import * as vscode from 'vscode'
import { classify, nestSymbols, type SymbolNode, supportsSymbols } from '../core/scopes'

const DECLARATION_CHARS = 400

/**
 * The scope of a symbol, read from its declaration. A symbol's range starts
 * with its doc comments and attributes, which can be longer than the text
 * that is looked at, so the line with the name (where the keyword is) comes
 * first and the start of the range is the fallback.
 */
function scopeOf(
  s: Pick<vscode.DocumentSymbol, 'kind' | 'range'> & { selectionRange?: vscode.Range },
  doc: vscode.TextDocument,
): SymbolNode['scope'] {
  const read = (from: vscode.Position): string =>
    doc.getText(new vscode.Range(from, s.range.end)).slice(0, DECLARATION_CHARS)
  const nameLine = s.selectionRange?.start.line
  if (
    nameLine !== undefined &&
    nameLine > s.range.start.line &&
    s.range.contains(s.selectionRange!)
  ) {
    const scope = classify(s.kind, doc.languageId, read(new vscode.Position(nameLine, 0)))
    if (scope) return scope
  }
  return classify(s.kind, doc.languageId, read(s.range.start))
}

function toNode(
  s: Pick<vscode.DocumentSymbol, 'name' | 'kind' | 'range' | 'children'> & {
    selectionRange?: vscode.Range
  },
  doc: vscode.TextDocument,
): SymbolNode {
  return {
    name: s.name,
    scope: scopeOf(s, doc),
    range: [s.range.start.line + 1, s.range.end.line + 1],
    children: s.children.map((c) => toNode(c, doc)),
  }
}

/**
 * Symbol tree of a document in a supported language, or null when there is
 * none to trust: another language, no provider, or a provider still warming
 * up (empty answer). Providers that answer with a flat list (the Go
 * extension does) get their symbols nested by range.
 */
export async function documentSymbols(doc: vscode.TextDocument): Promise<SymbolNode[] | null> {
  if (!supportsSymbols(doc.languageId)) return null
  const result = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >('vscode.executeDocumentSymbolProvider', doc.uri)
  if (!result || result.length === 0) return null
  if ('children' in result[0]!) {
    return (result as vscode.DocumentSymbol[]).map((s) => toNode(s, doc))
  }
  return nestSymbols(
    (result as vscode.SymbolInformation[])
      .filter((s) => s.location.uri.toString() === doc.uri.toString())
      .map((s) =>
        toNode({ name: s.name, kind: s.kind, range: s.location.range, children: [] }, doc),
      ),
  )
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
