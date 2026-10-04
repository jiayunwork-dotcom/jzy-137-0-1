/**
 * Shared domain types for the rainflow / damage pipeline.
 */

/** Basquin S-N curve: N = C * S^(-m) */
export interface SnCurve {
  /** Basquin coefficient C (must be > 0) */
  C: number
  /** Basquin exponent m (must be > 0) */
  m: number
}

export type MeanStressCorrection = 'none' | 'goodman'

export interface DamageConfig {
  snCurve: SnCurve
  correction: MeanStressCorrection
  /** Ultimate tensile strength; required when correction === 'goodman'. */
  ultimateStrength?: number
}

/** One rainflow cycle extracted from the turning-point stream. */
export interface Cycle {
  /** peak-to-valley range */
  range: number
  /** (peak + valley) / 2 */
  mean: number
  /** 1 for a closed (full) cycle, 0.5 for a half cycle */
  count: number
}

/** A cycle enriched with amplitude and its Miner damage contribution. */
export interface CountedCycle extends Cycle {
  /** range / 2 */
  amplitude: number
  /** damage = count * S_eq^m / C (S_eq = mean-stress-corrected amplitude) */
  damage: number
}

/**
 * Serializable state of the streaming peak/valley filter.
 * Persisted between blocks so chunk boundaries are invisible to the algorithm.
 */
export interface PvState {
  /** whether any point has been seen yet */
  started: boolean
  /** value of the last emitted turning point */
  last: number
  /** direction of travel since the last emitted turning point: 1 up, -1 down, 0 undetermined */
  dir: -1 | 0 | 1
  /** most extreme value seen since the last emitted turning point */
  extreme: number
}
