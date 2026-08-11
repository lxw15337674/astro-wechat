import { PATHS } from './codes.js'
import { readWechatConfig, type WechatConfig } from './config.js'
import { WechatApiError } from './errors.js'
import { TokenProvider } from './token.js'
import { WechatTransport, type WechatRequest } from './transport.js'

export interface ImageUpload {
  readonly bytes: Uint8Array
  readonly filename: string
  readonly contentType: string
}

export interface CreateDraftInput {
  readonly title: string
  readonly author?: string
  readonly digest: string
  /** Sanitized HTML with real image URLs already substituted. */
  readonly content: string
  readonly thumbMediaId: string
  /**
   * Canonical article URL.
   *
   * The only field WeChat stores that can carry a stable identifier, which
   * makes it the sole basis for recovering draft identity remotely (ADR-0002).
   */
  readonly contentSourceUrl?: string
}

export interface FindDraftOptions {
  /**
   * Hard bound on paged scanning.
   *
   * Reaching it is an error, never an empty result: reporting "not found"
   * because we stopped looking would make the synchronizer create a second
   * draft for an article that already has one.
   */
  readonly maxPages?: number
  readonly pageSize?: number
}

interface UploadImageResponse {
  url?: string
}

interface AddMaterialResponse {
  media_id?: string
  url?: string
}

interface AddDraftResponse {
  media_id?: string
}

interface BatchGetResponse {
  total_count?: number
  item_count?: number
  item?: {
    media_id?: string
    content?: {
      news_item?: { content_source_url?: string }[]
    }
  }[]
}

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_MAX_PAGES = 25

/**
 * WeChat Official Account client.
 *
 * All WeChat protocol knowledge lives here rather than being split across a
 * Node half and a Python half (ADR-0005), so there is one place to get error
 * classification right and one contract test suite that exercises it.
 */
export class WeChatClient {
  readonly #transport: WechatTransport
  readonly #tokens: TokenProvider

