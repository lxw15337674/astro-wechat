import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProjectConfig, ResolvedProject } from '../types.js'
import { SourceValidationError } from '../errors.js'

export const DEFAULT_CONFIG: ProjectConfig = {
  contentDir: 'src/data/blog',
  permalinkPattern: '/posts/:slug/',
  theme: 'default',
  previewDir: '.astro-wechat/preview',
  // Outside the preview directory on purpose: previews are disposable and
  // usually gitignored, while the ledger must be committed.
  ledgerPath: '.astro-wechat/ledger.json',
  allowAbsoluteAssetPaths: false,
}

const CONFIG_FILE_NAMES = ['astro-wechat.config.mjs', 'astro-wechat.config.js', 'astro-wechat.config.json']

/**
 * Load project configuration from the Astro project root.
 *
 * Only ESM and JSON are supported. A TypeScript config would need a loader in
 * the CLI process, which conflicts with the requirement that the core run in a
 * clean Node process (technical design section 2.4).
 */
export async function loadProjectConfig(
  root: string,
  overrides: Partial<ProjectConfig> = {},
): Promise<ResolvedProject> {
  const fromFile = await readConfigFile(root)
  const config: ProjectConfig = { ...DEFAULT_CONFIG, ...fromFile, ...overrides }

  if (config.siteUrl !== undefined) assertAbsoluteHttpUrl(config.siteUrl)

  return { root, config }
}

async function readConfigFile(root: string): Promise<Partial<ProjectConfig>> {
  for (const name of CONFIG_FILE_NAMES) {
    const path = join(root, name)
    if (!existsSync(path)) continue

    if (name.endsWith('.json')) {
      const raw = await readFile(path, 'utf8')
      return JSON.parse(raw) as Partial<ProjectConfig>
    }

    const module_ = (await import(pathToFileURL(path).href)) as {
      default?: Partial<ProjectConfig>
    }
    if (!module_.default) {
      throw new SourceValidationError(`${name} 必须默认导出一个配置对象。`, {
        code: 'invalid-config-export',
        sourcePath: path,
      })
    }
    return module_.default
  }

  return {}
}

function assertAbsoluteHttpUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SourceValidationError(`siteUrl 必须是绝对 URL：${value}`, {
      code: 'invalid-site-url',
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceValidationError(`siteUrl 必须是 http 或 https：${value}`, {
      code: 'invalid-site-url',
    })
  }
}

/** Absolute path of the configured content directory. */
export function contentRoot(project: ResolvedProject): string {
  return resolve(project.root, project.config.contentDir)
}
