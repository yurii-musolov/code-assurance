import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { filtersHtml } from '../core/html'
import { compilePathFilter, DEFAULT_FILTER, sanitizeFilter, type TreeFilter } from '../core/tree'

const STATE_KEY = 'codeAssurance.filter'

/** The Filters view above the coverage tree; remembered per workspace. */
export class FiltersView implements vscode.WebviewViewProvider {
  static readonly viewId = 'codeAssurance.filters'
  private readonly emitter = new vscode.EventEmitter<TreeFilter>()
  readonly onDidChange = this.emitter.event
  private view: vscode.WebviewView | undefined
  private filter: TreeFilter

  constructor(
    private readonly memento: vscode.Memento,
    private readonly reviewers: () => { name: string; email: string }[],
  ) {
    this.filter = sanitizeFilter(memento.get(STATE_KEY) ?? DEFAULT_FILTER)
  }

  get current(): TreeFilter {
    return this.filter
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [] }
    view.webview.html = filtersHtml(view.webview.cspSource, randomUUID().replace(/-/g, ''))
    view.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg))
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  refresh(): void {
    const compiled = compilePathFilter(this.filter.pathRegex)
    void this.view?.webview.postMessage({
      type: 'state',
      filter: this.filter,
      reviewers: this.reviewers(),
      error: compiled.ok ? '' : `Invalid regex: ${compiled.error}`,
    })
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const type = (msg as { type?: unknown }).type
    if (type === 'ready') this.refresh()
    else if (type === 'set') this.set(sanitizeFilter((msg as { filter?: unknown }).filter))
    else if (type === 'reset') this.set(DEFAULT_FILTER)
  }

  private set(next: TreeFilter): void {
    this.filter = next
    void this.memento.update(STATE_KEY, next)
    this.emitter.fire(next)
    this.refresh()
  }

  dispose(): void {
    this.emitter.dispose()
  }
}
