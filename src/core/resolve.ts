import { applyDelta } from './baseline'
import { LineMap, matchLines } from './diff'
import { isKnownKind } from './records'
import { fingerprints, hashLines, hashText, normalizeEol, splitLines } from './text'
import { type AssuranceRecord, CONTEXT_LINES } from './types'

/**
 * - confirmed: the confirmed code is present, unchanged, and we know where;
 * - outdated: the code changed (or moved away from its surroundings) since
 *   it was confirmed and needs to be confirmed again;
 * - ambiguous: the unchanged code now exists in several places and nothing
 *   tells which one was confirmed.
 * Computed every time from the current text, never stored, never set by hand.
 */
export type Status = 'confirmed' | 'outdated' | 'ambiguous'

export interface Resolution {
  status: Status
  /** Where to show it, 1-based inclusive, always inside the document. */
  range: [number, number]
  /** Ambiguous only: every place holding the confirmed code, nearest first. */
  candidates?: [number, number][]
}

/** Records longer than this keep no per-line fingerprints. */
export const MAX_FINGERPRINTED_LINES = 5000
/** More exact copies than this are not listed. */
const MAX_CANDIDATES = 32

/** A document prepared once and shared by all records of the file. */
export class DocModel {
  readonly lines: string[]
  readonly fps: string[]
  private positionsByFp: Map<string, number[]> | undefined
  private wholeHash: string | undefined

  readonly text: string

  constructor(text: string) {
    this.text = text
    this.lines = splitLines(text)
    this.fps = fingerprints(this.lines)
  }

  get lineCount(): number {
    return this.lines.length
  }

  /** 0-based indexes of the lines with this fingerprint. */
  positions(fp: string): number[] {
    if (!this.positionsByFp) {
      this.positionsByFp = new Map()
      this.fps.forEach((f, i) => {
        const list = this.positionsByFp!.get(f)
        if (list) list.push(i)
        else this.positionsByFp!.set(f, [i])
      })
    }
    return this.positionsByFp.get(fp) ?? []
  }

  hash(): string {
    this.wholeHash ??= hashText(this.text)
    return this.wholeHash
  }

  windowHash(start: number, length: number): string | null {
    if (start < 0 || start + length > this.lines.length) return null
    return hashLines(this.lines.slice(start, start + length))
  }
}

/** Hash and fingerprints captured when a range is confirmed. */
export function captureRange(
  lines: readonly string[],
  range: [number, number],
): { hash: string; lines?: string[]; before: string[]; after: string[] } {
  const [s, e] = range
  const slice = lines.slice(s - 1, e)
  const out: { hash: string; lines?: string[]; before: string[]; after: string[] } = {
    hash: hashLines(slice),
    before: fingerprints(lines.slice(Math.max(0, s - 1 - CONTEXT_LINES), s - 1)),
    after: fingerprints(lines.slice(e, e + CONTEXT_LINES)),
  }
  if (slice.length <= MAX_FINGERPRINTED_LINES) out.lines = fingerprints(slice)
  return out
}

/**
 * Fingerprints of the text a record was confirmed on, or null when they
 * cannot be rebuilt. `commitFps` are the fingerprints of the file at
 * `record.commit` ([] when the commit exists but did not contain the file,
 * null when the commit is not available).
 */
export function recordBaseline(
  record: AssuranceRecord,
  commitFps: readonly string[] | null,
): string[] | null {
  if (record.noBaseline || record.kind === 'file' || !record.range) return null
  const base = commitFps ?? (record.commit === '' ? [] : null)
  if (!base) return null
  const text = record.delta ? applyDelta(base, record.delta) : [...base]
  if (!text) return null
  // The rebuilt text must hold exactly what was confirmed, or it is not the baseline.
  const [s, e] = record.range
  if (e > text.length) return null
  if (record.lines) {
    for (let i = s; i <= e; i++) if (text[i - 1] !== record.lines[i - s]) return null
  }
  return text
}

/**
 * Where a record's code is now and whether it is unchanged.
 *
 * With a baseline (the confirmed text, rebuilt from git plus the record's
 * delta) the range is carried through a line diff, so it follows the code
 * through any insertion or deletion around it and never confuses two
 * identical blocks. Without one, the code is looked up by content and,
 * failing that, located by aligning its fingerprints and surroundings.
 */
export function resolveRecord(
  record: AssuranceRecord,
  doc: DocModel,
  baseline: readonly string[] | null,
): Resolution {
  const n = doc.lineCount
  if (record.kind === 'file' && isKnownKind(record)) {
    return {
      status: doc.hash() === record.hash ? 'confirmed' : 'outdated',
      range: [1, Math.max(1, n)],
    }
  }
  const stored = record.range ?? [1, 1]
  if (!isKnownKind(record)) return outdated(stored[0] - 1, stored[1] - 1, n)
  const len = stored[1] - stored[0] + 1

  if (baseline) {
    const m = LineMap.between(baseline, doc.fps).mapRange(stored[0] - 1, stored[1] - 1)
    if (m.intact && doc.windowHash(m.start, len) === record.hash) {
      return { status: 'confirmed', range: [m.start + 1, m.start + len] }
    }
    if (m.survivors > 0) return outdated(m.start, Math.max(m.start, m.end), n)
    // Nothing of it is left where it was: it was moved or deleted.
    const found = exactMatches(record, doc, len)
    if (found.length === 1) {
      const at = found[0]!
      return movedIntact(record, doc, at, len)
        ? confirmedAt(at, len)
        : outdated(at, at + len - 1, n)
    }
    if (found.length > 1) return ambiguous(found, m.start, len)
    return outdated(m.start, m.start, n)
  }

  const found = exactMatches(record, doc, len)
  if (found.length === 1) return confirmedAt(found[0]!, len)
  if (found.length > 1) {
    const scored = found.map((i) => ({ i, score: contextScore(record, doc, i, len) }))
    const best = Math.max(...scored.map((s) => s.score))
    const top = scored.filter((s) => s.score === best)
    const full = (record.before?.length ?? 0) + (record.after?.length ?? 0)
    if (top.length === 1 && best === full && full > 0) return confirmedAt(top[0]!.i, len)
    return ambiguous(found, stored[0] - 1, len)
  }
  const aligned = alignRange(record, doc)
  if (aligned) return outdated(aligned[0], aligned[1], n)
  return outdated(stored[0] - 1, stored[1] - 1, n)
}

