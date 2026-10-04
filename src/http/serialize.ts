import type { CycleRow, JobRow } from '../storage/jobStore.js'

/**
 * JSON has no Infinity: a damage that diverged (only possible with Goodman
 * correction when a tensile mean reaches the ultimate strength) is reported
 * as null, with `damageOverflow: true` on the summary.
 */
const finiteOrNull = (x: number): number | null => (Number.isFinite(x) ? x : null)

/** Running totals shared by the block/finalize/result responses. */
export function totalsJson(job: JobRow) {
  return {
    status: job.status,
    lastSeq: job.last_seq,
    cycleCount: job.cycle_rows,
    totalCount: job.total_count,
    damage: finiteOrNull(job.total_damage),
    damageOverflow: !Number.isFinite(job.total_damage),
  }
}

export function jobJson(job: JobRow) {
  return {
    id: job.id,
    name: job.name,
    material: job.material,
    snCurve: { C: job.sn_c, m: job.sn_m },
    meanStressCorrection: job.correction,
    ultimateStrength: job.ultimate_strength,
    hysteresisGate: job.gate,
    ...totalsJson(job),
    createdAt: job.created_at,
    finalizedAt: job.finalized_at,
  }
}

export function cycleJson(row: CycleRow) {
  return {
    index: row.idx,
    range: row.range,
    amplitude: row.amplitude,
    mean: row.mean,
    count: row.count,
    damage: finiteOrNull(row.damage),
  }
}
