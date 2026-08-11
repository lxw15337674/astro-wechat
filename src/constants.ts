/**
 * Every WeChat platform limit the package enforces lives here.
 *
 * Technical design section 5.2 requires one shared module rather than values
 * duplicated across validators, and open decision 6 requires the numbers to be
 * confirmed against current official documentation before the first release.
 *
 * Entries marked UNVERIFIED are working values taken from the published API
 * documentation but not yet re-checked against a live account. Confirming one
 * means deleting its marker, not editing the number in place somewhere else.
 */

/** Marker for values still pending confirmation under open decision 6. */
const UNVERIFIED = true

export interface FieldLimit {
  /** Maximum length in characters, counted as Unicode code points. */
  readonly max: number
  /** Whether the value may be truncated instead of rejected. */
  readonly truncatable: boolean
  readonly unverified?: boolean
}

/**
 * Length limits on WeChat article fields.
 *
 * Titles and authors are author-visible, so silent truncation would publish
 * something the author did not write. Digests are derived text, so truncating
 * on a boundary is acceptable.
 */
export const FIELD_LIMITS = {
  title: { max: 64, truncatable: false, unverified: UNVERIFIED },
  author: { max: 8, truncatable: false, unverified: UNVERIFIED },
  digest: { max: 120, truncatable: true, unverified: UNVERIFIED },
} as const satisfies Record<string, FieldLimit>

export type LimitedField = keyof typeof FIELD_LIMITS

/** Maximum article body size accepted by the draft endpoint. */
export const CONTENT_LIMITS = {
  /** Characters of HTML. */
  maxCharacters: 20_000,
  /** Bytes of HTML, measured as UTF-8. */
  maxBytes: 1024 * 1024,
  unverified: UNVERIFIED,
} as const

/**
 * Formats the body-image upload endpoint accepts.
 *
 * This is deliberately narrower than the set of source formats the package
 * reads. Technical design section 5.6: accepted source formats are an input
 * convenience, never a passthrough guarantee.
 */
export const BODY_IMAGE_UPLOAD = {
  acceptedFormats: ['jpeg', 'png'] as const,
  maxBytes: 1024 * 1024,
  unverified: UNVERIFIED,
} as const

/** Formats accepted when uploading a cover as permanent material. */
export const COVER_UPLOAD = {
  acceptedFormats: ['jpeg', 'png'] as const,
  maxBytes: 10 * 1024 * 1024,
  unverified: UNVERIFIED,
} as const

/** Source image formats the package will decode. */
export const ACCEPTED_SOURCE_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'svg'] as const

export type SourceImageFormat = (typeof ACCEPTED_SOURCE_FORMATS)[number]

/**
 * Bounds applied to local rasterization and normalization.
 *
 * These are our limits rather than the platform's, so they carry no
 * verification marker. They exist to stop a hostile or accidental
 * decompression bomb before it reaches the encoder.
 */
export const IMAGE_BOUNDS = {
  maxWidth: 1080,
  maxDecodedPixels: 40_000_000,
  maxSourceBytes: 20 * 1024 * 1024,
  /** Width used when rasterizing an SVG that declares no intrinsic size. */
  svgFallbackWidth: 1080,
} as const

/**
 * Link destinations WeChat still renders as clickable anchors.
 *
 * Open decision 7 has not been settled, so the safe default is an empty list:
 * every external link goes to the reference list. Widening this list is a
 * content-visible change and needs a rendering snapshot review.
 */
export const CLICKABLE_LINK_HOSTS: readonly string[] = []

/**
 * Version of the rendering contract.
 *
 * Participates in the content hash so a deliberate theme or renderer change is
 * detectable. Bump on any change to rendered HTML.
 */
export const RENDERER_VERSION = '1'

/**
 * Version of the content hash input set.
 *
 * Bump when the inputs listed in ADR-0002 change. In the current release this
 * only affects drift warnings; once the update path exists it will rewrite
 * every draft, so the release notes obligation grows with it.
 */
export const HASH_SCHEMA_VERSION = 1
