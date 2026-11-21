/**
 * Line diff used to carry confirmed ranges from the text they were confirmed
 * on to the text of today.
 *
 * Patience diff: lines that occur exactly once on both sides are matched
 * first (in order, via a longest increasing subsequence), which pins the
 * alignment on distinctive code instead of on braces and blank lines; the
 * gaps between those anchors are diffed recursively, and gaps without any
 * unique line fall back to a bounded Myers diff. Common prefixes and
 * suffixes are stripped first, so the usual "a few lines changed somewhere"
 * edit costs O(n).
 */

/** Gaps whose edit distance would exceed this are treated as fully replaced. */
const MYERS_MAX_EDITS = 1000

/**
 * Match the lines of `a` against `b`. Returns `aToB` where `aToB[i]` is the
 * index in `b` of line `a[i]`, or -1 when the line was removed or changed.
 * Matched indices are strictly increasing.
 */
export function matchLines(a: readonly string[], b: readonly string[]): Int32Array {
  const aToB = new Int32Array(a.length).fill(-1)
  const stack: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  while (stack.length > 0) {
    let [aLo, aHi, bLo, bHi] = stack.pop()!
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) aToB[aLo++] = bLo++
    while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) aToB[--aHi] = --bHi
    if (aLo === aHi || bLo === bHi) continue

    const anchors = uniqueAnchors(a, aLo, aHi, b, bLo, bHi)
    if (anchors.length === 0) {
      myers(a, aLo, aHi, b, bLo, bHi, aToB)
      continue
    }
    let pa = aLo
    let pb = bLo
    for (const [ai, bi] of anchors) {
      aToB[ai] = bi
      if (pa < ai && pb < bi) stack.push([pa, ai, pb, bi])
      pa = ai + 1
      pb = bi + 1
    }
    if (pa < aHi && pb < bHi) stack.push([pa, aHi, pb, bHi])
  }
  return aToB
}

/** Pairs of lines unique on both sides, reduced to their longest common order. */
function uniqueAnchors(
  a: readonly string[],
  aLo: number,
  aHi: number,
  b: readonly string[],
  bLo: number,
  bHi: number,
): [number, number][] {
  const seen = new Map<string, { ai: number; bi: number; na: number; nb: number }>()
  for (let i = aLo; i < aHi; i++) {
    const e = seen.get(a[i]!)
    if (e) e.na++
    else seen.set(a[i]!, { ai: i, bi: -1, na: 1, nb: 0 })
  }
  for (let j = bLo; j < bHi; j++) {
    const e = seen.get(b[j]!)
    if (!e) continue
    e.nb++
    e.bi = j
  }
  const pairs: [number, number][] = []
  for (const e of seen.values()) if (e.na === 1 && e.nb === 1) pairs.push([e.ai, e.bi])
  pairs.sort((x, y) => x[0] - y[0])
  return longestIncreasing(pairs)
}

/** Longest subsequence of pairs (sorted by a) whose b indices increase. */
function longestIncreasing(pairs: [number, number][]): [number, number][] {
  if (pairs.length === 0) return []
  const tails: number[] = [] // index into pairs of the smallest tail per length
  const prev = new Int32Array(pairs.length).fill(-1)
  for (let i = 0; i < pairs.length; i++) {
    const bi = pairs[i]![1]
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]!]![1] < bi) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]!
    tails[lo] = i
  }
  const out: [number, number][] = []
  for (let i = tails[tails.length - 1]!; i >= 0; i = prev[i]!) out.push(pairs[i]!)
  return out.reverse()
}

/**
 * Classic greedy Myers diff over a[aLo, aHi) and b[bLo, bHi), writing matches
 * into aToB. Gives up (leaving the gap unmatched, i.e. "replaced") when the
 * edit distance exceeds MYERS_MAX_EDITS, which bounds time and memory.
 */
function myers(
  a: readonly string[],
  aLo: number,
  aHi: number,
  b: readonly string[],
  bLo: number,
  bHi: number,
  aToB: Int32Array,
): void {
  const n = aHi - aLo
  const m = bHi - bLo
  const max = Math.min(n + m, MYERS_MAX_EDITS)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  // trace[d] = the furthest x per diagonal k in [-d-1, d+1] before step d.
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!)
          ? v[off + k + 1]!
          : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        backtrack(trace, d, n, m, aLo, bLo, aToB)
        return
      }
    }
  }
}

function backtrack(
  trace: Int32Array[],
  dEnd: number,
  n: number,
  m: number,
  aLo: number,
  bLo: number,
  aToB: Int32Array,
): void {
  let x = n
  let y = m
  for (let d = dEnd; d > 0; d--) {
    const snap = trace[d]!
    const at = (k: number): number => snap[k + d + 1]!
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      aToB[aLo + x - 1] = bLo + y - 1
      x--
      y--
    }
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    aToB[aLo + x - 1] = bLo + y - 1
    x--
    y--
  }
}

/** Where an old range of lines sits in the new text. All indices 0-based, inclusive. */
export interface MappedRange {
  start: number
  /** end < start: the range was deleted without replacement; `start` is where it was. */
  end: number
  /** Every line survived unchanged and the lines are still adjacent. */
  intact: boolean
  /** How many of the old lines are still present unchanged. */
  survivors: number
}

/**
 * Carries line ranges from the old text to the new one. A range boundary on
 * a changed or removed line moves to the edge of the replacement block, so
 * an edited range always covers the code that replaced it.
 */
export class LineMap {
  private readonly startOf: Int32Array
  private readonly endOf: Int32Array

  constructor(
    readonly aToB: Int32Array,
    readonly newLength: number,
  ) {
    const n = aToB.length
    this.startOf = new Int32Array(n)
    this.endOf = new Int32Array(n)
    let after = 0
    for (let i = 0; i < n; i++) {
      if (aToB[i]! >= 0) after = aToB[i]! + 1
      this.startOf[i] = aToB[i]! >= 0 ? aToB[i]! : after
    }
    let before = newLength - 1
    for (let i = n - 1; i >= 0; i--) {
      if (aToB[i]! >= 0) before = aToB[i]! - 1
      this.endOf[i] = aToB[i]! >= 0 ? aToB[i]! : before
    }
  }

  static between(a: readonly string[], b: readonly string[]): LineMap {
    return new LineMap(matchLines(a, b), b.length)
  }

  /** Map old lines [start, end] (0-based, inclusive, inside the old text). */
  mapRange(start: number, end: number): MappedRange {
    let survivors = 0
    let intact = true
    let last = -2
    for (let i = start; i <= end; i++) {
      const j = this.aToB[i]!
      if (j < 0) {
        intact = false
        continue
      }
      survivors++
      if (last !== -2 && j !== last + 1) intact = false
      last = j
    }
    return { start: this.startOf[start]!, end: this.endOf[end]!, intact, survivors }
  }
}
