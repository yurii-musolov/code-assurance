import * as vscode from 'vscode'
import { lineStatuses } from '../core/coverage'
import type { Status } from '../core/resolve'
import type { FileStatus } from './pipeline'

const STATUSES: readonly Status[] = ['confirmed', 'outdated', 'ambiguous']

/** How marked lines are drawn. */
export type MarksPosition = 'gutter' | 'text' | 'background'

const POSITIONS: readonly MarksPosition[] = ['gutter', 'text', 'background']

export function marksPosition(): MarksPosition {
  const v = vscode.workspace.getConfiguration('codeAssurance').get<string>('marks.position')
  return POSITIONS.find((p) => p === v) ?? 'gutter'
}

const themeColor = (s: Status): vscode.ThemeColor => new vscode.ThemeColor(`codeAssurance.${s}`)
const backgroundColor = (s: Status): vscode.ThemeColor =>
  new vscode.ThemeColor(`codeAssurance.${s}Background`)

/**
 * Vertical bars along every confirmed, outdated or ambiguous line.
 *
 * - gutter: a thin bar at the right edge of the glyph margin, next to the
 *   line numbers. It is drawn over the breakpoint column but leaves the
 *   breakpoint dot visible.
 * - text: a bar at the start of each line, inside the text area.
 * - background: a faint tint behind the whole line. Its colors are almost
 *   transparent so the selection, the current line highlight, find matches
 *   and bracket highlights stay distinguishable on top of it.
 *
 * Decorations never grow into inserted text (OpenOpen), so between an edit
 * and the next recomputation the bars move with the lines they mark.
 */
export class Marks {
  private readonly styles: Record<MarksPosition, Record<Status, vscode.TextEditorDecorationType>>
  private hidden = false

  constructor(extensionUri: vscode.Uri) {
    const make = (
      f: (s: Status) => vscode.DecorationRenderOptions,
    ): Record<Status, vscode.TextEditorDecorationType> =>
      Object.fromEntries(
        STATUSES.map((s) => [
          s,
          vscode.window.createTextEditorDecorationType({
            overviewRulerColor: themeColor(s),
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
            ...f(s),
          }),
        ]),
      ) as Record<Status, vscode.TextEditorDecorationType>
    this.styles = {
      gutter: make((s) => ({
        gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', `bar-${s}.svg`),
        gutterIconSize: '100% 100%',
      })),
      text: make((s) => ({
        isWholeLine: true,
        borderColor: themeColor(s),
        borderStyle: 'solid',
        borderWidth: '0 0 0 3px',
      })),
      background: make((s) => ({
        isWholeLine: true,
        backgroundColor: backgroundColor(s),
      })),
    }
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
  }

  apply(editor: vscode.TextEditor, status: FileStatus): void {
    const position = marksPosition()
    const runs = this.hidden
      ? []
      : lineStatuses(
          status.entries.map((e) => ({ status: e.res.status, range: e.res.range })),
          editor.document.lineCount,
        )
    for (const s of STATUSES) {
      const mine = runs.filter((r) => r.status === s)
      // Gutter icons draw on the first line of a range only: one range per line.
      const ranges =
        position === 'gutter'
          ? mine.flatMap((r) => {
              const out: vscode.Range[] = []
              for (let l = r.range[0]; l <= r.range[1]; l++)
                out.push(new vscode.Range(l - 1, 0, l - 1, 0))
              return out
            })
          : mine.map((r) => new vscode.Range(r.range[0] - 1, 0, r.range[1] - 1, 0))
      for (const p of POSITIONS)
        editor.setDecorations(this.styles[p][s], p === position ? ranges : [])
    }
  }

  dispose(): void {
    for (const set of Object.values(this.styles)) for (const d of Object.values(set)) d.dispose()
  }
}
