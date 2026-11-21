import { normalizeEmail, sameEmail } from './paths'
import { isFingerprint } from './text'
import type { AssuranceRecord, Author, StoreLine, Tombstone } from './types'

// Every line of the store is untrusted input: it is written by other people,
// merged by git and editable by hand. Validation checks every field the
// extension reads; unknown extra fields are kept so later versions can add
// some without older ones reporting their lines as damaged.

export function isTombstone(l: StoreLine): l is Tombstone {
  return 'revokes' in l
}

const KINDS = new Set(['lines', 'symbol', 'file'])
const SCOPES = new Set(['function', 'type', 'impl', 'module'])

/** False for records of a kind this version does not know (written by a newer one). */
export function isKnownKind(r: AssuranceRecord): boolean {
  return KINDS.has(r.kind)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const optStr = (v: unknown): boolean => v === undefined || isStr(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const optFingerprints = (v: unknown): boolean =>
  v === undefined || (Array.isArray(v) && v.every(isFingerprint))

function validAuthor(a: unknown): a is Author {
  return !!a && typeof a === 'object' && isStr((a as Author).name) && isStr((a as Author).email)
}

function validDelta(v: unknown): boolean {
  if (v === undefined) return true
  if (!Array.isArray(v)) return false
  return v.every(
    (d) =>
      Array.isArray(d) &&
      d.length === 3 &&
      isInt(d[0]) &&
      d[0] >= 0 &&
      isInt(d[1]) &&
      d[1] >= 0 &&
      Array.isArray(d[2]) &&
      (d[2] as unknown[]).every(isFingerprint),
  )
}

/** A parsed JSON object that may or may not have the shape of T. */
type Untrusted<T> = { [K in keyof T]?: unknown }

export function validLine(obj: unknown): obj is StoreLine {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = obj as Untrusted<AssuranceRecord & Tombstone>
  if (!isStr(o.id) || o.id === '' || !validAuthor(o.author) || !isStr(o.createdAt)) return false

  if ('revokes' in o) {
    return isStr(o.revokes) && isStr(o.reason) && o.reason !== '' && optStr(o.movedTo)
  }

  if (!isStr(o.kind) || o.kind === '' || !isStr(o.hash) || !isStr(o.commit)) return false
  if (o.range !== undefined) {
    if (!Array.isArray(o.range) || o.range.length !== 2) return false
    const [s, e] = o.range as unknown[]
    if (!isInt(s) || !isInt(e) || s < 1 || e < s) return false
  }
  if (o.scope !== undefined && !SCOPES.has(o.scope as string)) return false
  for (const k of ['symbol', 'container', 'comment', 'movedFrom'] as const)
    if (!optStr(o[k])) return false
  for (const k of ['lines', 'before', 'after'] as const) if (!optFingerprints(o[k])) return false
  if (!validDelta(o.delta)) return false
  if (o.noBaseline !== undefined && o.noBaseline !== true) return false
  if (o.supersedes !== undefined) {
    if (!Array.isArray(o.supersedes) || !o.supersedes.every(isStr)) return false
    if ((o.supersedes as string[]).includes(o.id)) return false
  }
  if (KINDS.has(o.kind) && o.kind !== 'file' && o.range === undefined) return false
  if (o.kind === 'symbol' && (!isStr(o.symbol) || o.symbol === '')) return false
  return true
}

export function parseJsonl(content: string): { lines: StoreLine[]; corrupt: number } {
  const lines: StoreLine[] = []
  let corrupt = 0
  for (const raw of content.split('\n')) {
    const s = raw.trim()
    if (!s) continue
    try {
      const obj: unknown = JSON.parse(s)
      if (validLine(obj)) lines.push(obj)
      else corrupt++
    } catch {
      corrupt++
    }
  }
  return { lines, corrupt }
}

/**
 * Collapse id collisions without ever depending on file order:
 * - identical duplicates (what a union merge produces) collapse to one;
 * - records sharing an id with different content are all dropped as damaged;
 * - a record whose id is also a tombstone's id is dropped, tombstones always stay
 *   (dropping one could bring a withdrawn confirmation back).
 */
export function dedupeById(lines: StoreLine[]): { lines: StoreLine[]; corrupt: number } {
  const tombIds = new Set(lines.filter(isTombstone).map((t) => t.id))
  const out: StoreLine[] = []
  const seenTombs = new Set<string>()
  const groups = new Map<string, AssuranceRecord[]>()
  for (const l of lines) {
    if (isTombstone(l)) {
      const key = JSON.stringify(l)
      if (!seenTombs.has(key)) {
        seenTombs.add(key)
        out.push(l)
      }
    } else if (!tombIds.has(l.id)) {
      const g = groups.get(l.id) ?? []
      g.push(l)
      groups.set(l.id, g)
    }
  }
  let corrupt = 0
  for (const g of groups.values()) {
    if (new Set(g.map((r) => JSON.stringify(r))).size === 1) out.push(g[0]!)
    else corrupt += g.length
  }
  return { lines: out, corrupt }
}

export interface FileState {
  /** Records that currently stand: not replaced and not withdrawn. */
  current: AssuranceRecord[]
  /** Every record, grouped by chain (a confirmation and everything that replaced it). */
  chains: AssuranceRecord[][]
  /** Chain index of every record id. */
  chainOf: Map<string, number>
  /** Indexes of chains whose every record was withdrawn. */
  revoked: Set<number>
}

const timeOf = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Chains, withdrawals and current records of one file.
 *
 * Trust rules (all data is shared and untrusted):
 * - a `supersedes` edge counts only between records of the same author, so
 *   nobody can replace someone else's confirmation;
 * - a tombstone withdraws only records of its own author;
 * - a record replaced by a present record of its author is never current,
 *   whatever the timestamps say. Timestamps only order the history.
 */
export function resolveChains(all: StoreLine[]): FileState {
  const records = all.filter((l): l is AssuranceRecord => !isTombstone(l))
  const tombs = all.filter(isTombstone)
  const byId = new Map(records.map((r) => [r.id, r]))

  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (parent.get(c) !== r) {
      const next = parent.get(c)!
      parent.set(c, r)
      c = next
    }
    return r
  }
  for (const r of records) parent.set(r.id, r.id)

  const superseded = new Set<string>()
  for (const r of records) {
    for (const prev of r.supersedes ?? []) {
      const target = byId.get(prev)
      if (!target || !sameEmail(target.author.email, r.author.email)) continue
      const a = find(r.id)
      const b = find(prev)
      if (a !== b) parent.set(b, a)
      superseded.add(prev)
    }
  }

  const rootIndex = new Map<string, number>()
  const chains: AssuranceRecord[][] = []
  for (const r of records) {
    const root = find(r.id)
    let i = rootIndex.get(root)
    if (i === undefined) {
      i = chains.length
      rootIndex.set(root, i)
      chains.push([])
    }
    chains[i]!.push(r)
  }
  const chainOf = new Map<string, number>()
  chains.forEach((members, i) => {
    members.sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || (a.id < b.id ? -1 : 1))
    for (const m of members) chainOf.set(m.id, i)
  })

  const withdrawn = new Set<string>()
  for (const t of tombs) {
    const i = chainOf.get(t.revokes)
    if (i === undefined) continue
    for (const m of chains[i]!) if (sameEmail(m.author.email, t.author.email)) withdrawn.add(m.id)
  }

  const current: AssuranceRecord[] = []
  const revoked = new Set<number>()
  chains.forEach((members, i) => {
    const alive = members.filter((m) => !withdrawn.has(m.id))
    if (alive.length === 0) {
      revoked.add(i)
      return
    }
    let tips = alive.filter((m) => !superseded.has(m.id))
    // Only hand-edited data can form a cycle; never let a live chain vanish.
    if (tips.length === 0) tips = [alive[alive.length - 1]!]
    // One current record per author: the newest unreplaced one.
    const byAuthor = new Map<string, AssuranceRecord>()
    for (const t of tips) byAuthor.set(normalizeEmail(t.author.email), t)
    current.push(...byAuthor.values())
  })
  return { current, chains, chainOf, revoked }
}
