import { describe, expect, it } from 'vitest'
import { makeApp, randomChunks, randomIntSeries, runSeries } from './helpers.js'

// Integer-valued series keep every downstream value exactly representable,
// so scaled/shifted/negated results can be compared with strict equality.
const base = randomIntSeries(777, 3000)
const M = 4
const CFG = { snCurve: { C: 1e9, m: M }, meanStressCorrection: 'none' }

describe('series transformations (no mean-stress correction)', () => {
  it('scaling by 2 scales amplitudes and means by 2 and damage by 2^m', async () => {
    const r1 = await runSeries(makeApp(), CFG, randomChunks(base, 1))
    const r2 = await runSeries(makeApp(), CFG, randomChunks(base.map((x) => x * 2), 2))
    expect(r2.cycleCount).toBe(r1.cycleCount)
    for (const [i, c1] of r1.cycles.entries()) {
      const c2 = r2.cycles[i]
      expect(c2.range).toBe(c1.range * 2)
      expect(c2.amplitude).toBe(c1.amplitude * 2)
      expect(c2.mean).toBe(c1.mean * 2)
      expect(c2.count).toBe(c1.count)
    }
    expect(r2.damage).toBe(r1.damage * 2 ** M)
  })

  it('shifting by a constant shifts every mean and leaves ranges and damage unchanged', async () => {
    const SHIFT = 37
    const r1 = await runSeries(makeApp(), CFG, randomChunks(base, 3))
    const r2 = await runSeries(makeApp(), CFG, randomChunks(base.map((x) => x + SHIFT), 4))
    expect(r2.cycleCount).toBe(r1.cycleCount)
    for (const [i, c1] of r1.cycles.entries()) {
      const c2 = r2.cycles[i]
      expect(c2.range).toBe(c1.range)
      expect(c2.amplitude).toBe(c1.amplitude)
      expect(c2.mean).toBe(c1.mean + SHIFT)
      expect(c2.count).toBe(c1.count)
    }
    expect(r2.damage).toBe(r1.damage)
  })

  it('negating negates the means and leaves amplitudes and damage unchanged', async () => {
    const r1 = await runSeries(makeApp(), CFG, randomChunks(base, 5))
    const r2 = await runSeries(makeApp(), CFG, randomChunks(base.map((x) => -x), 6))
    expect(r2.cycleCount).toBe(r1.cycleCount)
    for (const [i, c1] of r1.cycles.entries()) {
      const c2 = r2.cycles[i]
      expect(c2.range).toBe(c1.range)
      expect(c2.amplitude).toBe(c1.amplitude)
      // +0/-0 normalize: a zero mean may come out as -0 after negation
      expect(c2.mean + 0).toBe(-c1.mean + 0)
      expect(c2.count).toBe(c1.count)
    }
    expect(r2.damage).toBe(r1.damage)
  })
})
