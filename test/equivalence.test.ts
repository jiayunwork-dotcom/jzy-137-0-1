import { beforeAll, describe, expect, it } from 'vitest'
import {
  appendBlock,
  createJob,
  finalizeJob,
  getResult,
  makeApp,
  randomChunks,
  randomIntSeries,
  runSeries,
} from './helpers.js'

const series = randomIntSeries(12345, 1500)

const CONFIGS = [
  { snCurve: { C: 1e12, m: 4 }, meanStressCorrection: 'none', hysteresisGate: 0 },
  { snCurve: { C: 1e12, m: 4 }, meanStressCorrection: 'none', hysteresisGate: 7 },
]

describe('chunking invariance: any block layout yields identical cycles and damage', () => {
  for (const cfg of CONFIGS) {
    describe(`hysteresisGate=${cfg.hysteresisGate}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let reference: any
      beforeAll(async () => {
        reference = await runSeries(makeApp(), cfg, [series])
      })

      const chunkings: Record<string, number[][]> = {
        'single block': [series],
        'point by point': series.map((x) => [x]),
        'random chunks': randomChunks(series, 999, 53),
        'two halves': [series.slice(0, 777), series.slice(777)],
      }

      for (const [name, chunks] of Object.entries(chunkings)) {
        it(name, async () => {
          const result = await runSeries(makeApp(), cfg, chunks)
          expect(result.cycles).toEqual(reference.cycles)
          expect(result.damage).toBe(reference.damage)
          expect(result.totalCount).toBe(reference.totalCount)
          expect(result.cycleCount).toBe(reference.cycleCount)
        })
      }
    })
  }
})

describe('intermediate queries', () => {
  it('report only confirmed cycles; the residual is folded into half cycles at finalize', async () => {
    const app = makeApp()
    const job = (await createJob(app, { snCurve: { C: 1000, m: 3 } })).json()
    // Turning points trickle out of the filter as: 0,10,2 (b1), 8 (b2),
    // 4 (b3), 9 (b4); the kernel closes the first full cycle only at b4.
    const blocks = [
      [0, 10, 2, 8],
      [4],
      [9],
      [1],
    ]
    const expectedCycleCounts = [0, 0, 0, 1]
    const expectedResiduals = [3, 4, 5, 4]
    for (let i = 0; i < blocks.length; i++) {
      const res = await appendBlock(app, job.id, i + 1, blocks[i])
      expect(res.statusCode).toBe(201)
      const body = (await getResult(app, job.id)).json()
      expect(body.cycleCount).toBe(expectedCycleCounts[i])
      expect(body.residualLength).toBe(expectedResiduals[i])
    }

    // After block 4 exactly one full cycle is confirmed: range 4, mean 6.
    const mid = (await getResult(app, job.id)).json()
    expect(mid.cycles).toEqual([{ index: 0, range: 4, amplitude: 2, mean: 6, count: 1, damage: 8 / 1000 }])
    expect(mid.damage).toBe(8 / 1000)

    // Finalize: the residual closes one more full cycle and two half cycles.
    const fin = await finalizeJob(app, job.id)
    expect(fin.statusCode).toBe(200)
    expect(fin.json().cyclesEmitted).toBe(3)
    const final = (await getResult(app, job.id)).json()
    expect(final.residualLength).toBe(0)
    // The intermediate result is a strict prefix of the final cycle list.
    expect(final.cycles.slice(0, 1)).toEqual(mid.cycles)
    expect(final.cycles.slice(1)).toEqual([
      { index: 1, range: 7, amplitude: 3.5, mean: 5.5, count: 1, damage: 42.875 / 1000 },
      { index: 2, range: 10, amplitude: 5, mean: 5, count: 0.5, damage: 62.5 / 1000 },
      { index: 3, range: 9, amplitude: 4.5, mean: 5.5, count: 0.5, damage: 45.5625 / 1000 },
    ])
    expect(final.damage).toBe((8 + 42.875 + 62.5 + 45.5625) / 1000)
  })
})
