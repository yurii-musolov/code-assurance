// `.code-assurance/ignore`: a gitignore subset deciding which tracked files
// count toward coverage. Blank lines and # comments; `*` and `?` within a
// path segment, `**` across segments; a slash anywhere but at the end anchors
// the pattern to the repository root; a trailing slash matches a directory's
// whole subtree; a leading `!` re-includes; the last matching rule wins.

export interface IgnoreRules {
  ignores(sourcePath: string): boolean
}

const NOTHING: IgnoreRules = { ignores: () => false }

function segment(seg: string): string {
  let out = ''
  for (const ch of seg) {
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

function toRegex(pattern: string): RegExp {
  const dirOnly = pattern.endsWith('/')
  const body = pattern.replace(/^\//, '').replace(/\/$/, '')
  const rooted = pattern.startsWith('/') || body.includes('/')
  const parts = body.split('/')
  let re = ''
  parts.forEach((seg, i) => {
    const last = i === parts.length - 1
    if (seg === '**') re += last ? '.*' : '(?:[^/]+/)*'
    else re += segment(seg) + (last ? '' : '/')
  })
  const prefix = rooted ? '^' : '^(?:[^/]+/)*'
  const suffix = dirOnly ? '/.*$' : '(?:/.*)?$'
  return new RegExp(prefix + re + suffix)
}

export function compileIgnore(source: string): IgnoreRules {
  const rules: { negated: boolean; re: RegExp }[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negated = line.startsWith('!')
    const pattern = negated ? line.slice(1) : line
    if (!pattern) continue
    try {
      rules.push({ negated, re: toRegex(pattern) })
    } catch {
      // A broken pattern is skipped instead of disabling the whole file.
    }
  }
  if (rules.length === 0) return NOTHING
  return {
    ignores(sourcePath: string): boolean {
      let ignored = false
      for (const r of rules) if (r.re.test(sourcePath)) ignored = !r.negated
      return ignored
    },
  }
}
