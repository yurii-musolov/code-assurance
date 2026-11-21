import type { AssuranceRecord, Author, Tombstone } from '../../src/core/types'

export const ANN: Author = { name: 'Ann', email: 'ann@example.com' }
export const BOB: Author = { name: 'Bob', email: 'bob@example.com' }

let n = 0
export function rec(over: Partial<AssuranceRecord> = {}): AssuranceRecord {
  n++
  return {
    id: `r${n}`,
    author: ANN,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    kind: 'lines',
    range: [1, 2],
    hash: 'sha256:x',
    commit: '',
    ...over,
  }
}

export function tomb(revokes: string, over: Partial<Tombstone> = {}): Tombstone {
  n++
  return {
    id: `t${n}`,
    author: ANN,
    createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, n)).toISOString(),
    revokes,
    reason: 'revoke',
    ...over,
  }
}
