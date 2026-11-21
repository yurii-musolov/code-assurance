import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { RecordStore } from '../core/store'
import { fingerprints, splitLines } from '../core/text'
import type { AssuranceRecord } from '../core/types'
import { fileAtCommit, repoRoot } from './git'

export interface Root {
  rootDir: string
  store: RecordStore
}

/** Resolve symlinks so paths of roots and documents compare equal. */
function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p)
  } catch {
    try {
      return path.join(fs.realpathSync.native(path.dirname(p)), path.basename(p))
    } catch {
      return p
    }
  }
}

async function workspaceRoots(): Promise<string[]> {
  const dirs = new Set<string>()
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const top = (await repoRoot(folder.uri.fsPath)) ?? folder.uri.fsPath
    dirs.add(canonical(top))
  }
  return [...dirs]
}

const MAX_CACHED_COMMIT_FILES = 300

/** The repositories of the workspace and their record stores. */
export class Workspace {
  private readonly emitter = new vscode.EventEmitter<void>()
  /** Records were reloaded or the set of repositories changed. */
  readonly onDidChange = this.emitter.event
  readonly roots: Root[] = []
  private readonly commitFiles = new Map<string, Promise<string[] | null>>()

  static async create(): Promise<Workspace> {
    const ws = new Workspace()
    await ws.rebuildRoots(false)
    return ws
  }

  /** Recompute the repositories after workspace folders changed. */
  async rebuildRoots(fire = true): Promise<void> {
    const next: Root[] = []
    for (const rootDir of await workspaceRoots()) {
      const existing = this.roots.find((r) => r.rootDir === rootDir)
      if (existing) {
        next.push(existing)
        continue
      }
      const store = new RecordStore(rootDir)
      await store.load()
      next.push({ rootDir, store })
    }
    this.roots.splice(0, this.roots.length, ...next)
    if (fire) this.emitter.fire()
  }

  async reload(): Promise<void> {
    for (const r of this.roots) await r.store.load()
    this.emitter.fire()
  }

  rootFor(uri: vscode.Uri): Root | null {
    if (uri.scheme !== 'file') return null
    const p = canonical(uri.fsPath)
    let best: Root | null = null
    for (const r of this.roots) {
      const rel = path.relative(r.rootDir, p)
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue
      if (!best || r.rootDir.length > best.rootDir.length) best = r
    }
    return best
  }

  /** Repository-relative path with forward slashes. */
  sourcePathOf(uri: vscode.Uri): string | null {
    const root = this.rootFor(uri)
    if (!root) return null
    const rel = path.relative(root.rootDir, canonical(uri.fsPath)).split(path.sep).join('/')
    return rel === '' ? null : rel
  }

  uriOf(root: Root, sourcePath: string): vscode.Uri {
    return vscode.Uri.file(path.join(root.rootDir, ...sourcePath.split('/')))
  }

  find(id: string): { root: Root; record: AssuranceRecord; sourcePath: string } | null {
    for (const root of this.roots) {
      const hit = root.store.find(id)
      if (hit) return { root, ...hit }
    }
    return null
  }

  /**
   * Line fingerprints of a file at a commit ([] when the commit did not
   * contain it, null when the commit is not available). Commits never
   * change, so results are cached.
   */
  commitFingerprints(root: Root, commit: string, sourcePath: string): Promise<string[] | null> {
    const key = `${root.rootDir}\0${commit}\0${sourcePath}`
    let hit = this.commitFiles.get(key)
    if (hit) {
      this.commitFiles.delete(key)
      this.commitFiles.set(key, hit)
      return hit
    }
    hit = fileAtCommit(root.rootDir, commit, sourcePath).then((t) =>
      t === null ? null : t === 'absent' ? [] : fingerprints(splitLines(t)),
    )
    this.commitFiles.set(key, hit)
    // A missing commit may show up after a fetch: don't remember failures.
    void hit.then((v) => {
      if (v === null) this.commitFiles.delete(key)
    })
    while (this.commitFiles.size > MAX_CACHED_COMMIT_FILES) {
      this.commitFiles.delete(this.commitFiles.keys().next().value!)
    }
    return hit
  }

  dispose(): void {
    this.emitter.dispose()
  }
}
