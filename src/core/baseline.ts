import { matchLines } from './diff'
import type { Delta } from './types'

/** Largest number of inserted fingerprints a record may carry in its delta. */
export const MAX_DELTA_LINES = 20_000

/**
 * Describe `current` relative to `base` as replacement blocks: what the
 * uncommitted text of a file looked like, in fingerprints, without storing
 * the code. null when the change is too large to be worth recording.
 */
export function computeDelta(base: readonly string[], current: readonly string[]): Delta[] | null {
  const aToB = matchLines(base, current)
  const out: Delta[] = []
  let inserted = 0
  let i = 0
  let j = 0
  while (i < base.length || j < current.length) {
    if (i < base.length && aToB[i] === j) {
      i++
      j++
      continue
    }
    const start = i
    while (i < base.length && aToB[i]! < 0) i++
    // Lines of `current` up to the next matched base line are insertions.
    const nextJ = i < base.length ? aToB[i]! : current.length
    const ins = current.slice(j, nextJ)
    inserted += ins.length
    if (inserted > MAX_DELTA_LINES) return null
    out.push([start, i - start, ins as string[]])
    j = nextJ
  }
  return out
}

/** Rebuild the confirmed text's fingerprints; null when the delta does not fit `base`. */
export function applyDelta(base: readonly string[], delta: readonly Delta[]): string[] | null {
  const out: string[] = []
  let at = 0
  for (const [start, deleted, inserted] of delta) {
    if (start < at || start + deleted > base.length) return null
    for (let i = at; i < start; i++) out.push(base[i]!)
    out.push(...inserted)
    at = start + deleted
  }
  for (let i = at; i < base.length; i++) out.push(base[i]!)
  return out
}
