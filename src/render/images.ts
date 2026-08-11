import { dirname } from 'node:path'
import * as cheerio from 'cheerio'
import type { WarningCollector } from '../errors.js'
import type { AssetIdentity, ArticleDocument, ResolvedProject } from '../types.js'
import { identifyAsset } from '../assets/identity.js'
import { resolveAsset } from '../assets/resolve.js'

export interface ImageRewriteResult {
  readonly html: string
  /** Body assets in document order, deduplicated by original reference. */
  readonly assets: readonly AssetIdentity[]
}

/**
 * Styles forced onto every body image.
 *
 * WeChat renders at a fixed content width on phones; an image without these
 * overflows horizontally. Appended after any theme declarations so they win.
 */
const RESPONSIVE_STYLE = 'max-width:100%;height:auto;display:block;margin:1.2em auto;'

/**
 * Replace image sources with content-hash placeholders.
 *
 * Placeholders are what make the pre-upload content hash well defined: the HTML
 * that gets hashed contains no uploaded URL, so hashing does not require
 * uploading (ADR-0002).
 *
 * Uses an HTML parser rather than a regular expression, per technical design
 * section 5.5, so raw HTML images travel the same path as Markdown ones.
 */
export async function rewriteImages(
  html: string,
  document: ArticleDocument,
  project: ResolvedProject,
  warnings: WarningCollector,
): Promise<ImageRewriteResult> {
  const $ = cheerio.load(html, null, false)
  const markdownDir = dirname(document.source.absolutePath)

  const identities = new Map<string, AssetIdentity>()

  for (const element of $('img[src]').toArray()) {
    const image = $(element)
    const original = (image.attr('src') ?? '').trim()
    if (original === '') continue

    let identity = identities.get(original)
    if (!identity) {
      const reference = resolveAsset(
        original,
        {
          markdownDir,
          projectRoot: project.root,
          allowAbsolute: project.config.allowAbsoluteAssetPaths,
          role: 'body',
          alt: image.attr('alt'),
        },
        warnings,
      )
      identity = await identifyAsset(reference)
      identities.set(original, identity)
    }

    image.attr('src', identity.placeholder)
    image.attr('style', `${image.attr('style') ?? ''}${RESPONSIVE_STYLE}`)

    // Dimensions from the source would fight the responsive style once WeChat
    // scales the image to its own content width.
    image.removeAttr('width')
    image.removeAttr('height')
  }

  return { html: $.html(), assets: [...identities.values()] }
}

/**
 * Substitute real URLs for placeholders after upload.
 *
 * Kept next to the placeholder pass so both use the same parser, and so it is
 * obvious that this step must not change anything else about the markup — the
 * content hash was computed before it ran.
 */
export function substitutePlaceholders(
  html: string,
  urlByPlaceholder: ReadonlyMap<string, string>,
): string {
  const $ = cheerio.load(html, null, false)

  for (const element of $('img[src]').toArray()) {
    const image = $(element)
    const placeholder = image.attr('src') ?? ''
    const url = urlByPlaceholder.get(placeholder)
    if (url) image.attr('src', url)
  }

  return $.html()
}
