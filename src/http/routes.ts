import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors.js'
import type { JobStore } from '../storage/jobStore.js'
import {
  MAX_BLOCK_POINTS,
  blockBodySchema,
  createJobBodySchema,
  resultQuerySchema,
} from './schemas.js'
import { cycleJson, jobJson, totalsJson } from './serialize.js'

interface CreateJobBody {
  name?: string
  material: string
  snCurve: { C: number; m: number }
  meanStressCorrection: 'none' | 'goodman'
  ultimateStrength?: number
  hysteresisGate?: number
}

interface BlockBody {
  seq: number
  points: unknown
}

/** Domain-level validation of the points array with specific messages. */
function validatePoints(points: unknown): number[] {
  if (!Array.isArray(points) || points.length === 0) {
    throw new AppError(400, 'EMPTY_BLOCK', 'points must be a non-empty array of numbers')
  }
  if (points.length > MAX_BLOCK_POINTS) {
    throw new AppError(400, 'BLOCK_TOO_LARGE', `block exceeds the maximum of ${MAX_BLOCK_POINTS} points`)
  }
  for (let i = 0; i < points.length; i++) {
    const v = points[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new AppError(400, 'INVALID_POINT', `points[${i}] must be a finite number, got ${JSON.stringify(v)}`)
    }
  }
  return points as number[]
}

export function registerRoutes(app: FastifyInstance, store: JobStore): void {
  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/jobs', { schema: { body: createJobBodySchema } }, async (req, reply) => {
    const body = req.body as CreateJobBody
    if (body.meanStressCorrection === 'goodman' && body.ultimateStrength === undefined) {
      throw new AppError(400, 'GOODMAN_NEEDS_UTS', 'ultimateStrength is required when meanStressCorrection is "goodman"')
    }
    const job = store.createJob({
      name: body.name,
      material: body.material,
      snCurve: body.snCurve,
      correction: body.meanStressCorrection,
      ultimateStrength: body.ultimateStrength,
      gate: body.hysteresisGate ?? 0,
    })
    return reply.code(201).send(jobJson(job))
  })

  app.get('/jobs', async () => ({ jobs: store.listJobs().map(jobJson) }))

  app.get('/jobs/:id', async (req) => {
    const { id } = req.params as { id: string }
    return jobJson(store.getJobOrThrow(id))
  })

  app.post('/jobs/:id/blocks', { schema: { body: blockBodySchema } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as BlockBody
    const points = validatePoints(body.points)
    const outcome = store.applyBlock(id, body.seq, points)
    return reply.code(outcome.idempotent ? 200 : 201).send({
      jobId: id,
      seq: body.seq,
      idempotent: outcome.idempotent,
      pointsAccepted: outcome.pointsAccepted,
      cyclesEmitted: outcome.cyclesEmitted,
      ...totalsJson(outcome.job),
    })
  })

  app.get('/jobs/:id/result', { schema: { querystring: resultQuerySchema } }, async (req) => {
    const { id } = req.params as { id: string }
    const query = req.query as { offset?: number; limit?: number }
    const job = store.getJobOrThrow(id)
    const offset = query.offset ?? 0
    const limit = query.limit ?? -1 // -1 = all cycles
    return {
      jobId: id,
      ...totalsJson(job),
      residualLength: store.getResidual(id).length,
      offset,
      cycles: store.getCycles(id, offset, limit).map(cycleJson),
    }
  })

  app.post('/jobs/:id/finalize', async (req) => {
    const { id } = req.params as { id: string }
    const outcome = store.finalize(id)
    return {
      jobId: id,
      idempotent: outcome.idempotent,
      cyclesEmitted: outcome.cyclesEmitted,
      ...totalsJson(outcome.job),
      residualLength: 0,
    }
  })
}
