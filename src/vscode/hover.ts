import * as vscode from 'vscode'
import {
  callSiteMarkdown,
  commitUrl,
  HOVER_COMMANDS,
  type HoverEntry,
  hoverMarkdown,
  isValidSha,
} from '../core/render'
import { remoteUrl } from './git'
import { describeScope } from './history'
import type { StatusPipeline } from './pipeline'
import type { Workspace } from './workspace'

const DEFINITION_TIMEOUT_MS = 400

/**
 * On confirmed code: who confirmed it, when, the comment, and actions.
 * On a call whose target is confirmed elsewhere: a one-line status of the target.
 */
export function registerHover(
  ext: vscode.ExtensionContext,
  ws: Workspace,
  pipeline: StatusPipeline,
): void {
  const remotes = new Map<string, Promise<string | null>>()
  const remoteFor = (rootDir: string): Promise<string | null> => {
    let r = remotes.get(rootDir)
    if (!r) {
      r = remoteUrl(rootDir)
      remotes.set(rootDir, r)
    }
    return r
  }

  const provider: vscode.HoverProvider = {
    async provideHover(doc, pos, token) {
      const root = ws.rootFor(doc.uri)
      if (!root) return undefined
      const line = pos.line + 1
      const here = await pipeline.at(doc, line)
      if (here.length > 0) {
        const remote = await remoteFor(root.rootDir)
        const entries: HoverEntry[] = here.map((e) => ({
          recordId: e.record.id,
          authorName: e.record.author.name,
          status: e.res.status,
          createdAt: e.record.createdAt,
          scope: describeScope(e.record, e.res.range),
          comment: e.record.comment,
          commit: e.record.commit,
          commitLink:
            remote && isValidSha(e.record.commit) ? commitUrl(remote, e.record.commit) : null,
          replaced: e.record.supersedes?.length ?? 0,
        }))
        const md = new vscode.MarkdownString(hoverMarkdown(entries, new Date().toISOString()))
        // Record text is untrusted: only these command links may run.
        md.isTrusted = { enabledCommands: HOVER_COMMANDS }
        return new vscode.Hover(md)
      }

      // Call site: the status of the definition under the cursor.
      if (!ws.roots.some((r) => r.store.confirmedFiles().length > 0)) return undefined
      const lookup = Promise.resolve(
        vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>(
          'vscode.executeDefinitionProvider',
          doc.uri,
          pos,
        ),
      ).catch(() => undefined)
      const timeout = new Promise<undefined>((r) =>
        setTimeout(() => r(undefined), DEFINITION_TIMEOUT_MS),
      )
      const defs = await Promise.race([lookup, timeout])
      const first = defs?.[0]
      if (!first || token.isCancellationRequested) return undefined
      const uri = first instanceof vscode.Location ? first.uri : first.targetUri
      const range = first instanceof vscode.Location ? first.range : first.targetRange
      const targetRoot = ws.rootFor(uri)
      const targetPath = ws.sourcePathOf(uri)
      if (!targetRoot || !targetPath || targetRoot.store.currentFor(targetPath).length === 0) {
        return undefined
      }
      if (uri.toString() === doc.uri.toString() && range.contains(pos)) return undefined
      const targetDoc = await vscode.workspace.openTextDocument(uri)
      const { entries } = await pipeline.statusFor(targetDoc)
      const s = range.start.line + 1
      const covering = entries.filter(
        (e) => e.record.kind === 'file' || (e.res.range[0] <= s && s <= e.res.range[1]),
      )
      if (covering.length === 0) return undefined
      return new vscode.Hover(
        new vscode.MarkdownString(
          callSiteMarkdown(
            covering.map((e) => ({
              authorName: e.record.author.name,
              status: e.res.status,
              createdAt: e.record.createdAt,
            })),
            new Date().toISOString(),
          ),
        ),
      )
    },
  }
  ext.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file' }, provider))
}