function confirmedAt(i: number, len: number): Resolution {
  return { status: 'confirmed', range: [i + 1, i + len] }
}

/** Outdated at 0-based [start, end], clamped into the document. */
function outdated(start: number, end: number, lineCount: number): Resolution {
  const max = Math.max(1, lineCount)
  const clamp = (v: number): number =>
    Number.isFinite(v) ? Math.min(Math.max(1, Math.floor(v) + 1), max) : 1
  const s = clamp(start)
  return { status: 'outdated', range: [s, Math.max(s, clamp(end))] }
}

function ambiguous(found: number[], near: number, len: number): Resolution {
  const sorted = [...found]
    .sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b)
    .slice(0, MAX_CANDIDATES)
  const candidates = sorted.map((i): [number, number] => [i + 1, i + len])
  return { status: 'ambiguous', range: candidates[0]!, candidates }
}

/** 0-based starts of every unchanged copy of the record's code. */
function exactMatches(record: AssuranceRecord, doc: DocModel, len: number): number[] {
  const head = record.lines?.[0]
  if (!head) {
    // Huge ranges keep no fingerprints: only the stored place can be checked.
    const s = (record.range?.[0] ?? 1) - 1
    return doc.windowHash(s, len) === record.hash ? [s] : []
  }
  const out: number[] = []
  for (const i of doc.positions(head)) {
    if (doc.windowHash(i, len) === record.hash) out.push(i)
    if (out.length > MAX_CANDIDATES) break
  }
  return out
}

/** How many of the recorded surrounding lines are still around the copy at `i`. */
function contextScore(record: AssuranceRecord, doc: DocModel, i: number, len: number): number {
  let score = 0
  const before = record.before ?? []
  before.forEach((fp, k) => {
    if (doc.fps[i - before.length + k] === fp) score++
  })
  const after = record.after ?? []
  after.forEach((fp, k) => {
    if (doc.fps[i + len + k] === fp) score++
  })
  return score
}

/**
 * Code that left its place unchanged. A whole symbol (a function, a type)
 * stays confirmed wherever it went; a run of lines only when it moved
 * together with what surrounded it, because its meaning depends on that.
 */
function movedIntact(record: AssuranceRecord, doc: DocModel, i: number, len: number): boolean {
  if (record.kind === 'symbol') return true
  const before = record.before ?? []
  const after = record.after ?? []
  const fullBefore =
    before.length > 0 && before.every((fp, k) => doc.fps[i - before.length + k] === fp)
  const fullAfter = after.length > 0 && after.every((fp, k) => doc.fps[i + len + k] === fp)
  return fullBefore || fullAfter
}

/**
 * Locate changed code without a baseline: the record's lines and their
 * surroundings vote for an offset through lines that are unique on both
 * sides, then a diff against a window around that offset maps the range.
 * 0-based inclusive range, or null when nothing recognizable is left.
 */
function alignRange(record: AssuranceRecord, doc: DocModel): [number, number] | null {
  if (!record.lines || !record.range) return null
  const before = record.before ?? []
  const seq = [...before, ...record.lines, ...(record.after ?? [])]
  const count = new Map<string, number>()
  for (const fp of seq) count.set(fp, (count.get(fp) ?? 0) + 1)
  const votes = new Map<number, number>()
  seq.forEach((fp, k) => {
    if (count.get(fp) !== 1) return
    const pos = doc.positions(fp)
    if (pos.length !== 1) return
    const off = pos[0]! - k
    votes.set(off, (votes.get(off) ?? 0) + 1)
  })
  if (votes.size === 0) return null
  const storedOff = record.range[0] - 1 - before.length
  let bestOff = 0
  let bestVotes = -1
  for (const [off, v] of votes) {
    if (
      v > bestVotes ||
      (v === bestVotes && Math.abs(off - storedOff) < Math.abs(bestOff - storedOff))
    ) {
      bestOff = off
      bestVotes = v
    }
  }
  const pad = seq.length
  const ws = Math.max(0, bestOff - pad)
  const we = Math.min(doc.lineCount, bestOff + seq.length + pad)
  const map = new LineMap(matchLines(seq, doc.fps.slice(ws, we)), we - ws)
  const m = map.mapRange(before.length, before.length + record.lines.length - 1)
  if (m.survivors === 0) return null
  return [ws + m.start, ws + Math.max(m.start, m.end)]
}

/** Whole-text equality used for file records and the post-dialog guard. */
export function sameText(a: string, b: string): boolean {
  return normalizeEol(a) === normalizeEol(b)
}
