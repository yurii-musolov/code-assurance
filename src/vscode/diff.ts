import * as vscode from 'vscode'
import { isValidSha } from '../core/render'
import { hashLines, splitLines } from '../core/text'
import { fileAtCommit } from './git'
import type { StatusPipeline } from './pipeline'
import type { Workspace } from './workspace'

export const BASELINE_SCHEME = 'code-assurance-baseline'

const contents = new Map<string, string>()
const MAX_CONTENTS = 100
let counter = 0

/** Read-only documents for the left side of "diff since confirmation". */
export class BaselineProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return (
      contents.get(uri.path) ??
      '(This baseline is no longer available - open the diff again from the hover.)'
    )
  }
}

function register(text: string, label: string): vscode.Uri {
  const key = `/${counter++}/${label}`
  contents.set(key, text)
  while (contents.size > MAX_CONTENTS) contents.delete(contents.keys().next().value!)
  return vscode.Uri.from({ scheme: BASELINE_SCHEME, path: key })
}

/**
 * Compare a confirmation with the code of today. When the confirmed lines
 * are in the record's commit, the confirmed lines are compared with where
 * they are now; otherwise the whole file at that commit is compared with
 * the current file.
 */
export async function showDiff(
  ws: Workspace,
  pipeline: StatusPipeline,
  recordId: string,
): Promise<void> {
  const found = ws.find(recordId)
  if (!found) {
    void vscode.window.showWarningMessage('Code Assurance: confirmation not found.')
    return
  }
  const { root, record, sourcePath } = found
  if (!isValidSha(record.commit)) {
    void vscode.window.showInformationMessage(
      'Code Assurance: this confirmation was made outside git, there is nothing to compare with.',
    )
    return
  }
  const sha7 = record.commit.slice(0, 7)
  const committed = await fileAtCommit(root.rootDir, record.commit, sourcePath)
  if (committed === null) {
    void vscode.window.showWarningMessage(
      `Code Assurance: commit ${sha7} is not available locally (try fetching).`,
    )
    return
  }
  const uri = ws.uriOf(root, sourcePath)
  const base = committed === 'absent' ? '' : committed
  const baseLines = splitLines(base)
  const range = record.range
  const exact =
    !record.delta &&
    record.kind !== 'file' &&
    range !== undefined &&
    range[1] <= baseLines.length &&
    hashLines(baseLines.slice(range[0] - 1, range[1])) === record.hash
  if (exact) {
    const doc = await vscode.workspace.openTextDocument(uri)
    const entry = (await pipeline.statusFor(doc)).entries.find((e) => e.record.id === recordId)
    if (entry) {
      const now = splitLines(doc.getText()).slice(entry.res.range[0] - 1, entry.res.range[1])
      await vscode.commands.executeCommand(
        'vscode.diff',
        register(baseLines.slice(range[0] - 1, range[1]).join('\n'), `confirmed-${sha7}`),
        register(now.join('\n'), 'now'),
        `Confirmed at ${sha7} ↔ now`,
      )
      return
    }
  }
  if (record.delta) {
    void vscode.window.showInformationMessage(
      `Code Assurance: the confirmed code had uncommitted changes on top of ${sha7}; ` +
        'showing the whole file at that commit.',
    )
  }
  await vscode.commands.executeCommand(
    'vscode.diff',
    register(base, `file-${sha7}`),
    uri,
    `${sourcePath} at ${sha7} ↔ now`,
  )
}
