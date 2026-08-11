import { basename, extname } from 'node:path'
import { SourceValidationError, type WarningCollector } from '../errors.js'
import type { ArticleDocument, ResolvedProject, SourceArticle, WechatFrontmatter } from '../types.js'
import { stripMarkdown } from '../util/text.js'
import { assertWithinLimit, fitDigest } from './validate.js'

export interface AdapterOverrides {
  readonly title?: string
  readonly cover?: string
}

/** Map a parsed source file onto the normalized article. */
export function toArticleDocument(
  source: SourceArticle,
  project: ResolvedProject,
  warnings: WarningCollector,
  overrides: AdapterOverrides = {},
): ArticleDocument {
  const frontmatter = source.frontmatter
  const wechat = readWechat(frontmatter.wechat)
  const sourcePath = source.absolutePath

  const firstHeading = findFirstH1(source.body)
  const title = firstDefined(
    overrides.title,
    wechat.title,
    asString(frontmatter.title),
    firstHeading?.text,
  )

  if (!title) {
    throw new SourceValidationError(
      '无法确定标题：frontmatter 没有 title，正文也没有 H1。',
      { code: 'title-missing', sourcePath },
    )
  }
  assertWithinLimit('title', title, sourcePath)

  const cover = firstDefined(
    overrides.cover,
    wechat.cover,
    readImageField(frontmatter.ogImage),
    project.config.defaultCover,
  )

  if (!cover) {
    throw new SourceValidationError(
      '无法确定封面：frontmatter 没有 ogImage，配置也没有 defaultCover。微信草稿必须有封面。',
      { code: 'cover-missing', sourcePath },
    )
  }

  const author = firstDefined(wechat.author, asString(frontmatter.author), project.config.defaultAuthor)
  if (author) assertWithinLimit('author', author, sourcePath)

  const body = stripLeadingTitleHeading(source.body, firstHeading, title)

  const rawDigest = firstDefined(
    wechat.digest,
    asString(frontmatter.description),
    stripMarkdown(body).slice(0, 400),
  )
  const digest = fitDigest(rawDigest ?? '', warnings, sourcePath)

  const canonicalUrl = resolveCanonicalUrl(source, project, wechat, frontmatter)

  if (!canonicalUrl) {
    warnings.add({
      code: 'no-canonical-url',
      message:
        '这篇文章没有 canonical URL，草稿身份将无法从微信侧恢复。配置 siteUrl，或显式设置 canonicalURL / wechat.sourceURL。',
      sourcePath,
    })
  }

  return {
    sourceId: canonicalUrl ?? source.projectRelativePath,
    canonicalUrl,
    title,
    body,
    author,
    digest,
    cover,
    draft: frontmatter.draft === true,
    tags: readTags(frontmatter.tags),
    wechat,
    source,
  }
}

interface Heading {
  readonly text: string
  readonly line: number
}

/**
 * First ATX H1 in the body.
 *
 * Setext headings are not recognized. AstroPaper posts do not use them, and
 * accepting both would make the "is this line the title?" check ambiguous for
 * the removal step below.
 */
export function findFirstH1(body: string): Heading | undefined {
  const lines = body.split(/\r?\n/)
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) return { text: stripMarkdown(match[1] ?? '').trim(), line: i }
  }

  return undefined
}

/**
 * Drop a leading H1 that merely repeats the title.
 *
 * WeChat renders the title above the body, so keeping the heading shows it
 * twice. Only an exact match is removed: a different H1 is real content.
 */
function stripLeadingTitleHeading(
  body: string,
  heading: Heading | undefined,
  title: string,
): string {
  if (!heading || heading.text !== title.trim()) return body

  const lines = body.split(/\r?\n/)
  lines.splice(heading.line, 1)
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
  return lines.join('\n')
}

function resolveCanonicalUrl(
  source: SourceArticle,
  project: ResolvedProject,
  wechat: WechatFrontmatter,
  frontmatter: Readonly<Record<string, unknown>>,
): string | undefined {
  const explicit = firstDefined(wechat.sourceURL, asString(frontmatter.canonicalURL))
  if (explicit) return explicit

  const { siteUrl, permalinkPattern } = project.config
  if (!siteUrl) return undefined

  const slug = firstDefined(asString(frontmatter.slug), basename(source.absolutePath, extname(source.absolutePath)))
  if (!slug) return undefined

  const path = permalinkPattern.replace(':slug', encodeURIComponent(slug))
  return new URL(path, siteUrl).href
}

function readWechat(value: unknown): WechatFrontmatter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>

  return {
    enabled: raw.enabled === true,
    title: asString(raw.title),
    cover: asString(raw.cover),
    author: asString(raw.author),
    digest: asString(raw.digest),
    sourceURL: asString(raw.sourceURL),
  }
}

/**
 * Read an image-valued frontmatter field.
 *
 * Astro's `image()` schema helper turns a path into an object, so `ogImage` is
 * a string in some posts and an object in others. Both shapes appear in the
 * same repository.
 */
function readImageField(value: unknown): string | undefined {
  const direct = asString(value)
  if (direct) return direct

  if (value && typeof value === 'object' && 'src' in value) {
    return asString((value as { src: unknown }).src)
  }

  return undefined
}

function readTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function firstDefined(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value
  }
  return undefined
}
