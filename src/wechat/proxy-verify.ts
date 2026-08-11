import { PROXY_PATH_PREFIX } from './codes.js'
import { ProxyError } from './errors.js'

export type ProxyCheckName = 'missing-auth' | 'path-allowlist' | 'wechat-passthrough'

export interface ProxyCheckResult {
  readonly name: ProxyCheckName
  readonly passed: boolean
  readonly expected: string
  readonly actual: string
}

export interface ProxyVerificationResult {
  readonly proxyOrigin: string
  readonly passed: boolean
  readonly checks: readonly ProxyCheckResult[]
}

export interface VerifyProxyOptions {
  readonly proxyUrl: string
  readonly proxyToken: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Verify the deployed forwarding contract without using real WeChat credentials.
 *
 * The fake AppID and secret deliberately produce a WeChat business error. A
 * correct proxy returns that JSON error unchanged with HTTP 200.
 */
export async function verifyProxy(options: VerifyProxyOptions): Promise<ProxyVerificationResult> {
  const base = normalizeProxyUrl(options.proxyUrl)
  const token = options.proxyToken.trim()
  if (!token) {
    throw new ProxyError('缺少 WECHAT_PROXY_TOKEN，无法执行代理自检。', {
      code: 'proxy-token-missing',
    })
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const checks: ProxyCheckResult[] = []

  checks.push(
    await statusCheck(
      'missing-auth',
      'HTTP 401',
      () => request(fetchImpl, base, '/cgi-bin/stable_token', timeoutMs),
      401,
    ),
  )
  checks.push(
    await statusCheck(
      'path-allowlist',
      'HTTP 403',
      () =>
        request(fetchImpl, base, '/cgi-bin/message/mass/send', timeoutMs, {
          token,
        }),
      403,
    ),
  )
  checks.push(await passthroughCheck(fetchImpl, base, token, timeoutMs))

  return {
    proxyOrigin: new URL(base).origin,
    passed: checks.every((check) => check.passed),
    checks,
  }
}

async function statusCheck(
  name: ProxyCheckName,
  expected: string,
  run: () => Promise<Response>,
  expectedStatus: number,
): Promise<ProxyCheckResult> {
  try {
    const response = await run()
    return {
      name,
      passed: response.status === expectedStatus,
      expected,
      actual: `HTTP ${response.status}`,
    }
  } catch (error) {
    return { name, passed: false, expected, actual: describeFailure(error) }
  }
}

async function passthroughCheck(
  fetchImpl: typeof fetch,
  base: string,
  token: string,
  timeoutMs: number,
): Promise<ProxyCheckResult> {
  const expected = 'HTTP 200，JSON body 含非零 errcode'

  try {
    const response = await request(fetchImpl, base, '/cgi-bin/stable_token', timeoutMs, {
      token,
      json: {
        grant_type: 'client_credential',
        appid: 'astro-wechat-proxy-check',
        secret: 'not-a-real-secret',
      },
    })
    const text = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      return {
        name: 'wechat-passthrough',
        passed: false,
        expected,
        actual: `HTTP ${response.status}，非 JSON body`,
      }
    }

    const errcode = readErrcode(payload)
    const passed = response.status === 200 && errcode !== undefined && errcode !== 0
    return {
      name: 'wechat-passthrough',
      passed,
      expected,
      actual: `HTTP ${response.status}，errcode=${errcode ?? '缺失'}`,
    }
  } catch (error) {
    return {
      name: 'wechat-passthrough',
      passed: false,
      expected,
      actual: describeFailure(error),
    }
  }
}

interface RequestOptions {
  readonly token?: string
  readonly json?: unknown
}

function request(
  fetchImpl: typeof fetch,
  base: string,
  path: string,
  timeoutMs: number,
  options: RequestOptions = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.json !== undefined) headers.set('Content-Type', 'application/json')

  return fetchImpl(`${base}${PROXY_PATH_PREFIX}${path}`, {
    method: options.json === undefined ? 'GET' : 'POST',
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function normalizeProxyUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ProxyError(`WECHAT_PROXY_URL 不是合法 URL：${value}`, {
      code: 'proxy-url-invalid',
    })
  }

  if (url.protocol !== 'https:') {
    throw new ProxyError('代理部署自检只允许 HTTPS 地址。', { code: 'proxy-url-insecure' })
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ProxyError('WECHAT_PROXY_URL 不能包含认证信息、query 或 fragment。', {
      code: 'proxy-url-invalid',
    })
  }

  return url.href.replace(/\/+$/, '')
}

function readErrcode(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object' || !('errcode' in payload)) return undefined
  const value = (payload as { errcode?: unknown }).errcode
  return typeof value === 'number' ? value : undefined
}

function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败'
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '请求超时'
  return `请求失败：${error.message}`
}
