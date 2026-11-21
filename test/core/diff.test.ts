import { describe, expect, it } from 'vitest'
import { LineMap, matchLines } from '../../src/core/diff'

const L = (s: string): string[] => s.split('')

/** Every matched pair must hold equal lines, in increasing order. */
function assertValid(a: string[], b: string[], aToB: Int32Array): void {
  let last = -1
  for (let i = 0; i < a.length; i++) {
    const j = aToB[i]!
    if (j < 0) continue
    expect(b[j]).toBe(a[i])
    expect(j).toBeGreaterThan(last)
    last = j
  }
}

describe('matchLines', () => {
  it('matches identical sequences one to one', () => {
    expect([...matchLines(L('abc'), L('abc'))]).toEqual([0, 1, 2])
  })

  it('handles insertions above', () => {
    expect([...matchLines(L('abc'), L('xyabc'))]).toEqual([2, 3, 4])
  })

  it('handles deletions above', () => {
    expect([...matchLines(L('xyabc'), L('abc'))]).toEqual([-1, -1, 0, 1, 2])
  })

  it('marks changed lines as unmatched', () => {
    expect([...matchLines(L('abcde'), L('abXde'))]).toEqual([0, 1, -1, 3, 4])
  })

  it('pins the alignment on unique lines, not on repeated ones', () => {
    // '}' repeats; the unique function heads decide the alignment.
    const a = ['f() {', 'one', '}', 'g() {', 'two', '}']
    const b = ['h() {', 'zero', '}', 'f() {', 'one', '}', 'g() {', 'two', '}']
    const m = matchLines(a, b)
    expect([...m]).toEqual([3, 4, 5, 6, 7, 8])
  })

  it('falls back to Myers inside gaps without unique lines', () => {
    const a = L('aabbaabb')
    const b = L('abababab')
    const m = matchLines(a, b)
    assertValid(a, b, m)
    expect([...m].filter((j) => j >= 0).length).toBeGreaterThanOrEqual(6)
  })

  it('produces valid matches on random edits', () => {
    let seed = 7
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: rnd(40) }, () => String(rnd(8)))
      const b = [...a]
      for (let e = rnd(6); e > 0; e--) {
        const at = rnd(b.length + 1)
        if (rnd(2) === 0) b.splice(at, 0, String(rnd(8)))
        else b.splice(at, 1)
      }
      assertValid(a, b, matchLines(a, b))
    }
  })
})

describe('LineMap.mapRange', () => {
  it('follows a range moved down by insertions above', () => {
    const map = LineMap.between(L('abcdef'), L('XYabcdef'))
    expect(map.mapRange(2, 4)).toEqual({ start: 4, end: 6, intact: true, survivors: 3 })
  })

  it('follows a range moved up by deletions above', () => {
    const map = LineMap.between(L('abcdef'), L('cdef'))
    expect(map.mapRange(2, 4)).toEqual({ start: 0, end: 2, intact: true, survivors: 3 })
  })

  it('is not intact when a line inside changed, and keeps covering the replacement', () => {
    const map = LineMap.between(L('abcdef'), L('abcXef'))
    expect(map.mapRange(2, 4)).toEqual({ start: 2, end: 4, intact: false, survivors: 2 })
  })

  it('is not intact when a line was inserted inside', () => {
    const map = LineMap.between(L('abcdef'), L('abcXdef'))
    expect(map.mapRange(2, 4)).toEqual({ start: 2, end: 5, intact: false, survivors: 3 })
  })

  it('moves a changed first line to the start of its replacement', () => {
    const map = LineMap.between(L('abcdef'), L('aZZdef'))
    // old b..d -> new Z Z d
    expect(map.mapRange(1, 3)).toEqual({ start: 1, end: 3, intact: false, survivors: 1 })
  })

  it('reports a range deleted without replacement as empty', () => {
    const map = LineMap.between(L('abcdef'), L('aef'))
    const r = map.mapRange(1, 3)
    expect(r.end).toBeLessThan(r.start)
    expect(r.start).toBe(1)
    expect(r.survivors).toBe(0)
  })

  it('maps a deleted tail to the end of the new text', () => {
    const map = LineMap.between(L('abc'), L('a'))
    const r = map.mapRange(1, 2)
    expect(r.start).toBe(1)
    expect(r.end).toBe(0)
  })
})
