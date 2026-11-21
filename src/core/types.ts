export interface Author {
  name: string
  email: string
}

/** What a record confirms: a run of lines, a whole symbol, or a whole file. */
export type RecordKind = 'lines' | 'symbol' | 'file'

/** The kind of symbol a `symbol` record covers. */
export type Scope = 'function' | 'type' | 'impl' | 'module'

/**
 * One uncommitted change at confirmation time, relative to the file at
 * `commit`: starting at 0-based line `start`, `deleted` lines were replaced
 * by lines with the given fingerprints.
 */
export type Delta = [start: number, deleted: number, inserted: string[]]

/**
 * A person's confirmation that one span of code is correct. Records are
 * append-only and travel with the repository; nothing about the current
 * status is ever stored - it is computed from the code every time.
 */
export interface AssuranceRecord {
  id: string
  author: Author
  createdAt: string // ISO 8601
  kind: RecordKind
  scope?: Scope // kind 'symbol'
  symbol?: string // kind 'symbol': symbol path, names joined with '/'
  container?: string // kind 'lines': innermost enclosing symbol path, informational
  range?: [number, number] // 1-based inclusive; absent for kind 'file'
  hash: string // sha256 of the confirmed lines (or of the whole file)
  lines?: string[] // fingerprints of the confirmed lines (omitted for huge ranges)
  before?: string[] // fingerprints of up to CONTEXT_LINES lines above the range
  after?: string[] // fingerprints of up to CONTEXT_LINES lines below the range
  commit: string // HEAD at confirmation time; '' outside git
  /** Uncommitted changes the confirmed text had on top of `commit`. Absent = none. */
  delta?: Delta[]
  /** The confirmed text could not be described relative to `commit`. */
  noBaseline?: true
  comment?: string
  supersedes?: string[] // ids of the author's own records this one replaces
  movedFrom?: string // id of the record this one was re-attached from
}

/** Withdraws a record and its whole chain. Written only by the record's author. */
export interface Tombstone {
  id: string
  author: Author
  createdAt: string
  revokes: string
  reason: 'revoke' | 'moved'
  movedTo?: string
}

export type StoreLine = AssuranceRecord | Tombstone

export const CONTEXT_LINES = 3
