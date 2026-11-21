import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorSlug } from '../../src/core/paths'
import { RecordStore } from '../../src/core/store'
import { appendLine, GITATTRIBUTES_LINE, initStore } from '../../src/core/writer'
import { ANN, BOB, rec, tomb } from './fixtures'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ca-store-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('RecordStore', () => {
  it('loads appended records per source file', async () => {
    const a = rec({ author: ANN })
    const b = rec({ author: BOB })
    await appendLine(root, 'src/x.ts', authorSlug(ANN.email), a)
    await appendLine(root, 'src/x.ts', authorSlug(BOB.email), b)
    await appendLine(root, 'src/y.ts', authorSlug(ANN.email), rec())
    const store = new RecordStore(root)
    await store.load()
    expect(store.confirmedFiles()).toEqual(['src/x.ts', 'src/y.ts'])
    expect(store.currentFor('src/x.ts')).toHaveLength(2)
    expect(store.find(a.id)?.sourcePath).toBe('src/x.ts')
    expect(store.reviewers().map((r) => [r.email, r.count])).toEqual([
      ['ann@example.com', 2],
      ['bob@example.com', 1],
    ])
  })

  it('drops withdrawn files from the confirmed list and reports orphans', async () => {
    const a = rec()
    await appendLine(root, 'gone.ts', authorSlug(ANN.email), a)
    await appendLine(root, 'kept.ts', authorSlug(ANN.email), rec())
    const store = new RecordStore(root)
    await store.load()
    expect(store.orphans((p) => p === 'kept.ts')).toEqual(['gone.ts'])
    await appendLine(root, 'gone.ts', authorSlug(ANN.email), tomb(a.id))
    await store.load()
    expect(store.confirmedFiles()).toEqual(['kept.ts'])
  })

  it('counts damaged lines', async () => {
    await appendLine(root, 'x.ts', authorSlug(ANN.email), rec())
    const shard = join(root, '.code-assurance/records/x.ts', `${authorSlug(ANN.email)}.jsonl`)
    await writeFile(shard, `${await readFile(shard, 'utf8')}=======\n`)
    const store = new RecordStore(root)
    await store.load()
    expect(store.corruptLines).toBe(1)
  })
})

describe('initStore', () => {
  it('creates the store once and adds the merge rule once', async () => {
    await writeFile(join(root, '.gitattributes'), '*.png binary')
    await initStore(root)
    await initStore(root)
    const attrs = await readFile(join(root, '.gitattributes'), 'utf8')
    expect(attrs).toBe(`*.png binary\n${GITATTRIBUTES_LINE}\n`)
    expect(JSON.parse(await readFile(join(root, '.code-assurance/config.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
    })
    expect(await readFile(join(root, '.code-assurance/ignore'), 'utf8')).toMatch(/^#/)
  })
})
