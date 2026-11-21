import { describe, expect, it } from 'vitest'
import { dedupeById, parseJsonl, resolveChains, validLine } from '../../src/core/records'
import { ANN, BOB, rec, tomb } from './fixtures'

describe('validLine', () => {
  it('accepts records and tombstones', () => {
    expect(validLine(rec())).toBe(true)
    expect(validLine(tomb('x'))).toBe(true)
  })

  it('rejects missing or mistyped fields', () => {
    expect(validLine({ ...rec(), commit: undefined })).toBe(false)
    expect(validLine({ ...rec(), range: [3, 1] })).toBe(false)
    expect(validLine({ ...rec(), range: [0, 1] })).toBe(false)
    expect(validLine({ ...rec(), range: undefined })).toBe(false)
    expect(validLine({ ...rec(), lines: ['nothex'] })).toBe(false)
    expect(validLine({ ...rec(), delta: [[0, 1, ['zz']]] })).toBe(false)
    expect(validLine({ ...rec(), scope: 'weird' })).toBe(false)
    expect(validLine({ ...rec({ kind: 'symbol' }) })).toBe(false)
    const self = rec()
    expect(validLine({ ...self, supersedes: [self.id] })).toBe(false)
  })

  it('keeps records of unknown kinds and unknown extra fields', () => {
    expect(validLine({ ...rec(), kind: 'future', extra: 1 })).toBe(true)
  })
})

describe('parseJsonl', () => {
  it('counts unreadable lines', () => {
    const good = JSON.stringify(rec())
    const { lines, corrupt } = parseJsonl(`${good}\n{broken\n\n<<<<<<< HEAD\n`)
    expect(lines).toHaveLength(1)
    expect(corrupt).toBe(2)
  })
})

describe('dedupeById', () => {
  it('collapses identical duplicates and drops conflicting ones', () => {
    const a = rec()
    const b = rec()
    const { lines, corrupt } = dedupeById([a, a, b, { ...b, comment: 'x' }])
    expect(lines).toEqual([a])
    expect(corrupt).toBe(2)
  })

  it('never lets a record shadow a tombstone', () => {
    const t = tomb('x')
    const fake = rec({ id: t.id })
    expect(dedupeById([fake, t]).lines).toEqual([t])
  })
})

describe('resolveChains', () => {
  it('makes the replacing record current', () => {
    const a = rec()
    const b = rec({ supersedes: [a.id] })
    const s = resolveChains([a, b])
    expect(s.current.map((r) => r.id)).toEqual([b.id])
    expect(s.chains).toHaveLength(1)
  })

  it('trusts topology over timestamps', () => {
    const a = rec({ createdAt: '2030-01-01T00:00:00Z' })
    const b = rec({ supersedes: [a.id], createdAt: '2020-01-01T00:00:00Z' })
    expect(resolveChains([a, b]).current.map((r) => r.id)).toEqual([b.id])
  })

  it('ignores supersede edges across authors', () => {
    const a = rec({ author: ANN })
    const b = rec({ author: BOB, supersedes: [a.id] })
    expect(
      resolveChains([a, b])
        .current.map((r) => r.id)
        .sort(),
    ).toEqual([a.id, b.id].sort())
  })

  it('withdraws a whole chain with one tombstone', () => {
    const a = rec()
    const b = rec({ supersedes: [a.id] })
    const s = resolveChains([a, b, tomb(a.id)])
    expect(s.current).toEqual([])
    expect(s.revoked.size).toBe(1)
  })

  it('ignores tombstones written by someone else', () => {
    const a = rec({ author: ANN })
    expect(resolveChains([a, tomb(a.id, { author: BOB })]).current).toEqual([a])
  })

  it('matches authors by normalized email', () => {
    const a = rec({ author: { name: 'Ann', email: 'Ann@Example.com ' } })
    expect(resolveChains([a, tomb(a.id)]).current).toEqual([])
  })

  it('keeps a hand-made cycle visible', () => {
    const a = rec({ id: 'ca', supersedes: ['cb'] })
    const b = rec({ id: 'cb', supersedes: ['ca'] })
    expect(resolveChains([a, b]).current).toHaveLength(1)
  })
})
