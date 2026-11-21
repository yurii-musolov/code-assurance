import { describe, expect, it } from 'vitest'
import { applyDelta, computeDelta } from '../../src/core/baseline'
import { captureRange, DocModel, recordBaseline, resolveRecord } from '../../src/core/resolve'
import { fingerprints, hashText, splitLines } from '../../src/core/text'
import type { AssuranceRecord } from '../../src/core/types'
import { rec } from './fixtures'

const fileOf = (...lines: string[]): string => lines.join('\n') + '\n'

/** Confirm `range` of `text`, as if `committed` were the file at HEAD. */
function confirm(
  text: string,
  range: [number, number],
  committed: string | null = text,
  over: Partial<AssuranceRecord> = {},
): AssuranceRecord {
  const lines = splitLines(text)
  const r = rec({
    range,
    commit: committed === null ? '' : 'abc1234',
    ...captureRange(lines, range),
    ...over,
  })
  if (committed !== null && committed !== text) {
    const delta = computeDelta(fingerprints(splitLines(committed)), fingerprints(lines))
    if (delta) r.delta = delta
  }
  return r
}

/** Resolve against `now`, with the commit text available (or not). */
function resolve(r: AssuranceRecord, now: string, committed: string | null) {
  const commitFps = committed === null ? null : fingerprints(splitLines(committed))
  return resolveRecord(r, new DocModel(now), recordBaseline(r, commitFps))
}

const BASE = fileOf(
  'import x from "x"',
  '',
  'function add(a, b) {',
  '  return a + b',
  '}',
  '',
  'function sub(a, b) {',
  '  return a - b',
  '}',
)

describe('positions follow the code (history available)', () => {
  const r = confirm(BASE, [7, 9])

  it('stays put when nothing changed', () => {
    expect(resolve(r, BASE, BASE)).toEqual({ status: 'confirmed', range: [7, 9] })
  })

  it('moves down when lines are added above', () => {
    const now = fileOf('// header', '// more', ...splitLines(BASE))
    expect(resolve(r, now, BASE)).toEqual({ status: 'confirmed', range: [9, 11] })
  })

  it('moves up when lines are removed above', () => {
    const now = fileOf(...splitLines(BASE).slice(2))
    expect(resolve(r, now, BASE)).toEqual({ status: 'confirmed', range: [5, 7] })
  })

  it('an edited range is outdated where the code is now, not at the old numbers', () => {
    const lines = splitLines(BASE)
    lines[7] = '  return b - a'
    const now = fileOf('// a', '// b', '// c', ...lines)
    expect(resolve(r, now, BASE)).toEqual({ status: 'outdated', range: [10, 12] })
  })

  it('a line inserted inside makes it outdated and the range covers it', () => {
    const lines = splitLines(BASE)
    lines.splice(7, 0, '  console.log(a)')
    expect(resolve(r, fileOf(...lines), BASE)).toEqual({ status: 'outdated', range: [7, 10] })
  })

  it('identical copies elsewhere do not make it ambiguous', () => {
    const now = fileOf(...splitLines(BASE), '', 'function sub(a, b) {', '  return a - b', '}')
    expect(resolve(r, now, BASE)).toEqual({ status: 'confirmed', range: [7, 9] })
  })

  it('a deleted range is outdated at the place it was removed from', () => {
    const now = fileOf(...splitLines(BASE).slice(0, 5))
    expect(resolve(r, now, BASE)).toEqual({ status: 'outdated', range: [5, 5] })
  })
})

describe('code confirmed before it was committed', () => {
  it('rebuilds the confirmed text from the commit plus the delta', () => {
    const committed = fileOf(...splitLines(BASE).slice(0, 6))
    const r = confirm(BASE, [7, 9], committed)
    expect(r.delta).toBeDefined()
    const now = fileOf('// new first line', ...splitLines(BASE))
    expect(resolve(r, now, committed)).toEqual({ status: 'confirmed', range: [8, 10] })
  })

  it('works for a file that is not in the commit at all', () => {
    const r = confirm(BASE, [3, 5], '')
    const now = fileOf('// x', ...splitLines(BASE))
    expect(resolve(r, now, '')).toEqual({ status: 'confirmed', range: [4, 6] })
  })

  it('works outside git', () => {
    const r = confirm(BASE, [3, 5], null)
    expect(r.commit).toBe('')
    const now = fileOf('// x', ...splitLines(BASE))
    expect(resolve(r, now, null)).toEqual({ status: 'confirmed', range: [4, 6] })
  })
})

