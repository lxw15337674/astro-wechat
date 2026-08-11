import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AssetError, type WarningCollector } from '../errors.js'
import type { AssetReference, AssetRole } from '../types.js'

export interface ResolveAssetOptions {
  /** Directory of the Markdown file the reference appeared in. */
  readonly markdownDir: string
  readonly projectRoot: string
  readonly allowAbsolute: boolean
  readonly role: AssetRole
  readonly alt?: string
}

const WECHAT_HOSTS = new Set(['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'mp.weixin.qq.com'])

/**
 * Resolve an asset reference without running an Astro build.
 *
 * Astro resolves `public/` and site-root paths at build time. Reproducing the
 * subset we need keeps the CLI usable in a clean Node process, at the cost of
 * having to recognize each form explicitly.
 */
export function resolveAsset(
  original: string,
  options: ResolveAssetOptions,
  warnings: WarningCollector,
): AssetReference {
  const value = original.trim()
  const base = { original, role: options.role, alt: options.alt }

  if (value.startsWith('data:')) {
    if (!value.startsWith('data:image/')) {
      throw new AssetError(`data URI 不是图片：${value.slice(0, 32)}…`, {
        code: 'data-uri-not-image',
      })
    }
    return { ...base, kind: 'data-uri', url: value }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return resolveUrl(value, base)
  }

  if (value.startsWith('/')) {
    return localReference(base, publicPath(options.projectRoot, value.slice(1)), options)
  }

  if (isAbsolute(value)) {
    if (!options.allowAbsolute) {
      throw new AssetError(
        `拒绝绝对文件系统路径：${value}。需要时在配置中开启 allowAbsoluteAssetPaths。`,
        { code: 'absolute-path-not-allowed' },
      )
    }
    return { ...base, kind: 'local', localPath: value }
  }

  const relativeCandidate = resolve(options.markdownDir, value)
  if (existsSync(relativeCandidate)) {
    return localReference(base, relativeCandidate, options)
  }

  const fromPublic = publicSuffixFallback(options.projectRoot, value)
  if (fromPublic) {
    warnings.add({
      code: 'ambiguous-public-path',
      message: `资源路径 ${value} 相对 Markdown 文件不存在，已按 public/ 后缀从项目根解析为 ${fromPublic}。建议改为站点根路径写法。`,
    })
    return localReference(base, fromPublic, options)
  }

  throw new AssetError(`无法解析资源路径：${value}`, { code: 'asset-not-found' })
}

function resolveUrl(value: string, base: Omit<AssetReference, 'kind'>): AssetReference {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AssetError(`资源 URL 无效：${value}`, { code: 'invalid-asset-url' })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AssetError(`拒绝非 HTTP 协议的资源：${url.protocol}`, {
      code: 'unsupported-asset-protocol',
    })
  }

  const kind = WECHAT_HOSTS.has(url.hostname) ? 'wechat-hosted' : 'remote'
  return { ...base, kind, url: url.href }
}

function publicPath(projectRoot: string, relativePath: string): string {
  return join(projectRoot, 'public', relativePath)
}

/**
 * Recover a `public/` path buried under extra parent segments.
 *
 * Some AstroPaper posts write `../../../public/images/x.png`, where the number
 * of parent segments does not match the file's actual depth. Taking everything
 * after the last `public/` and resolving from the project root fixes those
 * without guessing about ordinary relative paths, which are tried first.
 */
function publicSuffixFallback(projectRoot: string, value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/')
  const marker = normalized.lastIndexOf('public/')
  if (marker === -1) return undefined

  const candidate = publicPath(projectRoot, normalized.slice(marker + 'public/'.length))
  return existsSync(candidate) ? candidate : undefined
}

function localReference(
  base: Omit<AssetReference, 'kind'>,
  path: string,
  options: ResolveAssetOptions,
): AssetReference {
  if (!existsSync(path)) {
    throw new AssetError(`资源文件不存在：${path}`, { code: 'asset-not-found' })
  }
  if (!options.allowAbsolute) assertInsideRoot(path, options.projectRoot)
  return { ...base, kind: 'local', localPath: path }
}

/**
 * Refuse to read outside the project.
 *
 * A `../` chain in frontmatter would otherwise let an article pull an arbitrary
 * file from the machine into a published draft.
 */
function assertInsideRoot(path: string, projectRoot: string): void {
  const rel = relative(projectRoot, path)
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new AssetError(`资源路径逃逸出项目根目录：${path}`, { code: 'asset-outside-project' })
  }
}
