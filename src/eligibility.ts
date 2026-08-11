import type { ArticleDocument, ProjectConfig, SkipReason } from './types.js'
import { normalizeRelativePath } from './util/text.js'

/**
 * Decide whether an article may be synchronized.
 *
 * Two independent gates exist and they combine with AND, with the article-level
 * gate authoritative (technical design section 6.1). Configuration can exclude
 * an opted-in article but can never opt one in, so silence never publishes.
 *
 * Returns the reason for skipping, or `undefined` when eligible.
 */
export function checkEligibility(
  document: ArticleDocument,
  config: ProjectConfig,
): SkipReason | undefined {
  if (document.draft) return 'source-is-draft'
  if (document.wechat.enabled !== true) return 'not-enabled'
  if (!passesConfigFilters(document, config)) return 'excluded-by-config'
  return undefined
}

function passesConfigFilters(document: ArticleDocument, config: ProjectConfig): boolean {
  const { eligibleTags, eligibleSourcePaths } = config

  if (eligibleTags && eligibleTags.length > 0) {
    if (!document.tags.some((tag) => eligibleTags.includes(tag))) return false
  }

  if (eligibleSourcePaths && eligibleSourcePaths.length > 0) {
    const path = normalizeRelativePath(document.source.projectRelativePath)
    if (!eligibleSourcePaths.some((prefix) => isUnder(path, prefix))) return false
  }

  return true
}

/**
 * Directory containment, not string prefix.
 *
 * A bare `startsWith` would let `src/data/blog` also match `src/data/blog2`,
 * silently publishing from a directory the author never listed.
 */
function isUnder(path: string, prefix: string): boolean {
  const normalized = normalizeRelativePath(prefix).replace(/\/+$/, '')
  return path === normalized || path.startsWith(`${normalized}/`)
}

/**
 * Whether a skip should be surfaced prominently.
 *
 * An article that opted in but was excluded by configuration is usually a
 * misconfiguration, not an intent, so it must not read like a normal skip.
 */
export function isSuspiciousSkip(reason: SkipReason | undefined): boolean {
  return reason === 'excluded-by-config'
}
