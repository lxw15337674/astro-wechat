/**
 * WeChat API paths and error-code classification.
 *
 * Values marked UNVERIFIED come from the published API documentation but have
 * not been confirmed against a live account (open decision 6). Getting a code
 * into the wrong bucket has real consequences — a quota error classified as
 * transient turns one operator-visible failure into a retry loop that burns the
 * remaining daily allowance — so each bucket below says why.
 */

export const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com'

/** Path prefix the forwarding proxy strips before calling WeChat. */
export const PROXY_PATH_PREFIX = '/wechat'

export const PATHS = {
  stableToken: '/cgi-bin/stable_token',
  uploadBodyImage: '/cgi-bin/media/uploadimg',
  addMaterial: '/cgi-bin/material/add_material',
  deleteMaterial: '/cgi-bin/material/del_material',
  draftAdd: '/cgi-bin/draft/add',
  draftBatchGet: '/cgi-bin/draft/batchget',
} as const

/**
 * Codes meaning the access token is stale.
 *
 * Recoverable without operator involvement: refresh once and replay. Replaying
 * more than once would mask a credential problem as a slow success.
 */
export const TOKEN_INVALID_CODES = new Set([
  40001, // invalid credential / access_token is invalid
  40014, // invalid access_token
  42001, // access_token expired
])

/**
 * Quota exhaustion. Never retried.
 *
 * Retrying makes it strictly worse: it consumes more of the same allowance and
 * converts one legible error into a stream of illegible ones.
 */
export const QUOTA_CODES = new Set([
  45009, // reach max api daily quota limit
  45028, // material quota exhausted -- UNVERIFIED
])

/**
 * Transient throttling and server-side hiccups. Retryable with backoff.
 *
 * Distinct from quota: the allowance is not gone, the call was merely too soon.
 */
export const TRANSIENT_CODES = new Set([
  -1, // system busy
  45011, // api minute-quota reached, retry next minute
])

/** HTTP statuses worth retrying for operations that are safe to repeat. */
export const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504])

export type WechatErrorKind = 'token-invalid' | 'quota' | 'transient' | 'permanent'

export function classifyErrorCode(code: number): WechatErrorKind {
  if (TOKEN_INVALID_CODES.has(code)) return 'token-invalid'
  if (QUOTA_CODES.has(code)) return 'quota'
  if (TRANSIENT_CODES.has(code)) return 'transient'
  return 'permanent'
}
