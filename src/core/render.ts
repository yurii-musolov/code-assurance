import type { Status } from './resolve'

// Everything rendered here may come from other people's records (names,
// comments, commits): it is escaped for the target format, and links are
// built only from values validated by shape.

export const COMMAND_PREFIX = 'codeAssurance'

export function relTime(fromIso: string, toIso: string): string {
  const delta = (Date.parse(toIso) - Date.parse(fromIso)) / 1000
  if (Number.isNaN(delta)) return 'unknown time'
  const s = Math.max(0, delta)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function statusLabel(status: Status): string {
  if (status === 'confirmed') return '✓ confirmed'
  if (status === 'ambiguous') return '? ambiguous (identical code in several places)'
  return '⚠ outdated (changed since confirmation)'
}

/** Escape Markdown so record text can never become formatting or a link. */
export function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()<>#+\-.!|~])/g, '\\$1')
}

/** QuickPick labels render `$(icon)`; escape it in record text. */
export function escapeIcons(s: string): string {
  return s.replace(/\$\(/g, '\\$(')
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A plain hexadecimal commit id; anything else is never put into a link or a git call. */
export function isValidSha(commit: string): boolean {
  return /^[0-9a-f]{4,64}$/i.test(commit)
}

/** Web page of a commit for common hosting services, or null. */
export function commitUrl(remote: string, sha: string): string | null {
  if (!isValidSha(sha)) return null
  const r = remote.trim()
  const m =
    /^git@([^:/\s]+):([^\s]+?)(?:\.git)?\/?$/.exec(r) ??
    /^(?:https?|ssh):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/([^\s]+?)(?:\.git)?\/?$/.exec(r)
  if (!m) return null
  const host = m[1]!
  const path = m[2]!
  if (!/^[\w.-]+$/.test(host) || !/^[\w.\-/~]+$/.test(path)) return null
  if (host === 'bitbucket.org') return `https://${host}/${path}/commits/${sha}`
  if (host.includes('gitlab')) return `https://${host}/${path}/-/commit/${sha}`
  return `https://${host}/${path}/commit/${sha}`
}

export interface HoverEntry {
  recordId: string
  authorName: string
  status: Status
  createdAt: string
  scope: string
  comment?: string
  commit: string
  commitLink: string | null
  replaced: number
}

const cmd = (name: string, arg: unknown): string =>
  `command:${COMMAND_PREFIX}.${name}?${encodeURIComponent(JSON.stringify([arg]))}`

/** Commands the hover may run; nothing else is trusted in its Markdown. */
export const HOVER_COMMANDS = ['actions', 'openHistory', 'showDiff', 'reconfirm', 'resolve'].map(
  (c) => `${COMMAND_PREFIX}.${c}`,
)

export function hoverMarkdown(entries: readonly HoverEntry[], nowIso: string): string {
  const parts: string[] = []
  for (const e of entries) {
    const sha = isValidSha(e.commit) ? e.commit.slice(0, 7) : ''
    const shaMd = !sha
      ? ''
      : e.commitLink?.startsWith('https://')
        ? ` ([\`${sha}\`](${e.commitLink}))`
        : ` (\`${sha}\`)`
    parts.push(
      `**${statusLabel(e.status)}** · ${escapeMd(e.scope)} · ${escapeMd(e.authorName)}, ` +
        `${relTime(e.createdAt, nowIso)}${shaMd}`,
    )
    if (e.comment) {
      parts.push(
        e.comment
          .split(/\r?\n/)
          .map((l) => `> ${escapeMd(l)}`)
          .join('\n'),
      )
    }
    if (e.replaced > 0) {
      parts.push(`replaces ${e.replaced} earlier confirmation${e.replaced > 1 ? 's' : ''}`)
    }
    const links: string[] = []
    if (e.status === 'ambiguous') links.push(`[Resolve](${cmd('resolve', e.recordId)})`)
    if (e.status !== 'confirmed') links.push(`[Confirm again](${cmd('reconfirm', e.recordId)})`)
    links.push(
      `[Actions…](${cmd('actions', e.recordId)})`,
      `[Diff](${cmd('showDiff', e.recordId)})`,
      `[History](${cmd('openHistory', e.recordId)})`,
    )
    parts.push(links.join(' · '))
  }
  return parts.join('\n\n---\n\n')
}

/** One-line summary for a status at a call site (no links). */
export function callSiteMarkdown(
  entries: readonly { authorName: string; status: Status; createdAt: string }[],
  nowIso: string,
): string {
  return entries
    .map(
      (e) =>
        `Code Assurance: ${statusLabel(e.status)} · ${escapeMd(e.authorName)}, ` +
        relTime(e.createdAt, nowIso),
    )
    .join('\n\n')
}

export function codeLensTitle(
  entries: readonly { authorName: string; status: Status; createdAt: string }[],
  nowIso: string,
): string {
  if (entries.length === 0) return ''
  if (entries.some((e) => e.status === 'outdated')) return '⚠ Outdated - confirm again'
  if (entries.some((e) => e.status === 'ambiguous')) return '? Ambiguous - resolve'
  const latest = entries.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  const more = entries.length > 1 ? ` +${entries.length - 1}` : ''
  return `✓ Confirmed by ${latest.authorName}${more}, ${relTime(latest.createdAt, nowIso)}`
}
