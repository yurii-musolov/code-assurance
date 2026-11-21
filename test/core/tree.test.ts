import { describe, expect, it } from 'vitest'
import {
  buildTree,
  compilePathFilter,
  DEFAULT_FILTER,
  fileMatcher,
  pruneTree,
  sanitizeFilter,
} from '../../src/core/tree'

const files = [
  { path: 'src/a.ts', coverage: { confirmed: 1, total: 2 } },
  { path: 'src/core/b.ts', coverage: { confirmed: 2, total: 2 } },
  { path: 'README.md', coverage: null },
]

describe('buildTree', () => {
  it('rolls coverage up into folders', () => {
    const t = buildTree(files)
    expect(t.coverage).toEqual({ confirmed: 3, total: 4 })
    expect(t.folders[0]!.name).toBe('src')
    expect(t.folders[0]!.folders[0]!.coverage).toEqual({ confirmed: 2, total: 2 })
  })

  it('stays pending while any file is', () => {
    expect(buildTree([...files, { path: 'src/c.ts', coverage: 'pending' }]).coverage).toBe(
      'pending',
    )
  })
})

describe('filters', () => {
  const reviewers = (p: string): string[] => (p === 'src/a.ts' ? ['ann@example.com'] : [])

  it('hides unconfirmed files by default', () => {
    const keep = fileMatcher(DEFAULT_FILTER, reviewers)
    const pruned = pruneTree(buildTree(files), keep)
    expect(pruned.files).toEqual([])
    expect(pruned.folders[0]!.files.map((f) => f.path)).toEqual(['src/a.ts'])
    expect(pruned.folders[0]!.folders).toEqual([])
  })

  it('filters by reviewer and path', () => {
    const f = { hideUnconfirmed: false, reviewer: 'bob@example.com', pathRegex: '' }
    expect(fileMatcher(f, reviewers)(files[0]!)).toBe(false)
    const p = { hideUnconfirmed: false, reviewer: null, pathRegex: '\\.md$' }
    expect(files.filter(fileMatcher(p, reviewers)).map((x) => x.path)).toEqual(['README.md'])
  })

  it('an invalid regex filters nothing and reports the error', () => {
    expect(compilePathFilter('(').ok).toBe(false)
    const f = { hideUnconfirmed: false, reviewer: null, pathRegex: '(' }
    expect(files.filter(fileMatcher(f, reviewers))).toHaveLength(3)
  })

  it('sanitizes untrusted input', () => {
    expect(sanitizeFilter(null)).toEqual(DEFAULT_FILTER)
    expect(sanitizeFilter({ hideUnconfirmed: 'x', reviewer: ' Ann@X.com', pathRegex: 5 })).toEqual({
      hideUnconfirmed: true,
      reviewer: 'ann@x.com',
      pathRegex: '',
    })
  })
})
