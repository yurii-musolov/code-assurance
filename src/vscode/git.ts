import { execFile } from 'node:child_process'
import type { Author } from '../core/types'
import { isValidSha } from '../core/render'

/** Run git without a shell; null on any failure. */
export function git(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })
}

const trimmed = async (p: Promise<string | null>): Promise<string | null> => {
  const out = await p
  return out === null ? null : out.replace(/\n$/, '')
}

export function repoRoot(cwd: string): Promise<string | null> {
  return trimmed(git(['rev-parse', '--show-toplevel'], cwd))
}

export async function identity(cwd: string): Promise<Author | null> {
  const name = await trimmed(git(['config', 'user.name'], cwd))
  const email = await trimmed(git(['config', 'user.email'], cwd))
  return name && email ? { name, email } : null
}

export function headSha(cwd: string): Promise<string | null> {
  return trimmed(git(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd))
}

export async function commitExists(cwd: string, commit: string): Promise<boolean> {
  if (!isValidSha(commit)) return false
  return (await git(['cat-file', '-e', `${commit}^{commit}`], cwd)) !== null
}

/**
 * The file at a commit: its text, 'absent' when the commit exists but did not
 * contain the file, or null when the commit is not available locally.
 * Commit ids come from shared records, so only hexadecimal ids reach git.
 */
export async function fileAtCommit(
  cwd: string,
  commit: string,
  sourcePath: string,
): Promise<string | 'absent' | null> {
  if (!isValidSha(commit)) return null
  const text = await git(['show', '--end-of-options', `${commit}:${sourcePath}`], cwd)
  if (text !== null) return text
  return (await commitExists(cwd, commit)) ? 'absent' : null
}

export function remoteUrl(cwd: string): Promise<string | null> {
  return trimmed(git(['remote', 'get-url', 'origin'], cwd))
}

/** Tracked files, repository-relative. */
export async function trackedFiles(cwd: string): Promise<string[]> {
  const out = await git(['ls-files', '-z'], cwd)
  return out ? out.split('\0').filter(Boolean) : []
}
