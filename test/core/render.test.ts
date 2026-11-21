import { describe, expect, it } from 'vitest'
import { filtersHtml, historyHtml } from '../../src/core/html'
import {
  codeLensTitle,
  commitUrl,
  escapeIcons,
  escapeMd,
  type HoverEntry,
  hoverMarkdown,
  isValidSha,
  relTime,
} from '../../src/core/render'

const NOW = '2026-01-10T00:00:00Z'

describe('relTime', () => {
  it('reads naturally and survives garbage', () => {
    expect(relTime('2026-01-09T23:59:30Z', NOW)).toBe('just now')
    expect(relTime('2026-01-09T22:00:00Z', NOW)).toBe('2h ago')
    expect(relTime('2026-01-07T00:00:00Z', NOW)).toBe('3d ago')
    expect(relTime('nope', NOW)).toBe('unknown time')
  })
})

describe('escaping', () => {
  it('neutralizes markdown links and icons', () => {
    expect(escapeMd('[x](command:evil)')).toBe('\\[x\\]\\(command:evil\\)')
    expect(escapeIcons('$(check) x')).toBe('\\$(check) x')
  })
})

describe('commit links', () => {
  it('accept only hexadecimal ids', () => {
    expect(isValidSha('abc1234')).toBe(true)
    expect(isValidSha('abc)[x](command:y')).toBe(false)
    expect(isValidSha('-n')).toBe(false)
  })

  it('build host specific urls', () => {
    expect(commitUrl('git@github.com:me/repo.git', 'abc1234')).toBe(
      'https://github.com/me/repo/commit/abc1234',
    )
    expect(commitUrl('https://gitlab.com/g/p.git', 'abc1234')).toBe(
      'https://gitlab.com/g/p/-/commit/abc1234',
    )
    expect(commitUrl('https://bitbucket.org/t/r', 'abc1234')).toBe(
      'https://bitbucket.org/t/r/commits/abc1234',
    )
    expect(commitUrl('/local/path', 'abc1234')).toBeNull()
    expect(commitUrl('git@github.com:me/repo.git', 'zzz')).toBeNull()
  })
})

describe('hoverMarkdown', () => {
  const e: HoverEntry = {
    recordId: 'id"1',
    authorName: '[evil](command:x)',
    status: 'outdated',
    createdAt: '2026-01-09T00:00:00Z',
    scope: 'function add',
    comment: 'line one\n[click](command:y)',
    commit: 'abc1234def',
    commitLink: 'https://github.com/me/r/commit/abc1234def',
    replaced: 2,
  }
  const md = hoverMarkdown([e], NOW)

  it('escapes record text', () => {
    expect(md).toContain('\\[evil\\]\\(command:x\\)')
    expect(md).toContain('> \\[click\\]\\(command:y\\)')
  })

  it('offers the actions that fit the status', () => {
    expect(md).toContain('Confirm again')
    expect(md).not.toContain('Resolve')
    expect(md).toContain('replaces 2 earlier confirmations')
    expect(md).toContain('[`abc1234`](https://github.com/me/r/commit/abc1234def)')
    expect(md).toContain(encodeURIComponent(JSON.stringify(['id"1'])))
  })
})

describe('codeLensTitle', () => {
  it('puts what needs attention first', () => {
    const base = { authorName: 'Ann', createdAt: '2026-01-09T00:00:00Z' }
    expect(codeLensTitle([{ ...base, status: 'confirmed' }], NOW)).toBe(
      '✓ Confirmed by Ann, 1d ago',
    )
    expect(
      codeLensTitle(
        [
          { ...base, status: 'confirmed' },
          { ...base, status: 'outdated' },
        ],
        NOW,
      ),
    ).toMatch(/^⚠/)
    expect(codeLensTitle([], NOW)).toBe('')
  })
})

describe('webview markup', () => {
  it('escapes history entries and drops non-https links', () => {
    const html = historyHtml(
      {
        sourcePath: '<x>.ts',
        nowIso: NOW,
        people: [
          {
            name: '<script>',
            chains: [
              {
                revoked: false,
                entries: [
                  {
                    recordId: '"><img>',
                    status: 'ambiguous',
                    createdAt: NOW,
                    scope: 'lines 1-2',
                    commit: 'abc1234',
                    commitLink: 'javascript:alert(1)',
                  },
                ],
              },
            ],
          },
        ],
      },
      'csp',
      'nonce',
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('&lt;x&gt;.ts')
    expect(html).toContain('data-cmd="resolve"')
  })

  it('filters markup carries no data', () => {
    expect(filtersHtml('csp', 'n')).toContain("script-src 'nonce-n'")
  })
})
