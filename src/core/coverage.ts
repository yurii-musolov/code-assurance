import type { Resolution, Status } from './resolve'
import { codeLineNumbers } from './text'
import type { AssuranceRecord } from './types'

/** Counts of code lines; blank lines are neither confirmed nor unconfirmed. */
export interface Coverage {
  confirmed: number
  total: number
}

export function fileCoverage(
  entries: readonly { record: AssuranceRecord; res: Resolution }[],
  lines: readonly string[],
): Coverage | null {
  const code = codeLineNumbers(lines)
  if (code.length === 0) return null
  if (entries.some((e) => e.record.kind === 'file' && e.res.status === 'confirmed')) {
    return { confirmed: code.length, total: code.length }
  }
  const covered = new Uint8Array(lines.length + 2)
  for (const { res } of entries) {
    if (res.status !== 'confirmed') continue
    for (let l = Math.max(1, res.range[0]); l <= Math.min(lines.length, res.range[1]); l++) {
      covered[l] = 1
    }
  }
  let confirmed = 0
  for (const l of code) confirmed += covered[l]!
  return { confirmed, total: code.length }
}

export function rollup(parts: readonly (Coverage | null)[]): Coverage | null {
  let confirmed = 0
  let total = 0
  let any = false
  for (const c of parts) {
    if (!c) continue
    any = true
    confirmed += c.confirmed
    total += c.total
  }
  return any ? { confirmed, total } : null
}

/** 100 only when every line is confirmed and 0 only when none is. */
export function pct(c: Coverage): number {
  if (c.confirmed >= c.total) return 100
  if (c.confirmed <= 0) return 0
  return Math.min(99, Math.max(1, Math.round((100 * c.confirmed) / c.total)))
}

/** Which status needs attention first: outdated, then ambiguous, then confirmed. */
export const URGENCY: Record<Status, number> = { confirmed: 0, ambiguous: 1, outdated: 2 }

export function mostUrgent(a: Status, b: Status): Status {
  return URGENCY[b] > URGENCY[a] ? b : a
}

/**
 * Flatten overlapping spans into disjoint runs of one status each, for the
 * marks in the editor. A line some confirmation still verifies stays
 * confirmed: an outdated span only says where changed code is, and must not
 * paint over code another confirmation covers. Other lines take the most
 * urgent status. Ranges are clamped to the document.
 */
export function lineStatuses(
  spans: readonly { status: Status; range: [number, number] }[],
  lineCount: number,
): { status: Status; range: [number, number] }[] {
  if (lineCount < 1 || spans.length === 0) return []
  const at: (Status | undefined)[] = new Array<Status | undefined>(lineCount + 1)
  for (const { status, range } of spans) {
    if (!Number.isFinite(range[0]) || !Number.isFinite(range[1])) continue
    const end = Math.min(lineCount, Math.floor(range[1]))
    for (let l = Math.max(1, Math.floor(range[0])); l <= end; l++) {
      const prev = at[l]
      at[l] =
        prev === undefined
          ? status
          : prev === 'confirmed' || status === 'confirmed'
            ? 'confirmed'
            : mostUrgent(prev, status)
    }
  }
  const out: { status: Status; range: [number, number] }[] = []
  for (let l = 1; l <= lineCount; l++) {
    const s = at[l]
    if (s === undefined) continue
    const last = out[out.length - 1]
    if (last && last.range[1] === l - 1 && last.status === s) last.range[1] = l
    else out.push({ status: s, range: [l, l] })
  }
  return out
}
