import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { type HistoryEntry, historyHtml } from '../core/html'
import { normalizeEmail } from '../core/paths'
import { commitUrl, isValidSha } from '../core/render'
import type { AssuranceRecord } from '../core/types'
import { remoteUrl } from './git'
import type { StatusPipeline } from './pipeline'
import type { Root, Workspace } from './workspace'

export function describeScope(r: AssuranceRecord, range?: [number, number]): string {
  if (r.kind === 'file') return 'whole file'
  if (r.kind === 'symbol') return `${r.scope ?? 'symbol'} ${r.symbol ?? ''}`.trim()
  const [s, e] = range ?? r.range ?? [1, 1]
  return s === e ? `line ${s}` : `lines ${s}-${e}`
}

const panels = new Map<string, vscode.WebviewPanel>()

/** History of every confirmation of one file, grouped by person and chain. */
export async function openHistory(
  ws: Workspace,
  pipeline: StatusPipeline,
  recordId: string,
): Promise<void> {
  const found = ws.find(recordId)
  if (!found) {
    void vscode.window.showWarningMessage('Code Assurance: confirmation not found.')
    return
  }
  const { root, sourcePath } = found
  const key = `${root.rootDir}\0${sourcePath}`
  let panel = panels.get(key)
  if (panel) {
    panel.reveal()
  } else {
    panel = vscode.window.createWebviewPanel(
      'codeAssurance.history',
      `History: ${sourcePath.split('/').pop()}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [] },
    )
    panels.set(key, panel)
    const p = panel
    const sub = ws.onDidChange(() => void render(ws, pipeline, p, root, sourcePath))
    p.onDidDispose(() => {
      sub.dispose()
      panels.delete(key)
    })
    p.webview.onDidReceiveMessage((msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const { cmd, recordId: id } = msg as { cmd?: unknown; recordId?: unknown }
      if (typeof id !== 'string' || typeof cmd !== 'string') return
      if (['reconfirm', 'resolve', 'showDiff', 'reveal'].includes(cmd)) {
        void vscode.commands.executeCommand(`codeAssurance.${cmd}`, id)
      }
    })
  }
  await render(ws, pipeline, panel, root, sourcePath)
}

async function render(
  ws: Workspace,
  pipeline: StatusPipeline,
  panel: vscode.WebviewPanel,
  root: Root,
  sourcePath: string,
): Promise<void> {
  const state = root.store.stateFor(sourcePath)
  let current = new Map<string, { status: HistoryEntry['status']; range: [number, number] }>()
  try {
    const doc = await vscode.workspace.openTextDocument(ws.uriOf(root, sourcePath))
    const status = await pipeline.statusFor(doc)
    current = new Map(
      status.entries.map((e) => [e.record.id, { status: e.res.status, range: e.res.range }]),
    )
  } catch {
    // The file is gone; everything shows as history only.
  }
  const remote = await remoteUrl(root.rootDir)
  const people = new Map<
    string,
    { name: string; chains: { entries: HistoryEntry[]; revoked: boolean }[] }
  >()
  state?.chains.forEach((chain, i) => {
    const byPerson = new Map<string, AssuranceRecord[]>()
    for (const r of chain) {
      const k = normalizeEmail(r.author.email)
      byPerson.set(k, [...(byPerson.get(k) ?? []), r])
    }
    for (const [email, records] of byPerson) {
      const person = people.get(email) ?? { name: records[0]!.author.name, chains: [] }
      person.chains.push({
        revoked: state.revoked.has(i),
        entries: [...records].reverse().map((r) => {
          const cur = current.get(r.id)
          return {
            recordId: r.id,
            status: cur?.status ?? 'replaced',
            createdAt: r.createdAt,
            scope: describeScope(r, cur?.range),
            commit: r.commit,
            commitLink: remote && isValidSha(r.commit) ? commitUrl(remote, r.commit) : null,
            comment: r.comment,
          }
        }),
      })
      people.set(email, person)
    }
  })
  panel.webview.html = historyHtml(
    { sourcePath, nowIso: new Date().toISOString(), people: [...people.values()] },
    panel.webview.cspSource,
    randomUUID().replace(/-/g, ''),
  )
}
