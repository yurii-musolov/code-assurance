import { createHash } from 'node:crypto'
import * as path from 'node:path'

/** Directory, at the repository root, that holds every record. */
export const STORE_DIR = '.code-assurance'
export const RECORDS_DIR = `${STORE_DIR}/records`
export const IGNORE_FILE = `${STORE_DIR}/ignore`
export const CONFIG_FILE = `${STORE_DIR}/config.json`

/** True when fsPath is root itself or lies under it. */
export function isInsideRoot(root: string, fsPath: string): boolean {
  const rel = path.relative(root, fsPath)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Canonical form for comparing identities (never for display). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b)
}

/** Per-author shard name, so two people never append to the same file. */
export function authorSlug(email: string): string {
  return createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex').slice(0, 8)
}

/** Repository-relative shard of one author's records for one source file. */
export function shardPath(sourcePath: string, slug: string): string {
  if (sourcePath.startsWith('/') || /^[A-Za-z]:/.test(sourcePath)) {
    throw new Error(`absolute source path not allowed: ${sourcePath}`)
  }
  for (const seg of sourcePath.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`invalid source path: ${sourcePath}`)
    }
  }
  return `${RECORDS_DIR}/${sourcePath}/${slug}.jsonl`
}

/** Inverse of shardPath; null for anything that is not a shard. */
export function sourcePathOfShard(relPath: string): string | null {
  const p = relPath.replace(/\\/g, '/')
  const prefix = `${RECORDS_DIR}/`
  if (!p.startsWith(prefix)) return null
  const m = /^(.+)\/[0-9a-f]{8}\.jsonl$/.exec(p.slice(prefix.length))
  if (!m) return null
  const source = m[1]!
  return source.split('/').some((s) => s === '' || s === '.' || s === '..') ? null : source
}
