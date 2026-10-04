import type { Cycle } from './types.js'

/**
 * Rainflow counting kernel per ASTM E1049 (three-point stack method).
 *
 * The kernel consumes turning points one at a time and maintains the
 * residual (unclosed) sequence on a stack. For each new point, with
 * X = |newest range| and Y = |previous range|:
 *
 *  - X < Y:            nothing closes; the point stays on the stack.
 *  - X >= Y, len == 3: the first pair forms a half cycle; drop the first
 *                      point (this half cycle is final — it appears in the
 *                      result no matter what arrives later).
 *  - X >= Y, len > 3:  the middle pair forms a closed (full) cycle;
 *                      remove both points and re-check.
 *
 * `finalize()` converts the remaining residual sequence into half cycles,
 * one per adjacent pair, as prescribed by the standard for the residue.
 *
 * The residual stack is the only state, so the kernel can be persisted and
 * resumed across blocks; emitted cycles are append-only, which makes every
 * intermediate result a strict prefix of the final cycle list.
 */
export class RainflowCounter {
  private residual: number[]

  constructor(residual?: number[]) {
    this.residual = residual ? [...residual] : []
  }

  /** The current residual (unclosed) turning-point sequence. */
  getResidual(): number[] {
    return [...this.residual]
  }

  /** Feed one turning point; returns the cycles closed by it (if any). */
  push(point: number): Cycle[] {
    const s = this.residual
    const out: Cycle[] = []
    s.push(point)
    while (s.length >= 3) {
      const x = Math.abs(s[s.length - 1] - s[s.length - 2])
      const y = Math.abs(s[s.length - 2] - s[s.length - 3])
      if (x < y) break
      if (s.length === 3) {
        out.push({ range: y, mean: (s[0] + s[1]) / 2, count: 0.5 })
        s.shift()
      } else {
        out.push({
          range: y,
          mean: (s[s.length - 3] + s[s.length - 2]) / 2,
          count: 1,
        })
        s.splice(s.length - 3, 2)
      }
    }
    return out
  }

  /**
   * Drain the residual sequence into half cycles (standard end-of-history
   * treatment). The kernel is empty afterwards.
   */
  finalize(): Cycle[] {
    const s = this.residual
    const out: Cycle[] = []
    for (let i = 0; i + 1 < s.length; i++) {
      out.push({
        range: Math.abs(s[i + 1] - s[i]),
        mean: (s[i] + s[i + 1]) / 2,
        count: 0.5,
      })
    }
    s.length = 0
    return out
  }
}
