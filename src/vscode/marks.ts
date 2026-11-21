import * as vscode from 'vscode'
import { lineStatuses } from '../core/coverage'
import type { Status } from '../core/resolve'
import type { FileStatus } from './pipeline'

const STATUSES: readonly Status[] = ['confirmed', 'outdated', 'ambiguous']

/** Where the status bars are drawn. */
export type MarksPosition = 'gutter' | 'text'

export function marksPosition(): MarksPosition {
  const v = vscode.workspace.getConfiguration('codeAssurance').get<string>('marks.position')
  return v === 'text' ? 'text' : 'gutter'
}

const themeColor = (s: Status): vscode.ThemeColor => new vscode.ThemeColor(`codeAssurance.${s}`)

/**
 * Vertical bars along every confirmed, outdated or ambiguous line.
 *
 * - gutter: a thin bar at the right edge of the glyph margin, next to the
 *   line numbers. It is drawn over the breakpoint column but leaves the
 *   breakpoint dot visible.
 * - text: a bar at the start of each line, inside the text area.
 *
 * Decorations never grow into inserted text (OpenOpen), so between an edit
 * and the next recomputation the bars move with the lines they mark.
 */
export class Marks {
  private readonly gutter: Record<Status, vscode.TextEditorDecorationType>
  private readonly text: Record<Status, vscode.TextEditorDecorationType>
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
    this.gutter = make((s) => ({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', `bar-${s}.svg`),
      gutterIconSize: '100% 100%',
    }))
    this.text = make((s) => ({
      isWholeLine: true,
      borderColor: themeColor(s),
      borderStyle: 'solid',
      borderWidth: '0 0 0 3px',
    }))
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
      const gutterRanges =
        position === 'gutter'
          ? mine.flatMap((r) => {
              const out: vscode.Range[] = []
              for (let l = r.range[0]; l <= r.range[1]; l++)
                out.push(new vscode.Range(l - 1, 0, l - 1, 0))
              return out
            })
          : []
      const textRanges =
        position === 'text'
          ? mine.map((r) => new vscode.Range(r.range[0] - 1, 0, r.range[1] - 1, 0))
          : []
      editor.setDecorations(this.gutter[s], gutterRanges)
      editor.setDecorations(this.text[s], textRanges)
    }
  }

  dispose(): void {
    for (const d of [...Object.values(this.gutter), ...Object.values(this.text)]) d.dispose()
  }
}
