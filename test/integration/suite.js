// Runs inside a real VS Code window (see run.mjs). Plain JavaScript on
// purpose: it is loaded by the editor directly, without a build step.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vscode = require('vscode')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Run a command and accept the comment box it opens. */
async function runAccepting(command) {
  let done = false
  const p = Promise.resolve(vscode.commands.executeCommand(command)).finally(() => (done = true))
  for (let i = 0; i < 50 && !done; i++) {
    await sleep(300)
    if (!done) await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem')
  }
  await p
}

async function edit(doc, fn) {
  const we = new vscode.WorkspaceEdit()
  fn(we)
  await vscode.workspace.applyEdit(we)
  await sleep(300)
}

async function suite() {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'code-assurance')
  const api = await ext.activate()
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath
  const statuses = async (doc) =>
    (await api.statusFor(doc)).entries.map((e) => [e.res.status, e.res.range])

  await vscode.commands.executeCommand('codeAssurance.init')
  assert.ok(fs.existsSync(path.join(root, '.code-assurance', 'records')), 'store created')

  const doc = await vscode.workspace.openTextDocument(path.join(root, 'a.ts'))
  const editor = await vscode.window.showTextDocument(doc)
  editor.selection = new vscode.Selection(6, 0, 9, 0)
  await runAccepting('codeAssurance.confirmLines')
  assert.deepEqual(await statuses(doc), [['confirmed', [7, 9]]], 'confirmed lines 7-9')

  await edit(doc, (we) => we.insert(doc.uri, new vscode.Position(0, 0), '// 1\n// 2\n// 3\n'))
  assert.deepEqual(await statuses(doc), [['confirmed', [10, 12]]], 'follows lines added above')

  await edit(doc, (we) => we.replace(doc.uri, doc.lineAt(10).range, '  return b - a'))
  assert.deepEqual(await statuses(doc), [['outdated', [10, 12]]], 'outdated where the code is')

  await edit(doc, (we) => we.delete(doc.uri, new vscode.Range(0, 0, 3, 0)))
  assert.deepEqual(await statuses(doc), [['outdated', [7, 9]]], 'follows lines removed above')

  await vscode.commands.executeCommand('workbench.action.files.revert')
  await sleep(300)
  assert.deepEqual(await statuses(doc), [['confirmed', [7, 9]]], 'confirmed again after revert')

  // Symbol scopes come from the TypeScript language server, which starts
  // lazily: wait for it before confirming a function and a type.
  const until = Date.now() + 90_000
  let symbols
  while (Date.now() < until) {
    symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri)
    if (symbols && symbols.length > 0) break
    await sleep(500)
  }
  assert.ok(symbols && symbols.length > 0, 'the language server returned symbols')
  const symbolRecords = async (doc) =>
    (await api.statusFor(doc)).entries.map((e) => [
      e.record.kind,
      e.record.scope ?? null,
      e.record.symbol ?? null,
      e.res.status,
      e.res.range,
    ])

  editor.selection = new vscode.Selection(7, 4, 7, 4)
  await runAccepting('codeAssurance.confirmFunction')
  assert.deepEqual(
    await symbolRecords(doc),
    [['symbol', 'function', 'sub', 'confirmed', [7, 9]]],
    'the function replaces the line confirmation it encloses',
  )

  editor.selection = new vscode.Selection(13, 4, 13, 4)
  await runAccepting('codeAssurance.confirmType')
  assert.deepEqual(
    await symbolRecords(doc),
    [
      ['symbol', 'function', 'sub', 'confirmed', [7, 9]],
      ['symbol', 'type', 'Box', 'confirmed', [11, 16]],
    ],
    'the enclosing class is confirmed',
  )

  // A changed method body makes the type outdated, the function stays.
  await edit(doc, (we) => we.replace(doc.uri, doc.lineAt(13).range, '    return this.value + 1'))
  assert.deepEqual(
    (await symbolRecords(doc)).map((r) => r[3]),
    ['confirmed', 'outdated'],
    'only the edited type is outdated',
  )

  // Every marks position draws without errors.
  const config = vscode.workspace.getConfiguration('codeAssurance')
  for (const position of ['text', 'background', 'gutter']) {
    await config.update('marks.position', position, vscode.ConfigurationTarget.Global)
    await sleep(300)
  }
}

// The editor's exit code does not reflect the result: write it next to the
// fixture repository for run.mjs to read.
exports.run = async function () {
  const resultFile = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '..', 'result.txt')
  try {
    await suite()
    fs.writeFileSync(resultFile, 'ok')
  } catch (err) {
    fs.writeFileSync(resultFile, String((err && err.stack) || err))
    throw err
  }
}
