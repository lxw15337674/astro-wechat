import { describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/state/store.js'
import { cleanupOrphans, listOrphans } from '../src/sync/cleanup.js'
import type { WeChatClient } from '../src/wechat/client.js'

function fakeClient(failOn: readonly string[] = []) {
  const deleted: string[] = []

  const client = {
    async deleteMaterial(mediaId: string) {
      if (failOn.includes(mediaId)) throw new Error(`cannot delete ${mediaId}`)
      deleted.push(mediaId)
    },
  }

  return { client: client as unknown as WeChatClient, deleted }
}

async function storeWithOrphans(): Promise<MemoryStateStore> {
  const store = new MemoryStateStore()

  await store.putPending({ sourceId: 'a' })
  await store.recordOrphan('a', 'm-1')
  await store.recordOrphan('a', 'm-2')

  await store.putPending({ sourceId: 'b' })
  await store.recordOrphan('b', 'm-3')

  return store
}

describe('列出孤儿素材', () => {
  it('汇总所有文章的孤儿记录', async () => {
    const orphans = await listOrphans(await storeWithOrphans())

    expect(orphans.map((orphan) => orphan.materialId)).toEqual(['m-1', 'm-2', 'm-3'])
  })

  it('没有孤儿时返回空数组', async () => {
    expect(await listOrphans(new MemoryStateStore())).toEqual([])
  })
})

describe('清理孤儿素材', () => {
  it('删除后从台账移除，避免下次重复尝试', async () => {
    const store = await storeWithOrphans()
    const { client, deleted } = fakeClient()

    const result = await cleanupOrphans(store, client)

    expect(deleted).toEqual(['m-1', 'm-2', 'm-3'])
    expect(result.deleted).toHaveLength(3)
    expect(await listOrphans(store)).toEqual([])
  })

  it('单个失败不影响其余，尽可能多回收配额', async () => {
    const store = await storeWithOrphans()
    const { client, deleted } = fakeClient(['m-2'])

    const result = await cleanupOrphans(store, client)

    expect(deleted).toEqual(['m-1', 'm-3'])
    expect(result.failed.map((failure) => failure.materialId)).toEqual(['m-2'])
  })

  it('删除失败的素材保留在台账里，等下次重试', async () => {
    const store = await storeWithOrphans()
    const { client } = fakeClient(['m-2'])

    await cleanupOrphans(store, client)

    expect((await listOrphans(store)).map((orphan) => orphan.materialId)).toEqual(['m-2'])
  })
})
