import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadProjectConfig } from '../../src/project/config.js'
import type { ProjectConfig, ResolvedProject } from '../../src/types.js'

/** 1x1 transparent PNG, small enough to inline and still a real decodable image. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export interface FixtureProject {
  readonly root: string
  /** Write a text file at a project-relative path, creating parents. */
  write(relativePath: string, contents: string): string
  /** Write a binary file from base64. */
  writeBinary(relativePath: string, base64: string): string
  resolved(overrides?: Partial<ProjectConfig>): Promise<ResolvedProject>
  cleanup(): void
}

/**
 * Build a throwaway Astro project on disk.
 *
 * Fixtures live in a temp directory rather than in the repository because
 * several tests need binary images and directory layouts that are tedious to
 * review as committed files.
 */
export function createFixtureProject(): FixtureProject {
  const root = mkdtempSync(join(tmpdir(), 'astro-wechat-'))

  const write = (relativePath: string, contents: string): string => {
    const path = join(root, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents, 'utf8')
    return path
  }

  const writeBinary = (relativePath: string, base64: string): string => {
    const path = join(root, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(base64, 'base64'))
    return path
  }

  write('package.json', JSON.stringify({ name: 'fixture', type: 'module' }))
  write('astro.config.mjs', 'export default {}\n')

  return {
    root,
    write,
    writeBinary,
    resolved: (overrides = {}) => loadProjectConfig(root, overrides),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

export interface PostOptions {
  readonly slug?: string
  readonly frontmatter?: Record<string, unknown>
  readonly body?: string
}

/** Write a Markdown post with YAML frontmatter into the content directory. */
export function writePost(project: FixtureProject, options: PostOptions = {}): string {
  const slug = options.slug ?? 'sample-post'
  const frontmatter = {
    title: '示例文章',
    description: '一段描述。',
    author: '作者',
    ogImage: '/images/cover.png',
    draft: false,
    tags: ['tech'],
    wechat: { enabled: true },
    ...options.frontmatter,
  }

  const yaml = toYaml(frontmatter)
  const body = options.body ?? '正文段落。\n'

  return project.write(`src/data/blog/${slug}.md`, `---\n${yaml}---\n\n${body}`)
}

/**
 * Minimal YAML writer for fixture frontmatter.
 *
 * Only covers the shapes these tests use. Pulling in a YAML dependency for test
 * fixtures would make the fixtures harder to read than the thing they test.
 */
function toYaml(value: Record<string, unknown>, indent = ''): string {
  let out = ''

  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue

    if (Array.isArray(item)) {
      out += `${indent}${key}:\n`
      for (const entry of item) out += `${indent}  - ${scalar(entry)}\n`
    } else if (item !== null && typeof item === 'object') {
      out += `${indent}${key}:\n${toYaml(item as Record<string, unknown>, `${indent}  `)}`
    } else {
      out += `${indent}${key}: ${scalar(item)}\n`
    }
  }

  return out
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}
