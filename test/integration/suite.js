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

async function edit(fn) {
  const we = new vscode.WorkspaceEdit()
  fn(we)
  await vscode.workspace.applyEdit(we)
  await sleep(300)
}

/** Wait for a language server to answer with the symbols of a document. */
async function waitForSymbols(doc, timeoutMs) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const symbols = await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      doc.uri,
    )
    if (symbols && symbols.length > 0) return
    if (Date.now() >= until) assert.fail(`no symbols for ${doc.fileName} from the language server`)
    await sleep(500)
  }
}

// Symbol confirmations per language: cursor line (1-based), command and
// the expected scope and range. Lines refer to the fixtures in run.mjs.
const LANGUAGE_CASES = {
  python: {
    file: 'mod.py',
    steps: [
      { line: 5, command: 'confirmFunction', scope: 'function', range: [4, 5] },
      { line: 10, command: 'confirmType', scope: 'type', range: [8, 10] },
    ],
  },
  go: {
    file: 'main.go',
    steps: [
      { line: 4, command: 'confirmFunction', scope: 'function', range: [3, 5] },
      { line: 8, command: 'confirmType', scope: 'type', range: [7, 9] },
    ],
  },
  rust: {
    file: 'src/lib.rs',
    steps: [
      { line: 2, command: 'confirmFunction', scope: 'function', range: [1, 3] },
      { line: 6, command: 'confirmType', scope: 'type', range: [5, 7] },
      { line: 11, command: 'confirmImpl', scope: 'impl', range: [9, 13] },
      { line: 17, command: 'confirmModule', scope: 'module', range: [15, 19] },
    ],
  },
}

async function checkLanguage(api, root, language) {
  const { file, steps } = LANGUAGE_CASES[language]
  const doc = await vscode.workspace.openTextDocument(path.join(root, file))
  await waitForSymbols(doc, 120_000)
  const editor = await vscode.window.showTextDocument(doc)
  const records = async () =>
    (await api.statusFor(doc)).entries
      .map((e) => [e.record.scope ?? null, e.res.status, e.res.range])
      .sort((a, b) => a[2][0] - b[2][0])

  for (const step of steps) {
    // A language extension may have opened a page of its own meanwhile.
    await vscode.window.showTextDocument(doc)
    editor.selection = new vscode.Selection(step.line - 1, 4, step.line - 1, 4)
    await runAccepting(`codeAssurance.${step.command}`)
  }
  const expected = steps.map((s) => [s.scope, 'confirmed', s.range])
  assert.deepEqual(await records(), expected, `${language}: every scope confirmed`)

  // Editing the body of the first symbol makes only that one outdated.
  const line = doc.lineAt(steps[0].line - 1)
  await edit((we) => we.insert(doc.uri, line.range.end, ' '))
  assert.deepEqual(
    (await records()).map((r) => r[1]),
    steps.map((_, i) => (i === 0 ? 'outdated' : 'confirmed')),
    `${language}: only the edited scope is outdated`,
  )
  await vscode.commands.executeCommand('workbench.action.files.revert')
  await sleep(300)
}

async function suite() {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'code-assurance')
  const api = await ext.activate()
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath
  const statuses = async (document) =>
    (await api.statusFor(document)).entries.map((e) => [e.res.status, e.res.range])

  await vscode.commands.executeCommand('codeAssurance.init')
  assert.ok(fs.existsSync(path.join(root, '.code-assurance', 'records')), 'store created')

  const doc = await vscode.workspace.openTextDocument(path.join(root, 'a.ts'))
  const editor = await vscode.window.showTextDocument(doc)
  editor.selection = new vscode.Selection(6, 0, 9, 0)
  await runAccepting('codeAssurance.confirmLines')
  assert.deepEqual(await statuses(doc), [['confirmed', [7, 9]]], 'confirmed lines 7-9')

  await edit((we) => we.insert(doc.uri, new vscode.Position(0, 0), '// 1\n// 2\n// 3\n'))
  assert.deepEqual(await statuses(doc), [['confirmed', [10, 12]]], 'follows lines added above')

  await edit((we) => we.replace(doc.uri, doc.lineAt(10).range, '  return b - a'))
  assert.deepEqual(await statuses(doc), [['outdated', [10, 12]]], 'outdated where the code is')

  await edit((we) => we.delete(doc.uri, new vscode.Range(0, 0, 3, 0)))
  assert.deepEqual(await statuses(doc), [['outdated', [7, 9]]], 'follows lines removed above')

  await vscode.commands.executeCommand('workbench.action.files.revert')
  await sleep(300)
  assert.deepEqual(await statuses(doc), [['confirmed', [7, 9]]], 'confirmed again after revert')

  // Symbol scopes come from the TypeScript language server, which starts
  // lazily: wait for it before confirming a function and a type.
  await waitForSymbols(doc, 90_000)
  const symbolRecords = async (document) =>
    (await api.statusFor(document)).entries.map((e) => [
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
  await edit((we) => we.replace(doc.uri, doc.lineAt(13).range, '    return this.value + 1'))
  assert.deepEqual(
    (await symbolRecords(doc)).map((r) => r[3]),
    ['confirmed', 'outdated'],
    'only the edited type is outdated',
  )

  // Every marks position draws without errors.
  const config = vscode.workspace.getConfiguration('codeAssurance')
  for (const position of ['gutter', 'text', 'background']) {
    await config.update('marks.position', position, vscode.ConfigurationTarget.Global)
    await sleep(300)
  }

  // Languages whose extensions run.mjs could link into the profile.
  const languages = JSON.parse(fs.readFileSync(path.join(root, '..', 'languages.json'), 'utf8'))
  for (const language of languages) await checkLanguage(api, root, language)
}

// The editor's exit code does not reflect the result: write it next to the
// fixture repository for run.mjs to read.
exports.run = async () => {
  const resultFile = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '..', 'result.txt')
  try {
    await suite()
    fs.writeFileSync(resultFile, 'ok')
  } catch (err) {
    fs.writeFileSync(resultFile, String(err?.stack || err))
    throw err
  }
}
