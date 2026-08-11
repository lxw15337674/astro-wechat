import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareArticle } from '../src/pipeline.js'
import { MemoryStateStore } from '../src/state/store.js'
import { synchronizeArticle, type SynchronizeDeps } from '../src/sync/synchronize.js'
import type { RenderedArticle } from '../src/types.js'
import type { WeChatClient } from '../src/wechat/client.js'
import { createFixtureProject, TINY_PNG_BASE64, writePost, type FixtureProject } from './helpers/project.js'

let project: FixtureProject

beforeEach(() => {
  project = createFixtureProject()
  project.writeBinary('public/images/cover.png', TINY_PNG_BASE64)
  project.writeBinary('src/data/blog/inline.png', TINY_PNG_BASE64)
})

afterEach(() => {
  project.cleanup()
})

interface FakeClient {
  readonly client: WeChatClient
  readonly calls: string[]
  draftShouldFail: boolean
  existingDraftId: string | null
}

/**
 * Stands in for the WeChat client.
 *
 * Records call names so tests can assert that a skipped article performs zero
 * requests — the property that makes re-running CI cheap, and one that is
 * invisible if you only check the returned status.
 */
function fakeClient(): FakeClient {
  const calls: string[] = []
  const state = { draftShouldFail: false, existingDraftId: null as string | null }

  const client = {
    async uploadBodyImage() {
      calls.push('uploadBodyImage')
      return `https://mmbiz.qpic.cn/body-${calls.length}`
    },
    async uploadCover() {
      calls.push('uploadCover')
      return { mediaId: `cover-${calls.length}`, url: undefined }
    },
    async createDraft() {
      calls.push('createDraft')
      if (state.draftShouldFail) throw new Error('draft failed')
      return 'draft-1'
    },
    async findDraftBySourceUrl() {
      calls.push('findDraftBySourceUrl')
      return state.existingDraftId
    },
    async deleteMaterial() {
      calls.push('deleteMaterial')
    },
  }

  return {
    client: client as unknown as WeChatClient,
    calls,
    get draftShouldFail() {
      return state.draftShouldFail
    },
    set draftShouldFail(value: boolean) {
      state.draftShouldFail = value
    },
    get existingDraftId() {
      return state.existingDraftId
    },
    set existingDraftId(value: string | null) {
      state.existingDraftId = value
    },
  }
}

const normalize = async () => ({
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'image/png',
  filename: 'image.png',
})

async function render(body = '![图](./inline.png)\n', slug = 'post'): Promise<RenderedArticle> {
  const path = writePost(project, { slug, body })
  const resolved = await project.resolved({ siteUrl: 'https://example.com' })
  return prepareArticle(path, resolved)
}

function deps(fake: FakeClient, store = new MemoryStateStore()): SynchronizeDeps & {
  store: MemoryStateStore
} {
  return { client: fake.client, store, normalize }
}

describe('已同步的文章', () => {
  it('跳过，且不产生任何请求', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await synchronizeArticle(rendered, context)
    const callsAfterFirst = fake.calls.length
    const second = await synchronizeArticle(rendered, context)

    expect(second.status).toBe('skipped')
    expect(second.skipReason).toBe('already-synchronized')
    expect(fake.calls).toHaveLength(callsAfterFirst)
  })

  it('源内容变化时报告 drift 并给出警告，但仍然跳过', async () => {
    const fake = fakeClient()
    const context = deps(fake)

    await synchronizeArticle(await render('原始正文。\n'), context)
    const second = await synchronizeArticle(await render('修改后的正文。\n'), context)

    expect(second.status).toBe('skipped')
    expect(second.drift).toBe(true)
    expect(second.warnings.map((w) => w.code)).toContain('source-drift')
  })

  it('--force-create 明确要求时才会再建一份', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await synchronizeArticle(rendered, context)
    const forced = await synchronizeArticle(rendered, context, { forceCreate: true })

    expect(forced.status).toBe('created')
  })
})

