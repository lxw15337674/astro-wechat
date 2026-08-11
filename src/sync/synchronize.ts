import { AstroWechatError, WarningCollector, type Warning } from '../errors.js'
import { normalizeImage, type NormalizedImage } from '../image/normalize.js'
import { substitutePlaceholders } from '../render/images.js'
import type { StateStore } from '../state/store.js'
import type { ArticleResult, ArticleStatus, AssetIdentity, RenderedArticle } from '../types.js'
import type { WeChatClient } from '../wechat/client.js'

/**
 * The part of a result the decision produces, on top of the identifying fields.
 *
 * `status` stays required rather than using `Partial<ArticleResult>`: spreading
 * a fully optional type would make `status` optional in the merged object too,
 * which is exactly the field that must never go missing.
 */
interface SyncOutcome {
  readonly status: ArticleStatus
  readonly skipReason?: ArticleResult['skipReason']
  readonly drift?: boolean
  readonly mediaId?: string
  readonly reconciled?: boolean
  readonly warnings?: readonly Warning[]
}

export interface SynchronizeDeps {
  readonly client: WeChatClient
  readonly store: StateStore
  /** Injected in tests so the suite does not require the native image pipeline. */
  readonly normalize?: (asset: AssetIdentity, warnings: WarningCollector) => Promise<NormalizedImage>
}

export interface SynchronizeOptions {
  /** Do everything up to the create decision, then report without writing. */
  readonly dryRun?: boolean
  /** Create a second draft for an article that already has one. */
  readonly forceCreate?: boolean
}

/**
 * Decide whether to skip or create, and carry out the create.
 *
 * There is no update path: the first release converges an article onto at most
 * one draft and stops there (technical design section 2.3). The skip decision
 * is therefore identity-based — does a committed record exist — and the content
 * hash only drives a drift warning.
 */
export async function synchronizeArticle(
  rendered: RenderedArticle,
  deps: SynchronizeDeps,
  options: SynchronizeOptions = {},
): Promise<ArticleResult> {
  const { document } = rendered
  const sourceId = document.sourceId
  const base = {
    sourcePath: document.source.projectRelativePath,
    sourceId,
    title: document.title,
    contentHash: rendered.contentHash,
    warnings: rendered.warnings,
  }

  try {
    const existing = await deps.store.get(sourceId)

    if (existing?.writeState === 'committed' && !options.forceCreate) {
      const drift = existing.contentHash !== rendered.contentHash
      return {
        ...base,
        status: 'skipped',
        skipReason: 'already-synchronized',
        drift,
        mediaId: existing.mediaId,
        warnings: drift ? [...rendered.warnings, driftWarning(document.source.absolutePath)] : rendered.warnings,
      }
    }

    if (existing?.writeState === 'pending' && !options.forceCreate) {
      const reconciled = await reconcile(rendered, deps)
      if (reconciled) return { ...base, ...reconciled }
    }

    if (options.dryRun) {
      return { ...base, status: 'planned' }
    }

    const outcome = await create(
      rendered,
      deps,
      existing?.coverMaterialId,
      existing?.coverContentHash,
    )
    return { ...base, ...outcome, warnings: outcome.warnings ?? base.warnings }
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      errorCategory: error instanceof AstroWechatError ? error.category : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Resolve a pending record against WeChat.
 *
 * A pending entry means a previous run called WeChat and never learned the
 * outcome. Creating again is exactly how duplicate drafts appear, so the remote
 * state decides.
 */
async function reconcile(
  rendered: RenderedArticle,
  deps: SynchronizeDeps,
): Promise<SyncOutcome | undefined> {
  const canonicalUrl = rendered.document.canonicalUrl

  if (!canonicalUrl) {
    // Without a canonical URL there is nothing in the draft to match on, so we
    // cannot tell "never created" from "created and lost". Creating would risk
    // a duplicate; refusing leaves the operator in control.
    throw new AstroWechatError(
      'wechat',
      '上一次同步结果未知，且这篇文章没有 canonical URL，无法与微信核对。' +
        '请手动检查草稿箱，确认后用 --force-create 或手动清理台账。',
      { code: 'reconcile-impossible', sourcePath: rendered.document.source.absolutePath },
    )
  }

  const mediaId = await deps.client.findDraftBySourceUrl(canonicalUrl)
  if (!mediaId) return undefined

  await deps.store.commit(rendered.document.sourceId, { mediaId })

  return {
    status: 'skipped',
    skipReason: 'already-synchronized',
    mediaId,
    reconciled: true,
  }
}

async function create(
  rendered: RenderedArticle,
  deps: SynchronizeDeps,
  reusableCoverMaterialId: string | undefined,
  reusableCoverHash: string | undefined,
): Promise<SyncOutcome> {
  const { document } = rendered
  const normalize = deps.normalize ?? normalizeImage
  const warnings = new WarningCollector()

  // Written before any WeChat call. A pending entry found on a later run is the
  // signal that the previous outcome is unknown.
  await deps.store.putPending({
    sourceId: document.sourceId,
    canonicalUrl: document.canonicalUrl,
    contentHash: rendered.contentHash,
    hashSchemaVersion: rendered.hashSchemaVersion,
  })

  const reuseCover =
    reusableCoverMaterialId !== undefined && reusableCoverHash === rendered.coverAsset.contentHash

  let coverMaterialId = reusableCoverMaterialId

  if (!reuseCover) {
    const image = await normalize(rendered.coverAsset, warnings)
    const uploaded = await deps.client.uploadCover(image)
    coverMaterialId = uploaded.mediaId

    // Recorded immediately: if draft creation fails, this material is already
    // consuming quota and belongs to no draft.
    await deps.store.recordOrphan(document.sourceId, uploaded.mediaId)
  }

  const substitutions = new Map<string, string>()
  for (const asset of rendered.bodyAssets) {
    const image = await normalize(asset, warnings)
    substitutions.set(asset.placeholder, await deps.client.uploadBodyImage(image))
  }

  const content = substitutePlaceholders(rendered.html, substitutions)

  const mediaId = await deps.client.createDraft({
    title: document.title,
    author: document.author,
    digest: document.digest,
    content,
    thumbMediaId: coverMaterialId!,
    contentSourceUrl: document.canonicalUrl,
  })

  await deps.store.commit(document.sourceId, {
    mediaId,
    coverMaterialId,
    coverContentHash: rendered.coverAsset.contentHash,
  })

  // Unconditional: the invariant is "material a draft references is not an
  // orphan", not "material we just uploaded". Keying this off whether an upload
  // happened would leave a reused cover marked as an orphan, and cleanup would
  // then delete a material a published draft depends on.
  await deps.store.clearOrphan(document.sourceId, coverMaterialId!)

  return {
    status: 'created',
    mediaId,
    warnings: [...rendered.warnings, ...warnings.warnings],
  }
}

function driftWarning(sourcePath: string): Warning {
  return {
    code: 'source-drift',
    message:
      '这篇文章已同步过，但源内容此后发生了变化。首个版本不更新草稿，因此改动不会反映到微信。' +
      '需要更新请在公众号后台编辑。',
    sourcePath,
  }
}
