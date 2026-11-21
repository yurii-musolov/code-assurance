import * as vscode from 'vscode'
import { RECORDS_DIR } from '../core/paths'
import { AssuranceCodeLens } from './codelens'
import { registerCommands } from './commands'
import { BASELINE_SCHEME, BaselineProvider } from './diff'
import { FiltersView } from './filters'
import { registerHover } from './hover'
import { initLog, logError } from './log'
import { Marks } from './marks'
import { StatusPipeline } from './pipeline'
import { CoverageTree } from './sidebar'
import { Workspace } from './workspace'

const HIDDEN_KEY = 'codeAssurance.marksHidden'

export async function activate(ext: vscode.ExtensionContext): Promise<void> {
  const subs = ext.subscriptions
  initLog(subs)
  const ws = await Workspace.create()
  subs.push(ws)
  const pipeline = new StatusPipeline(ws, subs)

  // Marks in every visible editor, redrawn whenever a status changes.
  const marks = new Marks(ext.extensionUri)
  subs.push(marks)
  const paint = (ed: vscode.TextEditor): void => {
    pipeline
      .statusFor(ed.document)
      .then((s) => marks.apply(ed, s))
      .catch((e) => logError('marks', e))
  }
  const paintAll = (): void => vscode.window.visibleTextEditors.forEach(paint)
  subs.push(
    pipeline.onDidUpdate((uri) => {
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.toString() === uri.toString()) paint(ed)
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(paint)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeAssurance.marks')) paintAll()
    }),
  )
  const setHidden = (hidden: boolean): void => {
    marks.setHidden(hidden)
    void ext.workspaceState.update(HIDDEN_KEY, hidden)
    void vscode.commands.executeCommand('setContext', HIDDEN_KEY, hidden)
    paintAll()
  }
  setHidden(ext.workspaceState.get<boolean>(HIDDEN_KEY) === true)
  subs.push(
    vscode.commands.registerCommand('codeAssurance.hideMarks', () => setHidden(true)),
    vscode.commands.registerCommand('codeAssurance.showMarks', () => setHidden(false)),
  )

  // Records written by teammates arrive through git: reload when shards change.
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  const reloadSoon = (): void => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => void ws.reload().catch((e) => logError('reload', e)), 300)
  }
  let watchers: vscode.Disposable[] = []
  const watch = (): void => {
    watchers.forEach((w) => w.dispose())
    watchers = ws.roots.map((root) => {
      const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(root.rootDir), `${RECORDS_DIR}/**/*.jsonl`),
      )
      w.onDidCreate(reloadSoon)
      w.onDidChange(reloadSoon)
      w.onDidDelete(reloadSoon)
      return w
    })
  }
  watch()
  subs.push(
    { dispose: () => watchers.forEach((w) => w.dispose()) },
    { dispose: () => clearTimeout(reloadTimer) },
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      ws.rebuildRoots()
        .then(watch)
        .catch((e) => logError('workspaceFolders', e))
    }),
  )

  // Damaged record lines must be visible, not silently skipped.
  let corrupt = ws.roots.reduce((n, r) => n + r.store.corruptLines, 0)
  subs.push(
    ws.onDidChange(() => {
      const now = ws.roots.reduce((n, r) => n + r.store.corruptLines, 0)
      if (now > corrupt) {
        void vscode.window.showWarningMessage(
          `Code Assurance: ${now} unreadable line(s) in ${RECORDS_DIR} - check recent merges.`,
        )
      }
      corrupt = now
    }),
  )

  const tree = new CoverageTree(ws, pipeline, subs)
  const filters = new FiltersView(ext.workspaceState, () => tree.reviewers())
  tree.setFilter(filters.current)
  subs.push(
    filters,
    vscode.window.registerTreeDataProvider('codeAssurance.coverage', tree),
    vscode.window.registerWebviewViewProvider(FiltersView.viewId, filters),
    filters.onDidChange((f) => tree.setFilter(f)),
    ws.onDidChange(() => filters.refresh()),
    vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, new BaselineProvider()),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      new AssuranceCodeLens(pipeline, subs),
    ),
  )
  registerHover(ext, ws, pipeline)
  registerCommands({ ext, ws, pipeline }, async () => {
    await ws.reload()
    await tree.reload()
  })
  paintAll()
}

export function deactivate(): void {}
