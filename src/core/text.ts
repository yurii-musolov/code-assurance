import { createHash } from 'node:crypto'

/** CRLF and lone CR become LF, so hashes do not depend on the platform. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * The line model used everywhere: a trailing newline ends the last line
 * instead of starting an empty one, and '' has no lines. Line N of the
 * editor is element N-1.
 */
export function splitLines(text: string): string[] {
  const t = normalizeEol(text)
  if (t === '') return []
  const lines = t.split('\n')
  if (t.endsWith('\n')) lines.pop()
  return lines
}

/** Whitespace-only lines carry no code: they are neither confirmed nor unconfirmed. */
export function isBlankLine(line: string): boolean {
  return line.trim() === ''
}

/** 1-based numbers of the lines that count toward coverage. */
export function codeLineNumbers(lines: readonly string[]): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) if (!isBlankLine(lines[i]!)) out.push(i + 1)
  return out
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/** Content hash of a run of lines. */
export function hashLines(lines: readonly string[]): string {
  return sha256(lines.join('\n'))
}

/** Content hash of a whole file. */
export function hashText(text: string): string {
  return sha256(normalizeEol(text))
}

/** Length of a line fingerprint in hex characters (40 bits). */
export const FINGERPRINT_LENGTH = 10

/**
 * Short per-line digest. Fingerprints let line positions be traced through
 * later edits without storing the code itself; every decision that grants a
 * confirmed status is re-checked against a full content hash, so a
 * fingerprint collision can never turn changed code green.
 */
export function fingerprint(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex').slice(0, FINGERPRINT_LENGTH)
}

export function fingerprints(lines: readonly string[]): string[] {
  return lines.map(fingerprint)
}

const FINGERPRINT_RE = new RegExp(`^[0-9a-f]{${FINGERPRINT_LENGTH}}$`)

export function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && FINGERPRINT_RE.test(v)
}
