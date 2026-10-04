import { describe, expect, it } from 'vitest'
import { appendBlock, createJob, finalizeJob, getResult, makeApp, runSeries } from './helpers.js'

// ASTM E1049 rainflow example, turning points A..I:
//   A=-2 B=1 C=-3 D=5 E=-1 F=3 G=-4 H=4 I=-2
const ASTM_SERIES = [-2, 1, -3, 5, -1, 3, -4, 4, -2]

// Literature table: closed cycle E-F plus half cycles A-B, B-C, C-D, D-G,
// G-H, H-I (listed in emission order of the E1049 stack algorithm).
const EXPECTED_CYCLES = [
  { range: 3, mean: -0.5, count: 0.5 }, // A-B
  { range: 4, mean: -1, count: 0.5 }, //   B-C
  { range: 4, mean: 1, count: 1 }, //     E-F (closed)
  { range: 8, mean: 1, count: 0.5 }, //   C-D
  { range: 9, mean: 0.5, count: 0.5 }, // D-G
  { range: 8, mean: 0, count: 0.5 }, //   G-H
  { range: 6, mean: 1, count: 0.5 }, //   H-I
]

const CFG = { snCurve: { C: 1e12, m: 3 }, meanStressCorrection: 'none' }

describe('ASTM E1049 classic example', () => {
  it('matches the literature table cycle by cycle (single block)', async () => {
    const result = await runSeries(makeApp(), CFG, [ASTM_SERIES])
    expect(result.cycles.map((c: { range: number; mean: number; count: number }) => ({
      range: c.range,
      mean: c.mean,
      count: c.count,
    }))).toEqual(EXPECTED_CYCLES)
    // amplitudes are range/2
    for (const [i, c] of result.cycles.entries()) {
      expect(c.amplitude).toBe(EXPECTED_CYCLES[i].range / 2)
    }
    // damage accumulated in the same order as emitted
    const expectedDamage = EXPECTED_CYCLES.reduce(
      (d, c) => d + (c.count * Math.pow(c.range / 2, 3)) / 1e12,
      0,
    )
    expect(result.damage).toBe(expectedDamage)
    expect(result.totalCount).toBe(4) // 1 full + 6 half cycles
  })

  it('matches the same table when fed in chunks', async () => {
    const app = makeApp()
    const job = (await createJob(app, CFG)).json()
    const chunks = [[-2, 1], [-3, 5, -1], [3], [-4, 4, -2]]
    for (let i = 0; i < chunks.length; i++) {
      const res = await appendBlock(app, job.id, i + 1, chunks[i])
      expect(res.statusCode).toBe(201)
    }
    await finalizeJob(app, job.id)
    const result = (await getResult(app, job.id)).json()
    expect(result.cycles.map((c: { range: number; mean: number; count: number }) => ({
      range: c.range,
      mean: c.mean,
      count: c.count,
    }))).toEqual(EXPECTED_CYCLES)
  })
})
