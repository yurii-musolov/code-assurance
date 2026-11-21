import { describe, expect, it } from 'vitest'
import {
  codeLineNumbers,
  fingerprint,
  FINGERPRINT_LENGTH,
  hashLines,
  hashText,
  isFingerprint,
  normalizeEol,
  splitLines,
} from '../../src/core/text'

describe('splitLines', () => {
  it('treats a trailing newline as the end of the last line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
  })

  it('has no lines for empty text and one empty line for a lone newline', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('\n')).toEqual([''])
  })

  it('normalizes CRLF and CR', () => {
    expect(normalizeEol('a\r\nb\rc')).toBe('a\nb\nc')
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b'])
  })
})

describe('codeLineNumbers', () => {
  it('skips whitespace-only lines', () => {
    expect(codeLineNumbers(['x', '', '  \t', 'y'])).toEqual([1, 4])
  })
})

describe('hashes', () => {
  it('do not depend on line endings', () => {
    expect(hashText('a\r\nb\r\n')).toBe(hashText('a\nb\n'))
    expect(hashLines(['a', 'b'])).toBe(hashLines(splitLines('a\r\nb')))
  })

  it('fingerprints are short hex digests', () => {
    const f = fingerprint('const x = 1')
    expect(f).toHaveLength(FINGERPRINT_LENGTH)
    expect(isFingerprint(f)).toBe(true)
    expect(fingerprint('const x = 1')).toBe(f)
    expect(fingerprint('const x = 2')).not.toBe(f)
    expect(isFingerprint('xyz')).toBe(false)
    expect(isFingerprint(42)).toBe(false)
  })
})