  constructor(config: WechatConfig, fetchImpl?: typeof fetch) {
    this.#transport = new WechatTransport({
      proxyUrl: config.proxyUrl,
      proxyToken: config.proxyToken,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      fetchImpl,
    })
    this.#tokens = new TokenProvider(this.#transport, config.appId, config.appSecret)
  }

  static fromEnvironment(env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): WeChatClient {
    return new WeChatClient(readWechatConfig(env), fetchImpl)
  }

  get usesProxy(): boolean {
    return this.#transport.usesProxy
  }

  /**
   * Upload a body image and return its WeChat-hosted URL.
   *
   * Safe to repeat: it creates no permanent material and consumes no material
   * quota, so a retry wastes bandwidth and nothing else.
   */
  async uploadBodyImage(image: ImageUpload): Promise<string> {
    const payload = await this.#authorized<UploadImageResponse>((token) => ({
      path: PATHS.uploadBodyImage,
      method: 'POST',
      query: { access_token: token },
      form: () => toFormData(image),
      idempotent: true,
    }))

    if (!payload.url) {
      throw new WechatApiError('上传正文图片成功但响应中没有 url。', {
        code: 'upload-url-missing',
      })
    }
    return payload.url
  }

  /**
   * Upload a cover as permanent material.
   *
   * Deliberately not retried: permanent material counts against a per-account
   * quota and is never reclaimed by draft operations, so a retry leaks quota
   * permanently. Reuse is handled upstream by content hash.
   */
  async uploadCover(image: ImageUpload): Promise<{ mediaId: string; url: string | undefined }> {
    const payload = await this.#authorized<AddMaterialResponse>((token) => ({
      path: PATHS.addMaterial,
      method: 'POST',
      query: { access_token: token, type: 'image' },
      form: () => toFormData(image),
      idempotent: false,
    }))

    if (!payload.media_id) {
      throw new WechatApiError('上传封面成功但响应中没有 media_id。', {
        code: 'material-id-missing',
      })
    }
    return { mediaId: payload.media_id, url: payload.url }
  }

  /**
   * Create a draft.
   *
   * Never retried. A timeout here surfaces as `OutcomeUnknownError`, which the
   * synchronizer resolves by reconciling against WeChat rather than by trying
   * again — that retry is precisely how duplicate drafts appear.
   */
  async createDraft(input: CreateDraftInput): Promise<string> {
    const article: Record<string, unknown> = {
      title: input.title,
      author: input.author ?? '',
      digest: input.digest,
      content: input.content,
      thumb_media_id: input.thumbMediaId,
      content_source_url: input.contentSourceUrl ?? '',
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }

    const payload = await this.#authorized<AddDraftResponse>((token) => ({
      path: PATHS.draftAdd,
      method: 'POST',
      query: { access_token: token },
      json: { articles: [article] },
      idempotent: false,
    }))

    if (!payload.media_id) {
      throw new WechatApiError('创建草稿成功但响应中没有 media_id。', {
        code: 'draft-id-missing',
      })
    }
    return payload.media_id
  }

  /**
   * Find an existing draft by its source URL.
   *
   * WeChat drafts carry no custom metadata, so this scans pages and matches on
   * the article's source-URL field. Linear in the size of the draft box, which
   * is why it is a recovery path rather than the steady-state lookup.
   */
  async findDraftBySourceUrl(
    sourceUrl: string,
    options: FindDraftOptions = {},
  ): Promise<string | null> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * pageSize

      const payload = await this.#authorized<BatchGetResponse>((token) => ({
        path: PATHS.draftBatchGet,
        method: 'POST',
        query: { access_token: token },
        // `no_content: 1` drops the article body, which is most of the payload.
        // Whether it also drops `content_source_url` is unverified against a
        // live account (open decision 6), hence the guard below.
        json: { offset, count: pageSize, no_content: 1 },
        idempotent: true,
      }))

      const items = payload.item ?? []
      let sawSourceUrlField = false

      for (const item of items) {
        for (const news of item.content?.news_item ?? []) {
          if (news.content_source_url !== undefined) sawSourceUrlField = true
          if (news.content_source_url === sourceUrl && item.media_id) return item.media_id
        }
      }

      // Without this, a response that omits the field would look exactly like a
      // draft box that simply does not contain the article — and the caller
      // would create a duplicate. Fail loudly on the shape instead.
      if (items.length > 0 && !sawSourceUrlField) {
        throw new WechatApiError(
          '草稿列表响应里没有 content_source_url 字段，无法据此匹配草稿。' +
            '这通常意味着 no_content 参数把该字段一并省略了，需要改用完整响应重新核对。',
          { code: 'draft-source-url-absent' },
        )
      }

      if (items.length < pageSize) return null
    }

    throw new WechatApiError(
      `扫描 ${maxPages} 页仍未找到 source URL 为 ${sourceUrl} 的草稿，且草稿箱还有更多内容。` +
        '返回「未找到」会导致重复创建，因此这里报错。请提高 maxPages 或改用台账恢复。',
      { code: 'draft-scan-exhausted' },
    )
  }

  /** Delete permanent material. Irreversible; only ever called explicitly. */
  async deleteMaterial(mediaId: string): Promise<void> {
    await this.#authorized<unknown>((token) => ({
      path: PATHS.deleteMaterial,
      method: 'POST',
      query: { access_token: token },
      json: { media_id: mediaId },
      idempotent: false,
    }))
  }

  /**
   * Run a request with a valid token, refreshing once if WeChat rejects it.
   *
   * Replaying after a token error is safe even for non-idempotent calls: the
   * request was rejected at authentication, so nothing was created. Only one
   * replay is attempted — a second failure means the credentials are wrong, and
   * retrying would report that as a slow success.
   */
  async #authorized<T>(build: (token: string) => WechatRequest): Promise<T> {
    const token = await this.#tokens.get()

    try {
      return await this.#transport.request<T>(build(token))
    } catch (error) {
      if (!(error instanceof WechatApiError) || error.code !== 'token-invalid') throw error

      const refreshed = await this.#tokens.refresh()
      return this.#transport.request<T>(build(refreshed))
    }
  }
}

function toFormData(image: ImageUpload): FormData {
  const form = new FormData()
  // BlobPart rejects Uint8Array<ArrayBufferLike> because it may be backed by a
  // SharedArrayBuffer. Copying gives fetch an ordinary ArrayBuffer-backed view.
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(image.bytes.byteLength)
  bytes.set(image.bytes)
  form.append('media', new Blob([bytes], { type: image.contentType }), image.filename)
  return form
}
