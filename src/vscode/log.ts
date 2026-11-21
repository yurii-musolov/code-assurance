import * as vscode from 'vscode'

let channel: vscode.OutputChannel | undefined

export function initLog(subscriptions: vscode.Disposable[]): void {
  channel = vscode.window.createOutputChannel('Code Assurance')
  subscriptions.push(channel, { dispose: () => (channel = undefined) })
}

/** Background failures are logged, never swallowed silently. */
export function logError(scope: string, err: unknown): void {
  channel?.appendLine(`[${new Date().toISOString()}] ${scope}: ${String(err)}`)
}

/** Messages shown to the person are kept in the log too. */
export function logInfo(message: string): void {
  channel?.appendLine(`[${new Date().toISOString()}] ${message}`)
}
