/**
 * Framework-independent core.
 *
 * This is the package default export, not the Astro integration (ADR-0001), so
 * a plain Node or CI consumer never loads Astro-dependent code.
 */

export * from './types.js'
export * from './errors.js'
export {
  ACCEPTED_SOURCE_FORMATS,
  BODY_IMAGE_UPLOAD,
  CLICKABLE_LINK_HOSTS,
  CONTENT_LIMITS,
  COVER_UPLOAD,
  FIELD_LIMITS,
  HASH_SCHEMA_VERSION,
  IMAGE_BOUNDS,
  RENDERER_VERSION,
} from './constants.js'

export {
  openProject,
  inspectArticle,
  prepareArticle,
  publishArticle,
  listArticleFiles,
} from './pipeline.js'
export type { ArticleInspection, OpenProjectOptions, PublishOptions } from './pipeline.js'

export { synchronizeArticle } from './sync/synchronize.js'
export type { SynchronizeDeps, SynchronizeOptions } from './sync/synchronize.js'
export { cleanupOrphans, listOrphans } from './sync/cleanup.js'
export type { CleanupResult, OrphanRecord } from './sync/cleanup.js'

export { JsonLedgerStore, MemoryStateStore } from './state/store.js'
export type { CommitResult, StateStore } from './state/store.js'

export { changedMarkdownFiles } from './git/changed.js'
export type { ChangedFilesOptions } from './git/changed.js'

export {
  normalizeImage,
  chooseOutputFormat,
  contentTypeFor,
  decodeDataUri,
  isSvgDataUri,
} from './image/normalize.js'
export type { NormalizedImage } from './image/normalize.js'

export { checkEligibility, isSuspiciousSkip } from './eligibility.js'
export { DEFAULT_CONFIG, loadProjectConfig, contentRoot } from './project/config.js'
export { discoverProjectRoot, isProjectRoot } from './project/discover.js'
export { loadSourceArticle } from './source/load.js'
export { toArticleDocument, findFirstH1 } from './source/adapter.js'
export type { AdapterOverrides } from './source/adapter.js'
export { assertWithinLimit, fitDigest } from './source/validate.js'

export { resolveAsset } from './assets/resolve.js'
export type { ResolveAssetOptions } from './assets/resolve.js'
export { identifyAsset, placeholderFor, isPlaceholder } from './assets/identity.js'

export { renderArticle } from './render/index.js'
export { renderMarkdown, createMarkdownRenderer } from './render/markdown.js'
export type { MarkdownRenderer } from './render/markdown.js'
export { rewriteOutboundLinks } from './render/links.js'
export type { LinkReference, LinkRewriteOptions, LinkRewriteResult } from './render/links.js'
export { rewriteImages, substitutePlaceholders } from './render/images.js'
export { sanitizeArticleHtml } from './render/sanitize.js'
export { computeContentHash } from './render/hash.js'
export type { ContentHashInput } from './render/hash.js'
export { getTheme, ARTICLE_CLASS } from './render/theme.js'
export type { Theme } from './render/theme.js'

export { rasterizeSvg, assertSafeSvg } from './image/rasterize.js'
export { renderPreviewPage, writePreview } from './preview/index.js'

export { WeChatClient } from './wechat/client.js'
export type { CreateDraftInput, FindDraftOptions, ImageUpload } from './wechat/client.js'
export { readWechatConfig, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES } from './wechat/config.js'
export type { WechatConfig } from './wechat/config.js'
export {
  OutcomeUnknownError,
  ProxyError,
  WechatApiError,
  WechatQuotaError,
} from './wechat/errors.js'
export { PATHS, classifyErrorCode } from './wechat/codes.js'
export type { WechatErrorKind } from './wechat/codes.js'
export { WechatTransport, assertNoWechatError } from './wechat/transport.js'
export type { TransportOptions, WechatEnvelope, WechatRequest } from './wechat/transport.js'
