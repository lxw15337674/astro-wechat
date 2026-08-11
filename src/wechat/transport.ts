import {
  PROXY_PATH_PREFIX,
  RETRYABLE_HTTP_STATUS,
  WECHAT_API_ORIGIN,
  classifyErrorCode,
} from './codes.js'
import { OutcomeUnknownError, ProxyError, WechatApiError, WechatQuotaError } from './errors.js'

export interface TransportOptions {
  readonly proxyUrl?: string
  readonly proxyToken?: string
  readonly timeoutMs: number
  readonly maxRetries: number
  /** Injected in tests. */
  readonly fetchImpl?: typeof fetch
}

export interface WechatRequest {
  readonly path: string
  readonly method?: 'GET' | 'POST'
  readonly query?: Readonly<Record<string, string>>
  readonly json?: unknown
  /**
   * Factory rather than a value, so a retry builds a fresh body.
   *
   * A `FormData` instance cannot be safely resent after its stream has been
   * consumed, and silently sending an empty body on retry is much harder to
   * diagnose than not retrying at all.
   */
  readonly form?: () => FormData
  /**
   * Whether repeating this request is safe.
   *
   * False for anything that creates a durable object: a retried draft creation
   * produces a second draft, and a retried permanent-material upload leaks
   * account quota.
   */
  readonly idempotent: boolean
}

/**
 * The two fields every WeChat response may carry.
 *
 * Exported because `assertNoWechatError` is public: declaration emit cannot
 * reference a non-exported name, so keeping it private would break `build`
 * while leaving `typecheck --noEmit` green.
 */
export interface WechatEnvelope {
  errcode?: number
  errmsg?: string
}

/**
 * HTTP layer for WeChat calls, with or without the forwarding proxy.
 *
 * The proxy returns upstream responses verbatim, so both modes parse
 * identically and error handling does not fork (ADR-0005). The only difference
 * is that proxy-level failures are recognized and reported separately.
 */
export class WechatTransport {
  readonly #options: TransportOptions
  readonly #fetch: typeof fetch

  constructor(options: TransportOptions) {
    this.#options = options
    this.#fetch = options.fetchImpl ?? globalThis.fetch
  }

  get usesProxy(): boolean {
    return this.#options.proxyUrl !== undefined
  }

  async request<T>(request: WechatRequest): Promise<T> {
    const attempts = request.idempotent ? this.#options.maxRetries + 1 : 1
    let lastError: unknown

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await delay(backoffMs(attempt))

      try {
        return await this.#attempt<T>(request)
      } catch (error) {
        lastError = error
        if (!isRetryable(error) || attempt === attempts - 1) throw error
      }
    }

    throw lastError
  }

  async #attempt<T>(request: WechatRequest): Promise<T> {
    const url = this.#buildUrl(request)
    const headers: Record<string, string> = {}
    let body: RequestInit['body']

    if (this.#options.proxyToken) {
      headers.Authorization = `Bearer ${this.#options.proxyToken}`
    }

    if (request.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(request.json)
    } else if (request.form) {
      // Content-Type is intentionally unset: fetch must generate the multipart
      // boundary itself.
      body = request.form()
    }

    let response: Response
    try {
      response = await this.#fetch(url, {
        method: request.method ?? 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      })
    } catch (cause) {
      throw this.#networkFailure(request, cause)
    }

    this.#assertProxyOk(response)

    if (!response.ok) {
      throw new WechatApiError(`微信返回 HTTP ${response.status}。`, {
        code: 'http-error',
        httpStatus: response.status,
        retryable: RETRYABLE_HTTP_STATUS.has(response.status),
      })
    }

    const payload = await this.#parseJson<T & WechatEnvelope>(response)
    assertNoWechatError(payload)
    return payload
  }

  #buildUrl(request: WechatRequest): string {
    const base = this.#options.proxyUrl ?? WECHAT_API_ORIGIN
    const path = this.#options.proxyUrl ? `${PROXY_PATH_PREFIX}${request.path}` : request.path

    const url = new URL(joinPath(base, path))
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, value)
    }
    return url.href
  }

  /**
   * Distinguish "the proxy said no" from "WeChat said no".
   *
   * Only meaningful when a proxy is configured; talking to WeChat directly, a
   * 401 is WeChat's own answer and must not be relabelled.
   */
  #assertProxyOk(response: Response): void {
    if (!this.usesProxy) return

    if (response.status === 401 || response.status === 403) {
      throw new ProxyError(
        `转发代理拒绝了请求（HTTP ${response.status}）：令牌无效，或路径不在白名单内。`,
        { code: 'proxy-rejected', httpStatus: response.status },
      )
    }
  }

  #networkFailure(request: WechatRequest, cause: unknown): Error {
    const timedOut = isTimeout(cause)

    // A write that timed out may or may not have taken effect. Reporting it as
    // a retryable transport error would invite exactly the retry that creates
    // a duplicate draft.
    if (timedOut && !request.idempotent) {
      return new OutcomeUnknownError(
        `请求超时且结果未知：${request.path}。不得重试，必须先与微信核对。`,
        { code: 'outcome-unknown', cause },
      )
    }

    const description = timedOut ? '超时' : '连接失败'

    if (this.usesProxy) {
      return new ProxyError(`转发代理${description}：${this.#options.proxyUrl}`, {
        code: timedOut ? 'proxy-timeout' : 'proxy-unreachable',
        retryable: true,
        cause,
      })
    }

    return new WechatApiError(`直连微信${description}。`, {
      code: timedOut ? 'wechat-timeout' : 'wechat-unreachable',
      retryable: true,
      cause,
    })
  }

  async #parseJson<T>(response: Response): Promise<T> {
    const text = await response.text()

    try {
      return JSON.parse(text) as T
    } catch (cause) {
      // A proxy that returns an HTML error page instead of upstream JSON is
      // misconfigured; saying so beats reporting a JSON syntax error.
      if (this.usesProxy) {
        throw new ProxyError('转发代理返回了非 JSON 响应，可能未按原样透传上游内容。', {
          code: 'proxy-bad-response',
          cause,
        })
      }
      throw new WechatApiError('微信返回了非 JSON 响应。', { code: 'invalid-json', cause })
    }
  }
}

/**
 * WeChat reports business failures inside HTTP 200 responses, so a successful
 * status says nothing on its own. Missing `errcode` means success: several
 * endpoints omit it entirely when they succeed.
 */
export function assertNoWechatError(payload: WechatEnvelope): void {
  const code = payload.errcode
  if (code === undefined || code === 0) return

  const message = `微信返回 errcode ${code}：${payload.errmsg ?? '无描述'}`
  const kind = classifyErrorCode(code)

  if (kind === 'quota') {
    throw new WechatQuotaError(`${message}。配额耗尽，重试只会更糟。`, {
      code: 'quota-exhausted',
      errcode: code,
    })
  }

  throw new WechatApiError(message, {
    code: kind === 'token-invalid' ? 'token-invalid' : `errcode-${code}`,
    errcode: code,
    retryable: kind === 'transient',
  })
}

function isRetryable(error: unknown): boolean {
  return error instanceof Error && 'retryable' in error && error.retryable === true
}

function isTimeout(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  return cause.name === 'TimeoutError' || cause.name === 'AbortError'
}

/** Exponential backoff with jitter, so parallel articles do not resynchronize. */
function backoffMs(attempt: number): number {
  const base = 300 * 2 ** (attempt - 1)
  return base + Math.floor(Math.random() * 200)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function joinPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}
