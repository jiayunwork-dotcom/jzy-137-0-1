import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../errors.js'
import { JobProcessor } from '../domain/pipeline.js'
import type { CountedCycle, DamageConfig, PvState } from '../domain/types.js'
import type { DB } from './db.js'

export interface JobRow {
  id: string
  name: string | null
  material: string
  sn_c: number
  sn_m: number
  correction: 'none' | 'goodman'
  ultimate_strength: number | null
  gate: number
  status: 'open' | 'finalized'
  last_seq: number
  last_block_hash: string | null
  last_block_points: number
  last_block_cycles: number
  cycle_rows: number
  total_count: number
  total_damage: number
  created_at: string
  finalized_at: string | null
}

export interface CycleRow {
  idx: number
  range: number
  amplitude: number
  mean: number
  count: number
  damage: number
}

export interface NewJob {
  name?: string
  material: string
  snCurve: { C: number; m: number }
  correction: 'none' | 'goodman'
  ultimateStrength?: number
  gate: number
}

export interface BlockOutcome {
  idempotent: boolean
  pointsAccepted: number
  cyclesEmitted: number
  job: JobRow
}

export interface FinalizeOutcome {
  idempotent: boolean
  cyclesEmitted: number
  job: JobRow
}

const INITIAL_PV: PvState = { started: false, last: 0, dir: 0, extreme: 0 }

/**
 * Job persistence: configuration, incremental pipeline state, cycle log and
 * running totals. Every block is applied inside a single SQLite transaction
 * (state update + cycle inserts + totals), so the database never holds a
 * half-applied block.
 */
export class JobStore {
  private readonly db: DB

  constructor(db: DB) {
    this.db = db
  }

