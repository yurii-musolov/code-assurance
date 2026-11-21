import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { type Coverage, fileCoverage, pct } from '../core/coverage'
import { compileIgnore, type IgnoreRules } from '../core/ignore'
import { IGNORE_FILE, normalizeEmail, STORE_DIR } from '../core/paths'
import { splitLines } from '../core/text'
import {
  buildTree,
  type CoverageValue,
  DEFAULT_FILTER,
  fileMatcher,
  pruneTree,
  type TreeFile,
  type TreeFilter,
  type TreeFolder,
} from '../core/tree'
import { trackedFiles } from './git'
import { logError } from './log'
import { resolveText, type StatusPipeline } from './pipeline'
import type { Root, Workspace } from './workspace'

const MAX_FILES = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024

type Item =
  | { t: 'summary' }
  | { t: 'root'; root: Root }
  | { t: 'folder'; root: Root; node: TreeFolder }
  | { t: 'file'; root: Root; file: TreeFile }
  | { t: 'reviewers' }
  | { t: 'reviewer'; email: string }
  | { t: 'reviewerFile'; root: Root; sourcePath: string; count: number }
  | { t: 'missing' }
  | { t: 'missingFile'; root: Root; sourcePath: string }
  | { t: 'init' }

interface RootData {
  files: string[]
  ignore: IgnoreRules
  coverage: Map<string, CoverageValue>
  truncated: boolean
}

const fmt = (c: CoverageValue): string =>
  c === 'pending' ? '…' : c === null ? '' : `${pct(c)}% (${c.confirmed}/${c.total})`

/**
 * Coverage of every tracked file of repositories that use Code Assurance
 * (have a .code-assurance directory), with reviewers and confirmations of
 * files that no longer exist.
 */
export class CoverageTree implements vscode.TreeDataProvider<Item> {
  private readonly emitter = new vscode.EventEmitter<Item | undefined>()
  readonly onDidChangeTreeData = this.emitter.event
  private readonly data = new Map<string, RootData>()
  private filter: TreeFilter = DEFAULT_FILTER
  private scanGen = 0
  private fireTimer: ReturnType<typeof setTimeout> | undefined
  private reloadTimer: ReturnType<typeof setTimeout> | undefined

  private readonly ws: Workspace
  private readonly pipeline: StatusPipeline

  constructor(ws: Workspace, pipeline: StatusPipeline, subscriptions: vscode.Disposable[]) {
    this.ws = ws
    this.pipeline = pipeline
    const watcher = vscode.workspace.createFileSystemWatcher('**/*')
    const later = (): void => this.scheduleReload()
    watcher.onDidCreate(later)
    watcher.onDidDelete(later)
    subscriptions.push(
      this.emitter,
      watcher,
      ws.onDidChange(() => this.scheduleReload()),
      vscode.workspace.onDidSaveTextDocument((d) => this.recompute(d.uri)),
      pipeline.onDidUpdate((uri) => this.recompute(uri)),
      {
        dispose: () => {
          clearTimeout(this.fireTimer)
          clearTimeout(this.reloadTimer)
        },
      },
    )
    void this.reload()
  }

  setFilter(f: TreeFilter): void {
    this.filter = f
    this.emitter.fire(undefined)
  }

  reviewers(): { name: string; email: string }[] {
    const seen = new Map<string, string>()
    for (const root of this.liveRoots()) {
      for (const r of root.store.reviewers(this.includer(root)))
        if (!seen.has(r.email)) seen.set(r.email, r.name)
    }
    return [...seen].map(([email, name]) => ({ name, email }))
  }

  private liveRoots(): Root[] {
    return this.ws.roots.filter((r) => fs.existsSync(path.join(r.rootDir, STORE_DIR)))
  }

