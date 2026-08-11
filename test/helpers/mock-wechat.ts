import type { WechatConfig } from '../../src/wechat/config.js'

export interface MockCall {
  readonly url: URL
  readonly method: string
  readonly headers: Headers
  readonly body: unknown
}

export interface MockFetch {
  readonly fetch: typeof fetch
  readonly calls: readonly MockCall[]
  /** Calls whose path ends with the given suffix. */
  callsTo(pathSuffix: string): readonly MockCall[]
}

export type MockHandler = (call: MockCall, index: number) => Response | Promise<Response>

/**
 * A stand-in for WeChat.
 *
 * Replaces `fetch` rather than starting a real server: the tests care about
 * request shape and response handling, and a stub makes both directly
 * observable without ports, teardown, or timing flakiness.
 */
export function createMockFetch(handler: MockHandler): MockFetch {
  const calls: MockCall[] = []

  // Parameter types are derived from `fetch` itself rather than written as
  // `RequestInfo`/`RequestInit`: whether those names are global depends on the
  // @types/node version, and this helper should not care.
  const impl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const call: MockCall = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    }
    calls.push(call)
    return handler(call, calls.length - 1)
  }) as unknown as typeof fetch

  return {
    fetch: impl,
    calls,
    callsTo: (suffix) => calls.filter((call) => call.url.pathname.endsWith(suffix)),
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A rejection shaped like the one `AbortSignal.timeout` produces. */
export function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

export const TOKEN_OK = { access_token: 'token-abc', expires_in: 7200 }

export function testConfig(overrides: Partial<WechatConfig> = {}): WechatConfig {
  return {
    appId: 'app-id',
    appSecret: 'app-secret',
    timeoutMs: 1_000,
    // Retries default to zero so tests stay fast; the retry tests opt in.
    maxRetries: 0,
    ...overrides,
  }
}

export function parseJsonBody(body: unknown): Record<string, unknown> {
  return JSON.parse(String(body)) as Record<string, unknown>
}