  createJob(input: NewJob): JobRow {
    const id = randomUUID()
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jobs (id, name, material, sn_c, sn_m, correction, ultimate_strength, gate, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name ?? null,
          input.material,
          input.snCurve.C,
          input.snCurve.m,
          input.correction,
          input.ultimateStrength ?? null,
          input.gate,
          now,
        )
      this.db
        .prepare('INSERT INTO job_state (job_id, pv_state, residual) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(INITIAL_PV), '[]')
    })
    tx()
    return this.getJobOrThrow(id)
  }

  getJob(id: string): JobRow | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
  }

  getJobOrThrow(id: string): JobRow {
    const job = this.getJob(id)
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', `job ${id} not found`)
    return job
  }

  listJobs(): JobRow[] {
    return this.db.prepare('SELECT * FROM jobs ORDER BY rowid').all() as JobRow[]
  }

  /**
   * Append one block to a job.
   *
   * Sequence rules:
   *  - seq must be exactly last_seq + 1 (gaps are rejected);
   *  - re-sending the last applied seq with identical content (SHA-256 of
   *    the points array) is an idempotent no-op and returns the stored
   *    outcome of that block;
   *  - re-sending an applied seq with different content is a conflict.
   */
  applyBlock(jobId: string, seq: number, points: number[]): BlockOutcome {
    const job = this.getJobOrThrow(jobId)
    if (job.status === 'finalized') {
      throw new AppError(409, 'JOB_FINALIZED', `job ${jobId} is finalized and accepts no more blocks`)
    }
    const hash = createHash('sha256').update(JSON.stringify(points)).digest('hex')
    if (seq <= job.last_seq) {
      if (seq === job.last_seq && hash === job.last_block_hash) {
        return {
          idempotent: true,
          pointsAccepted: job.last_block_points,
          cyclesEmitted: job.last_block_cycles,
          job,
        }
      }
      throw new AppError(409, 'SEQ_CONFLICT', `block seq ${seq} was already applied with different content`)
    }
    if (seq !== job.last_seq + 1) {
      throw new AppError(409, 'SEQ_GAP', `blocks must be appended in order: expected seq ${job.last_seq + 1}, got ${seq}`)
    }

    const tx = this.db.transaction(() => {
      const proc = this.loadProcessor(job)
      const cycles = proc.process(points)
      const totals = this.persistCycles(job, proc, cycles)
      this.db
        .prepare(
          `UPDATE jobs
           SET last_seq = ?, last_block_hash = ?, last_block_points = ?, last_block_cycles = ?,
               cycle_rows = ?, total_count = ?, total_damage = ?
           WHERE id = ?`,
        )
        .run(seq, hash, points.length, cycles.length, totals.cycleRows, totals.totalCount, totals.totalDamage, job.id)
      return cycles.length
    })
    const emitted = tx()
    return { idempotent: false, pointsAccepted: points.length, cyclesEmitted: emitted, job: this.getJobOrThrow(jobId) }
  }

  /**
   * Explicit end-of-history: fold the residual sequence into half cycles
   * and close the job. Idempotent — finalizing twice returns the same
   * totals and emits nothing the second time.
   */
  finalize(jobId: string): FinalizeOutcome {
    const job = this.getJobOrThrow(jobId)
    if (job.status === 'finalized') {
      return { idempotent: true, cyclesEmitted: 0, job }
    }
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      const proc = this.loadProcessor(job)
      const cycles = proc.finalize()
      const totals = this.persistCycles(job, proc, cycles)
      this.db
        .prepare(
          `UPDATE jobs
           SET status = 'finalized', finalized_at = ?, cycle_rows = ?, total_count = ?, total_damage = ?
           WHERE id = ?`,
        )
        .run(now, totals.cycleRows, totals.totalCount, totals.totalDamage, job.id)
      return cycles.length
    })
    const emitted = tx()
    return { idempotent: false, cyclesEmitted: emitted, job: this.getJobOrThrow(jobId) }
  }

  getCycles(jobId: string, offset: number, limit: number): CycleRow[] {
    return this.db
      .prepare('SELECT idx, range, amplitude, mean, count, damage FROM cycles WHERE job_id = ? ORDER BY idx LIMIT ? OFFSET ?')
      .all(jobId, limit, offset) as CycleRow[]
  }

  /** Current residual (unclosed) turning-point sequence of the kernel. */
  getResidual(jobId: string): number[] {
    const row = this.db.prepare('SELECT residual FROM job_state WHERE job_id = ?').get(jobId) as
      | { residual: string }
      | undefined
    return row ? (JSON.parse(row.residual) as number[]) : []
  }

  private damageConfig(job: JobRow): DamageConfig & { gate: number } {
    return {
      snCurve: { C: job.sn_c, m: job.sn_m },
      correction: job.correction,
      ultimateStrength: job.ultimate_strength ?? undefined,
      gate: job.gate,
    }
  }

  private loadProcessor(job: JobRow): JobProcessor {
    const row = this.db.prepare('SELECT pv_state, residual FROM job_state WHERE job_id = ?').get(job.id) as {
      pv_state: string
      residual: string
    }
    return new JobProcessor(this.damageConfig(job), {
      pv: JSON.parse(row.pv_state) as PvState,
      residual: JSON.parse(row.residual) as number[],
    })
  }

  /**
   * Insert the emitted cycles and fold them into the running totals.
   *
   * Totals are accumulated one cycle at a time, in emission order, so the
   * floating-point summation sequence is identical for every possible
   * chunking of the same series — chunked and one-shot ingestion produce
   * bit-identical damage.
   */
  private persistCycles(
    job: JobRow,
    proc: JobProcessor,
    cycles: CountedCycle[],
  ): { cycleRows: number; totalCount: number; totalDamage: number } {
    const insert = this.db.prepare(
      'INSERT INTO cycles (job_id, idx, range, amplitude, mean, count, damage) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    let idx = job.cycle_rows
    let totalCount = job.total_count
    let totalDamage = job.total_damage
    for (const c of cycles) {
      insert.run(job.id, idx, c.range, c.amplitude, c.mean, c.count, c.damage)
      idx += 1
      totalCount += c.count
      totalDamage += c.damage
    }
    const state = proc.getState()
    this.db
      .prepare('UPDATE job_state SET pv_state = ?, residual = ? WHERE job_id = ?')
      .run(JSON.stringify(state.pv), JSON.stringify(state.residual), job.id)
    return { cycleRows: idx, totalCount, totalDamage }
  }
}
