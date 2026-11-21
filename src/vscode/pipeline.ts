import * as vscode from 'vscode'
import { fileCoverage, type Coverage } from '../core/coverage'
import { isKnownKind } from '../core/records'
import { DocModel, recordBaseline, resolveRecord, type Resolution } from '../core/resolve'
import type { AssuranceRecord } from '../core/types'
import { logError } from './log'
import type { Root, Workspace } from './workspace'

export interface Entry {
  record: AssuranceRecord
  res: Resolution
}

export interface FileStatus {
  entries: Entry[]
  coverage: Coverage | null
}

const EMPTY: FileStatus = { entries: [], coverage: null }

/** Status of every current record of a file against the given text. */
export async function resolveText(
  ws: Workspace,
  root: Root,
  sourcePath: string,
  text: string,
): Promise<FileStatus> {
  const records = root.store.currentFor(sourcePath).filter(isKnownKind)
  if (records.length === 0) return EMPTY
  const doc = new DocModel(text)
  const entries = await Promise.all(
    records.map(async (record) => {
      const commitFps =
        record.kind === 'file' || record.commit === ''
          ? null
          : await ws.commitFingerprints(root, record.commit, sourcePath)
      return { record, res: resolveRecord(record, doc, recordBaseline(record, commitFps)) }
    }),
  )
  return { entries, coverage: fileCoverage(entries, doc.lines) }
}

/**
 * Statuses of open documents, cached per document version and recomputed
 * shortly after each edit, so marks follow the code while typing.
 */
export class StatusPipeline {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidUpdate = this.emitter.event
  private cache = new WeakMap<
    vscode.TextDocument,
    { version: number; gen: number; status: Promise<FileStatus> }
  >()
  private gen = 0
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  private readonly ws: Workspace

  constructor(ws: Workspace, subscriptions: vscode.Disposable[]) {
    this.ws = ws
    subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0) this.schedule(e.document)
      }),
      ws.onDidChange(() => this.refreshAll()),
      { dispose: () => this.timers.forEach((t) => clearTimeout(t)) },
    )
  }

  /** Forget every cached status and recompute the visible editors. */
  refreshAll(): void {
    this.gen++
    for (const ed of vscode.window.visibleTextEditors) this.fire(ed.document)
  }

  private fire(doc: vscode.TextDocument): void {
    this.statusFor(doc)
      .then(() => this.emitter.fire(doc.uri))
      .catch((e) => logError('pipeline', e))
  }

  private schedule(doc: vscode.TextDocument): void {
    const key = doc.uri.toString()
    const t = this.timers.get(key)
    if (t) clearTimeout(t)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        this.fire(doc)
      }, 120),
    )
  }

  statusFor(doc: vscode.TextDocument): Promise<FileStatus> {
    const hit = this.cache.get(doc)
    if (hit && hit.version === doc.version && hit.gen === this.gen) return hit.status
    const root = this.ws.rootFor(doc.uri)
    const sourcePath = this.ws.sourcePathOf(doc.uri)
    if (!root || !sourcePath) return Promise.resolve(EMPTY)
    const status = resolveText(this.ws, root, sourcePath, doc.getText())
    this.cache.set(doc, { version: doc.version, gen: this.gen, status })
    status.catch(() => this.cache.delete(doc))
    return status
  }

  /** Entries covering a 1-based line (file records cover every line). */
  async at(doc: vscode.TextDocument, line: number): Promise<Entry[]> {
    const { entries } = await this.statusFor(doc)
    return entries.filter(
      (e) => e.record.kind === 'file' || (e.res.range[0] <= line && line <= e.res.range[1]),
    )
  }
}
