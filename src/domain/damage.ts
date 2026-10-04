import type { CountedCycle, Cycle, DamageConfig } from './types.js'

/**
 * Mean-stress correction of the stress amplitude.
 *
 *  - 'none':    the amplitude is used as-is.
 *  - 'goodman': a tensile mean (Sm > 0) amplifies the amplitude to
 *               Sa / (1 - Sm/Su); a compressive or zero mean leaves it
 *               unchanged (no amplification, per requirement).
 *
 * Returns Infinity when the tensile mean alone reaches or exceeds the
 * ultimate strength (static failure — the Goodman denominator vanishes).
 */
export function correctedAmplitude(
  amplitude: number,
  mean: number,
  cfg: DamageConfig,
): number {
  if (cfg.correction === 'goodman' && mean > 0) {
    const su = cfg.ultimateStrength
    if (su === undefined || !(su > 0)) {
      throw new Error('Goodman correction requires a positive ultimateStrength')
    }
    const denom = 1 - mean / su
    if (denom <= 0) return Infinity
    return amplitude / denom
  }
  return amplitude
}

/**
 * Palmgren-Miner damage of one cycle against a Basquin S-N curve
 * N = C * S^(-m), i.e. damage per occurrence = S^m / C, weighted by the
 * cycle count (1 or 0.5).
 */
export function cycleDamage(cycle: Cycle, cfg: DamageConfig): CountedCycle {
  const amplitude = cycle.range / 2
  const s = correctedAmplitude(amplitude, cycle.mean, cfg)
  const damage = (cycle.count * Math.pow(s, cfg.snCurve.m)) / cfg.snCurve.C
  return { ...cycle, amplitude, damage }
}
