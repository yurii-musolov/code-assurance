import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as vscode from 'vscode'
import { computeDelta } from '../core/baseline'
import {
  buildRecord,
  carriedComments,
  type Resolved,
  reattach,
  rebaseRange,
  supersededBy,
} from '../core/confirm'
import { authorSlug, sameEmail } from '../core/paths'
import { commitUrl, escapeIcons, isValidSha } from '../core/render'
import { DocModel } from '../core/resolve'
import { enclosingSymbol, SCOPE_LABEL, type SymbolNode, symbolsAtPath } from '../core/scopes'
import { fingerprints, normalizeEol, splitLines } from '../core/text'
import type { AssuranceRecord, Author, Delta, RecordKind, Scope, Tombstone } from '../core/types'
import { appendLine, initStore } from '../core/writer'
import { showDiff } from './diff'
import { headSha, identity, remoteUrl } from './git'
import { describeScope, openHistory } from './history'
import { logInfo } from './log'
import type { Entry, StatusPipeline } from './pipeline'
import { documentSymbols, documentSymbolsPatiently } from './symbols'
import type { Root, Workspace } from './workspace'

const PREFIX = 'Code Assurance'
const info = (m: string): void => {
  logInfo(m)
  void vscode.window.showInformationMessage(`${PREFIX}: ${m}`)
}
const warn = (m: string): void => {
  logInfo(m)
  void vscode.window.showWarningMessage(`${PREFIX}: ${m}`)
}

interface Ctx {
  ext: vscode.ExtensionContext
  ws: Workspace
  pipeline: StatusPipeline
}

/** The person confirming: git identity, else one asked for once and remembered. */
async function author(c: Ctx, cwd: string): Promise<Author | null> {
  const fromGit = await identity(cwd)
  if (fromGit) return fromGit
  const saved = c.ext.globalState.get<Author>('codeAssurance.identity')
  if (saved) return saved
  const name = await vscode.window.showInputBox({
    prompt: `${PREFIX}: your name (no git identity)`,
  })
  if (!name) return null
  const email = await vscode.window.showInputBox({ prompt: `${PREFIX}: your email` })
  if (!email) return null
  const a = { name, email }
  await c.ext.globalState.update('codeAssurance.identity', a)
  return a
}

interface ActiveFile {
  editor: vscode.TextEditor
  root: Root
  sourcePath: string
}

function activeFile(c: Ctx): ActiveFile | null {
  const editor = vscode.window.activeTextEditor
  if (editor?.document.uri.scheme !== 'file') {
    info('open a file first.')
    return null
  }
  const root = c.ws.rootFor(editor.document.uri)
  const sourcePath = c.ws.sourcePathOf(editor.document.uri)
  if (!root || !sourcePath) {
    info('this file is outside the workspace.')
    return null
  }
  return { editor, root, sourcePath }
}

async function openRecord(
  c: Ctx,
  id: string,
): Promise<{
  editor: vscode.TextEditor
  root: Root
  sourcePath: string
  record: AssuranceRecord
} | null> {
  const found = c.ws.find(id)
  if (!found) {
    warn('confirmation not found.')
    return null
  }
  try {
    const doc = await vscode.workspace.openTextDocument(c.ws.uriOf(found.root, found.sourcePath))
    const editor = await vscode.window.showTextDocument(doc, { preview: false })
    return { editor, ...found }
  } catch {
    warn(`${found.sourcePath} cannot be opened.`)
    return null
  }
}

async function append(
  c: Ctx,
  root: Root,
  sourcePath: string,
  who: Author,
  lines: (AssuranceRecord | Tombstone)[],
): Promise<boolean> {
  try {
    for (const l of lines) await appendLine(root.rootDir, sourcePath, authorSlug(who.email), l)
  } catch (err) {
    void vscode.window.showErrorMessage(`${PREFIX}: could not write the record - ${String(err)}`)
    return false
  }
  await c.ws.reload()
  return true
}

