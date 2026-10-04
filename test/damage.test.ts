import { describe, expect, it } from 'vitest'
import { correctedAmplitude, cycleDamage } from '../src/domain/damage.js'
import type { DamageConfig } from '../src/domain/types.js'

const none: DamageConfig = { snCurve: { C: 1000, m: 3 }, correction: 'none' }
const goodman: DamageConfig = {
  snCurve: { C: 1000, m: 2 },
  correction: 'goodman',
  ultimateStrength: 200,
}

describe('correctedAmplitude', () => {
  it('leaves the amplitude unchanged without correction', () => {
    expect(correctedAmplitude(50, 80, none)).toBe(50)
  })

  it('amplifies tensile means per Goodman', () => {
    // 1 / (1 - 50/200) = 1/0.75
    expect(correctedAmplitude(50, 50, goodman)).toBeCloseTo(50 / 0.75, 12)
  })

  it('does not amplify compressive or zero means', () => {
    expect(correctedAmplitude(50, -50, goodman)).toBe(50)
    expect(correctedAmplitude(50, 0, goodman)).toBe(50)
  })

  it('diverges when the tensile mean reaches the ultimate strength', () => {
    expect(correctedAmplitude(50, 200, goodman)).toBe(Infinity)
    expect(correctedAmplitude(50, 250, goodman)).toBe(Infinity)
  })
})

describe('cycleDamage (Palmgren-Miner + Basquin)', () => {
  it('damage = count * S^m / C', () => {
    const c = cycleDamage({ range: 20, mean: 5, count: 1 }, none)
    expect(c.amplitude).toBe(10)
    expect(c.damage).toBe(1000 / 1000) // 10^3 / 1000
  })

  it('half cycles contribute half the damage', () => {
    const c = cycleDamage({ range: 20, mean: 0, count: 0.5 }, none)
    expect(c.damage).toBe(0.5)
  })

  it('applies Goodman to the amplitude before accumulating', () => {
    const sEq = 50 / (1 - 50 / 200)
    const c = cycleDamage({ range: 100, mean: 50, count: 1 }, goodman)
    expect(c.damage).toBeCloseTo((sEq ** 2) / 1000, 12)
  })
})
