import { describe, expect, it } from 'vitest'
import { WeChatClient } from '../src/wechat/client.js'
import { readWechatConfig } from '../src/wechat/config.js'
import {
  OutcomeUnknownError,
  ProxyError,
  WechatApiError,
  WechatQuotaError,
} from '../src/wechat/errors.js'
import {
  TOKEN_OK,
  createMockFetch,
  jsonResponse,
  parseJsonBody,
  testConfig,
  timeoutError,
  type MockHandler,
} from './helpers/mock-wechat.js'

const IMAGE = {
  bytes: new Uint8Array([1, 2, 3]),
  filename: 'cover.png',
  contentType: 'image/png',
}

const DRAFT = {
  title: '标题',
  author: '作者',
  digest: '摘要',
  content: '<section>正文</section>',
  thumbMediaId: 'thumb-1',
  contentSourceUrl: 'https://example.com/posts/a/',
}

/** Answers the token request, then delegates everything else. */
function withToken(handler: MockHandler): MockHandler {
  return (call, index) => {
    if (call.url.pathname.endsWith('/cgi-bin/stable_token')) return jsonResponse(TOKEN_OK)
    return handler(call, index)
  }
}

function client(handler: MockHandler, config = testConfig()) {
  const mock = createMockFetch(handler)
  return { client: new WeChatClient(config, mock.fetch), mock }
}

describe('access token', () => {
  it('使用 stable-token 接口，避免与其他调用方互相踢掉 token', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ url: 'https://mmbiz.qpic.cn/x' })),
    )

    await wechat.uploadBodyImage(IMAGE)

    const tokenCall = mock.callsTo('/cgi-bin/stable_token')[0]
    expect(tokenCall).toBeDefined()
    expect(parseJsonBody(tokenCall!.body).grant_type).toBe('client_credential')
  })

  it('缓存 token，多次调用只取一次', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ url: 'https://mmbiz.qpic.cn/x' })),
    )

    await wechat.uploadBodyImage(IMAGE)
    await wechat.uploadBodyImage(IMAGE)

    expect(mock.callsTo('/cgi-bin/stable_token')).toHaveLength(1)
  })

  it('并发请求合并为一次 token 获取', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ url: 'https://mmbiz.qpic.cn/x' })),
    )

    await Promise.all([wechat.uploadBodyImage(IMAGE), wechat.uploadBodyImage(IMAGE)])

    expect(mock.callsTo('/cgi-bin/stable_token')).toHaveLength(1)
  })

  it('token 失效时刷新一次并重放，且只重放一次', async () => {
    let draftAttempts = 0
    const { client: wechat, mock } = client(
      withToken((call) => {
        if (!call.url.pathname.endsWith('/cgi-bin/draft/add')) return jsonResponse({})
        draftAttempts += 1
        return draftAttempts === 1
          ? jsonResponse({ errcode: 42001, errmsg: 'access_token expired' })
          : jsonResponse({ media_id: 'draft-1' })
      }),
    )

    const mediaId = await wechat.createDraft(DRAFT)

    expect(mediaId).toBe('draft-1')
    expect(draftAttempts).toBe(2)
    expect(mock.callsTo('/cgi-bin/stable_token')).toHaveLength(2)
  })

  it('刷新后仍然失效则放弃，不进入刷新循环', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ errcode: 40001, errmsg: 'invalid credential' })),
    )

    await expect(wechat.createDraft(DRAFT)).rejects.toThrow(WechatApiError)
    expect(mock.callsTo('/cgi-bin/draft/add')).toHaveLength(2)
  })
})