/** How the confirmed text differs from HEAD; null when it cannot be described. */
async function deltaFor(
  c: Ctx,
  root: Root,
  sourcePath: string,
  commit: string,
  text: string,
): Promise<Delta[] | null> {
  const base = commit ? await c.ws.commitFingerprints(root, commit, sourcePath) : []
  if (base === null) return null
  return computeDelta(base, fingerprints(splitLines(text)))
}

/** Selected lines; a selection ending at the start of a line does not include that line. */
function selectedLines(editor: vscode.TextEditor): [number, number] {
  const sel = editor.selection
  let end = sel.end.line
  if (!sel.isEmpty && sel.end.character === 0 && end > sel.start.line) end--
  return [sel.start.line + 1, end + 1]
}

interface ConfirmOptions {
  scope?: Scope | undefined
  /** Confirm exactly this symbol instead of the one at the cursor. */
  symbolPath?: string | undefined
  /** A record this confirmation explicitly replaces (confirm again / resolve). */
  supersedeId?: string | undefined
}

async function confirm(c: Ctx, kind: RecordKind, opts: ConfirmOptions = {}): Promise<void> {
  const st = activeFile(c)
  if (!st) return
  const { editor, root, sourcePath } = st
  const doc = editor.document

  // What the person read: text and range are captured before any dialog.
  const snapshot = doc.getText()
  const version = doc.version
  // Lines only use symbols to note their container: never wait for them.
  const symbols =
    kind === 'symbol'
      ? await documentSymbolsPatiently(doc)
      : kind === 'lines'
        ? await documentSymbols(doc)
        : null
  if (doc.version !== version) {
    warn('the file changed while starting - try again.')
    return
  }

  let range: [number, number] | undefined
  let symbol: string | undefined
  let container: string | undefined
  if (kind === 'lines') {
    range = selectedLines(editor)
    if (symbols) container = enclosingSymbol(symbols, range)?.path
  } else if (kind === 'symbol') {
    const scope = opts.scope ?? 'function'
    let found: { path: string; node: SymbolNode } | null = null
    if (symbols && opts.symbolPath) {
      const nodes = symbolsAtPath(symbols, opts.symbolPath)
      if (nodes.length === 1) found = { path: opts.symbolPath, node: nodes[0]! }
    } else if (symbols) {
      const line = editor.selection.active.line + 1
      found = enclosingSymbol(symbols, [line, line], (n) => n.scope === scope)
    }
    if (!found) {
      info(
        symbols
          ? `no enclosing ${SCOPE_LABEL[scope]} here - select the lines and confirm them instead.`
          : 'symbols are not available for this file yet - select the lines and confirm them instead.',
      )
      return
    }
    range = found.node.range
    symbol = found.path
  }

  const who = await author(c, root.rootDir)
  if (!who) return

  const entries = (await c.pipeline.statusFor(doc)).entries
  const replaced: Resolved[] = supersededBy(who, { kind, symbol, range }, entries)
  const explicit = entries.find(
    (e) => e.record.id === opts.supersedeId && sameEmail(e.record.author.email, who.email),
  )
  if (explicit && !replaced.includes(explicit)) replaced.push(explicit)

  let prefill = ''
  const comments = replaced.filter((e) => e.record.comment).length
  const notConfirmed = replaced.filter((e) => e.res.status !== 'confirmed').length
  const unexpected = replaced.filter((e) => e !== explicit)
  if (unexpected.length > 0 && (comments > 0 || notConfirmed > 0)) {
    const detail = [
      comments > 0 ? `${comments} of them have comments.` : '',
      notConfirmed > 0 ? `${notConfirmed} of them are outdated or ambiguous.` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const choices = comments > 0 ? ['Keep comments', 'Drop comments'] : ['Continue']
    const choice = await vscode.window.showWarningMessage(
      `This confirmation replaces ${replaced.length} of your earlier confirmations.`,
      { modal: true, detail },
      ...choices,
    )
    if (!choice) return
    if (choice === 'Keep comments') prefill = carriedComments(replaced)
  } else if (explicit?.record.comment) {
    prefill = carriedComments([explicit])
  }

  const comment = await vscode.window.showInputBox({
    prompt: `${PREFIX}: comment (optional, Enter to skip)`,
    value: prefill,
  })
  if (comment === undefined) return

  // The buffer may have changed while dialogs were open (formatters, other
  // tools). Find the lines that were read; never confirm text nobody read.
  const finalText = doc.getText()
  if (kind === 'file') {
    if (normalizeEol(finalText) !== normalizeEol(snapshot)) {
      warn('the file changed while the dialog was open - confirm it again.')
      return
    }
  } else {
    const rebased = rebaseRange(snapshot, range!, finalText)
    if (!rebased) {
      warn('the code changed while the dialog was open - confirm it again.')
      return
    }
    range = rebased
  }

  const commit = (await headSha(root.rootDir)) ?? ''
  const record = buildRecord({
    id: randomUUID(),
    author: who,
    createdAt: new Date().toISOString(),
    kind,
    scope: kind === 'symbol' ? (opts.scope ?? 'function') : undefined,
    symbol,
    container,
    range,
    text: finalText,
    commit,
    delta: await deltaFor(c, root, sourcePath, commit, finalText),
    comment: comment.trim() || undefined,
    supersedes: replaced.map((e) => e.record.id),
  })
  await append(c, root, sourcePath, who, [record])
}

function tombstone(who: Author, revokes: string): Tombstone {
  return {
    id: randomUUID(),
    author: who,
    createdAt: new Date().toISOString(),
    revokes,
    reason: 'revoke',
  }
}

function label(e: Entry): string {
  return escapeIcons(
    `${e.res.status} · ${describeScope(e.record, e.res.range)} · ${e.record.author.name}`,
  )
}

async function revokeAtCursor(c: Ctx): Promise<void> {
  const st = activeFile(c)
  if (!st) return
  const who = await author(c, st.root.rootDir)
  if (!who) return
  const line = st.editor.selection.active.line + 1
  const mine = (await c.pipeline.at(st.editor.document, line)).filter((e) =>
    sameEmail(e.record.author.email, who.email),
  )
  if (mine.length === 0) {
    info('none of your confirmations cover this line.')
    return
  }
  let chosen = mine
  if (mine.length > 1) {
    const picked = await vscode.window.showQuickPick(
      mine.map((e) => ({ label: label(e), picked: true, e })),
      { canPickMany: true, placeHolder: 'Withdraw which confirmations?' },
    )
    if (!picked || picked.length === 0) return
    chosen = picked.map((p) => p.e)
  }
  await append(
    c,
    st.root,
    st.sourcePath,
    who,
    chosen.map((e) => tombstone(who, e.record.id)),
  )
}

/** Confirm again the record with this id, or your outdated/ambiguous one at the cursor. */
async function reconfirm(c: Ctx, arg: unknown): Promise<void> {
  let editor: vscode.TextEditor
  let target: Entry | undefined
  if (typeof arg === 'string') {
    const opened = await openRecord(c, arg)
    if (!opened) return
    editor = opened.editor
    target = (await c.pipeline.statusFor(editor.document)).entries.find((e) => e.record.id === arg)
    if (!target) {
      info('this confirmation is no longer current.')
      return
    }
  } else {
    const st = activeFile(c)
    if (!st) return
    editor = st.editor
    const who = await author(c, st.root.rootDir)
    if (!who) return
    const hint = (arg as { line?: unknown } | undefined)?.line
    const line = typeof hint === 'number' ? hint : editor.selection.active.line + 1
    const mine = (await c.pipeline.at(editor.document, line)).filter((e) =>
      sameEmail(e.record.author.email, who.email),
    )
    target = mine.find((e) => e.res.status !== 'confirmed') ?? mine[0]
    if (!target) {
      info('none of your confirmations cover this line - use a Confirm command.')
      return
    }
  }
  const r = target.record
  if (r.kind === 'file') {
    await confirm(c, 'file', { supersedeId: r.id })
    return
  }
  const [first, last] = target.res.range
  const range = new vscode.Range(first - 1, 0, last - 1, 0)
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  if (r.kind === 'symbol' && r.symbol) {
    const symbols = await documentSymbolsPatiently(editor.document)
    const nodes = symbols ? symbolsAtPath(symbols, r.symbol) : []
    if (nodes.length === 1) {
      const n = nodes[0]!
      editor.selection = new vscode.Selection(n.range[0] - 1, 0, n.range[0] - 1, 0)
      await confirm(c, 'symbol', { scope: r.scope, symbolPath: r.symbol, supersedeId: r.id })
      return
    }
  }
  // A run of lines (or a symbol that is gone or duplicated): let the person
  // check the selection, so they confirm exactly what they see.
  editor.selection = new vscode.Selection(
    first - 1,
    0,
    last - 1,
    editor.document.lineAt(last - 1).text.length,
  )
  const go = await vscode.window.showInformationMessage(
    `${PREFIX}: adjust the selection if needed, then confirm it.`,
    'Confirm selection',
  )
  if (go) await confirm(c, 'lines', { supersedeId: r.id })
}

/** Pin an ambiguous confirmation to the copy that was actually checked. */
async function resolveAmbiguous(c: Ctx, arg: unknown): Promise<void> {
  const ids =
    typeof arg === 'string'
      ? [arg]
      : Array.isArray(arg)
        ? arg.filter((x) => typeof x === 'string')
        : []
  const records = ids.map((id) => c.ws.find(id as string)).filter((f) => f !== null)
  const first = records[0]
  if (!first) return
  const who = await author(c, first.root.rootDir)
  if (!who) return
  const own = records.find((f) => sameEmail(f.record.author.email, who.email))
  if (!own) {
    info(`only ${first.record.author.name} can resolve this - confirm the code yourself instead.`)
    return
  }
  const opened = await openRecord(c, own.record.id)
  if (!opened) return
  const { editor, root, sourcePath, record } = opened
  const doc = editor.document
  const entry = (await c.pipeline.statusFor(doc)).entries.find((e) => e.record.id === record.id)
  const candidates = entry?.res.status === 'ambiguous' ? (entry.res.candidates ?? []) : []
  if (candidates.length === 0) {
    info('this confirmation is not ambiguous anymore.')
    return
  }
  type Item = vscode.QuickPickItem & { range: [number, number] }
  const lines = splitLines(doc.getText())
  const picked = await new Promise<Item | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<Item>()
    qp.placeholder = `${candidates.length} identical copies - pick the one you checked`
    qp.items = candidates.map(([s, e]) => ({
      label: `Lines ${s}-${e}`,
      description: escapeIcons((lines[s - 1] ?? '').trim().slice(0, 80)),
      range: [s, e],
    }))
    qp.onDidChangeActive(([it]) => {
      if (!it) return
      const r = new vscode.Range(it.range[0] - 1, 0, it.range[1] - 1, 0)
      editor.selection = new vscode.Selection(r.start, r.end)
      editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    })
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0])
      qp.hide()
    })
    qp.onDidHide(() => {
      resolve(undefined)
      qp.dispose()
    })
    qp.show()
  })
  if (!picked) return
  const text = doc.getText()
  const len = picked.range[1] - picked.range[0] + 1
  if (new DocModel(text).windowHash(picked.range[0] - 1, len) !== record.hash) {
    warn('the file changed meanwhile - resolve again.')
    return
  }
  const commit = (await headSha(root.rootDir)) ?? ''
  const replacement = buildRecord({
    id: randomUUID(),
    author: who,
    createdAt: new Date().toISOString(),
    kind: record.kind,
    scope: record.scope,
    symbol: record.symbol,
    container: record.container,
    range: picked.range,
    text,
    commit,
    delta: await deltaFor(c, root, sourcePath, commit, text),
    comment: record.comment,
    supersedes: [record.id],
  })
  await append(c, root, sourcePath, who, [replacement])
}

