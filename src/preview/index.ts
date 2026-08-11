import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type { AssetIdentity, RenderedArticle, ResolvedProject } from '../types.js'
import { substitutePlaceholders } from '../render/images.js'
import { rasterizeSvg } from '../image/rasterize.js'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

/**
 * Build a standalone preview page.
 *
 * Local images are embedded as data URIs so the file can be moved, mailed, or
 * uploaded as a CI artifact and still render. That inflates the file, which is
 * acceptable for a review artifact and would not be for the published body.
 *
 * The preview shows placeholders resolved to local content, but the HTML that
 * gets hashed and published is the placeholder version. The preview is a view
 * of the article, not the artifact that ships.
 */
export async function renderPreviewPage(rendered: RenderedArticle): Promise<string> {
  const substitutions = new Map<string, string>()

  for (const asset of [...rendered.bodyAssets, rendered.coverAsset]) {
    substitutions.set(asset.placeholder, await previewSource(asset))
  }

  const body = substitutePlaceholders(rendered.html, substitutions)
  const cover = substitutions.get(rendered.coverAsset.placeholder) ?? ''
  const { title, author, digest } = rendered.document

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — 预览</title>
<style>
  body { margin: 0; background: #ebedef; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .frame { max-width: 414px; margin: 24px auto; background: #fff; padding: 20px 16px 48px; }
  .meta { border-bottom: 1px solid #e3e6e8; padding-bottom: 16px; margin-bottom: 8px; }
  .meta h1 { font-size: 22px; line-height: 1.4; margin: 0 0 12px; color: #1a1d1f; }
  .meta .byline { font-size: 13px; color: #8a9199; }
  .meta .digest { font-size: 13px; color: #6b7580; margin-top: 10px; }
  .meta img { max-width: 100%; display: block; margin-top: 14px; border-radius: 4px; }
  .note { max-width: 414px; margin: 0 auto 24px; font-size: 12px; color: #6b7580; line-height: 1.6; }
</style>
</head>
<body>
<div class="frame">
  <div class="meta">
    <h1>${escapeHtml(title)}</h1>
    <div class="byline">${escapeHtml(author ?? '未设置作者')}</div>
    <div class="digest">${escapeHtml(digest)}</div>
    ${cover ? `<img src="${cover}" alt="封面">` : ''}
  </div>
  ${body}
</div>
<p class="note">
  本地预览，宽度模拟手机阅读。图片为本地内容，发布时会替换为微信图片地址。
  内容哈希 ${rendered.contentHash.slice(0, 12)}。
</p>
</body>
</html>
`
}

/** Write the preview next to the project and return its path. */
export async function writePreview(
  rendered: RenderedArticle,
  project: ResolvedProject,
): Promise<string> {
  const directory = resolve(project.root, project.config.previewDir)
  await mkdir(directory, { recursive: true })

  const name = `${rendered.document.source.projectRelativePath.replace(/[\\/]/g, '_').replace(/\.md$/, '')}.html`
  const path = join(directory, name)

  await writeFile(path, await renderPreviewPage(rendered), 'utf8')
  return path
}

async function previewSource(asset: AssetIdentity): Promise<string> {
  const { reference } = asset

  if (reference.kind === 'remote' || reference.kind === 'wechat-hosted' || reference.kind === 'data-uri') {
    return reference.url ?? ''
  }

  const path = reference.localPath
  if (!path) return ''

  const extension = extname(path).toLowerCase()

  if (extension === '.svg') {
    const png = await rasterizeSvg(await readFile(path, 'utf8'))
    return `data:image/png;base64,${png.toString('base64')}`
  }

  const mime = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  const bytes = await readFile(path)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