describe('错误分类', () => {
  it('HTTP 200 里的 errcode 不算成功', async () => {
    const { client: wechat } = client(
      withToken(() => jsonResponse({ errcode: 40007, errmsg: 'invalid media_id' })),
    )

    await expect(wechat.createDraft(DRAFT)).rejects.toMatchObject({
      category: 'wechat',
      errcode: 40007,
    })
  })

  it('配额耗尽单独成类且绝不重试', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ errcode: 45009, errmsg: 'reach max api daily quota limit' })),
      testConfig({ maxRetries: 3 }),
    )

    await expect(wechat.uploadBodyImage(IMAGE)).rejects.toThrow(WechatQuotaError)
    expect(mock.callsTo('/cgi-bin/media/uploadimg')).toHaveLength(1)
  })

  it('瞬态错误在可重试操作上会重试', async () => {
    let attempts = 0
    const { client: wechat } = client(
      withToken(() => {
        attempts += 1
        return attempts === 1
          ? jsonResponse({ errcode: -1, errmsg: 'system error' })
          : jsonResponse({ url: 'https://mmbiz.qpic.cn/x' })
      }),
      testConfig({ maxRetries: 2 }),
    )

    await expect(wechat.uploadBodyImage(IMAGE)).resolves.toContain('mmbiz.qpic.cn')
    expect(attempts).toBe(2)
  })

  it('封面上传不重试，避免永久素材配额泄漏', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ errcode: -1, errmsg: 'system error' })),
      testConfig({ maxRetries: 3 }),
    )

    await expect(wechat.uploadCover(IMAGE)).rejects.toThrow(WechatApiError)
    expect(mock.callsTo('/cgi-bin/material/add_material')).toHaveLength(1)
  })
})

describe('创建草稿的结果不明', () => {
  it('超时报告为结果不明，而不是可重试失败', async () => {
    const { client: wechat, mock } = client(
      withToken(() => {
        throw timeoutError()
      }),
      testConfig({ maxRetries: 3 }),
    )

    await expect(wechat.createDraft(DRAFT)).rejects.toThrow(OutcomeUnknownError)

    // 关键断言：一次都不能重试，重试正是重复草稿的来源。
    expect(mock.callsTo('/cgi-bin/draft/add')).toHaveLength(1)
  })

  it('把 canonical URL 写入 content_source_url，这是唯一可远程恢复的身份载体', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ media_id: 'draft-1' })),
    )

    await wechat.createDraft(DRAFT)

    const body = parseJsonBody(mock.callsTo('/cgi-bin/draft/add')[0]!.body)
    const article = (body.articles as Record<string, unknown>[])[0]!
    expect(article.content_source_url).toBe(DRAFT.contentSourceUrl)
  })
})

describe('按 source URL 查找草稿', () => {
  function pagedHandler(pages: (string | null)[][]): MockHandler {
    return withToken((call) => {
      if (!call.url.pathname.endsWith('/cgi-bin/draft/batchget')) return jsonResponse({})

      const { offset, count } = parseJsonBody(call.body) as { offset: number; count: number }
      const page = pages[offset / count] ?? []

      return jsonResponse({
        item: page.map((url, index) => ({
          media_id: `draft-${offset + index}`,
          content: { news_item: [{ content_source_url: url ?? '' }] },
        })),
      })
    })
  }

  it('在后续分页中找到匹配项', async () => {
    const pageSize = 2
    const { client: wechat } = client(
      pagedHandler([
        ['https://example.com/other/', 'https://example.com/another/'],
        ['https://example.com/posts/a/'],
      ]),
    )

    const found = await wechat.findDraftBySourceUrl('https://example.com/posts/a/', { pageSize })
    expect(found).toBe('draft-2')
  })

  it('扫到最后一页仍未命中时返回 null', async () => {
    const { client: wechat } = client(pagedHandler([['https://example.com/other/']]))

    const found = await wechat.findDraftBySourceUrl('https://example.com/posts/a/', { pageSize: 2 })
    expect(found).toBeNull()
  })

  it('响应里没有 content_source_url 字段时立刻报错，而不是一路扫到上限', async () => {
    // 字段缺失和「草稿箱里确实没有这篇」在结果上无法区分，静默继续会让
    // 上层创建重复草稿，并把问题伪装成草稿箱太大。
    const { client: wechat } = client(
      withToken((call) => {
        if (!call.url.pathname.endsWith('/cgi-bin/draft/batchget')) return jsonResponse({})
        return jsonResponse({
          item: [{ media_id: 'draft-0', content: { news_item: [{ title: '某篇文章' }] } }],
        })
      }),
    )

    await expect(
      wechat.findDraftBySourceUrl('https://example.com/posts/a/', { pageSize: 2 }),
    ).rejects.toThrow(/没有 content_source_url/)
  })

  it('达到扫描上限时报错而不是返回 null', async () => {
    // 每页都是满的，意味着还有更多内容没看过。此时返回 null 会被上层
    // 理解为「没发过」，进而重复创建草稿 —— 所以必须报错。
    const fullPage = ['https://example.com/x/', 'https://example.com/y/']
    const { client: wechat } = client(pagedHandler([fullPage, fullPage, fullPage]))

    await expect(
      wechat.findDraftBySourceUrl('https://example.com/posts/a/', { pageSize: 2, maxPages: 2 }),
    ).rejects.toThrow(/扫描 2 页/)
  })
})