/** Everything that can be done with one confirmation. */
async function actions(c: Ctx, arg: unknown): Promise<void> {
  let doc: vscode.TextDocument
  let root: Root
  let sourcePath: string
  let entries: Entry[]
  if (typeof arg === 'string') {
    const found = c.ws.find(arg)
    if (!found) {
      warn('confirmation not found.')
      return
    }
    ;({ root, sourcePath } = found)
    try {
      doc = await vscode.workspace.openTextDocument(c.ws.uriOf(root, sourcePath))
    } catch {
      warn(`${sourcePath} cannot be opened.`)
      return
    }
    entries = (await c.pipeline.statusFor(doc)).entries.filter((e) => e.record.id === arg)
  } else {
    const st = activeFile(c)
    if (!st) return
    ;({ root, sourcePath } = st)
    doc = st.editor.document
    const hint = (arg as { line?: unknown } | undefined)?.line
    entries = await c.pipeline.at(
      doc,
      typeof hint === 'number' ? hint : st.editor.selection.active.line + 1,
    )
  }
  if (entries.length === 0) {
    info('no confirmations here.')
    return
  }
  let entry = entries[0]!
  if (entries.length > 1) {
    const picked = await vscode.window.showQuickPick(
      entries.map((e) => ({ label: label(e), e })),
      { placeHolder: 'Several confirmations cover this line - pick one' },
    )
    if (!picked) return
    entry = picked.e
  }
  const who = await author(c, root.rootDir)
  if (!who) return
  const id = entry.record.id
  const mine = sameEmail(entry.record.author.email, who.email)
  type Action = vscode.QuickPickItem & { run: () => Thenable<unknown> }
  const run =
    (cmd: string): (() => Thenable<unknown>) =>
    () =>
      vscode.commands.executeCommand(`codeAssurance.${cmd}`, id)
  const items: Action[] = []
  if (mine && entry.res.status === 'ambiguous') {
    items.push({
      label: '$(pin) Resolve',
      detail: 'Pick the copy you actually checked',
      run: run('resolve'),
    })
  }
  items.push({
    label: mine ? '$(check) Confirm again' : '$(check) Confirm it yourself',
    detail: mine
      ? 'Confirm the code as it is now; replaces this confirmation'
      : `Add your own confirmation next to ${escapeIcons(entry.record.author.name)}'s`,
    run: mine ? run('reconfirm') : () => confirmLike(c, entry),
  })
  if (mine) {
    items.push({
      label: '$(trash) Withdraw',
      detail: 'The code becomes unconfirmed; the history keeps the record',
      run: () => append(c, root, sourcePath, who, [tombstone(who, id)]),
    })
  }
  items.push(
    { label: '$(diff) Diff since confirmation', run: run('showDiff') },
    { label: '$(history) History', run: run('openHistory') },
  )
  if (isValidSha(entry.record.commit)) {
    items.push({ label: '$(link-external) Open commit on the web', run: run('openCommit') })
  }
  const choice = await vscode.window.showQuickPick(items, { placeHolder: label(entry) })
  if (choice) await choice.run()
}

