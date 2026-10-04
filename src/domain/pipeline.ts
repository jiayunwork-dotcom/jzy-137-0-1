import { cycleDamage } from './damage.js'
import { PeakValleyFilter } from './peakvalley.js'
import { RainflowCounter } from './rainflow.js'
import type { CountedCycle, DamageConfig, PvState } from './types.js'

/** Fully serializable state of the processing pipeline of one job. */
export interface ProcessorState {
  pv: PvState
  residual: number[]
}

/**
 * Chains the three pipeline stages for one job:
 *
 *   raw points -> PeakValleyFilter -> RainflowCounter -> damage
 *
 * All state is held in the filter and the counter and can be snapshot via
 * {@link getState}; restoring a processor from a snapshot continues exactly
 * where the previous one stopped. This is what makes the result independent
 * of how the series is split into blocks.
 */
export class JobProcessor {
  private readonly cfg: DamageConfig & { gate: number }
  private readonly filter: PeakValleyFilter
  private readonly counter: RainflowCounter

  constructor(cfg: DamageConfig & { gate: number }, state?: ProcessorState) {
    this.cfg = cfg
    this.filter = new PeakValleyFilter(cfg.gate, state?.pv)
    this.counter = new RainflowCounter(state?.residual)
  }

  /** Process one block of raw points; returns newly confirmed cycles. */
  process(points: Iterable<number>): CountedCycle[] {
    const out: CountedCycle[] = []
    for (const x of points) {
      for (const tp of this.filter.push(x)) {
        for (const c of this.counter.push(tp)) {
          out.push(cycleDamage(c, this.cfg))
        }
      }
    }
    return out
  }

  /**
   * Explicit end-of-history: flush the pending extreme out of the filter,
   * run it through the counter, then fold the residual into half cycles.
   */
  finalize(): CountedCycle[] {
    const out: CountedCycle[] = []
    for (const tp of this.filter.flush()) {
      for (const c of this.counter.push(tp)) {
        out.push(cycleDamage(c, this.cfg))
      }
    }
    for (const c of this.counter.finalize()) {
      out.push(cycleDamage(c, this.cfg))
    }
    return out
  }

  getState(): ProcessorState {
    return { pv: this.filter.getState(), residual: this.counter.getResidual() }
  }

  /** Number of unclosed turning points currently held by the kernel. */
  getResidualLength(): number {
    return this.counter.getResidual().length
  }
}
