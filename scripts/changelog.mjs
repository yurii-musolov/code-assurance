// Starts a release section in CHANGELOG.md: the notes under [Unreleased]
// move under "## [<version>] - <today>", and [Unreleased] starts empty.
// With --notes, prints the notes of an existing <version> section instead
// (the body of the release commit).
// Usage: node scripts/changelog.mjs [--notes] <version>
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const notesOnly = process.argv[2] === '--notes'
const version = process.argv[notesOnly ? 3 : 2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/changelog.mjs [--notes] <major.minor.patch>')
  process.exit(2)
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
const text = readFileSync(file, 'utf8')

/** The text of the section whose heading starts with `title`. */
function section(title) {
  const start = text.indexOf(title)
  if (start < 0) return null
  const body = text.indexOf('\n', start) + 1
  const next = text.indexOf('\n## [', body)
  return text.slice(body, next < 0 ? undefined : next).trim()
}

if (notesOnly) {
  const released = section(`## [${version}]`)
  if (released === null) {
    console.error(`CHANGELOG.md has no ${version} section`)
    process.exit(1)
  }
  console.log(released)
  process.exit(0)
}
const heading = '## [Unreleased]\n'
const notes = section(heading)
if (notes === null) throw new Error('CHANGELOG.md has no [Unreleased] section')
if (notes === '') {
  console.error('CHANGELOG.md: nothing under [Unreleased] to release')
  process.exit(1)
}
if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has ${version}`)
const today = new Date().toISOString().slice(0, 10)
writeFileSync(file, text.replace(heading, `${heading}\n## [${version}] - ${today}\n`))
console.log(`CHANGELOG.md: [Unreleased] -> [${version}] - ${today}`)