/** Confirm, as yourself, the same scope someone else confirmed. */
async function confirmLike(c: Ctx, entry: Entry): Promise<void> {
  const opened = await openRecord(c, entry.record.id)
  if (!opened) return
  const r = entry.record
  if (r.kind === 'file') return confirm(c, 'file')
  if (r.kind === 'symbol' && r.symbol)
    return confirm(c, 'symbol', { scope: r.scope, symbolPath: r.symbol })
  const [s, e] = entry.res.range
  opened.editor.selection = new vscode.Selection(
    s - 1,
    0,
    e - 1,
    opened.editor.document.lineAt(e - 1).text.length,
  )
  return confirm(c, 'lines')
}

async function openCommit(c: Ctx, id: unknown): Promise<void> {
  const found = typeof id === 'string' ? c.ws.find(id) : null
  if (!found || !isValidSha(found.record.commit)) {
    info('no commit recorded for this confirmation.')
    return
  }
  const remote = await remoteUrl(found.root.rootDir)
  const url = remote ? commitUrl(remote, found.record.commit) : null
  if (!url) {
    info('no recognizable git remote.')
    return
  }
  void vscode.env.openExternal(vscode.Uri.parse(url))
}

async function reveal(c: Ctx, id: unknown): Promise<void> {
  if (typeof id !== 'string') return
  const opened = await openRecord(c, id)
  if (!opened) return
  const entry = (await c.pipeline.statusFor(opened.editor.document)).entries.find(
    (e) => e.record.id === id,
  )
  const [first, last] = entry?.res.range ?? [1, 1]
  const range = new vscode.Range(first - 1, 0, last - 1, 0)
  opened.editor.selection = new vscode.Selection(range.start, range.end)
  opened.editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
}

