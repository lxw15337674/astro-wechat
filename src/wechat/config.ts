import { ProxyError, WechatApiError } from './errors.js'

export interface WechatConfig {
  readonly appId: string
  readonly appSecret: string
  /** Forwarding proxy base URL. Absent means talk to WeChat directly. */
  readonly proxyUrl?: string
  readonly proxyToken?: string
  readonly timeoutMs: number
  readonly maxRetries: number
}

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_RETRIES = 2

/**
 * Read credentials and proxy settings from the environment.
 *
 * Secrets are environment-only: never from configuration files, frontmatter, or
 * command-line flags, all of which end up in logs, artifacts, or shell history.
 */
export function readWechatConfig(env: NodeJS.ProcessEnv = process.env): WechatConfig {
  const appId = env.WECHAT_APP_ID?.trim()
  const appSecret = env.WECHAT_APP_SECRET?.trim()

  if (!appId || !appSecret) {
    throw new WechatApiError(
      '缺少 WECHAT_APP_ID 或 WECHAT_APP_SECRET。凭据只从环境变量读取。',
      { code: 'credentials-missing' },
    )
  }

  const proxyUrl = env.WECHAT_PROXY_URL?.trim() || undefined
  const proxyToken = env.WECHAT_PROXY_TOKEN?.trim() || undefined

  if (proxyUrl) {
    assertHttpsUrl(proxyUrl)
    if (!proxyToken) {
      throw new ProxyError('配置了 WECHAT_PROXY_URL 但缺少 WECHAT_PROXY_TOKEN。', {
        code: 'proxy-token-missing',
      })
    }
  }

  return {
    appId,
    appSecret,
    proxyUrl,
    proxyToken,
    timeoutMs: readPositiveInt(env.WECHAT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: readPositiveInt(env.WECHAT_MAX_RETRIES, DEFAULT_MAX_RETRIES),
  }
}

/**
 * The proxy sees the AppSecret in the token request body and the access token
 * in every query string. Plain HTTP would put both on the wire.
 */
function assertHttpsUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProxyError(`WECHAT_PROXY_URL 不是合法 URL：${value}`, { code: 'proxy-url-invalid' })
  }

  if (url.protocol !== 'https:') {
    throw new ProxyError(
      `WECHAT_PROXY_URL 必须是 HTTPS：凭据与 access token 会经过这条链路。收到 ${url.protocol}`,
      { code: 'proxy-url-insecure' },
    )
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
