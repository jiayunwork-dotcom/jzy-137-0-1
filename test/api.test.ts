import { describe, expect, it } from 'vitest'
import {
  appendBlock,
  createJob,
  finalizeJob,
  getResult,
  makeApp,
} from './helpers.js'

describe('block sequence rules', () => {
  it('rejects gaps and conflicting duplicates; identical resubmission is idempotent', async () => {
    const app = makeApp()
    const job = (await createJob(app)).json()

    // gap: first block must have seq 1
    let res = await appendBlock(app, job.id, 2, [1, 2, 3])
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/expected seq 1/)

    res = await appendBlock(app, job.id, 1, [1, 2, 3])
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ idempotent: false, pointsAccepted: 3 })
    const afterFirst = (await getResult(app, job.id)).json()

    // identical resubmission of the last block: idempotent no-op
    res = await appendBlock(app, job.id, 1, [1, 2, 3])
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ idempotent: true, pointsAccepted: 3 })
    const afterReplay = (await getResult(app, job.id)).json()
    expect(afterReplay.cycleCount).toBe(afterFirst.cycleCount)
    expect(afterReplay.damage).toBe(afterFirst.damage)
    expect(afterReplay.lastSeq).toBe(1)

    // same seq, different content: conflict
    res = await appendBlock(app, job.id, 1, [1, 2, 4])
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/different content/)

    // gap after the applied block
    res = await appendBlock(app, job.id, 3, [9])
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/expected seq 2/)

    // the correct next seq is accepted
    res = await appendBlock(app, job.id, 2, [4, 5])
    expect(res.statusCode).toBe(201)
    expect((await getResult(app, job.id)).json().lastSeq).toBe(2)
  })

  it('rejects appends after finalize; finalize itself is idempotent', async () => {
    const app = makeApp()
    const job = (await createJob(app)).json()
    await appendBlock(app, job.id, 1, [0, 10, 0])
    const fin1 = await finalizeJob(app, job.id)
    expect(fin1.statusCode).toBe(200)
    expect(fin1.json()).toMatchObject({ idempotent: false, status: 'finalized' })

    const fin2 = await finalizeJob(app, job.id)
    expect(fin2.statusCode).toBe(200)
    expect(fin2.json()).toMatchObject({ idempotent: true, status: 'finalized' })
    expect(fin2.json().damage).toBe(fin1.json().damage)
    expect(fin2.json().cycleCount).toBe(fin1.json().cycleCount)

    const res = await appendBlock(app, job.id, 2, [1])
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/finalized/)
  })

  it('finalizing an empty job yields zero cycles', async () => {
    const app = makeApp()
    const job = (await createJob(app)).json()
    const fin = await finalizeJob(app, job.id)
    expect(fin.statusCode).toBe(200)
    expect(fin.json()).toMatchObject({ cycleCount: 0, damage: 0 })
  })
})

describe('request validation', () => {
  it('rejects invalid blocks with clear errors', async () => {
    const app = makeApp()
    const job = (await createJob(app)).json()
    const post = (payload: unknown) =>
      app.inject({ method: 'POST', url: `/jobs/${job.id}/blocks`, payload: payload as never })

    let res = await post({ seq: 1, points: [] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/non-empty/)

    res = await post({ seq: 1, points: 'not-an-array' })
    expect(res.statusCode).toBe(400)

    res = await post({ seq: 1, points: [1, 'x', 3] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/points\[1\] must be a finite number/)

    res = await post({ seq: 1, points: [1, null] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/finite number/)

    res = await post({ seq: 0, points: [1] })
    expect(res.statusCode).toBe(400)

    res = await post({ seq: 1.5, points: [1] })
    expect(res.statusCode).toBe(400)

    // raw NaN literal is not valid JSON
    res = await app.inject({
      method: 'POST',
      url: `/jobs/${job.id}/blocks`,
      headers: { 'content-type': 'application/json' },
      payload: '{"seq":1,"points":[1,NaN]}',
    })
    expect(res.statusCode).toBe(400)

    // one point over the limit
    res = await post({ seq: 1, points: new Array(200_001).fill(1) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/200000/)

    // exactly at the limit is accepted
    res = await post({ seq: 1, points: new Array(200_000).fill(1) })
    expect(res.statusCode).toBe(201)
  })

  it('rejects invalid job configurations', async () => {
    const app = makeApp()
    let res = await app.inject({ method: 'POST', url: '/jobs', payload: { material: 'x', meanStressCorrection: 'none' } })
    expect(res.statusCode).toBe(400)

    res = await createJob(app, { snCurve: { C: 1e12, m: -3 } })
    expect(res.statusCode).toBe(400)

    res = await createJob(app, { meanStressCorrection: 'goodman' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/ultimateStrength/)

    res = await createJob(app, { meanStressCorrection: 'goodman', ultimateStrength: 500 })
    expect(res.statusCode).toBe(201)

    res = await createJob(app, { meanStressCorrection: 'morrow' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for unknown jobs', async () => {
    const app = makeApp()
    let res = await app.inject({ method: 'GET', url: '/jobs/nope' })
    expect(res.statusCode).toBe(404)
    res = await appendBlock(app, 'nope', 1, [1])
    expect(res.statusCode).toBe(404)
    res = await getResult(app, 'nope')
    expect(res.statusCode).toBe(404)
    res = await finalizeJob(app, 'nope')
    expect(res.statusCode).toBe(404)
  })
})

describe('Goodman mean-stress correction via the API', () => {
  const CFG = {
    snCurve: { C: 1000, m: 2 },
    meanStressCorrection: 'goodman',
    ultimateStrength: 200,
  }

  it('amplifies tensile means only', async () => {
    const app = makeApp()
    // [0,100,0] -> two half cycles, amplitude 50, mean 50 (tensile)
    const tensile = await runSeriesLike(app, CFG, [0, 100, 0])
    const sEq = 50 / (1 - 50 / 200)
    expect(tensile.cycles).toHaveLength(2)
    expect(tensile.cycles[0].damage).toBeCloseTo((0.5 * sEq ** 2) / 1000, 12)
    expect(tensile.damage).toBeCloseTo((2 * 0.5 * sEq ** 2) / 1000, 12)

    // [0,-100,0] -> two half cycles, amplitude 50, mean -50 (compressive):
    // no amplification
    const compressive = await runSeriesLike(app, CFG, [0, -100, 0])
    expect(compressive.damage).toBeCloseTo((2 * 0.5 * 50 ** 2) / 1000, 12)
  })

  it('matches the uncorrected result for purely compressive means', async () => {
    const app = makeApp()
    const goodman = await runSeriesLike(app, CFG, [0, -100, 0])
    const uncorrected = await runSeriesLike(
      app,
      { snCurve: { C: 1000, m: 2 }, meanStressCorrection: 'none' },
      [0, -100, 0],
    )
    expect(goodman.damage).toBe(uncorrected.damage)
  })
})

async function runSeriesLike(app: ReturnType<typeof makeApp>, cfg: Record<string, unknown>, points: number[]) {
  const job = (await createJob(app, cfg)).json()
  await appendBlock(app, job.id, 1, points)
  await finalizeJob(app, job.id)
  return (await getResult(app, job.id)).json()
}
