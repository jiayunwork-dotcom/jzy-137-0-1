import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { AppError } from '../errors.js'
import { openDatabase } from '../storage/db.js'
import { JobStore } from '../storage/jobStore.js'
import { registerRoutes } from './routes.js'

export interface AppOptions {
  dbPath: string
  logger?: boolean
}

function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: err.message, code: err.code })
  }
  const e = err as FastifyError
  if (e.validation) {
    return reply.code(400).send({ error: `invalid request: ${e.message}`, code: 'VALIDATION' })
  }
  const status = typeof e.statusCode === 'number' && e.statusCode >= 400 ? e.statusCode : 500
  if (status >= 500) req.log.error(e)
  return reply.code(status).send({ error: e.message || 'internal error', code: e.code ?? 'INTERNAL' })
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const db = openDatabase(opts.dbPath)
  const store = new JobStore(db)
  const app = Fastify({
    logger: opts.logger ?? false,
    // 200k-point blocks are ~4 MB of JSON; keep headroom.
    bodyLimit: 64 * 1024 * 1024,
  })
  app.setErrorHandler(errorHandler)
  registerRoutes(app, store)
  app.addHook('onClose', async () => {
    db.close()
  })
  return app
}
