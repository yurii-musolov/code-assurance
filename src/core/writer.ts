import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONFIG_FILE, IGNORE_FILE, RECORDS_DIR, shardPath } from './paths'
import type { StoreLine } from './types'

/** Append one line to the author's shard. The store is never rewritten. */
export async function appendLine(
  rootDir: string,
  sourcePath: string,
  slug: string,
  line: StoreLine,
): Promise<void> {
  const abs = join(rootDir, shardPath(sourcePath, slug))
  await mkdir(dirname(abs), { recursive: true })
  await appendFile(abs, `${JSON.stringify(line)}\n`, 'utf8')
}

/** Shards are append-only, so concurrent branches merge by keeping both sides. */
export const GITATTRIBUTES_LINE = `${RECORDS_DIR}/** merge=union`

const IGNORE_TEMPLATE = `# Files left out of coverage (gitignore syntax: *, **, ?, trailing /, leading !).
# Confirmations of ignored files still show in the editor.
`

async function readOr(path: string, fallback: string | null): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return fallback
  }
}

/** Create the store in a repository; safe to run again. */
export async function initStore(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, RECORDS_DIR), { recursive: true })
  const cfg = join(rootDir, CONFIG_FILE)
  if ((await readOr(cfg, null)) === null) {
    await writeFile(cfg, `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`, 'utf8')
  }
  const ignore = join(rootDir, IGNORE_FILE)
  if ((await readOr(ignore, null)) === null) await writeFile(ignore, IGNORE_TEMPLATE, 'utf8')

  const attrPath = join(rootDir, '.gitattributes')
  const attrs = (await readOr(attrPath, '')) ?? ''
  if (!attrs.split(/\r?\n/).some((l) => l.trim() === GITATTRIBUTES_LINE)) {
    const sep = attrs === '' || attrs.endsWith('\n') ? '' : '\n'
    await writeFile(attrPath, `${attrs}${sep}${GITATTRIBUTES_LINE}\n`, 'utf8')
  }
}
