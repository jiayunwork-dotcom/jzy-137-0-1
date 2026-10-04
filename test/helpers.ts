import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, expect } from 'vitest'
import { buildApp } from '../src/http/app.js'

const createdDirs: string[] = []

export function newDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rainflow-test-'))
  createdDirs.push(dir)
  return join(dir, 'test.db')
}

export function makeApp(dbPath: string = newDbPath()): FastifyInstance {
  return buildApp({ dbPath })
}

afterAll(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

export const DEFAULT_JOB = {
  material: 'S355',
  snCurve: { C: 1e12, m: 3 },
  meanStressCorrection: 'none',
} as const

export async function createJob(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/jobs', payload: { ...DEFAULT_JOB, ...overrides } })
}

export async function appendBlock(app: FastifyInstance, jobId: string, seq: number, points: number[]) {
  return app.inject({ method: 'POST', url: `/jobs/${jobId}/blocks`, payload: { seq, points } })
}

export async function finalizeJob(app: FastifyInstance, jobId: string) {
  return app.inject({ method: 'POST', url: `/jobs/${jobId}/finalize` })
}

export async function getResult(app: FastifyInstance, jobId: string) {
  return app.inject({ method: 'GET', url: `/jobs/${jobId}/result` })
}

/** Deterministic PRNG so "random" series/chunkings are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer-valued series: keeps all downstream arithmetic exactly
 *  representable so results can be compared with strict equality. */
export function randomIntSeries(seed: number, length: number, lo = -100, hi = 100): number[] {
  const rand = mulberry32(seed)
  const out: number[] = []
  for (let i = 0; i < length; i++) out.push(lo + Math.floor(rand() * (hi - lo + 1)))
  return out
}

export function randomChunks(series: number[], seed: number, maxSize = 40): number[][] {
  const rand = mulberry32(seed)
  const chunks: number[][] = []
  let i = 0
  while (i < series.length) {
    const n = 1 + Math.floor(rand() * maxSize)
    chunks.push(series.slice(i, i + n))
    i += n
  }
  return chunks
}

/** Feed a series through one job in the given chunking, finalize, and
 *  return the final result body. */
export async function runSeries(
  app: FastifyInstance,
  jobConfig: Record<string, unknown>,
  chunks: number[][],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const create = await createJob(app, jobConfig)
  expect(create.statusCode).toBe(201)
  const job = create.json()
  for (let i = 0; i < chunks.length; i++) {
    const res = await appendBlock(app, job.id, i + 1, chunks[i])
    expect(res.statusCode).toBe(201)
  }
  const fin = await finalizeJob(app, job.id)
  expect(fin.statusCode).toBe(200)
  const result = await getResult(app, job.id)
  expect(result.statusCode).toBe(200)
  return result.json()
}
