import { PATHS } from './codes.js'
import { WechatApiError } from './errors.js'
import type { WechatTransport } from './transport.js'

interface StableTokenResponse {
  access_token?: string
  expires_in?: number
}

/** Renew this long before nominal expiry, so a call never races the boundary. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000

/** Floor between forced refreshes, so a failing call cannot spin the quota away. */
const MIN_FORCED_REFRESH_INTERVAL_MS = 10_000

/**
 * Access token acquisition and in-memory caching.
 *
 * Uses the stable-token endpoint rather than the plain one: an account has a
 * single valid token at a time, and the plain endpoint invalidates the previous
 * one, so a CI job and a local run would evict each other and produce
 * intermittent auth failures that look like throttling.
 *
 * ADR-0005 accepts that this is a convention rather than a structural
 * guarantee — the abandoned gateway design made concurrent callers impossible.
 */
export class TokenProvider {
  readonly #transport: WechatTransport
  readonly #appId: string
  readonly #appSecret: string

  #cached: { value: string; expiresAt: number } | undefined
  #lastForcedRefreshAt = 0
  #inFlight: Promise<string> | undefined

  constructor(transport: WechatTransport, appId: string, appSecret: string) {
    this.#transport = transport
    this.#appId = appId
    this.#appSecret = appSecret
  }

  async get(): Promise<string> {
    const cached = this.#cached
    if (cached && cached.expiresAt > Date.now()) return cached.value

    // Collapse concurrent misses: several articles publishing at once should
    // produce one token request, not one per article.
    //
    // Held in a local rather than read back from the field: the `finally`
    // handler clears the field, and relying on narrowing across a callback that
    // assigns to it is exactly the kind of thing that works until it doesn't.
    const pending =
      this.#inFlight ??
      this.#fetchToken(false).finally(() => {
        this.#inFlight = undefined
      })

    this.#inFlight = pending
    return pending
  }

  /**
   * Discard the cached token and obtain a new one.
   *
   * Rate limited: a caller that keeps failing must not turn one bad token into
   * a refresh loop that spends the account's refresh allowance.
   */
  async refresh(): Promise<string> {
    const sinceLast = Date.now() - this.#lastForcedRefreshAt
    if (sinceLast < MIN_FORCED_REFRESH_INTERVAL_MS) {
      throw new WechatApiError(
        'token 刚刷新过仍然无效，停止重试以免耗尽刷新配额。请检查 AppID 与 AppSecret。',
        { code: 'token-refresh-throttled' },
      )
    }

    this.#lastForcedRefreshAt = Date.now()
    this.#cached = undefined
    return this.#fetchToken(true)
  }

  async #fetchToken(force: boolean): Promise<string> {
    const payload = await this.#transport.request<StableTokenResponse>({
      path: PATHS.stableToken,
      method: 'POST',
      json: {
        grant_type: 'client_credential',
        appid: this.#appId,
        secret: this.#appSecret,
        force_refresh: force,
      },
      // Safe to repeat: acquiring a token creates no durable object.
      idempotent: true,
    })

    const token = payload.access_token
    if (!token) {
      throw new WechatApiError('微信返回的响应中没有 access_token。', {
        code: 'token-missing-in-response',
      })
    }

    const lifetimeMs = (payload.expires_in ?? 7200) * 1000
    this.#cached = {
      value: token,
      expiresAt: Date.now() + Math.max(lifetimeMs - EXPIRY_MARGIN_MS, 60_000),
    }

    return token
  }
}