describe('moved code', () => {
  it('a whole symbol stays confirmed wherever it moved', () => {
    const r = confirm(BASE, [3, 5], BASE, { kind: 'symbol', symbol: 'add', scope: 'function' })
    const lines = splitLines(BASE)
    const now = fileOf(...lines.slice(5), '', ...lines.slice(2, 5))
    const res = resolve(r, now, BASE)
    expect(res.status).toBe('confirmed')
    expect(res.range).toEqual([6, 8])
  })

  it('a run of lines moved away from its surroundings is outdated at its new place', () => {
    const r = confirm(BASE, [4, 4])
    const lines = splitLines(BASE)
    const now = fileOf(
      ...lines.slice(0, 3),
      '  return 0',
      ...lines.slice(4),
      '// moved',
      '  return a + b',
    )
    expect(resolve(r, now, BASE)).toEqual({ status: 'outdated', range: [11, 11] })
  })
})

describe('without history', () => {
  it('finds unchanged code by content', () => {
    const r = confirm(BASE, [7, 9], BASE)
    const now = fileOf('// x', ...splitLines(BASE))
    expect(resolve(r, now, null)).toEqual({ status: 'confirmed', range: [8, 10] })
  })

  it('uses the surroundings to tell identical copies apart', () => {
    const text = fileOf('a', 'b', 'X', 'Y', 'c', 'd', 'e', 'X', 'Y', 'f')
    const r = confirm(text, [3, 4])
    expect(resolve(r, fileOf('0', ...splitLines(text)), null)).toEqual({
      status: 'confirmed',
      range: [4, 5],
    })
  })

  it('is ambiguous when nothing tells copies apart', () => {
    const text = fileOf('a', 'X', 'Y', 'b')
    const r = confirm(text, [2, 3])
    const res = resolve(r, fileOf('z', 'X', 'Y', 'q', 'X', 'Y', 'w'), null)
    expect(res.status).toBe('ambiguous')
    expect(res.candidates).toEqual([
      [2, 3],
      [5, 6],
    ])
  })

  it('locates changed code by alignment', () => {
    const r = confirm(BASE, [7, 9])
    const lines = splitLines(BASE)
    lines[7] = '  return b - a'
    const now = fileOf('// 1', '// 2', '// 3', '// 4', ...lines)
    expect(resolve(r, now, null)).toEqual({ status: 'outdated', range: [11, 13] })
  })
})

describe('file records', () => {
  it('compare the whole text', () => {
    const r = rec({ kind: 'file', range: undefined, hash: hashText(BASE) })
    expect(resolve(r, BASE, null).status).toBe('confirmed')
    expect(resolve(r, BASE + 'x\n', null).status).toBe('outdated')
  })
})

describe('untrusted ranges', () => {
  it('are clamped into the document', () => {
    const r = rec({ range: [500, 900], hash: 'sha256:none' })
    expect(resolve(r, fileOf('a', 'b'), null)).toEqual({ status: 'outdated', range: [2, 2] })
  })

  it('an inconsistent baseline is ignored', () => {
    const r = confirm(BASE, [7, 9])
    expect(recordBaseline(r, fingerprints(['totally', 'different']))).toBeNull()
  })
})

describe('deltas', () => {
  it('round-trip', () => {
    const a = fingerprints(['a', 'b', 'c', 'd', 'e'])
    const b = fingerprints(['x', 'a', 'c', 'D', 'e', 'f'])
    const delta = computeDelta(a, b)!
    expect(applyDelta(a, delta)).toEqual(b)
  })

  it('reject blocks that do not fit', () => {
    expect(applyDelta(['a'], [[3, 1, []]])).toBeNull()
  })
})
