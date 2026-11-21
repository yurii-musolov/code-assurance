import { describe, expect, it } from 'vitest'
import { buildTree } from '../../src/core/tree'
import {
  countFiles,
  coverageText,
  folderNodes,
  isSearch,
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
