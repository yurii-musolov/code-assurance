import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { type Coverage, fileCoverage } from '../core/coverage'
import { coverageHtml } from '../core/html'
import { compileIgnore, type IgnoreRules } from '../core/ignore'
import { IGNORE_FILE, normalizeEmail, STORE_DIR } from '../core/paths'
import { splitLines } from '../core/text'
import {
  buildTree,
  type CoverageValue,
  compilePathFilter,
  DEFAULT_FILTER,
  fileMatcher,
  pruneTree,
  sanitizeFilter,
  type TreeFile,
  type TreeFilter,
  type TreeFolder,
} from '../core/tree'
import {
  AUTO_EXPAND_FILES,
  countFiles,
  isSearch,
  type Repo,
  repoNodes,
  reviewerTrees,
  summaryNode,
  type ViewNode,
  type ViewState,
} from '../core/view'
import { trackedFiles } from './git'
import { logError } from './log'
import { resolveText, type StatusPipeline } from './pipeline'
import type { Root, Workspace } from './workspace'

const MAX_FILES = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024

interface RootData {
  files: string[]
  ignore: IgnoreRules
  coverage: Map<string, CoverageValue>
  truncated: boolean
}

const STATE_KEY = 'codeAssurance.filter'

/** Normalized emails of the people with current confirmations in a file. */
const reviewersOf =
  (root: Root) =>
  (sourcePath: string): string[] =>
    root.store.currentFor(sourcePath).map((r) => normalizeEmail(r.author.email))

/**
 * The Coverage view: filters on top and, below them, the coverage of every
 * tracked file of repositories that use Code Assurance (have a
 * .code-assurance directory), the reviewers and confirmations of files that
 * no longer exist. One panel, like the Search view; the filter only narrows
 * what is listed, percentages always describe every file.
 */
