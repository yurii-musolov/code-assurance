import { describe, expect, it } from 'vitest'
import {
  buildRecord,
  carriedComments,
  rebaseRange,
  reattach,
  supersededBy,
  type Resolved,
} from '../../src/core/confirm'
import { validLine } from '../../src/core/records'
import { ANN, BOB, rec } from './fixtures'

const TEXT = 'a\nb\nc\nd\ne\n'

const at = (r: ReturnType<typeof rec>, range: [number, number]): Resolved => ({
  record: r,
  res: { status: 'confirmed', range },
})

describe('supersededBy', () => {
  it('replaces only own records fully enclosed by the new range', () => {
    const inner = at(rec({ author: ANN }), [2, 3])
    const partial = at(rec({ author: ANN }), [3, 6])
    const foreign = at(rec({ author: BOB }), [2, 3])
    const out = supersededBy(ANN, { kind: 'lines', range: [1, 4] }, [inner, partial, foreign])
    expect(out).toEqual([inner])
  })

  it('replaces the same symbol even when it grew', () => {
    const old = at(rec({ kind: 'symbol', symbol: 'A/m', scope: 'function' }), [2, 9])
    expect(supersededBy(ANN, { kind: 'symbol', symbol: 'A/m', range: [2, 5] }, [old])).toEqual([
      old,
    ])
  })

  it('a file confirmation replaces all own records', () => {
    const a = at(rec(), [1, 1])
    expect(supersededBy(ANN, { kind: 'file' }, [a])).toEqual([a])
  })
})

describe('buildRecord', () => {
  const base = {
    id: 'n1',
    author: ANN,
    createdAt: '2026-01-01T00:00:00Z',
    text: TEXT,
    commit: 'abc1234',
  }

  it('builds a valid line record with context', () => {
    const r = buildRecord({
      ...base,
      kind: 'lines',
      range: [2, 3],
      delta: [],
      supersedes: ['x', 'x'],
      container: 'f',
    })
    expect(validLine(r)).toBe(true)
    expect(r.lines).toHaveLength(2)
    expect(r.before).toHaveLength(1)
    expect(r.after).toHaveLength(2)
    expect(r.supersedes).toEqual(['x'])
    expect(r.delta).toBeUndefined()
    expect(r.container).toBe('f')
  })

  it('marks a record whose uncommitted changes could not be described', () => {
    const r = buildRecord({ ...base, kind: 'file', delta: null, supersedes: [] })
    expect(r.noBaseline).toBe(true)
    expect(r.range).toBeUndefined()
    expect(validLine(r)).toBe(true)
  })

  it('builds a symbol record', () => {
    const r = buildRecord({
      ...base,
      kind: 'symbol',
      scope: 'function',
      symbol: 'f',
      range: [1, 5],
      delta: [[0, 0, ['0123456789']]],
      supersedes: [],
    })
    expect(validLine(r)).toBe(true)
    expect(r.symbol).toBe('f')
    expect(r.delta).toHaveLength(1)
  })
})

describe('rebaseRange', () => {
  it('follows edits elsewhere', () => {
    expect(rebaseRange(TEXT, [2, 3], 'x\n' + TEXT)).toEqual([3, 4])
  })

  it('refuses when the confirmed lines changed or got duplicated', () => {
    expect(rebaseRange(TEXT, [2, 3], 'a\nB\nc\n')).toBeNull()
    expect(rebaseRange(TEXT, [2, 3], TEXT + 'b\nc\n')).toBeNull()
  })
})

describe('carriedComments', () => {
  it('joins non-empty comments on one line', () => {
    const a = at(rec({ comment: 'one\ntwo' }), [1, 1])
    const b = at(rec(), [2, 2])
    expect(carriedComments([a, b])).toBe('one two')
  })
})

describe('reattach', () => {
  it('moves only the author own records', () => {
    let i = 0
    const mine = rec({ author: ANN, supersedes: ['old'] })
    const theirs = rec({ author: BOB })
    const out = reattach([mine, theirs], 'new.ts', () => `id${i++}`, 'now', ANN)
    expect(out.copies).toHaveLength(1)
    expect(out.copies[0]!.movedFrom).toBe(mine.id)
    expect(out.copies[0]!.supersedes).toBeUndefined()
    expect(out.tombstones[0]).toMatchObject({
      revokes: mine.id,
      reason: 'moved',
      movedTo: 'new.ts',
    })
  })
})
