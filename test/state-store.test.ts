import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonLedgerStore } from '../src/state/store.js'
import { createFixtureProject, type FixtureProject } from './helpers/project.js'

let project: FixtureProject
let store: JsonLedgerStore
let path: string

beforeEach(() => {
  project = createFixtureProject()
  path = join(project.root, '.astro-wechat/ledger.json')
  store = new JsonLedgerStore(path)
})

afterEach(() => {
  project.cleanup()
})

async function readLedger(): Promise<{ entries: Record<string, Record<string, unknown>> }> {
  return JSON.parse(await readFile(path, 'utf8')) as {
    entries: Record<string, Record<string, unknown>>
  }
}

describe('两阶段写入', () => {
  it('pending 先于微信调用写入，用于识别结果不明的运行', async () => {
    await store.putPending({ sourceId: 'a', contentHash: 'h1' })

    const entry = await store.get('a')
    expect(entry?.writeState).toBe('pending')
    expect(entry?.mediaId).toBeUndefined()
  })

  it('commit 写入 media_id 并转为 committed', async () => {
    await store.putPending({ sourceId: 'a', contentHash: 'h1' })
    await store.commit('a', { mediaId: 'draft-1', coverMaterialId: 'm-1', coverContentHash: 'c1' })

    const entry = await store.get('a')
    expect(entry).toMatchObject({
      writeState: 'committed',
      mediaId: 'draft-1',
      coverMaterialId: 'm-1',
      coverContentHash: 'c1',
    })
  })

  it('没有 pending 记录时拒绝 commit，避免凭空产生已发布状态', async () => {
    await expect(store.commit('missing', { mediaId: 'x' })).rejects.toThrow(/pending/)
  })
})

describe('孤儿素材', () => {
  it('记录后可读出', async () => {
    await store.putPending({ sourceId: 'a' })
    await store.recordOrphan('a', 'm-1')

    expect((await store.get('a'))?.orphanedCoverMaterialIds).toEqual(['m-1'])
  })

  it('重复记录同一个素材不会产生重复项', async () => {
    await store.putPending({ sourceId: 'a' })
    await store.recordOrphan('a', 'm-1')
    await store.recordOrphan('a', 'm-1')

    expect((await store.get('a'))?.orphanedCoverMaterialIds).toEqual(['m-1'])
  })

  it('清除孤儿不影响写入状态', async () => {
    await store.putPending({ sourceId: 'a' })
    await store.recordOrphan('a', 'm-1')
    await store.commit('a', { mediaId: 'draft-1' })
    await store.clearOrphan('a', 'm-1')

    const entry = await store.get('a')
    expect(entry?.orphanedCoverMaterialIds).toEqual([])
    expect(entry?.writeState).toBe('committed')
  })

  it('重写记录时保留已有孤儿，它们是配额已被占用的唯一线索', async () => {
    await store.putPending({ sourceId: 'a' })
    await store.recordOrphan('a', 'm-1')
    await store.putPending({ sourceId: 'a', contentHash: 'h2' })

    expect((await store.get('a'))?.orphanedCoverMaterialIds).toEqual(['m-1'])
  })
})

describe('台账文件', () => {
  it('按 sourceId 排序写入，使 diff 可审查', async () => {
    await store.putPending({ sourceId: 'zeta' })
    await store.putPending({ sourceId: 'alpha' })

    expect(Object.keys((await readLedger()).entries)).toEqual(['alpha', 'zeta'])
  })

  it('缺失的台账当作首次运行，不报错', async () => {
    expect(await store.get('anything')).toBeUndefined()
  })

  it('损坏的台账必须报错，不能退化成空台账', async () => {
    // 空台账会让每篇文章看起来都是新的，下一次发布就会给整个博客重建草稿。
    // 这正是台账存在的意义，所以这里宁可中止。
    project.write('.astro-wechat/ledger.json', '{ 这不是 JSON')
    const fresh = new JsonLedgerStore(path)

    await expect(fresh.get('a')).rejects.toThrow(/不是合法 JSON/)
  })

  it('重新读取时能看到此前写入的内容', async () => {
    await store.putPending({ sourceId: 'a', contentHash: 'h1' })
    await store.commit('a', { mediaId: 'draft-1' })

    const reopened = new JsonLedgerStore(path)
    expect((await reopened.get('a'))?.mediaId).toBe('draft-1')
  })
})