/** Move your confirmations of a renamed or moved file to its new path. */
async function reattachOrphans(c: Ctx): Promise<void> {
  for (const root of c.ws.roots) {
    const orphans = root.store.orphans((p) => fs.existsSync(c.ws.uriOf(root, p).fsPath))
    if (orphans.length === 0) continue
    const oldPath = await vscode.window.showQuickPick(orphans, {
      placeHolder: 'Confirmations of files that no longer exist - pick the old path',
    })
    if (!oldPath) return
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: vscode.Uri.file(root.rootDir),
      openLabel: 'Move confirmations to this file',
    })
    const target = picked?.[0]
    const newPath = target ? c.ws.sourcePathOf(target) : null
    if (!target || !newPath || c.ws.rootFor(target) !== root) {
      if (target) warn('the new file must be in the same repository.')
      return
    }
    const who = await author(c, root.rootDir)
    if (!who) return
    const current = root.store.currentFor(oldPath)
    const { tombstones, copies } = reattach(
      current,
      newPath,
      randomUUID,
      new Date().toISOString(),
      who,
    )
    if (copies.length === 0) {
      const owners = [...new Set(current.map((r) => r.author.name))].join(', ')
      info(`these confirmations belong to ${owners}; each person moves their own.`)
      return
    }
    // Withdraw first: an interruption may lose coverage, never duplicate it.
    if (!(await append(c, root, oldPath, who, tombstones))) return
    await append(c, root, newPath, who, copies)
    return
  }
  info('no confirmations of missing files.')
}

