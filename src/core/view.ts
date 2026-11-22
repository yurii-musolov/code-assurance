import { type Coverage, pct } from './coverage'
import {
  type CoverageValue,
  type FileFilter,
  fileMatcher,
  pruneTree,
  type TreeFilter,
  type TreeFolder,
} from './tree'

// Data of the Coverage view. The extension builds it, the webview only
// renders it: every string goes into the page as text, and actions name a
// root by index and a repository-relative path, which the extension checks
// again before acting on them.

export type ViewIcon = 'repo' | 'folder' | 'file' | 'person' | 'warning' | 'shield' | 'add'

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
  /** Expanded until the person collapses it (folders follow ViewState.autoExpand). */
  open?: boolean
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

/**
 * Folders first, then files, as in the explorer. `prefix` keeps ids unique
 * when the same file appears in several trees (one per reviewer).
 */
export function folderNodes(root: number, folder: TreeFolder, prefix = ''): ViewNode[] {
  return [
    ...folder.folders.map(
      (f): ViewNode => ({
        id: `${prefix}${root}:d:${f.path}`,
        label: f.name,
        description: coverageText(f.coverage),
        icon: 'folder',
        children: folderNodes(root, f, prefix),
        ...optionalCoverage(f.coverage),
      }),
    ),
    ...folder.files.map((f): ViewNode => {
      const slash = f.path.lastIndexOf('/')
      return {
        id: `${prefix}${root}:f:${f.path}`,
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

/** A workspace repository as the view lists it. */
export interface Repo {
  label: string
  /** Every file, for the repository's own percentage. */
  full: TreeFolder
  /** The files the current filter lets through. */
  shown: TreeFolder
  /** Normalized emails of the people with current confirmations in a file. */
  reviewersOf: (sourcePath: string) => string[]
}

/**
 * One repository: its folders directly; several: a node per repository.
 * In a reviewer's tree (`prefix` set) repositories without files are left out.
 */
export function repoNodes(
  repos: readonly Repo[],
  shownOf: (repo: Repo) => TreeFolder,
  prefix = '',
): ViewNode[] {
  if (repos.length === 1) return folderNodes(0, shownOf(repos[0]!), prefix)
  return repos
    .map(
      (repo, i): ViewNode => ({
        id: `${prefix}${i}:root`,
        label: repo.label,
        description: coverageText(repo.full.coverage),
        icon: 'repo',
        children: folderNodes(i, shownOf(repo), prefix),
      }),
    )
    .filter((n) => prefix === '' || (n.children?.length ?? 0) > 0)
}

/**
 * One tree per reviewer: the files that person has current confirmations
 * in, narrowed by the path filter. Percentages still describe each file as
 * a whole. Reviewers without matching files are left out.
 */
export function reviewerTrees(
  repos: readonly Repo[],
  people: readonly { name: string; email: string; count: number }[],
  filter: FileFilter,
): ViewNode[] {
  const out: ViewNode[] = []
  for (const person of people) {
    const own = { ...filter, reviewer: person.email, hideUnconfirmed: true }
    const prefix = `${person.email}|`
    const children = repoNodes(
      repos,
      (repo) => pruneTree(repo.full, fileMatcher(own, repo.reviewersOf)),
      prefix,
    )
    if (children.length === 0) continue
    out.push({
      id: `reviewer:${person.email}`,
      label: person.name,
      description: `${person.count} confirmation(s) · ${countFiles(children)} file(s)`,
      tooltip: person.email,
      icon: 'person',
      open: true,
      children,
    })
  }
  return out
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
export function isSearch(f: FileFilter): boolean {
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
