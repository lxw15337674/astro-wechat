import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { WarningCollector, type Warning } from './errors.js'
import { checkEligibility } from './eligibility.js'
import { contentRoot, loadProjectConfig } from './project/config.js'
import { discoverProjectRoot } from './project/discover.js'
import { renderArticle } from './render/index.js'
import { toArticleDocument, type AdapterOverrides } from './source/adapter.js'
import { loadSourceArticle } from './source/load.js'
import {
  synchronizeArticle,
  type SynchronizeDeps,
  type SynchronizeOptions,
} from './sync/synchronize.js'
import type {
  ArticleDocument,
  ArticleResult,
  ProjectConfig,
  RenderedArticle,
  ResolvedProject,
  SkipReason,
} from './types.js'

export interface OpenProjectOptions {
  readonly root?: string
  readonly configOverrides?: Partial<ProjectConfig>
}

/** Resolve the project once so every command shares one configuration. */
export async function openProject(
  startFrom: string,
  options: OpenProjectOptions = {},
): Promise<ResolvedProject> {
  const root = discoverProjectRoot(startFrom, options.root)
  return loadProjectConfig(root, options.configOverrides ?? {})
}

export interface ArticleInspection {
  readonly document: ArticleDocument
  readonly skipReason: SkipReason | undefined
  readonly warnings: readonly Warning[]
}

/**
 * Load and normalize one article without rendering it.
 *
 * Cheap enough to run across a whole content directory, which is what `list`
 * does. Rendering is deliberately excluded: it resolves and hashes every image.
 */
export async function inspectArticle(
  absolutePath: string,
  project: ResolvedProject,
  overrides: AdapterOverrides = {},
): Promise<ArticleInspection> {
  const warnings = new WarningCollector()
  const source = await loadSourceArticle(absolutePath, project.root)
  const document = toArticleDocument(source, project, warnings, overrides)

  return {
    document,
    skipReason: checkEligibility(document, project.config),
    warnings: warnings.warnings,
  }
}

/**
 * Produce the pre-upload rendered article.
 *
 * This is everything the create decision needs, and it performs no network I/O
 * and no writes. Milestone 2 adds upload on top of this output rather than
 * changing it.
 */
export async function prepareArticle(
  absolutePath: string,
  project: ResolvedProject,
  overrides: AdapterOverrides = {},
): Promise<RenderedArticle> {
  const warnings = new WarningCollector()
  const source = await loadSourceArticle(absolutePath, project.root)
  const document = toArticleDocument(source, project, warnings, overrides)
  return renderArticle(document, project, warnings)
}

export interface PublishOptions extends SynchronizeOptions {
  /** Publish even though the source is marked as a draft. */
  readonly allowDraft?: boolean
}

/**
 * Render and synchronize one article.
 *
 * Eligibility is checked before rendering: an article that will not be
 * published should not pay for asset resolution and hashing, and more
 * importantly must not reach any code path that writes.
 */
export async function publishArticle(
  absolutePath: string,
  project: ResolvedProject,
  deps: SynchronizeDeps,
  options: PublishOptions = {},
): Promise<ArticleResult> {
  const warnings = new WarningCollector()
  const source = await loadSourceArticle(absolutePath, project.root)
  const document = toArticleDocument(source, project, warnings)

  const skipReason = checkEligibility(document, project.config)
  const ignorable = options.allowDraft && skipReason === 'source-is-draft'

  if (skipReason && !ignorable) {
    return {
      sourcePath: document.source.projectRelativePath,
      sourceId: document.sourceId,
      title: document.title,
      status: 'skipped',
      skipReason,
      warnings: warnings.warnings,
    }
  }

  const rendered = await renderArticle(document, project, warnings)
  return synchronizeArticle(rendered, deps, options)
}

/** Every Markdown file under the configured content directory. */
export async function listArticleFiles(project: ResolvedProject): Promise<string[]> {
  const root = contentRoot(project)
  const found: string[] = []

  async function walk(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(path)
      }
    }
  }

  await walk(resolve(root))
  return found.sort()
}
