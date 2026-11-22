import { describe, expect, it } from 'vitest'
import { buildTree } from '../../src/core/tree'
import {
  countFiles,
  coverageText,
  folderNodes,
  isSearch,
  type Repo,
  repoNodes,
  reviewerTrees,
  summaryNode,
  type ViewNode,
} from '../../src/core/view'

const shape = (nodes: ViewNode[]): unknown[] =>
  nodes.map((n) => (n.children ? [n.label, shape(n.children)] : n.label))

describe('folderNodes', () => {
  const tree = buildTree([
    { path: 'src/b.ts', coverage: { confirmed: 2, total: 2 } },
    { path: 'src/a.ts', coverage: { confirmed: 0, total: 4 } },
    { path: 'src/core/x.ts', coverage: { confirmed: 1, total: 3 } },
    { path: 'README.md', coverage: null },
  ])
  const nodes = folderNodes(1, tree)

  it('lists folders before files, both sorted', () => {
    expect(shape(nodes)).toEqual([['src', [['core', ['x.ts']], 'a.ts', 'b.ts']], 'README.md'])
  })

  it('gives stable ids, open actions and coverage classes', () => {
    const src = nodes[0]!
    expect(src.id).toBe('1:d:src')
    expect(src.description).toBe('33% (3/9)')
    expect(src.coverage).toBe('partial')
    const [, a, b] = src.children!
    expect(a).toMatchObject({ id: '1:f:src/a.ts', coverage: 'none', tooltip: 'src/a.ts' })
    expect(b).toMatchObject({
      coverage: 'full',
      action: { type: 'open', root: 1, path: 'src/b.ts' },
    })
    expect(nodes[1]!.coverage).toBeUndefined()
    expect(countFiles(nodes)).toBe(4)
  })
})

describe('view helpers', () => {
  it('formats coverage', () => {
    expect(coverageText('pending')).toBe('…')
    expect(coverageText(null)).toBe('')
    expect(coverageText({ confirmed: 1, total: 200 })).toBe('1% (1/200)')
  })

  it('treats a path or reviewer filter as a search', () => {
    expect(isSearch({ hideUnconfirmed: true, reviewer: null, pathRegex: '' })).toBe(false)
    expect(isSearch({ hideUnconfirmed: false, reviewer: null, pathRegex: 'src' })).toBe(true)
    expect(isSearch({ hideUnconfirmed: true, reviewer: 'a@x', pathRegex: '' })).toBe(true)
  })

  it('summarizes coverage and problems', () => {
    const s = summaryNode(
      { confirmed: 1, total: 4 },
      { pending: true, files: 2, truncatedAt: 20000, corrupt: 3 },
    )
    expect(s.label).toBe('25% of code lines confirmed (counting…)')
    expect(s.description).toBe('2 file(s) with confirmations')
    expect(s.icon).toBe('warning')
    expect(s.tooltip).toContain('Only the first 20000 files')
    expect(
      summaryNode(
        { confirmed: 0, total: 0 },
        { pending: false, files: 0, truncatedAt: null, corrupt: 0 },
      ).label,
    ).toBe('No code lines')
  })
})

describe('repository and reviewer trees', () => {
  const ann = (p: string) => p.startsWith('src/')
  const repo = (label: string, paths: string[], who: (p: string) => string[]): Repo => {
    const full = buildTree(paths.map((path) => ({ path, coverage: { confirmed: 1, total: 2 } })))
    return { label, full, shown: full, reviewersOf: who }
  }
  const a = repo('a', ['src/x.ts', 'src/y.ts', 'docs/z.md'], (p) =>
    ann(p) ? ['ann@x'] : p === 'docs/z.md' ? ['bob@x'] : [],
  )
  const b = repo('b', ['lib/q.go'], (p) => (p === 'lib/q.go' ? ['bob@x'] : []))
  const people = [
    { name: 'Ann', email: 'ann@x', count: 3 },
    { name: 'Bob', email: 'bob@x', count: 2 },
    { name: 'Eve', email: 'eve@x', count: 1 },
  ]
  const filter = { hideUnconfirmed: false, reviewer: null, pathRegex: '' }

  it('lists the folders of a single repository directly', () => {
    expect(shape(repoNodes([a], (r) => r.shown))).toEqual([
      ['docs', ['z.md']],
      ['src', ['x.ts', 'y.ts']],
    ])
  })

  it('puts several repositories under their own nodes', () => {
    const nodes = repoNodes([a, b], (r) => r.shown)
    expect(nodes.map((n) => [n.id, n.label, n.description])).toEqual([
      ['0:root', 'a', '50% (3/6)'],
      ['1:root', 'b', '50% (1/2)'],
    ])
  })

  it('gives every reviewer a tree of their files, open by default', () => {
    const trees = reviewerTrees([a, b], people, filter)
    expect(trees.map((t) => [t.label, t.description, t.open])).toEqual([
      ['Ann', '3 confirmation(s) · 2 file(s)', true],
      ['Bob', '2 confirmation(s) · 2 file(s)', true],
    ])
    expect(shape(trees[1]!.children!)).toEqual([
      ['a', [['docs', ['z.md']]]],
      ['b', [['lib', ['q.go']]]],
    ])
    // A repository without the person's files is left out of their tree.
    expect(shape(trees[0]!.children!)).toEqual([['a', [['src', ['x.ts', 'y.ts']]]]])
    // The same file in two trees gets two ids.
    expect(trees[0]!.children![0]!.id).toBe('ann@x|0:root')
  })

  it('applies the path filter inside each reviewer tree', () => {
    const trees = reviewerTrees([a], people, { ...filter, pathRegex: 'y\\.ts$' })
    expect(trees.map((t) => t.label)).toEqual(['Ann'])
    expect(shape(trees[0]!.children!)).toEqual([['src', ['y.ts']]])
  })
})
