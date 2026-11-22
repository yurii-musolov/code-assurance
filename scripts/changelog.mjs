// Starts a release section in CHANGELOG.md: the notes under [Unreleased]
// move under "## [<version>] - <today>", and [Unreleased] starts empty.
// Usage: node scripts/changelog.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/changelog.mjs <major.minor.patch>')
  process.exit(2)
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
const text = readFileSync(file, 'utf8')
const heading = '## [Unreleased]\n'
const start = text.indexOf(heading)
if (start < 0) throw new Error('CHANGELOG.md has no [Unreleased] section')
const next = text.indexOf('\n## [', start + heading.length)
const notes = text.slice(start + heading.length, next < 0 ? undefined : next).trim()
if (notes === '') {
  console.error('CHANGELOG.md: nothing under [Unreleased] to release')
  process.exit(1)
}
if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has ${version}`)
const today = new Date().toISOString().slice(0, 10)
writeFileSync(file, text.replace(heading, `${heading}\n## [${version}] - ${today}\n`))
console.log(`CHANGELOG.md: [Unreleased] -> [${version}] - ${today}`)
