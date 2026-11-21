import * as vscode from 'vscode'
import { codeLensTitle } from '../core/render'
import type { Entry, StatusPipeline } from './pipeline'

/** A summary line above the first line of every confirmed, outdated or ambiguous span. */
export class AssuranceCodeLens implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this.emitter.event

  private readonly pipeline: StatusPipeline

  constructor(pipeline: StatusPipeline, subscriptions: vscode.Disposable[]) {
    this.pipeline = pipeline
    subscriptions.push(
      this.emitter,
      pipeline.onDidUpdate(() => this.emitter.fire()),
    )
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const { entries } = await this.pipeline.statusFor(doc)
    const byLine = new Map<number, Entry[]>()
    for (const e of entries) {
      const l = e.res.range[0]
      byLine.set(l, [...(byLine.get(l) ?? []), e])
    }
    const now = new Date().toISOString()
    const lenses: vscode.CodeLens[] = []
    for (const [line, group] of byLine) {
      const range = new vscode.Range(line - 1, 0, line - 1, 0)
      const title = codeLensTitle(
        group.map((g) => ({
          authorName: g.record.author.name,
          status: g.res.status,
          createdAt: g.record.createdAt,
        })),
        now,
      )
      const ids = group.map((g) => g.record.id)
      const outdated = group.some((g) => g.res.status === 'outdated')
      const ambiguous = group.filter((g) => g.res.status === 'ambiguous').map((g) => g.record.id)
      const main: vscode.Command = outdated
        ? { title, command: 'codeAssurance.reconfirm', arguments: [{ line }] }
        : ambiguous.length > 0
          ? { title, command: 'codeAssurance.resolve', arguments: [ambiguous] }
          : { title, command: 'codeAssurance.openHistory', arguments: [ids[0]] }
      lenses.push(
        new vscode.CodeLens(range, main),
        new vscode.CodeLens(range, {
          title: 'Actions',
          command: 'codeAssurance.actions',
          arguments: ids.length === 1 ? [ids[0]] : [{ line }],
        }),
        new vscode.CodeLens(range, {
          title: 'Diff',
          command: 'codeAssurance.pickDiff',
          arguments: [ids],
        }),
      )
    }
    return lenses
  }
}
