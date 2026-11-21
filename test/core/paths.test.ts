import { describe, expect, it } from 'vitest'
import { authorSlug, isInsideRoot, shardPath, sourcePathOfShard } from '../../src/core/paths'

describe('shard paths', () => {
  it('round-trip', () => {
    const p = shardPath('src/a b/x.ts', authorSlug('ann@example.com'))
    expect(p).toMatch(/^\.code-assurance\/records\/src\/a b\/x\.ts\/[0-9a-f]{8}\.jsonl$/)
    expect(sourcePathOfShard(p)).toBe('src/a b/x.ts')
  })

  it('slug ignores email case and spaces', () => {
    expect(authorSlug(' Ann@Example.com')).toBe(authorSlug('ann@example.com'))
  })

  it('refuse escaping paths', () => {
    expect(() => shardPath('../x.ts', 'aaaaaaaa')).toThrow()
    expect(() => shardPath('/etc/x', 'aaaaaaaa')).toThrow()
    expect(() => shardPath('C:/x', 'aaaaaaaa')).toThrow()
    expect(sourcePathOfShard('.code-assurance/records/../x/aaaaaaaa.jsonl')).toBeNull()
    expect(sourcePathOfShard('.code-assurance/records/x/notaslug.jsonl')).toBeNull()
  })

  it('isInsideRoot does not match sibling prefixes', () => {
    expect(isInsideRoot('/repo', '/repo/a')).toBe(true)
    expect(isInsideRoot('/repo', '/repository/a')).toBe(false)
  })
})
