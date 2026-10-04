import type { PvState } from './types.js'

/**
 * Streaming peak/valley (turning point) extraction with an optional
 * hysteresis gate.
 *
 * Consumes the raw point stream and emits the compressed turning-point
 * sequence:
 *  - adjacent points moving in the same direction are merged (only the
 *    current extreme is kept),
 *  - plateaus (runs of equal values) are collapsed to a single value,
 *  - a reversal is only accepted when its swing exceeds `gate`; smaller
 *    wiggles are dropped before counting (hysteresis filtering),
 *  - the first point of the series is always kept; `flush()` emits the
 *    trailing extreme so the series end becomes a turning point.
 *
 * The filter is a pure function of the concatenated input stream: all of
 * its state lives in {@link PvState} (four scalars), which is persisted
 * between blocks. Feeding the same series in any chunking therefore yields
 * exactly the same turning points.
 */
export class PeakValleyFilter {
  private readonly gate: number
  private state: PvState

  constructor(gate = 0, state?: PvState) {
    if (!(gate >= 0)) throw new Error('hysteresis gate must be >= 0')
    this.gate = gate
    this.state = state
      ? { ...state }
      : { started: false, last: 0, dir: 0, extreme: 0 }
  }

  getState(): PvState {
    return { ...this.state }
  }

  /**
   * Feed one raw point. Returns the turning points emitted by this point
   * (empty array, or a single turning point).
   */
  push(x: number): number[] {
    const st = this.state
    if (!st.started) {
      st.started = true
      st.last = x
      st.extreme = x
      return [x]
    }
    if (st.dir === 0) {
      // No direction established yet (all points equal so far).
      if (x > st.last) {
        st.dir = 1
        st.extreme = x
      } else if (x < st.last) {
        st.dir = -1
        st.extreme = x
      }
      return []
    }
    if (st.dir === 1) {
      if (x >= st.extreme) {
        st.extreme = x
        return []
      }
      if (st.extreme - x > this.gate) {
        const peak = st.extreme
        st.last = peak
        st.dir = -1
        st.extreme = x
        return [peak]
      }
      // Sub-gate dip: ignore, still heading up.
      return []
    }
    // dir === -1
    if (x <= st.extreme) {
      st.extreme = x
      return []
    }
    if (x - st.extreme > this.gate) {
      const valley = st.extreme
      st.last = valley
      st.dir = 1
      st.extreme = x
      return [valley]
    }
    // Sub-gate rise: ignore, still heading down.
    return []
  }

  /**
   * End-of-series handling: emit the pending extreme (if any) so the tail
   * of the series becomes the final turning point. A trailing sub-gate
   * wiggle is dropped, consistent with the hysteresis semantics.
   */
  flush(): number[] {
    const st = this.state
    if (st.started && st.dir !== 0 && st.extreme !== st.last) {
      const tp = st.extreme
      st.last = tp
      st.dir = 0
      return [tp]
    }
    return []
  }
}
