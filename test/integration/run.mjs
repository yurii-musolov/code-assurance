// Integration test in a real VS Code: creates a throw-away git repository,
// opens it in a separate profile with this extension loaded from source and
// runs suite.js. Needs the `code` command and a display.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const extensionPath = resolve(here, '../..')
const work = mkdtempSync(join(tmpdir(), 'code-assurance-it-'))
const repo = join(work, 'repo')
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

try {
  execFileSync('mkdir', ['-p', repo])
  git('init', '-q')
  git('config', 'user.name', 'Integration Test')
  git('config', 'user.email', 'it@example.com')
  writeFileSync(
    join(repo, 'a.ts'),
    'import x from "x"\n\nfunction add(a, b) {\n  return a + b\n}\n\n' +
      'function sub(a, b) {\n  return a - b\n}\n',
  )
  git('add', '.')
  git('commit', '-qm', 'fixture')
  const r = spawnSync(
    process.env.VSCODE_BIN ?? 'code',
    [
      '--wait',
      '--new-window',
      `--user-data-dir=${join(work, 'profile')}`,
      `--extensions-dir=${join(work, 'extensions')}`,
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
    console.log('integration test passed')
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
