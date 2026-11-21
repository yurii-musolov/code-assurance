import { captureRange, type Resolution } from './resolve'
import { hashLines, hashText, splitLines } from './text'
import { sameEmail } from './paths'
import type { AssuranceRecord, Author, Delta, RecordKind, Scope, Tombstone } from './types'

export function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1]
}

export function encloses(outer: [number, number], inner: [number, number]): boolean {
  return outer[0] <= inner[0] && inner[1] <= outer[1]
}

export interface Resolved {
  record: AssuranceRecord
  res: Resolution
}

/**
 * The author's own current records a new confirmation replaces: those it
 * fully encloses, or that cover the same symbol. A partial overlap never
 * replaces anything - both confirmations stand side by side.
 */
export function supersededBy(
  author: Author,
  target: { kind: RecordKind; symbol?: string | undefined; range?: [number, number] | undefined },
  current: readonly Resolved[],
): Resolved[] {
  return current.filter((e) => {
    if (!sameEmail(e.record.author.email, author.email)) return false
    if (target.kind === 'file') return true
    if (target.symbol && e.record.kind === 'symbol' && e.record.symbol === target.symbol) {
      return true
    }
    if (e.record.kind === 'file' || !target.range) return false
    return encloses(target.range, e.res.range)
  })
}

export interface NewRecord {
  id: string
  author: Author
  createdAt: string
  kind: RecordKind
  scope?: Scope | undefined
  symbol?: string | undefined
  container?: string | undefined
  range?: [number, number] | undefined
  text: string
  commit: string
  /** Uncommitted changes relative to `commit`; null = could not be described. */
  delta: Delta[] | null
  comment?: string | undefined
  supersedes: string[]
}

export function buildRecord(p: NewRecord): AssuranceRecord {
  const r: AssuranceRecord = {
    id: p.id,
    author: p.author,
    createdAt: p.createdAt,
    kind: p.kind,
    hash: '',
    commit: p.commit,
  }
  if (p.kind === 'file') {
    r.hash = hashText(p.text)
  } else {
    const range = p.range!
    r.range = range
    Object.assign(r, captureRange(splitLines(p.text), range))
    if (p.kind === 'symbol') {
      if (p.scope) r.scope = p.scope
      if (p.symbol !== undefined) r.symbol = p.symbol
    } else if (p.container) {
      r.container = p.container
    }
  }
  if (p.delta === null) r.noBaseline = true
  else if (p.delta.length > 0) r.delta = p.delta
  if (p.comment) r.comment = p.comment
  const supersedes = [...new Set(p.supersedes)].filter((id) => id !== p.id)
  if (supersedes.length > 0) r.supersedes = supersedes
  return r
}

/**
 * Find the snapshot's range again in the text after the dialogs closed.
 * Edits elsewhere just move it; if the confirmed lines themselves changed
 * or now exist twice, null - nobody may confirm text they did not read.
 */
export function rebaseRange(
  snapshot: string,
  range: [number, number],
  finalText: string,
): [number, number] | null {
  const before = splitLines(snapshot).slice(range[0] - 1, range[1])
  const hash = hashLines(before)
  const lines = splitLines(finalText)
  const len = before.length
  if (len === 0) return null
  let found: number | null = null
  for (let i = 0; i + len <= lines.length; i++) {
    if (lines[i] !== before[0]) continue
    if (hashLines(lines.slice(i, i + len)) !== hash) continue
    if (found !== null) return null
    found = i
  }
  return found === null ? null : [found + 1, found + len]
}

/** Comments of replaced records, offered as the start of the new comment. */
export function carriedComments(replaced: readonly Resolved[]): string {
  return replaced
    .map((e) => (e.record.comment ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ')
}

/** Move the author's records of a renamed file: withdraw at the old path, copy to the new. */
export function reattach(
  records: readonly AssuranceRecord[],
  newSourcePath: string,
  newId: () => string,
  now: string,
  author: Author,
): { tombstones: Tombstone[]; copies: AssuranceRecord[] } {
  const tombstones: Tombstone[] = []
  const copies: AssuranceRecord[] = []
  for (const r of records) {
    if (!sameEmail(r.author.email, author.email)) continue
    const copy: AssuranceRecord = { ...r, id: newId(), movedFrom: r.id }
    delete copy.supersedes
    copies.push(copy)
    tombstones.push({
      id: newId(),
      author,
      createdAt: now,
      revokes: r.id,
      reason: 'moved',
      movedTo: newSourcePath,
    })
  }
  return { tombstones, copies }
}
