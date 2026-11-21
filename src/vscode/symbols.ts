import * as vscode from 'vscode'
import { classify, supportsSymbols, type SymbolNode } from '../core/scopes'

const DECLARATION_CHARS = 400

function toNode(s: vscode.DocumentSymbol, doc: vscode.TextDocument): SymbolNode {
  const declaration = doc.getText(s.range).slice(0, DECLARATION_CHARS)
  return {
    name: s.name,
    scope: classify(s.kind, doc.languageId, declaration),
    range: [s.range.start.line + 1, s.range.end.line + 1],
    children: s.children.map((c) => toNode(c, doc)),
  }
}

/**
 * Symbol tree of a document in a supported language, or null when there is
 * none to trust: another language, no provider, a provider still warming up
 * (empty answer) or one that answers only with a flat list.
 */
export async function documentSymbols(doc: vscode.TextDocument): Promise<SymbolNode[] | null> {
  if (!supportsSymbols(doc.languageId)) return null
  const result = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >('vscode.executeDocumentSymbolProvider', doc.uri)
  if (!result || result.length === 0 || !('children' in result[0]!)) return null
  return (result as vscode.DocumentSymbol[]).map((s) => toNode(s, doc))
}

/**
 * Symbols for commands that need them, waiting a little for a language
 * server that is still starting (right after a file was opened).
 */
export async function documentSymbolsPatiently(
  doc: vscode.TextDocument,
  timeoutMs = 4000,
): Promise<SymbolNode[] | null> {
  if (!supportsSymbols(doc.languageId)) return null
  const until = Date.now() + timeoutMs
  for (;;) {
    const symbols = await documentSymbols(doc)
    if (symbols || Date.now() >= until) return symbols
    await new Promise((r) => setTimeout(r, 400))
  }
}
