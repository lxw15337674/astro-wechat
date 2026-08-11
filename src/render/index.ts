import { dirname } from 'node:path'
import juice from 'juice'
import { CLICKABLE_LINK_HOSTS, CONTENT_LIMITS, HASH_SCHEMA_VERSION, RENDERER_VERSION } from '../constants.js'
import { RenderError, WarningCollector } from '../errors.js'
import type { ArticleDocument, RenderedArticle, ResolvedProject } from '../types.js'
import { identifyAsset } from '../assets/identity.js'
import { resolveAsset } from '../assets/resolve.js'
import { codePointLength } from '../util/text.js'
import { computeContentHash } from './hash.js'
import { rewriteImages } from './images.js'
import { rewriteOutboundLinks } from './links.js'
import { renderMarkdown } from './markdown.js'
import { sanitizeArticleHtml } from './sanitize.js'
import { ARTICLE_CLASS, getTheme } from './theme.js'

/**
 * Render one article to the pre-upload state.
 *
 * Performs no network I/O and no writes. Everything here must be reproducible
 * offline, because the content hash it produces is what later decides whether
 * any upload happens at all.
 */
export async function renderArticle(
  document: ArticleDocument,
  project: ResolvedProject,
  warnings: WarningCollector = new WarningCollector(),
): Promise<RenderedArticle> {
  const theme = getTheme(project.config.theme)

  // 1. Markdown to HTML.
  const parsed = renderMarkdown(document.body)

  // 2. Outbound links to numbered references, before the theme sees them so
  //    the generated reference list gets themed like the rest.
  const linked = rewriteOutboundLinks(parsed, {
    clickableHosts: CLICKABLE_LINK_HOSTS,
    referenceHeading: theme.referenceHeading,
  })

  // 3. Theme, and 4. inline it. WeChat drops <style>, so `juice` is not an
  //    optimization here; without it the article renders unstyled.
  const themed = `<style>${theme.css}</style><section class="${ARTICLE_CLASS}">${linked.html}</section>`
  const inlined = juice(themed)

  // 5. Sanitize.
  const clean = sanitizeArticleHtml(inlined)

  // 6. Images to content-hash placeholders, with responsive styles forced on.
  const withPlaceholders = await rewriteImages(clean, document, project, warnings)

  assertWithinContentLimits(withPlaceholders.html, document.source.absolutePath)

  const coverAsset = await identifyAsset(
    resolveAsset(
      document.cover,
      {
        markdownDir: dirname(document.source.absolutePath),
        projectRoot: project.root,
        allowAbsolute: project.config.allowAbsoluteAssetPaths,
        role: 'cover',
      },
      warnings,
    ),
  )

  const contentHash = computeContentHash({
    document,
    html: withPlaceholders.html,
    bodyAssets: withPlaceholders.assets,
    coverAsset,
    themeName: theme.name,
  })

  return {
    document,
    html: withPlaceholders.html,
    bodyAssets: withPlaceholders.assets,
    coverAsset,
    contentHash,
    hashSchemaVersion: HASH_SCHEMA_VERSION,
    rendererVersion: RENDERER_VERSION,
    warnings: warnings.warnings,
  }
}

/**
 * Check body size locally.
 *
 * Placeholders are longer than the WeChat URLs that replace them, so passing
 * here does not strictly guarantee the uploaded body fits. The margin is small
 * and in the safe direction: we reject slightly early rather than late.
 */
function assertWithinContentLimits(html: string, sourcePath: string): void {
  const characters = codePointLength(html)
  if (characters > CONTENT_LIMITS.maxCharacters) {
    throw new RenderError(
      `正文 HTML ${characters} 字符，超出微信上限 ${CONTENT_LIMITS.maxCharacters}。`,
      { code: 'content-too-long', sourcePath },
    )
  }

  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > CONTENT_LIMITS.maxBytes) {
    throw new RenderError(
      `正文 HTML ${bytes} 字节，超出微信上限 ${CONTENT_LIMITS.maxBytes}。`,
      { code: 'content-too-large', sourcePath },
    )
  }
}
