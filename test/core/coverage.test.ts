import { describe, expect, it } from 'vitest'
import { fileCoverage, lineStatuses, pct, rollup } from '../../src/core/coverage'
import type { Status } from '../../src/core/resolve'
import { rec } from './fixtures'

const entry = (status: Status, range: [number, number], kind: 'lines' | 'file' = 'lines') => ({
  record: rec({ kind }),
  res: { status, range },
})

describe('fileCoverage', () => {
  const lines = ['a', '', 'b', 'c', '  ']

  it('counts confirmed code lines and skips blank ones', () => {
    expect(fileCoverage([entry('confirmed', [1, 3])], lines)).toEqual({ confirmed: 2, total: 3 })
  })

  it('ignores outdated and ambiguous records', () => {
    expect(fileCoverage([entry('outdated', [1, 5])], lines)).toEqual({ confirmed: 0, total: 3 })
  })

  it('a confirmed file record covers everything', () => {
    expect(fileCoverage([entry('confirmed', [1, 5], 'file')], lines)).toEqual({
      confirmed: 3,
      total: 3,
    })
  })

  it('has nothing to say about blank files', () => {
    expect(fileCoverage([], ['', ' '])).toBeNull()
  })
})

describe('pct and rollup', () => {
  it('only shows 100 and 0 when exact', () => {
    expect(pct({ confirmed: 9999, total: 10000 })).toBe(99)
    expect(pct({ confirmed: 1, total: 10000 })).toBe(1)
    expect(pct({ confirmed: 5, total: 5 })).toBe(100)
  })

  it('rolls up non-null parts', () => {
    expect(rollup([{ confirmed: 1, total: 2 }, null, { confirmed: 3, total: 4 }])).toEqual({
      confirmed: 4,
      total: 6,
    })
    expect(rollup([null])).toBeNull()
  })
})

describe('lineStatuses', () => {
  it('merges runs and never paints over confirmed lines', () => {
    const out = lineStatuses(
      [
        { status: 'outdated', range: [1, 10] },
        { status: 'confirmed', range: [3, 4] },
        { status: 'ambiguous', range: [9, 12] },
      ],
      11,
    )
    expect(out).toEqual([
      { status: 'outdated', range: [1, 2] },
      { status: 'confirmed', range: [3, 4] },
      { status: 'outdated', range: [5, 10] },
      { status: 'ambiguous', range: [11, 11] },
    ])
  })

  it('drops non-finite ranges', () => {
    expect(lineStatuses([{ status: 'confirmed', range: [NaN, 2] }], 5)).toEqual([])
  })
})
