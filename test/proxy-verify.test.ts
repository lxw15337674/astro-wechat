import { describe, expect, it } from 'vitest'
import { ProxyError } from '../src/wechat/errors.js'
import { verifyProxy } from '../src/wechat/proxy-verify.js'
import { createMockFetch, jsonResponse, type MockCall } from './helpers/mock-wechat.js'

function authorization(call: MockCall): string | null {
  return call.headers.get('authorization')
}

describe('代理部署自检', () => {
  it('验证 401、路径白名单和微信 HTTP 200 错误原样透传', async () => {
    const mock = createMockFetch((call) => {
      if (authorization(call) === null) return jsonResponse({ detail: 'missing' }, 401)
      if (call.url.pathname.endsWith('/cgi-bin/message/mass/send')) {
        return jsonResponse({ detail: 'forbidden' }, 403)
      }
      return jsonResponse({ errcode: 40013, errmsg: 'invalid appid' })
    })

    const result = await verifyProxy({
      proxyUrl: 'https://proxy.example.com/',
      proxyToken: 'proxy-secret',
      fetchImpl: mock.fetch,
    })

    expect(result).toMatchObject({ proxyOrigin: 'https://proxy.example.com', passed: true })
    expect(result.checks).toHaveLength(3)
    expect(mock.calls.map((call) => call.url.pathname)).toEqual([
      '/wechat/cgi-bin/stable_token',
      '/wechat/cgi-bin/message/mass/send',
      '/wechat/cgi-bin/stable_token',
    ])
    expect(authorization(mock.calls[0]!)).toBeNull()
    expect(authorization(mock.calls[1]!)).toBe('Bearer proxy-secret')
  })

  it('HTTP 状态被代理改写时报告失败', async () => {
    const mock = createMockFetch((call) => {
      if (authorization(call) === null) return jsonResponse({}, 401)
      if (call.url.pathname.endsWith('/message/mass/send')) return jsonResponse({}, 403)
      return jsonResponse({ errcode: 40013 }, 400)
    })

    const result = await verifyProxy({
      proxyUrl: 'https://proxy.example.com',
      proxyToken: 'proxy-secret',
      fetchImpl: mock.fetch,
    })

    expect(result.passed).toBe(false)
    expect(result.checks[2]).toMatchObject({
      name: 'wechat-passthrough',
      passed: false,
      actual: 'HTTP 400，errcode=40013',
    })
  })

  it('拒绝 HTTP 地址和缺失令牌', async () => {
    await expect(
      verifyProxy({ proxyUrl: 'http://proxy.example.com', proxyToken: 'x' }),
    ).rejects.toBeInstanceOf(ProxyError)
    await expect(
      verifyProxy({ proxyUrl: 'https://proxy.example.com', proxyToken: '' }),
    ).rejects.toMatchObject({ code: 'proxy-token-missing' })
  })
})
