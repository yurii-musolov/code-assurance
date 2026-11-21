// Integration test in a real VS Code: creates a throw-away git repository,
// opens it in a separate profile with this extension loaded from source and
// runs suite.js. Needs the `code` command and a display.
//
// Symbol commands for Python, Go and Rust need language extensions. They are
// taken from the local VS Code installation (VSCODE_EXTENSIONS, by default
// ~/.vscode/extensions) and linked into the test profile without the rest of
// the local extensions. A language whose extensions are not installed is
// skipped, and the summary says so. Go also needs gopls, Rust needs cargo.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const extensionPath = resolve(here, '../..')
const work = mkdtempSync(join(tmpdir(), 'code-assurance-it-'))
const repo = join(work, 'repo')
const extensionsDir = join(work, 'extensions')
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

const LANGUAGE_EXTENSIONS = {
  python: ['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.vscode-python-envs'],
  go: ['golang.go'],
  rust: ['rust-lang.rust-analyzer'],
}

const FIXTURES = {
  'a.ts':
    'import x from "x"\n\nfunction add(a, b) {\n  return a + b\n}\n\n' +
    'function sub(a, b) {\n  return a - b\n}\n\n' +
    'class Box {\n  value = 1\n  get() {\n    return this.value\n  }\n}\n',
  'mod.py':
    'import os\n\n\ndef add(a, b):\n    return a + b\n\n\n' +
    'class Box:\n    def get(self):\n        return 1\n',
  'go.mod': 'module example.com/fixture\n\ngo 1.21\n',
  'main.go':
    'package main\n\nfunc add(a, b int) int {\n\treturn a + b\n}\n\n' +
    'type Box struct {\n\tvalue int\n}\n\nfunc main() {}\n',
  'Cargo.toml': '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
  'src/lib.rs':
    'pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n' +
    'pub struct Boxed {\n    value: i32,\n}\n\n' +
    'impl Boxed {\n    pub fn get(&self) -> i32 {\n        self.value\n    }\n}\n\n' +
    'mod inner {\n    pub fn one() -> i32 {\n        1\n    }\n}\n',
}

/** Link the installed extensions of every language that has them all. */
function linkLanguageExtensions() {
  const source = process.env.VSCODE_EXTENSIONS ?? join(homedir(), '.vscode', 'extensions')
  let installed = []
  try {
    installed = JSON.parse(readFileSync(join(source, 'extensions.json'), 'utf8'))
  } catch {
    // No local extensions: every extra language is skipped.
  }
  const find = (id) =>
    installed.find(
      (e) => e.identifier?.id?.toLowerCase() === id && existsSync(e.location?.path ?? ''),
    )
  const entries = []
  const languages = []
  const skipped = []
  for (const [language, ids] of Object.entries(LANGUAGE_EXTENSIONS)) {
    const found = ids.map(find)
    if (found.some((e) => !e)) {
      skipped.push(`${language} (missing ${ids.filter((_, i) => !found[i]).join(', ')})`)
      continue
    }
    languages.push(language)
    for (const e of found) {
      const name = e.relativeLocation ?? e.location.path.split('/').pop()
      symlinkSync(e.location.path, join(extensionsDir, name), 'dir')
      entries.push({
        ...e,
        location: { $mid: 1, scheme: 'file', path: join(extensionsDir, name) },
        relativeLocation: name,
      })
    }
  }
  writeFileSync(join(extensionsDir, 'extensions.json'), JSON.stringify(entries))
  return { languages, skipped }
}

try {
  mkdirSync(extensionsDir, { recursive: true })
  mkdirSync(join(repo, 'src'), { recursive: true })
  git('init', '-q')
  git('config', 'user.name', 'Integration Test')
  git('config', 'user.email', 'it@example.com')
  for (const [file, text] of Object.entries(FIXTURES)) writeFileSync(join(repo, file), text)
  git('add', '.')
  git('commit', '-qm', 'fixture')

  const { languages, skipped } = linkLanguageExtensions()
  writeFileSync(join(work, 'languages.json'), JSON.stringify(languages))

  // A fresh profile would open the fixture in restricted mode and ask
  // whether to trust it; the language servers need a trusted workspace.
  // The other settings keep language extensions from prompting.
  mkdirSync(join(work, 'profile', 'User'), { recursive: true })
  writeFileSync(
    join(work, 'profile', 'User', 'settings.json'),
    JSON.stringify({
      'security.workspace.trust.enabled': false,
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
      'go.toolsManagement.autoUpdate': false,
      'go.survey.prompt': false,
      'go.showWelcome': false,
      'rust-analyzer.checkOnSave': false,
    }),
  )

  const r = spawnSync(
    process.env.VSCODE_BIN ?? 'code',
    [
      '--wait',
      '--new-window',
      `--user-data-dir=${join(work, 'profile')}`,
      `--extensions-dir=${extensionsDir}`,
      `--extensionDevelopmentPath=${extensionPath}`,
      `--extensionTestsPath=${join(here, 'suite.js')}`,
      repo,
    ],
    { stdio: 'inherit' },
  )
  const resultFile = join(work, 'result.txt')
  const result = existsSync(resultFile) ? readFileSync(resultFile, 'utf8') : 'no result written'
  if (r.status !== 0 || result !== 'ok') {
    console.error(`integration test failed (exit ${r.status}):\n${result}`)
    process.exitCode = 1
  } else {
    console.log(`integration test passed: typescript${languages.map((l) => `, ${l}`).join('')}`)
  }
  if (skipped.length > 0) console.log(`skipped: ${skipped.join('; ')}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
