import { HASH_SCHEMA_VERSION, RENDERER_VERSION } from '../constants.js'
import type { AssetIdentity, ArticleDocument } from '../types.js'
import { canonicalJson, sha256Hex } from '../util/hash.js'

export interface ContentHashInput {
  readonly document: ArticleDocument
  /** HTML with asset references still in placeholder form. */
  readonly html: string
  readonly bodyAssets: readonly AssetIdentity[]
  readonly coverAsset: AssetIdentity
  readonly themeName: string
}

/**
 * Content hash over pre-upload inputs only.
 *
 * No uploaded URL and no WeChat media identifier participates. Substituting
 * real URLs into the HTML after the decision must not change this value —
 * see ADR-0002, and the test that asserts it directly.
 */
export function computeContentHash(input: ContentHashInput): string {
  const { document } = input

  return sha256Hex(
    canonicalJson({
      schema: HASH_SCHEMA_VERSION,
      renderer: RENDERER_VERSION,
      theme: input.themeName,
      sourceId: document.sourceId,
      title: document.title,
      author: document.author ?? '',
      digest: document.digest,
      html: input.html,
      // Ordered: moving an image within the article is a content change.
      bodyAssets: input.bodyAssets.map((asset) => asset.contentHash),
      cover: input.coverAsset.contentHash,
    }),
  )
}
