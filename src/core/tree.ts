import { type Coverage, rollup } from './coverage'
import { normalizeEmail } from './paths'

export type CoverageValue = Coverage | null | 'pending'

export interface TreeFile {
  path: string
  coverage: CoverageValue
}

export interface TreeFolder {
  name: string
  path: string
  folders: TreeFolder[]
  files: TreeFile[]
  coverage: CoverageValue
}

/** Folder tree of files with coverage rolled up into every folder. */
export function buildTree(files: readonly TreeFile[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [], coverage: null }
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const segs = f.path.split('/')
    let node = root
    for (let i = 0; i < segs.length - 1; i++) {
      let child = node.folders.find((x) => x.name === segs[i])
      if (!child) {
        child = {
          name: segs[i]!,
          path: segs.slice(0, i + 1).join('/'),
          folders: [],
          files: [],
          coverage: null,
        }
        node.folders.push(child)
      }
      node = child
    }
    node.files.push(f)
  }
  rollupFolder(root)
  return root
}

function rollupFolder(folder: TreeFolder): CoverageValue {
  const parts: (Coverage | null)[] = []
  let pending = false
  for (const v of [...folder.folders.map(rollupFolder), ...folder.files.map((f) => f.coverage)]) {
    if (v === 'pending') pending = true
    else parts.push(v)
  }
  folder.coverage = pending ? 'pending' : rollup(parts)
  return folder.coverage
}

/** View-only narrowing of the tree; percentages always describe every file. */
export interface TreeFilter {
  /** Hide files without any current confirmation. */
  hideUnconfirmed: boolean
  /** Normalized email, or null for everyone. */
  reviewer: string | null
  /** Regular expression matched against the repository-relative path; '' = off. */
  pathRegex: string
}

export const DEFAULT_FILTER: TreeFilter = { hideUnconfirmed: true, reviewer: null, pathRegex: '' }
export const MAX_PATH_REGEX = 500

export type PathMatcher = { ok: true; test: (p: string) => boolean } | { ok: false; error: string }

export function compilePathFilter(src: string): PathMatcher {
  if (src === '') return { ok: true, test: () => true }
  if (src.length > MAX_PATH_REGEX) {
    return { ok: false, error: `longer than ${MAX_PATH_REGEX} characters` }
  }
  try {
    const re = new RegExp(src)
    return { ok: true, test: (p) => re.test(p) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * `reviewersOf` gives the normalized emails of a file's current records. A
 * file whose confirmations are all outdated still has reviewers and stays
 * visible: it is exactly the code waiting to be confirmed again. An invalid
 * regex filters nothing.
 */
export function fileMatcher(
  f: TreeFilter,
  reviewersOf: (path: string) => string[],
): (file: TreeFile) => boolean {
  const compiled = compilePathFilter(f.pathRegex)
  const testPath = compiled.ok ? compiled.test : (): boolean => true
  return (file) => {
    if (!testPath(file.path)) return false
    if (!f.hideUnconfirmed && f.reviewer === null) return true
    const who = reviewersOf(file.path)
    if (f.hideUnconfirmed && who.length === 0) return false
    return f.reviewer === null || who.includes(f.reviewer)
  }
}

export function pruneTree(folder: TreeFolder, keep: (f: TreeFile) => boolean): TreeFolder {
  const folders = folder.folders
    .map((sub) => pruneTree(sub, keep))
    .filter((sub) => sub.folders.length > 0 || sub.files.length > 0)
  return { ...folder, folders, files: folder.files.filter(keep) }
}

/** Parse stored or webview input; malformed fields fall back to defaults. */
export function sanitizeFilter(raw: unknown): TreeFilter {
  const o = raw && typeof raw === 'object' ? (raw as { [K in keyof TreeFilter]?: unknown }) : {}
  return {
    hideUnconfirmed:
      typeof o.hideUnconfirmed === 'boolean' ? o.hideUnconfirmed : DEFAULT_FILTER.hideUnconfirmed,
    reviewer:
      typeof o.reviewer === 'string' && o.reviewer.trim() !== ''
        ? normalizeEmail(o.reviewer)
        : null,
    pathRegex: typeof o.pathRegex === 'string' ? o.pathRegex.slice(0, 10 * MAX_PATH_REGEX) : '',
  }
}
