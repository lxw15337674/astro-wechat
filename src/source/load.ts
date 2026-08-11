import { readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import matter from 'gray-matter'
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

  const raw = await readFile(path, 'utf8')
  const parsed = matter(raw)

  return {
    absolutePath: path,
    projectRelativePath: normalizeRelativePath(relative(projectRoot, path)),
    frontmatter: parsed.data as Record<string, unknown>,
    body: parsed.content,
    format: 'md',
  }
}
