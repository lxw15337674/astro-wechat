import type { Warning } from './errors.js'

/** Technical design section 4.1. Raw file content before normalization. */
export interface SourceArticle {
  readonly absolutePath: string
  readonly projectRelativePath: string
  readonly frontmatter: Readonly<Record<string, unknown>>
  readonly body: string
  readonly format: 'md'
}

/** The optional `wechat` frontmatter object. Technical design section 6. */
export interface WechatFrontmatter {
  readonly enabled?: boolean
  readonly title?: string
  readonly cover?: string
  readonly author?: string
  readonly digest?: string
  readonly sourceURL?: string
}

/**
 * Technical design section 4.2. The normalized article.
 *
 * Locale and timezone are deliberately absent: nothing consumes them, and an
 * unused field in the shared model invites inconsistent implementations.
 */
export interface ArticleDocument {
  /** Canonical URL when available, otherwise the normalized relative path. */
  readonly sourceId: string
  readonly canonicalUrl: string | undefined
  readonly title: string
  readonly body: string
  readonly author: string | undefined
  readonly digest: string
  /** Unresolved cover reference as written in frontmatter or configuration. */
  readonly cover: string
  readonly draft: boolean
  readonly tags: readonly string[]
  readonly wechat: WechatFrontmatter
  readonly source: SourceArticle
}

export type AssetSourceKind = 'local' | 'remote' | 'data-uri' | 'wechat-hosted'

export type AssetRole = 'body' | 'cover'

/** Technical design section 4.3. An image before upload. */
export interface AssetReference {
  readonly original: string
  readonly kind: AssetSourceKind
  /** Absolute filesystem path for local assets. */
  readonly localPath?: string
  /** Absolute URL for remote and already-hosted assets. */
  readonly url?: string
  readonly role: AssetRole
  readonly alt?: string
}

/** A resolved asset with its content identity computed. */
export interface AssetIdentity {
  readonly reference: AssetReference
  /**
   * Hash of the asset's bytes for local assets, or of its URL for remote ones.
   *
   * Remote assets are not downloaded during rendering, so their identity is the
   * URL. That is weaker than content identity and is why remote images cannot
   * detect an upstream edit.
   */
  readonly contentHash: string
  /** Placeholder substituted into the HTML until upload replaces it. */
  readonly placeholder: string
}

/**
 * Technical design section 4.4, pre-upload state.
 *
 * This is what the create decision reads. It contains no uploaded URL, because
 * the content hash must be computable before anything is uploaded.
 */
export interface RenderedArticle {
  readonly document: ArticleDocument
  /** Sanitized HTML with asset references still in placeholder form. */
  readonly html: string
  readonly bodyAssets: readonly AssetIdentity[]
  readonly coverAsset: AssetIdentity
  readonly contentHash: string
  readonly hashSchemaVersion: number
  readonly rendererVersion: string
  readonly warnings: readonly Warning[]
}

/** Technical design section 4.5. Persisted by the state store in ADR-0002. */
export interface DraftIdentity {
  readonly sourceId: string
  readonly canonicalUrl?: string
  readonly mediaId?: string
  readonly contentHash?: string
  readonly hashSchemaVersion?: number
  readonly coverMaterialId?: string
  /** Content hash of the cover that produced `coverMaterialId`. */
  readonly coverContentHash?: string
  readonly orphanedCoverMaterialIds?: readonly string[]
  readonly writeState: 'pending' | 'committed'
  readonly updatedAt?: string
}

/** Project configuration. Technical design section 8. */
export interface ProjectConfig {
  readonly contentDir: string
  readonly siteUrl?: string
  /**
   * Pattern used to derive a canonical URL from a slug.
   *
   * Route shape is theme-specific, so it is configuration rather than a
   * built-in assumption. The default matches AstroPaper, which is the first
   * consumer, but nothing in the core depends on that theme.
   */
  readonly permalinkPattern: string
  readonly defaultAuthor?: string
  readonly defaultCover?: string
  readonly theme: string
  readonly eligibleTags?: readonly string[]
  readonly eligibleSourcePaths?: readonly string[]
  /** Exact hostnames permitted when downloading remote images for WeChat upload. */
  readonly remoteImageHosts?: readonly string[]
  readonly previewDir: string
  /**
   * Ledger location, relative to the project root.
   *
   * This file must be committed: it is the record of what has been
   * synchronized, and losing it means the next run cannot tell an already
   * published article from a new one (ADR-0002).
   */
  readonly ledgerPath: string
  /** Allow resolving assets from absolute filesystem paths. Off by default. */
  readonly allowAbsoluteAssetPaths: boolean
}

export interface ResolvedProject {
  readonly root: string
  readonly config: ProjectConfig
}

/** Why an article was not synchronized. Reported rather than silently omitted. */
export type SkipReason =
  | 'already-synchronized'
  | 'not-enabled'
  | 'excluded-by-config'
  | 'source-is-draft'

/**
 * `planned` only appears under `--dry-run`.
 *
 * There is no `updated`: the first release never updates a draft (technical
 * design section 2.3). Consumers must not assume this set is closed.
 */
export type ArticleStatus = 'skipped' | 'created' | 'failed' | 'planned'

export interface ArticleResult {
  readonly sourcePath: string
  readonly sourceId: string
  readonly title: string
  readonly status: ArticleStatus
  readonly skipReason?: SkipReason
  readonly contentHash?: string
  /** Source changed after synchronization; the draft will not be updated. */
  readonly drift?: boolean
  readonly mediaId?: string
  /** Set when a previously unknown outcome was resolved against WeChat. */
  readonly reconciled?: boolean
  readonly errorCategory?: string
  readonly errorMessage?: string
  readonly warnings: readonly Warning[]
}