  private includer(root: Root): (p: string) => boolean {
    const ignore = this.data.get(root.rootDir)?.ignore
    return (p) => !ignore?.ignores(p)
  }

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(
      () => void this.reload().catch((e) => logError('sidebar', e)),
      400,
    )
  }

  private fireSoon(): void {
    if (this.fireTimer) return
    this.fireTimer = setTimeout(() => {
      this.fireTimer = undefined
      this.emitter.fire(undefined)
    }, 200)
  }

  /** Re-read file lists and ignore rules, then recompute every file's coverage. */
  async reload(): Promise<void> {
    const gen = ++this.scanGen
    void vscode.commands.executeCommand(
      'setContext',
      'codeAssurance.active',
      this.liveRoots().length > 0,
    )
    const work: { root: Root; sourcePath: string }[] = []
    this.data.clear()
    for (const root of this.liveRoots()) {
      let ignoreText = ''
      try {
        ignoreText = await fs.promises.readFile(path.join(root.rootDir, IGNORE_FILE), 'utf8')
      } catch {
        // no ignore file
      }
      const ignore = compileIgnore(ignoreText)
      const tracked = await trackedFiles(root.rootDir)
      const all = [...new Set([...tracked, ...root.store.confirmedFiles()])].filter(
        (p) => !p.startsWith(`${STORE_DIR}/`) && !ignore.ignores(p),
      )
      const files = all.slice(0, MAX_FILES)
      const coverage = new Map<string, CoverageValue>(files.map((f) => [f, 'pending']))
      this.data.set(root.rootDir, { files, ignore, coverage, truncated: all.length > MAX_FILES })
      for (const sourcePath of files) work.push({ root, sourcePath })
    }
    this.emitter.fire(undefined)
    // Files with confirmations first: they are what people look at.
    work.sort(
      (a, b) =>
        Number(b.root.store.currentFor(b.sourcePath).length > 0) -
        Number(a.root.store.currentFor(a.sourcePath).length > 0),
    )
    const queue = work.values()
    const worker = async (): Promise<void> => {
      for (const { root, sourcePath } of queue) {
        if (gen !== this.scanGen) return
        const value = await this.coverageOf(root, sourcePath).catch(() => null)
        if (gen !== this.scanGen) return
        this.data.get(root.rootDir)?.coverage.set(sourcePath, value)
        this.fireSoon()
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }

  private recompute(uri: vscode.Uri): void {
    const root = this.ws.rootFor(uri)
    const sourcePath = this.ws.sourcePathOf(uri)
    const d = root && this.data.get(root.rootDir)
    if (!root || !sourcePath || !d?.coverage.has(sourcePath)) return
    void this.coverageOf(root, sourcePath)
      .then((v) => {
        d.coverage.set(sourcePath, v)
        this.fireSoon()
      })
      .catch((e) => logError('sidebar.recompute', e))
  }

  private async coverageOf(root: Root, sourcePath: string): Promise<Coverage | null> {
    const uri = this.ws.uriOf(root, sourcePath)
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
    if (open) return (await this.pipeline.statusFor(open)).coverage ?? null
    let buf: Buffer
    try {
      const stat = await fs.promises.stat(uri.fsPath)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
      buf = await fs.promises.readFile(uri.fsPath)
    } catch {
      return null
    }
    if (buf.subarray(0, 8192).includes(0)) return null // binary
    const text = buf.toString('utf8')
    if (root.store.currentFor(sourcePath).length === 0) return fileCoverage([], splitLines(text))
    return (await resolveText(this.ws, root, sourcePath, text)).coverage
  }

  private treeOf(root: Root): TreeFolder {
    const d = this.data.get(root.rootDir)
    const files: TreeFile[] = (d?.files ?? []).map((p) => ({
      path: p,
      coverage: d?.coverage.get(p) ?? 'pending',
    }))
    const full = buildTree(files)
    const reviewersOf = (p: string): string[] =>
      root.store.currentFor(p).map((r) => normalizeEmail(r.author.email))
    const pruned = pruneTree(full, fileMatcher(this.filter, reviewersOf))
    return { ...pruned, coverage: full.coverage }
  }

  getChildren(item?: Item): Item[] {
    const roots = this.liveRoots()
    if (!item) {
      if (roots.length === 0) return this.ws.roots.length > 0 ? [{ t: 'init' }] : []
      const out: Item[] = [{ t: 'summary' }]
      if (roots.length === 1) out.push(...this.folderChildren(roots[0]!, this.treeOf(roots[0]!)))
      else out.push(...roots.map((root): Item => ({ t: 'root', root })))
      out.push({ t: 'reviewers' })
      if (this.missing().length > 0) out.push({ t: 'missing' })
      return out
    }
    switch (item.t) {
      case 'root':
        return this.folderChildren(item.root, this.treeOf(item.root))
      case 'folder':
        return this.folderChildren(item.root, item.node)
      case 'reviewers':
        return this.reviewers().map((r): Item => ({ t: 'reviewer', email: r.email }))
      case 'reviewer':
        return roots.flatMap((root) =>
          (
            root.store.reviewers(this.includer(root)).find((r) => r.email === item.email)?.files ??
            []
          ).map(
            (f): Item => ({
              t: 'reviewerFile',
              root,
              sourcePath: f.sourcePath,
              count: f.count,
            }),
          ),
        )
      case 'missing':
        return this.missing()
      default:
        return []
    }
  }

  private missing(): Item[] {
    return this.liveRoots().flatMap((root) =>
      root.store
        .orphans((p) => fs.existsSync(this.ws.uriOf(root, p).fsPath), this.includer(root))
        .map((sourcePath): Item => ({ t: 'missingFile', root, sourcePath })),
    )
  }

  private folderChildren(root: Root, node: TreeFolder): Item[] {
    return [
      ...node.folders.map((f): Item => ({ t: 'folder', root, node: f })),
      ...node.files.map((file): Item => ({ t: 'file', root, file })),
    ]
  }

  getTreeItem(item: Item): vscode.TreeItem {
    const None = vscode.TreeItemCollapsibleState.None
    const Collapsed = vscode.TreeItemCollapsibleState.Collapsed
    switch (item.t) {
      case 'init': {
        const ti = new vscode.TreeItem('Start using Code Assurance in this repository', None)
        ti.iconPath = new vscode.ThemeIcon('add')
        ti.command = { title: 'Initialize', command: 'codeAssurance.init' }
        return ti
      }
      case 'summary': {
        const roots = this.liveRoots()
        const trees = roots.map((r) => this.treeOf(r).coverage)
        const pending = trees.includes('pending')
        let confirmed = 0
        let total = 0
        for (const c of trees) {
          if (c && c !== 'pending') {
            confirmed += c.confirmed
            total += c.total
          }
        }
        const files = roots.reduce((n, r) => n + r.store.confirmedFiles().length, 0)
        const label =
          total === 0 ? 'No code lines' : `${pct({ confirmed, total })}% of code lines confirmed`
        const ti = new vscode.TreeItem(pending ? `${label} (counting…)` : label, None)
        const truncated = roots.some((r) => this.data.get(r.rootDir)?.truncated)
        const corrupt = roots.reduce((n, r) => n + r.store.corruptLines, 0)
        ti.description = `${files} file(s) with confirmations`
        ti.tooltip =
          `${confirmed} of ${total} code lines confirmed.` +
          (truncated ? `\nOnly the first ${MAX_FILES} files are counted.` : '') +
          (corrupt > 0 ? `\n${corrupt} unreadable record line(s).` : '')
        ti.iconPath = new vscode.ThemeIcon(corrupt > 0 ? 'warning' : 'shield')
        return ti
      }
      case 'root': {
        const ti = new vscode.TreeItem(path.basename(item.root.rootDir), Collapsed)
        ti.description = fmt(this.treeOf(item.root).coverage)
        ti.iconPath = new vscode.ThemeIcon('repo')
        return ti
      }
      case 'folder': {
        const ti = new vscode.TreeItem(item.node.name, Collapsed)
        ti.description = fmt(item.node.coverage)
        ti.iconPath = vscode.ThemeIcon.Folder
        ti.resourceUri = this.ws.uriOf(item.root, item.node.path)
        return ti
      }
      case 'file': {
        const uri = this.ws.uriOf(item.root, item.file.path)
        const ti = new vscode.TreeItem(uri, None)
        ti.description = fmt(item.file.coverage)
        ti.command = { title: 'Open', command: 'vscode.open', arguments: [uri] }
        return ti
      }
      case 'reviewers': {
        const ti = new vscode.TreeItem('Reviewers', Collapsed)
        ti.iconPath = new vscode.ThemeIcon('organization')
        return ti
      }
      case 'reviewer': {
        const roots = this.liveRoots()
        const summaries = roots.flatMap((r) =>
          r.store.reviewers(this.includer(r)).filter((x) => x.email === item.email),
        )
        const ti = new vscode.TreeItem(summaries[0]?.name ?? item.email, Collapsed)
        ti.description = `${summaries.reduce((n, s) => n + s.count, 0)} confirmation(s)`
        ti.tooltip = item.email
        ti.iconPath = new vscode.ThemeIcon('person')
        return ti
      }
      case 'reviewerFile': {
        const uri = this.ws.uriOf(item.root, item.sourcePath)
        const ti = new vscode.TreeItem(uri, None)
        ti.description = `${item.count}`
        ti.command = { title: 'Open', command: 'vscode.open', arguments: [uri] }
        return ti
      }
      case 'missing': {
        const ti = new vscode.TreeItem('Confirmations of missing files', Collapsed)
        ti.iconPath = new vscode.ThemeIcon('warning')
        ti.tooltip =
          'Files renamed or deleted after they were confirmed. Use "Move confirmations of a renamed file".'
        return ti
      }
      case 'missingFile': {
        const ti = new vscode.TreeItem(item.sourcePath, None)
        ti.command = { title: 'Move', command: 'codeAssurance.reattach' }
        ti.iconPath = new vscode.ThemeIcon('file')
        return ti
      }
    }
  }
}