describe('结果不明后的协调', () => {
  it('远程已存在草稿时提交台账并跳过，不重复创建', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await context.store.putPending({
      sourceId: rendered.document.sourceId,
      contentHash: rendered.contentHash,
    })
    fake.existingDraftId = 'draft-existing'

    const result = await synchronizeArticle(rendered, context)

    expect(result.status).toBe('skipped')
    expect(result.reconciled).toBe(true)
    expect(result.mediaId).toBe('draft-existing')
    expect(fake.calls).not.toContain('createDraft')
  })

  it('远程确实没有时才创建', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await context.store.putPending({
      sourceId: rendered.document.sourceId,
      contentHash: rendered.contentHash,
    })
    fake.existingDraftId = null

    const result = await synchronizeArticle(rendered, context)

    expect(result.status).toBe('created')
    expect(fake.calls).toContain('findDraftBySourceUrl')
  })

  it('没有 canonical URL 就无法核对，报错而不是盲目创建', async () => {
    const fake = fakeClient()
    const context = deps(fake)

    // 不配置 siteUrl，文章因此没有可远程恢复的身份。
    const path = writePost(project, { slug: 'no-url' })
    const resolved = await project.resolved()
    const rendered = await prepareArticle(path, resolved)

    await context.store.putPending({
      sourceId: rendered.document.sourceId,
      contentHash: rendered.contentHash,
    })

    const result = await synchronizeArticle(rendered, context)

    expect(result.status).toBe('failed')
    expect(fake.calls).not.toContain('createDraft')
  })
})

describe('创建', () => {
  it('先写 pending 再调用微信', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    fake.draftShouldFail = true
    await synchronizeArticle(rendered, context)

    // 创建失败后台账里应留下 pending，这正是下次运行触发协调的依据。
    expect((await context.store.get(rendered.document.sourceId))?.writeState).toBe('pending')
  })

  it('把上传后的图片地址替换进正文', async () => {
    const fake = fakeClient()
    const context = deps(fake)

    const result = await synchronizeArticle(await render(), context)

    expect(result.status).toBe('created')
    expect(fake.calls).toContain('uploadBodyImage')
  })

  it('封面内容哈希未变时复用素材，不重复上传', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await synchronizeArticle(rendered, context)
    const coverUploads = fake.calls.filter((call) => call === 'uploadCover').length

    // 正文变了但封面没变：应当只上传一次封面。
    await synchronizeArticle(await render('新的正文。\n'), context, { forceCreate: true })

    expect(fake.calls.filter((call) => call === 'uploadCover')).toHaveLength(coverUploads)
  })

  it('封面已上传但创建草稿失败时，把素材记为孤儿', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    fake.draftShouldFail = true
    await synchronizeArticle(rendered, context)

    const entry = await context.store.get(rendered.document.sourceId)
    expect(entry?.orphanedCoverMaterialIds?.length).toBe(1)
  })

  it('创建成功后素材不再是孤儿', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await synchronizeArticle(rendered, context)

    const entry = await context.store.get(rendered.document.sourceId)
    expect(entry?.orphanedCoverMaterialIds).toEqual([])
  })

  it('复用封面时也要清掉孤儿标记，否则清理命令会删掉在用的素材', async () => {
    const fake = fakeClient()
    const context = deps(fake)
    const rendered = await render()

    await synchronizeArticle(rendered, context)

    // 人为把已被草稿引用的素材重新标成孤儿，模拟历史记录残留。
    const entry = await context.store.get(rendered.document.sourceId)
    await context.store.recordOrphan(rendered.document.sourceId, entry!.coverMaterialId!)

    // 再次创建时封面哈希未变，会走复用路径 —— 不能因为「没有新上传」就跳过清除。
    await synchronizeArticle(rendered, context, { forceCreate: true })

    const after = await context.store.get(rendered.document.sourceId)
    expect(after?.orphanedCoverMaterialIds).toEqual([])
  })
})

describe('dry run', () => {
  it('报告计划操作但不产生任何写入', async () => {
    const fake = fakeClient()
    const context = deps(fake)

    const result = await synchronizeArticle(await render(), context, { dryRun: true })

    expect(result.status).toBe('planned')
    expect(fake.calls).toHaveLength(0)
    expect(await context.store.all()).toHaveLength(0)
  })
})
