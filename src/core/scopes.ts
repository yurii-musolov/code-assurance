import type { Scope } from './types'

/** Languages with symbol-level commands. Every other file gets lines and whole-file only. */
export const SYMBOL_LANGUAGES: readonly string[] = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'python',
  'go',
  'rust',
]

export function supportsSymbols(languageId: string): boolean {
  return SYMBOL_LANGUAGES.includes(languageId)
}

/** Values of the editor's SymbolKind enum that matter here (the editor API numbers them from 0). */
export const Kind = {
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  Object: 18,
  Struct: 22,
  TypeParameter: 26,
} as const

export interface SymbolNode {
  name: string
  scope: Scope | null
  range: [number, number] // 1-based inclusive
  children: SymbolNode[]
}

/**
 * The scope of one document symbol.
 *
 * Language servers map items onto a small common set of kinds, so the kind
 * alone is not always enough: a JS/TS `const f = () => {}` is a variable, a
 * Rust `impl` block is an object. `declaration` is the start of the symbol's
 * text, used to tell those cases apart.
 */
export function classify(kind: number, languageId: string, declaration: string): Scope | null {
  if (languageId === 'rust') {
    const item = rustItem(declaration)
    if (item) return item
    // rust-analyzer reports type aliases as type parameters and impl blocks
    // as objects; neither kind means anything else in its outline.
    if (kind === Kind.TypeParameter) return 'type'
    if (kind === Kind.Object) return 'impl'
  }
  switch (kind) {
    case Kind.Function:
    case Kind.Method:
    case Kind.Constructor:
      return 'function'
    case Kind.Class:
    case Kind.Interface:
    case Kind.Struct:
    case Kind.Enum:
      return 'type'
    case Kind.Module:
    case Kind.Namespace:
    case Kind.Package:
      return 'module'
    case Kind.Variable:
    case Kind.Constant:
    case Kind.Property:
    case Kind.Field:
      if (languageId.startsWith('javascript') || languageId.startsWith('typescript')) {
        return isFunctionValued(declaration) ? 'function' : null
      }
      if (languageId === 'python') return /=\s*lambda\b/.test(declaration) ? 'function' : null
      return null
    default:
      return null
  }
}

/** `x = () => ...`, `x = async function () {}`; not objects or arrays that contain arrows. */
export function isFunctionValued(text: string): boolean {
  const eq = assignmentIndex(text)
  if (eq < 0) return false
  const init = text.slice(eq + 1).trimStart()
  if (/^(async\s+)?function\b/.test(init)) return true
  if (/^[{['"`]/.test(init)) return false
  return /^(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(:[^=]+)?=>/.test(init)
}

function assignmentIndex(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '=') continue
    const prev = text[i - 1]
    const next = text[i + 1]
    if (next === '>' || next === '=') continue
    if (prev === '=' || prev === '!' || prev === '<' || prev === '>') continue
    return i
  }
  return -1
}

/**
 * Rust item scope from its declaration: comments, attributes, visibility and
 * qualifiers are skipped, then the keyword decides.
 */
export function rustItem(declaration: string): Scope | null {
  let s = declaration
  for (;;) {
    const before = s
    s = s.replace(/^\s+/, '')
    s = s.replace(/^\/\/[^\n]*\n?/, '')
    s = s.replace(/^\/\*[\s\S]*?\*\//, '')
    s = s.replace(/^#!?\[[^\]]*\]/, '')
    s = s.replace(/^pub(\s*\([^)]*\))?\s+/, '')
    s = s.replace(/^(unsafe|default|const|async|auto|extern(\s+"[^"]*")?)\s+/, '')
    if (s === before) break
  }
  const kw = /^(fn|macro_rules!|macro|struct|union|enum|trait|type|impl|mod)\b|^macro_rules!/.exec(
    s,
  )
  if (!kw) return null
  const word = kw[1] ?? 'macro_rules!'
  if (word === 'fn' || word.startsWith('macro')) return 'function'
  if (word === 'impl') return 'impl'
  if (word === 'mod') return 'module'
  return 'type'
}

/**
 * Build a symbol tree from a flat list (what some providers return, e.g. the
 * Go extension): every symbol becomes a child of the smallest symbol listed
 * before it whose range encloses its own. Symbols with the same range nest
 * in list order.
 */
export function nestSymbols(flat: readonly Omit<SymbolNode, 'children'>[]): SymbolNode[] {
  const sorted = flat
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.range[0] - b.s.range[0] || b.s.range[1] - a.s.range[1] || a.i - b.i)
  const roots: SymbolNode[] = []
  const open: SymbolNode[] = []
  for (const { s } of sorted) {
    const node: SymbolNode = { name: s.name, scope: s.scope, range: s.range, children: [] }
    for (;;) {
      const top = open.at(-1)
      if (!top || (top.range[0] <= s.range[0] && s.range[1] <= top.range[1])) break
      open.pop()
    }
    ;(open.at(-1)?.children ?? roots).push(node)
    open.push(node)
  }
  return roots
}

/** Innermost symbol satisfying `pred` that encloses the whole range. */
export function enclosingSymbol(
  roots: readonly SymbolNode[],
  range: [number, number],
  pred: (n: SymbolNode) => boolean = (n) => n.scope !== null,
): { path: string; node: SymbolNode } | null {
  let best: { path: string; node: SymbolNode } | null = null
  const visit = (nodes: readonly SymbolNode[], prefix: string): void => {
    for (const n of nodes) {
      if (range[0] < n.range[0] || range[1] > n.range[1]) continue
      const path = prefix ? `${prefix}/${n.name}` : n.name
      if (pred(n)) best = { path, node: n }
      visit(n.children, path)
    }
  }
  visit(roots, '')
  return best
}

/** Every symbol at the path (duplicates such as overloads are possible). */
export function symbolsAtPath(roots: readonly SymbolNode[], path: string): SymbolNode[] {
  let level: readonly SymbolNode[] = roots
  let matches: SymbolNode[] = []
  for (const seg of path.split('/')) {
    matches = level.filter((n) => n.name === seg)
    if (matches.length === 0) return []
    level = matches.flatMap((n) => n.children)
  }
  return matches
}

export const SCOPE_LABEL: Record<Scope, string> = {
  function: 'function',
  type: 'type',
  impl: 'impl block',
  module: 'module',
}
