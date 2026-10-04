import { describe, expect, it } from 'vitest'
import { PeakValleyFilter } from '../src/domain/peakvalley.js'
import { randomChunks, randomIntSeries } from './helpers.js'

/** Run a whole series through the filter (including flush) and collect the
 *  emitted turning points. */
function turningPoints(points: number[], gate = 0): number[] {
  const filter = new PeakValleyFilter(gate)
  const out: number[] = []
  for (const x of points) out.push(...filter.push(x))
  out.push(...filter.flush())
  return out
}

describe('PeakValleyFilter', () => {
  it.each([
    // same-direction runs merge into one extreme
    [[1, 2, 3, 2, 1], [1, 3, 1]],
    [[1, 2, 3, 4], [1, 4]],
    [[4, 3, 2, 1], [4, 1]],
    // plateaus collapse to a single value
    [[1, 2, 2, 2, 1], [1, 2, 1]],
    [[2, 2, 3, 1], [2, 3, 1]],
    [[3, 1, 1, 2], [3, 1, 2]],
    [[2, 1, 1, 0], [2, 0]],
    // degenerate inputs
    [[5, 5, 5], [5]],
    [[7], [7]],
  ])('turning points of %j are %j', (input, expected) => {
    expect(turningPoints(input)).toEqual(expected)
  })

  it('drops reversals whose swing does not exceed the gate', () => {
    // dip 4 -> 3 has swing 1 <= gate: filtered out entirely
    expect(turningPoints([0, 4, 3, 5], 2)).toEqual([0, 5])
    // dip 4 -> 1 has swing 3 > gate: kept
    expect(turningPoints([0, 4, 1, 5], 2)).toEqual([0, 4, 1, 5])
    // trailing sub-gate wiggle is dropped at flush, keeping the extreme
    expect(turningPoints([0, 10, 9.5, 12], 1)).toEqual([0, 12])
    expect(turningPoints([0, 10, 8, 12], 1)).toEqual([0, 10, 8, 12])
  })

  it('handles a block boundary exactly on a peak', () => {
    const filter = new PeakValleyFilter()
    const out: number[] = []
    for (const x of [1, 2, 3]) out.push(...filter.push(x))
    for (const x of [2, 1]) out.push(...filter.push(x))
    out.push(...filter.flush())
    expect(out).toEqual([1, 3, 1])
  })

  it('is invariant under arbitrary chunking of the same series', () => {
    const series = randomIntSeries(42, 5000)
    for (const gate of [0, 3]) {
      const whole = turningPoints(series, gate)
      for (const chunks of [randomChunks(series, 7, 25), series.map((x) => [x])]) {
        const filter = new PeakValleyFilter(gate)
        const out: number[] = []
        for (const chunk of chunks) for (const x of chunk) out.push(...filter.push(x))
        out.push(...filter.flush())
        expect(out).toEqual(whole)
      }
    }
  })
})
