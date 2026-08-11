import { readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { SourceValidationError } from '../errors.js'
import type { SourceArticle } from '../types.js'
import { normalizeRelativePath } from '../util/text.js'

/**
 * Read one Markdown file into a `SourceArticle`.
 *
 * Parses the file directly rather than going through `astro:content`, so the
 * CLI works in a clean Node process (technical design section 2.4).
 */
export async function loadSourceArticle(
  absolutePath: string,
  projectRoot: string,
): Promise<SourceArticle> {
  const path = resolve(absolutePath)
  const extension = extname(path).toLowerCase()

  if (extension === '.mdx') {
    throw new SourceValidationError(
      'MDX 在首个版本不受支持：它需要执行组件，而渲染必须是确定性的纯转换。',
      { code: 'mdx-unsupported', sourcePath: path },
    )
  }

  if (extension !== '.md') {
    throw new SourceValidationError(`只支持 .md 文件，收到 ${extension || '无扩展名'}。`, {
      code: 'unsupported-extension',
      sourcePath: path,
    })
  }

  const { frontmatter, body } = parseFrontmatter(await readFile(path, 'utf8'), path)

  return {
    absolutePath: path,
    projectRelativePath: normalizeRelativePath(relative(projectRoot, path)),
    frontmatter,
    body,
    format: 'md',
  }
}

function parseFrontmatter(raw: string, sourcePath: string): {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
} {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(raw)
  if (!opening) return { frontmatter: {}, body: raw }

  const closing = /^---[ \t]*\r?$/gm
  closing.lastIndex = opening[0].length
  const match = closing.exec(raw)
  if (!match) {
    throw new SourceValidationError('frontmatter 缺少结束分隔符 ---。', {
      code: 'frontmatter-unclosed',
      sourcePath,
    })
  }

  const document = parseDocument(raw.slice(opening[0].length, match.index))
  if (document.errors.length > 0) {
    const detail = document.errors.map(error => error.message).join('; ')
    throw new SourceValidationError(`无法解析 YAML frontmatter：${detail}`, {
      code: 'frontmatter-invalid',
      sourcePath,
    })
  }

  const value = document.toJS()
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new SourceValidationError('frontmatter 必须是 YAML 对象。', {
      code: 'frontmatter-not-object',
      sourcePath,
    })
  }

  const bodyStart = match.index + match[0].length
  const body = raw.slice(bodyStart).replace(/^\r?\n/, '')
  return { frontmatter: (value ?? {}) as Record<string, unknown>, body }
}