describe('出口：代理与直连', () => {
  const proxyConfig = testConfig({
    proxyUrl: 'https://proxy.example.com',
    proxyToken: 'proxy-token',
  })

  it('配置代理时加前缀并携带 Bearer 令牌', async () => {
    const { client: wechat, mock } = client(
      withToken(() => jsonResponse({ media_id: 'draft-1' })),
      proxyConfig,
    )

    await wechat.createDraft(DRAFT)

    const call = mock.calls.at(-1)!
    expect(call.url.origin).toBe('https://proxy.example.com')
    expect(call.url.pathname).toBe('/wechat/cgi-bin/draft/add')
    expect(call.headers.get('authorization')).toBe('Bearer proxy-token')
  })

  it('未配置代理时直连微信，且不带令牌', async () => {
    const { client: wechat, mock } = client(withToken(() => jsonResponse({ media_id: 'draft-1' })))

    await wechat.createDraft(DRAFT)

    const call = mock.calls.at(-1)!
    expect(call.url.origin).toBe('https://api.weixin.qq.com')
    expect(call.url.pathname).toBe('/cgi-bin/draft/add')
    expect(call.headers.get('authorization')).toBeNull()
  })

  it('代理拒绝时归为 proxy 类，而不是微信错误', async () => {
    const { client: wechat } = client(
      () => jsonResponse({ detail: 'forbidden' }, 403),
      proxyConfig,
    )

    const error = await wechat.uploadBodyImage(IMAGE).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProxyError)
    expect((error as ProxyError).category).toBe('proxy')
  })

  it('代理返回非 JSON 时提示透传有问题，而不是报 JSON 语法错误', async () => {
    const { client: wechat } = client(
      () => new Response('<html>502 Bad Gateway</html>', { status: 200 }),
      proxyConfig,
    )

    await expect(wechat.uploadBodyImage(IMAGE)).rejects.toThrow(/未按原样透传/)
  })

  it('直连时的 403 是微信的回答，不能被改标成代理错误', async () => {
    const { client: wechat } = client(() => jsonResponse({ errcode: 48001 }, 403))

    const error = await wechat.uploadBodyImage(IMAGE).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(ProxyError)
  })
})

describe('配置读取', () => {
  const base = { WECHAT_APP_ID: 'id', WECHAT_APP_SECRET: 'secret' }

  it('缺少凭据时报错', () => {
    expect(() => readWechatConfig({})).toThrow(/WECHAT_APP_ID/)
  })

  it('拒绝 HTTP 代理地址，因为凭据会经过这条链路', () => {
    expect(() =>
      readWechatConfig({ ...base, WECHAT_PROXY_URL: 'http://proxy.example.com', WECHAT_PROXY_TOKEN: 't' }),
    ).toThrow(/必须是 HTTPS/)
  })

  it('配置了代理地址却没有令牌时报错', () => {
    expect(() =>
      readWechatConfig({ ...base, WECHAT_PROXY_URL: 'https://proxy.example.com' }),
    ).toThrow(/WECHAT_PROXY_TOKEN/)
  })

  it('不配置代理是合法的：白名单机器上可直连', () => {
    const config = readWechatConfig(base)
    expect(config.proxyUrl).toBeUndefined()
  })
})
