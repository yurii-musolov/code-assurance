import { describe, expect, it } from 'vitest'
import { compileIgnore } from '../../src/core/ignore'

describe('compileIgnore', () => {
  const rules = compileIgnore(
    [
      '# comment',
      'dist',
      '*.min.js',
      '/docs/*.md',
      'gen/',
      'test/**/fixtures',
      '!keep.min.js',
    ].join('\n'),
  )

  it('matches bare names at any depth', () => {
    expect(rules.ignores('dist/a.js')).toBe(true)
    expect(rules.ignores('pkg/dist/a.js')).toBe(true)
    expect(rules.ignores('a/b.min.js')).toBe(true)
  })

  it('anchors patterns with a slash', () => {
    expect(rules.ignores('docs/a.md')).toBe(true)
    expect(rules.ignores('src/docs/a.md')).toBe(false)
    expect(rules.ignores('docs/sub/a.md')).toBe(false)
  })

  it('handles directories and double stars', () => {
    expect(rules.ignores('gen/x.ts')).toBe(true)
    expect(rules.ignores('test/fixtures/x')).toBe(true)
    expect(rules.ignores('test/a/b/fixtures/x')).toBe(true)
  })

  it('re-includes with the last matching rule', () => {
    expect(rules.ignores('keep.min.js')).toBe(false)
  })

  it('ignores nothing when empty', () => {
    expect(compileIgnore('\n# only comments\n').ignores('x')).toBe(false)
  })
})