export class CoverageView implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeAssurance.coverage'
  private readonly emitter = new vscode.EventEmitter<void>()
  private readonly data = new Map<string, RootData>()
  private filter: TreeFilter
  private view: vscode.WebviewView | undefined
  private scanGen = 0
  private fireTimer: ReturnType<typeof setTimeout> | undefined
  private reloadTimer: ReturnType<typeof setTimeout> | undefined

  private readonly ws: Workspace
  private readonly pipeline: StatusPipeline

  private readonly memento: vscode.Memento

  constructor(
    ws: Workspace,
    pipeline: StatusPipeline,
    memento: vscode.Memento,
    subscriptions: vscode.Disposable[],
  ) {
    this.ws = ws
    this.pipeline = pipeline
    this.memento = memento
    this.filter = sanitizeFilter(memento.get(STATE_KEY) ?? DEFAULT_FILTER)
    const watcher = vscode.workspace.createFileSystemWatcher('**/*')
    const later = (): void => this.scheduleReload()
    watcher.onDidCreate(later)
    watcher.onDidDelete(later)
    subscriptions.push(
      this.emitter,
      watcher,
      ws.onDidChange(() => this.scheduleReload()),
      this.emitter.event(() => this.post()),
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

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [] }
    view.webview.html = coverageHtml(view.webview.cspSource, randomUUID().replace(/-/g, ''))
    view.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg))
    view.onDidChangeVisibility(() => this.post())
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  setFilter(f: TreeFilter): void {
    this.filter = f
    void this.memento.update(STATE_KEY, f)
    this.emitter.fire()
  }

  /** Commands from the view's title bar. */
  clearFilters(): void {
    this.setFilter(DEFAULT_FILTER)
  }

  collapseAll(): void {
    void this.view?.webview.postMessage({ type: 'collapseAll' })
  }

  focusFilter(): void {
    void this.view?.webview.postMessage({ type: 'focusFilter' })
  }

  private post(): void {
    if (!this.view?.visible) return
    void this.view.webview.postMessage({ type: 'state', state: this.state() })
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const m = msg as { type?: unknown; filter?: unknown; action?: unknown }
    if (m.type === 'ready') this.post()
    else if (m.type === 'filter') this.setFilter(sanitizeFilter(m.filter))
    else if (m.type === 'action')
      void this.act(m.action).catch((e) => logError('sidebar.action', e))
  }

  /** Actions come from the page: check them against what this view lists. */
  private async act(action: unknown): Promise<void> {
    if (!action || typeof action !== 'object') return
    const a = action as { type?: unknown; root?: unknown; path?: unknown }
    if (a.type === 'init') await vscode.commands.executeCommand('codeAssurance.init')
    else if (a.type === 'reattach') await vscode.commands.executeCommand('codeAssurance.reattach')
    else if (a.type === 'open' && typeof a.root === 'number' && typeof a.path === 'string') {
      const root = this.liveRoots()[a.root]
      if (!root || !this.lists(root, a.path)) return
      await vscode.commands.executeCommand('vscode.open', this.ws.uriOf(root, a.path))
    }
  }

  private lists(root: Root, sourcePath: string): boolean {
    return (
      this.data.get(root.rootDir)?.coverage.has(sourcePath) === true ||
      root.store.currentFor(sourcePath).length > 0
    )
  }

  private reviewers(): { name: string; email: string }[] {
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
      this.emitter.fire()
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
    this.emitter.fire()
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

  /** Everything the page shows, already filtered. */
  private state(): ViewState {
    const roots = this.liveRoots()
    const compiled = compilePathFilter(this.filter.pathRegex)
    const base = {
      filter: this.filter,
      reviewers: this.reviewers(),
      filterError: compiled.ok ? '' : `Invalid regular expression: ${compiled.error}`,
    }
    if (roots.length === 0) {
      const nodes: ViewNode[] =
        this.ws.roots.length > 0
          ? [
              {
                id: 'init',
                label: 'Start using Code Assurance in this repository',
                icon: 'add',
                action: { type: 'init' },
              },
            ]
          : []
      const message = this.ws.roots.length > 0 ? '' : 'Open a folder to start confirming code.'
      return { ...base, active: false, summary: null, nodes, autoExpand: false, message }
    }

    const trees = roots.map((r) => this.treeOf(r))
    let confirmed = 0
    let total = 0
    for (const t of trees) {
      if (t.full.coverage && t.full.coverage !== 'pending') {
        confirmed += t.full.coverage.confirmed
        total += t.full.coverage.total
      }
    }
    const summary = summaryNode(
      { confirmed, total },
      {
        pending: trees.some((t) => t.full.coverage === 'pending'),
        files: roots.reduce((n, r) => n + r.store.confirmedFiles().length, 0),
        truncatedAt: roots.some((r) => this.data.get(r.rootDir)?.truncated) ? MAX_FILES : null,
        corrupt: roots.reduce((n, r) => n + r.store.corruptLines, 0),
      },
    )

    const grouped = this.filter.groupByReviewer && this.filter.reviewer === null
    const repos: Repo[] = roots.map((root, i) => ({
      label: path.basename(root.rootDir),
      full: trees[i]!.full,
      shown: trees[i]!.shown,
      reviewersOf: reviewersOf(root),
    }))
    const fileNodes = grouped
      ? reviewerTrees(repos, this.reviewerCounts(roots), this.filter)
      : repoNodes(repos, (r) => r.shown)
    const shown = countFiles(fileNodes)
    const nodes = [...fileNodes]
    const missing = this.missingNodes(roots)
    if (missing.length > 0) {
      nodes.push({
        id: 'missing',
        label: 'Confirmations of missing files',
        tooltip:
          'Files renamed or deleted after they were confirmed. Use "Move confirmations of a renamed file".',
        icon: 'warning',
        children: missing,
      })
    }
    return {
      ...base,
      active: true,
      summary,
      nodes,
      autoExpand: (grouped || isSearch(this.filter)) && shown <= AUTO_EXPAND_FILES,
      message:
        shown > 0
          ? ''
          : grouped
            ? 'No confirmations match the filter.'
            : isSearch(this.filter)
              ? 'No files match the filter.'
              : '',
    }
  }

  /** People with current confirmations and how many they have, over all roots. */
  private reviewerCounts(roots: Root[]): { name: string; email: string; count: number }[] {
    const byEmail = new Map<string, { name: string; email: string; count: number }>()
    for (const root of roots) {
      for (const r of root.store.reviewers(this.includer(root))) {
        const e = byEmail.get(r.email) ?? { name: r.name, email: r.email, count: 0 }
        e.count += r.count
        byEmail.set(r.email, e)
      }
    }
    return [...byEmail.values()]
  }

  private treeOf(root: Root): { full: TreeFolder; shown: TreeFolder } {
    const d = this.data.get(root.rootDir)
    const files: TreeFile[] = (d?.files ?? []).map((p) => ({
      path: p,
      coverage: d?.coverage.get(p) ?? 'pending',
    }))
    const full = buildTree(files)
    return { full, shown: pruneTree(full, fileMatcher(this.filter, reviewersOf(root))) }
  }

  private missingNodes(roots: Root[]): ViewNode[] {
    return roots.flatMap((root, i) =>
      root.store
        .orphans((p) => fs.existsSync(this.ws.uriOf(root, p).fsPath), this.includer(root))
        .map(
          (sourcePath): ViewNode => ({
            id: `${i}:m:${sourcePath}`,
            label: sourcePath,
            icon: 'file',
            action: { type: 'reattach' },
          }),
        ),
    )
  }
}