export function registerCommands(c: Ctx, refresh: () => Promise<void>): void {
  const reg = (name: string, fn: (arg?: unknown) => unknown): void => {
    c.ext.subscriptions.push(vscode.commands.registerCommand(`codeAssurance.${name}`, fn))
  }
  reg('init', async () => {
    const editor = vscode.window.activeTextEditor
    const root = (editor && c.ws.rootFor(editor.document.uri)) ?? c.ws.roots[0]
    if (!root) {
      info('open a folder first.')
      return
    }
    await initStore(root.rootDir)
    await refresh()
    info(`initialized in ${root.rootDir}`)
  })
  reg('confirmLines', () => confirm(c, 'lines'))
  reg('confirmFunction', () => confirm(c, 'symbol', { scope: 'function' }))
  reg('confirmType', () => confirm(c, 'symbol', { scope: 'type' }))
  reg('confirmImpl', () => confirm(c, 'symbol', { scope: 'impl' }))
  reg('confirmModule', () => confirm(c, 'symbol', { scope: 'module' }))
  reg('confirmFile', () => confirm(c, 'file'))
  reg('reconfirm', (arg) => reconfirm(c, arg))
  reg('revoke', () => revokeAtCursor(c))
  reg('resolve', (arg) => resolveAmbiguous(c, arg))
  reg('actions', (arg) => actions(c, arg))
  reg('showDiff', (id) => (typeof id === 'string' ? showDiff(c.ws, c.pipeline, id) : undefined))
  reg('pickDiff', async (arg) => {
    const ids = Array.isArray(arg) ? arg.filter((x): x is string => typeof x === 'string') : []
    if (ids.length <= 1) return ids[0] && showDiff(c.ws, c.pipeline, ids[0])
    const items = ids.flatMap((id) => {
      const f = c.ws.find(id)
      return f
        ? [{ label: escapeIcons(`${f.record.author.name} · ${describeScope(f.record)}`), id }]
        : []
    })
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Diff which confirmation?',
    })
    if (picked) await showDiff(c.ws, c.pipeline, picked.id)
  })
  reg('openHistory', (id) =>
    typeof id === 'string' ? openHistory(c.ws, c.pipeline, id) : undefined,
  )
  reg('openCommit', (id) => openCommit(c, id))
  reg('reveal', (id) => reveal(c, id))
  reg('reattach', () => reattachOrphans(c))
  reg('refresh', refresh)
}
