import { FIELD_LIMITS, type LimitedField } from '../constants.js'
import { SourceValidationError, type WarningCollector } from '../errors.js'
import { codePointLength, truncateOnBoundary } from '../util/text.js'

/**
 * Reject a field that exceeds its WeChat limit.
 *
 * Validation happens locally, before any upload, so an oversized title is a
 * source error the author can fix rather than a remote failure surfacing after
 * images have already been uploaded.
 */
export function assertWithinLimit(
  field: Exclude<LimitedField, 'digest'>,
  value: string,
  sourcePath: string,
): void {
  const limit = FIELD_LIMITS[field]
  const length = codePointLength(value)
  if (length <= limit.max) return

  throw new SourceValidationError(
    `${field} 超出微信限制：${length} 字符，上限 ${limit.max}。请缩短后重试。`,
    { code: `${field}-too-long`, sourcePath },
  )
}

/**
 * Fit a digest to its limit by truncating.
 *
 * Digests are derived summary text rather than something the author composed
 * word by word, so truncating is preferable to failing the whole article.
 */
export function fitDigest(
  value: string,
  warnings: WarningCollector,
  sourcePath: string,
): string {
  const limit = FIELD_LIMITS.digest
  if (codePointLength(value) <= limit.max) return value

  warnings.add({
    code: 'digest-truncated',
    message: `摘要超出 ${limit.max} 字符已截断。显式提供 wechat.digest 可控制截断位置。`,
    sourcePath,
  })

  return truncateOnBoundary(value, limit.max)
}
