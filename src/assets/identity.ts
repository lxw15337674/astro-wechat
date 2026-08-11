import { readFile } from 'node:fs/promises'
import { AssetError } from '../errors.js'
import type { AssetIdentity, AssetReference } from '../types.js'
import { shortHash } from '../util/hash.js'

/**
 * Reserved TLD, so a placeholder that escapes into published HTML can never
 * resolve to a real host. A bare token would be simpler but would not survive
 * HTML tooling that validates URLs.
 */
const PLACEHOLDER_ORIGIN = 'https://asset.astro-wechat.invalid'

export function placeholderFor(contentHash: string): string {
  return `${PLACEHOLDER_ORIGIN}/${contentHash}`
}

export function isPlaceholder(url: string): boolean {
  return url.startsWith(`${PLACEHOLDER_ORIGIN}/`)
}

/**
 * Compute an asset's content identity.
 *
 * Local assets hash their bytes, so editing an image changes the article hash.
 * Remote assets hash their URL instead: downloading during rendering would make
 * a read-only command perform network I/O, and would make `preview` fail
 * offline. The tradeoff is that an upstream edit behind an unchanged URL is
 * invisible to drift detection, which is documented rather than hidden.
 */
export async function identifyAsset(reference: AssetReference): Promise<AssetIdentity> {
  const contentHash = await hashOf(reference)
  return { reference, contentHash, placeholder: placeholderFor(contentHash) }
}

async function hashOf(reference: AssetReference): Promise<string> {
  switch (reference.kind) {
    case 'local': {
      if (!reference.localPath) {
        throw new AssetError('本地资源缺少路径。', { code: 'asset-missing-path' })
      }
      return shortHash(await readFile(reference.localPath))
    }
    case 'data-uri': {
      return shortHash(reference.url ?? '')
    }
    case 'remote':
    case 'wechat-hosted': {
      return shortHash(`url:${reference.url ?? ''}`)
    }
  }
}
