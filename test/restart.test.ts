import { describe, expect, it } from 'vitest'
import {
  appendBlock,
  createJob,
  finalizeJob,
  getResult,
  makeApp,
  newDbPath,
  randomChunks,
  randomIntSeries,
  runSeries,
} from './helpers.js'

describe('restart durability', () => {
  it('continues appending after a restart and matches the uninterrupted run', async () => {
    const dbPath = newDbPath()
    const series = randomIntSeries(31337, 1500)
    const chunks = randomChunks(series, 555, 30)
    const cfg = { snCurve: { C: 1e12, m: 3 }, meanStressCorrection: 'none', hysteresisGate: 2 }

    // Reference: same series, same chunking, no restart.
    const reference = await runSeries(makeApp(), cfg, chunks)

    // Interrupted run: apply the first half of the blocks, then "restart"
    // by closing the app and building a new one on the same database file.
    const app1 = makeApp(dbPath)
    const job = (await createJob(app1, cfg)).json()
    const half = Math.floor(chunks.length / 2)
    for (let i = 0; i < half; i++) {
      const res = await appendBlock(app1, job.id, i + 1, chunks[i])
      expect(res.statusCode).toBe(201)
    }
    await app1.close()

    const app2 = makeApp(dbPath)
    const meta = (await app2.inject({ method: 'GET', url: `/jobs/${job.id}` })).json()
    expect(meta.status).toBe('open')
    expect(meta.lastSeq).toBe(half)

    for (let i = half; i < chunks.length; i++) {
      const res = await appendBlock(app2, job.id, i + 1, chunks[i])
      expect(res.statusCode).toBe(201)
    }
    await finalizeJob(app2, job.id)
    const result = (await getResult(app2, job.id)).json()

    expect(result.cycles).toEqual(reference.cycles)
    expect(result.damage).toBe(reference.damage)
    expect(result.totalCount).toBe(reference.totalCount)
    await app2.close()
  })

  it('accepts an idempotent replay of the last pre-restart block', async () => {
    const dbPath = newDbPath()
    const app1 = makeApp(dbPath)
    const job = (await createJob(app1)).json()
    await appendBlock(app1, job.id, 1, [0, 5, 0])
    await app1.close()

    // Client retries its last block after the restart: must be a no-op.
    const app2 = makeApp(dbPath)
    const res = await appendBlock(app2, job.id, 1, [0, 5, 0])
    expect(res.statusCode).toBe(200)
    expect(res.json().idempotent).toBe(true)
    const next = await appendBlock(app2, job.id, 2, [3])
    expect(next.statusCode).toBe(201)
    await app2.close()
  })
})
