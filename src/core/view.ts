import { type Coverage, pct } from './coverage'
import type { CoverageValue, TreeFilter, TreeFolder } from './tree'

// Data of the Coverage view. The extension builds it, the webview only
// renders it: every string goes into the page as text, and actions name a
// root by index and a repository-relative path, which the extension checks
// again before acting on them.

export type ViewIcon =
  | 'repo'
  | 'folder'
  | 'file'
  | 'people'
  | 'person'
  | 'warning'
  | 'shield'
  | 'add'

export type ViewAction =
  | { type: 'open'; root: number; path: string }
  | { type: 'reattach' }
  | { type: 'init' }

export interface ViewNode {
  /** Stable across updates, so expanded folders stay expanded. */
  id: string
  label: string
  description?: string
  tooltip?: string
  icon: ViewIcon
  children?: ViewNode[]
  action?: ViewAction
  /** Every code line confirmed, some, or none (files and folders only). */
  coverage?: 'full' | 'partial' | 'none'
}

export interface ViewState {
  /** False when no workspace repository uses Code Assurance yet. */
  active: boolean
  filter: TreeFilter
  reviewers: { name: string; email: string }[]
  /** Why the path filter is ignored ('' when it is valid). */
  filterError: string
  summary: ViewNode | null
  nodes: ViewNode[]
  /** Open folders by default: a narrow filter is a search for files. */
  autoExpand: boolean
  /** Shown instead of the tree when there is nothing to list. */
  message: string
}

/** At most this many files are expanded automatically. */
export const AUTO_EXPAND_FILES = 300

export function coverageText(c: CoverageValue): string {
  if (c === 'pending') return '…'
  if (c === null) return ''
  return `${pct(c)}% (${c.confirmed}/${c.total})`
}

function coverageClass(c: CoverageValue): ViewNode['coverage'] {
  if (c === null || c === 'pending' || c.total === 0) return undefined
  if (c.confirmed >= c.total) return 'full'
  return c.confirmed > 0 ? 'partial' : 'none'
}

/** Folders first, then files, as in the explorer. */
export function folderNodes(root: number, folder: TreeFolder): ViewNode[] {
  return [
    ...folder.folders.map(
      (f): ViewNode => ({
        id: `${root}:d:${f.path}`,
        label: f.name,
        description: coverageText(f.coverage),
        icon: 'folder',
        children: folderNodes(root, f),
        ...optionalCoverage(f.coverage),
      }),
    ),
    ...folder.files.map((f): ViewNode => {
      const slash = f.path.lastIndexOf('/')
      return {
        id: `${root}:f:${f.path}`,
        label: f.path.slice(slash + 1),
        description: coverageText(f.coverage),
        tooltip: f.path,
        icon: 'file',
        action: { type: 'open', root, path: f.path },
        ...optionalCoverage(f.coverage),
      }
    }),
  ]
}

function optionalCoverage(c: CoverageValue): Pick<ViewNode, 'coverage'> {
  const v = coverageClass(c)
  return v ? { coverage: v } : {}
}

export function countFiles(nodes: readonly ViewNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.icon === 'file') n++
    if (node.children) n += countFiles(node.children)
  }
  return n
}

/** Whether the filter narrows the files beyond the default view. */
export function isSearch(f: TreeFilter): boolean {
  return f.pathRegex !== '' || f.reviewer !== null
}

export function summaryNode(
  total: Coverage,
  opts: { pending: boolean; files: number; truncatedAt: number | null; corrupt: number },
): ViewNode {
  const label = total.total === 0 ? 'No code lines' : `${pct(total)}% of code lines confirmed`
  const tooltip = [`${total.confirmed} of ${total.total} code lines confirmed.`]
  if (opts.truncatedAt !== null)
    tooltip.push(`Only the first ${opts.truncatedAt} files are counted.`)
  if (opts.corrupt > 0) tooltip.push(`${opts.corrupt} unreadable record line(s).`)
  return {
    id: 'summary',
    label: opts.pending ? `${label} (counting…)` : label,
    description: `${opts.files} file(s) with confirmations`,
    tooltip: tooltip.join('\n'),
    icon: opts.corrupt > 0 ? 'warning' : 'shield',
  }
}
