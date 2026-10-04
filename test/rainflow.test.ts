import { describe, expect, it } from 'vitest'
import { RainflowCounter } from '../src/domain/rainflow.js'

function count(points: number[]) {
  const counter = new RainflowCounter()
  const cycles = []
  for (const p of points) cycles.push(...counter.push(p))
  const residualBeforeFinalize = counter.getResidual()
  cycles.push(...counter.finalize())
  return { cycles, residualBeforeFinalize }
}

describe('RainflowCounter (ASTM E1049)', () => {
  it('reproduces the classic example from the standard', () => {
    // ASTM E1049 rainflow example, turning points A..I:
    //   A=-2 B=1 C=-3 D=5 E=-1 F=3 G=-4 H=4 I=-2
    // Literature result: one closed cycle E-F (range 4, mean 1) and the
    // half cycles A-B, B-C, C-D, D-G, G-H, H-I.
    const { cycles } = count([-2, 1, -3, 5, -1, 3, -4, 4, -2])
    expect(cycles).toEqual([
      { range: 3, mean: -0.5, count: 0.5 }, // A-B
      { range: 4, mean: -1, count: 0.5 }, //   B-C
      { range: 4, mean: 1, count: 1 }, //     E-F (closed)
      { range: 8, mean: 1, count: 0.5 }, //   C-D
      { range: 9, mean: 0.5, count: 0.5 }, // D-G
      { range: 8, mean: 0, count: 0.5 }, //   G-H
      { range: 6, mean: 1, count: 0.5 }, //   H-I
    ])
  })

  it('extracts a closed cycle from the middle and keeps the residual', () => {
    const counter = new RainflowCounter()
    const emitted = []
    for (const p of [0, 10, 3, 7, 2]) emitted.push(...counter.push(p))
    expect(emitted).toEqual([{ range: 4, mean: 5, count: 1 }])
    expect(counter.getResidual()).toEqual([0, 10, 2])
    expect(counter.finalize()).toEqual([
      { range: 10, mean: 5, count: 0.5 },
      { range: 8, mean: 6, count: 0.5 },
    ])
  })

  it('emits nothing before any cycle closes and holds the residual', () => {
    const { cycles, residualBeforeFinalize } = count([0, 10, 2, 8])
    // all four points stay residual; finalize folds them into half cycles
    expect(residualBeforeFinalize).toEqual([0, 10, 2, 8])
    expect(cycles).toEqual([
      { range: 10, mean: 5, count: 0.5 },
      { range: 8, mean: 6, count: 0.5 },
      { range: 6, mean: 5, count: 0.5 },
    ])
  })

  it('counts a constant series as nothing', () => {
    const { cycles } = count([5])
    expect(cycles).toEqual([])
  })
})
