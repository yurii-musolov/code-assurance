import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { dedupeById, parseJsonl, resolveChains, type FileState } from './records'
import { normalizeEmail, RECORDS_DIR, sourcePathOfShard } from './paths'
import type { AssuranceRecord, StoreLine } from './types'

export interface ReviewerSummary {
  name: string
  email: string
  count: number
  files: { sourcePath: string; count: number }[]
}

type Include = (sourcePath: string) => boolean
const ALL: Include = () => true

/** Every record of one repository, read from `.code-assurance/records`. */
export class RecordStore {
  private bySource = new Map<string, FileState>()
  private byId = new Map<string, { record: AssuranceRecord; sourcePath: string }>()
  corruptLines = 0

  constructor(readonly rootDir: string) {}

  async load(): Promise<void> {
    const recordsDir = join(this.rootDir, RECORDS_DIR)
    const linesBySource = new Map<string, StoreLine[]>()
    let corrupt = 0
    for (const abs of await walk(recordsDir)) {
      const rel = `${RECORDS_DIR}/${relative(recordsDir, abs).split('\\').join('/')}`
      const source = sourcePathOfShard(rel)
      if (!source) continue
      let content: string
      try {
        content = await readFile(abs, 'utf8')
      } catch {
        continue
      }
      const parsed = parseJsonl(content)
      corrupt += parsed.corrupt
      const list = linesBySource.get(source) ?? []
      list.push(...parsed.lines)
      linesBySource.set(source, list)
    }
    const bySource = new Map<string, FileState>()
    const byId = new Map<string, { record: AssuranceRecord; sourcePath: string }>()
    for (const [source, lines] of linesBySource) {
      const deduped = dedupeById(lines)
      corrupt += deduped.corrupt
      const state = resolveChains(deduped.lines)
      bySource.set(source, state)
      for (const chain of state.chains) {
        for (const record of chain) byId.set(record.id, { record, sourcePath: source })
      }
    }
    this.bySource = bySource
    this.byId = byId
    this.corruptLines = corrupt
  }

  stateFor(sourcePath: string): FileState | undefined {
    return this.bySource.get(sourcePath)
  }

  currentFor(sourcePath: string): AssuranceRecord[] {
    return this.bySource.get(sourcePath)?.current ?? []
  }

  find(id: string): { record: AssuranceRecord; sourcePath: string } | undefined {
    return this.byId.get(id)
  }

  /** Source paths with at least one current record. */
  confirmedFiles(): string[] {
    return [...this.bySource.entries()]
      .filter(([, s]) => s.current.length > 0)
      .map(([p]) => p)
      .sort()
  }

  /** Files with current records that no longer exist (renamed or deleted). */
  orphans(exists: (sourcePath: string) => boolean, include: Include = ALL): string[] {
    return this.confirmedFiles().filter((p) => include(p) && !exists(p))
  }

  /** Current records per person, keyed by normalized email. */
  reviewers(include: Include = ALL): ReviewerSummary[] {
    const byEmail = new Map<
      string,
      { name: string; email: string; count: number; perFile: Map<string, number> }
    >()
    for (const [sourcePath, state] of this.bySource) {
      if (!include(sourcePath)) continue
      for (const r of state.current) {
        const key = normalizeEmail(r.author.email)
        let e = byEmail.get(key)
        if (!e) {
          e = { name: r.author.name, email: key, count: 0, perFile: new Map() }
          byEmail.set(key, e)
        }
        e.count++
        e.perFile.set(sourcePath, (e.perFile.get(sourcePath) ?? 0) + 1)
      }
    }
    return [...byEmail.values()]
      .map((e) => ({
        name: e.name,
        email: e.email,
        count: e.count,
        files: [...e.perFile.entries()]
          .map(([sourcePath, count]) => ({ sourcePath, count }))
          .sort((a, b) => b.count - a.count || a.sourcePath.localeCompare(b.sourcePath)),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }
}

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}
