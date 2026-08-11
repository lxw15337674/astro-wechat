import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { SourceValidationError } from '../errors.js'

const ASTRO_CONFIG_NAMES = [
  'astro.config.mjs',
  'astro.config.js',
  'astro.config.ts',
  'astro.config.mts',
  'astro.config.cjs',
]

/** Whether a directory looks like the root of an Astro project. */
export function isProjectRoot(dir: string): boolean {
  if (!existsSync(join(dir, 'package.json'))) return false
  return ASTRO_CONFIG_NAMES.some((name) => existsSync(join(dir, name)))
}

/**
 * Find the Astro project root by walking upward from a file.
 *
 * Deliberately does not consult `process.cwd()`. The CLI is invoked from CI
 * working directories and from editors, so the current directory says nothing
 * reliable about which project a given article belongs to.
 */
export function discoverProjectRoot(startFrom: string, explicitRoot?: string): string {
  if (explicitRoot) {
    const root = resolve(explicitRoot)
    if (!isProjectRoot(root)) {
      throw new SourceValidationError(
        `指定的项目根目录不像 Astro 项目（缺少 package.json 或 astro 配置）：${root}`,
        { code: 'invalid-project-root' },
      )
    }
    return root
  }

  const absolute = isAbsolute(startFrom) ? startFrom : resolve(startFrom)
  let dir = existsSync(absolute) && isDirectory(absolute) ? absolute : dirname(absolute)
  const { root: filesystemRoot } = parse(dir)

  while (true) {
    if (isProjectRoot(dir)) return dir
    if (dir === filesystemRoot) break
    dir = dirname(dir)
  }

  throw new SourceValidationError(
    `从 ${startFrom} 向上未找到 Astro 项目根目录。使用 --root 显式指定。`,
    { code: 'project-root-not-found', sourcePath: startFrom },
  )
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
