import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { BODY_IMAGE_UPLOAD, COVER_UPLOAD, IMAGE_BOUNDS } from '../constants.js'
import { AssetError, type WarningCollector } from '../errors.js'
import type { AssetIdentity, AssetRole } from '../types.js'
import { rasterizeSvg } from './rasterize.js'

export interface NormalizedImage {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly filename: string
}

/** Formats the target endpoint accepts, by role. */
function limitsFor(role: AssetRole) {
  return role === 'cover' ? COVER_UPLOAD : BODY_IMAGE_UPLOAD
}

/**
 * Decide the output encoding.
 *
 * The endpoint's accepted list is narrower than the set of sources we read, so
 * this is a conversion decision, never a passthrough one. Alpha decides between
 * the two acceptable outputs: JPEG would flatten transparency onto whatever
 * background we picked, which is visible and wrong on a white article page.
 */
export function chooseOutputFormat(hasAlpha: boolean): 'png' | 'jpeg' {
  return hasAlpha ? 'png' : 'jpeg'
}

export function contentTypeFor(format: 'png' | 'jpeg'): string {
  return format === 'png' ? 'image/png' : 'image/jpeg'
}

/**
 * Quality ladder used to fit an image under the byte limit.
 *
 * Tried in order before falling back to downscaling, because losing a little
 * fidelity reads better than losing resolution on a phone screen.
 */
const QUALITY_LADDER = [82, 70, 58, 45] as const

/**
 * Normalize a resolved asset for upload.
 *
 * Decodes rather than trusting the extension: a `.png` that is actually an HTML
 * error page must fail here, not at WeChat. `sharp` is imported lazily so that
 * commands which never upload do not pay for a native module.
 */
export async function normalizeImage(
  asset: AssetIdentity,
  warnings: WarningCollector,
): Promise<NormalizedImage> {
  const source = await readSourceBytes(asset)
  const role = asset.reference.role
  const limits = limitsFor(role)

  const sharp = await loadSharp()
  const pipeline = sharp(source, { limitInputPixels: IMAGE_BOUNDS.maxDecodedPixels })

  let metadata
  try {
    metadata = await pipeline.metadata()
  } catch (cause) {
    throw new AssetError(`无法解码图片：${describe(asset)}`, { code: 'image-undecodable', cause })
  }

  if (!metadata.format) {
    throw new AssetError(`无法识别图片格式：${describe(asset)}`, { code: 'image-unknown-format' })
  }

  if (metadata.pages && metadata.pages > 1) {
    warnings.add({
      code: 'animation-dropped',
      message: `${describe(asset)} 是动图，微信正文图片不支持动画，已保留第一帧。`,
    })
  }

  const preferred = chooseOutputFormat(metadata.hasAlpha === true)
  const maxWidth = Math.min(IMAGE_BOUNDS.maxWidth, metadata.width ?? IMAGE_BOUNDS.maxWidth)

  const encoded = await encodeWithinLimit(sharp, source, {
    preferred,
    width: maxWidth,
    maxBytes: limits.maxBytes,
  })

  if (encoded.format !== preferred) {
    warnings.add({
      code: 'transparency-flattened',
      message: `${describe(asset)} 体积超限，已铺白底转为 JPEG。若封面依赖透明效果，请手动压缩后再用。`,
    })
  }

  return {
    bytes: encoded.bytes,
    contentType: contentTypeFor(encoded.format),
    filename: `${asset.contentHash}.${encoded.format === 'png' ? 'png' : 'jpg'}`,
  }
}

interface EncodeOptions {
  readonly preferred: 'png' | 'jpeg'
  readonly width: number
  readonly maxBytes: number
}

interface EncodedImage {
  readonly bytes: Uint8Array
  readonly format: 'png' | 'jpeg'
}

const MIN_WIDTH = 200
const SCALE_STEPS = 4

/**
 * Encode within the byte limit, degrading in the order that costs least.
 *
 * Exceeding the limit is rejected by WeChat only after the upload has spent
 * bandwidth and quota, so several local attempts are worth it.
 *
 * Order matters. For JPEG, quality drops before resolution: a slightly softer
 * image reads better on a phone than a smaller one. For PNG the quality ladder
 * does nothing, so it goes straight to downscaling — and if even the smallest
 * size does not fit, it falls back to JPEG rather than failing.
 *
 * That fallback exists because "has an alpha channel" and "actually uses
 * transparency" are different things, and plenty of opaque PNGs carry one. A
 * large opaque PNG would otherwise fail the whole article for a reason the
 * author cannot see in their image.
 */
async function encodeWithinLimit(
  sharp: SharpModule,
  source: Uint8Array,
  options: EncodeOptions,
): Promise<EncodedImage> {
  const formats: ('png' | 'jpeg')[] = options.preferred === 'png' ? ['png', 'jpeg'] : ['jpeg']

  for (const format of formats) {
    let width = options.width

    for (let step = 0; step < SCALE_STEPS; step += 1) {
      for (const quality of QUALITY_LADDER) {
        const pipeline = sharp(source, { limitInputPixels: IMAGE_BOUNDS.maxDecodedPixels }).resize({
          width,
          withoutEnlargement: true,
        })

        const encoded =
          format === 'png'
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
            : await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer()

        if (encoded.byteLength <= options.maxBytes) {
          return { bytes: new Uint8Array(encoded), format }
        }

        // PNG ignores the quality ladder, so repeating it at the same width
        // would just re-encode identical bytes.
        if (format === 'png') break
      }

      width = Math.floor(width * 0.75)
      if (width < MIN_WIDTH) break
    }
  }

  throw new AssetError(
    `图片压缩到 ${MIN_WIDTH}px 宽仍超过 ${options.maxBytes} 字节上限。请手动处理这张图。`,
    { code: 'image-too-large' },
  )
}

async function readSourceBytes(asset: AssetIdentity): Promise<Uint8Array> {
  const { reference } = asset

  if (reference.kind === 'data-uri') {
    const value = reference.url ?? ''
    const bytes = decodeDataUri(value)

    // An inline `image/svg+xml` would otherwise reach sharp and be rasterized
    // through librsvg, skipping the entity and remote-reference checks. Every
    // path that turns SVG into pixels has to go through the hardened one.
    if (isSvgDataUri(value)) {
      return new Uint8Array(await rasterizeSvg(Buffer.from(bytes).toString('utf8')))
    }

    return bytes
  }

  if (reference.kind === 'remote') {
    throw new AssetError(
      `远程图片需要先下载：${reference.url}。里程碑 2 暂不实现远程下载。`,
      { code: 'remote-download-unimplemented' },
    )
  }

  if (reference.kind === 'wechat-hosted') {
    throw new AssetError('已托管在微信的图片不需要重新上传。', { code: 'already-hosted' })
  }

  const path = reference.localPath
  if (!path) throw new AssetError('本地资源缺少路径。', { code: 'asset-missing-path' })

  const bytes = await readFile(path)
  if (bytes.byteLength > IMAGE_BOUNDS.maxSourceBytes) {
    throw new AssetError(`源图片超过 ${IMAGE_BOUNDS.maxSourceBytes} 字节上限：${path}`, {
      code: 'source-image-too-large',
    })
  }

  // SVG never reaches sharp: rasterizing it here keeps external entity and
  // script handling in the one place that was hardened for it.
  if (extname(path).toLowerCase() === '.svg') {
    return new Uint8Array(await rasterizeSvg(bytes.toString('utf8')))
  }

  return new Uint8Array(bytes)
}

export function isSvgDataUri(value: string): boolean {
  return /^data:image\/svg\+xml[;,]/i.test(value)
}

export function decodeDataUri(value: string): Uint8Array {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value)
  if (!match) throw new AssetError('data URI 格式无效。', { code: 'invalid-data-uri' })

  const [, mime, isBase64, payload = ''] = match
  if (!mime?.startsWith('image/')) {
    throw new AssetError(`data URI 不是图片：${mime}`, { code: 'data-uri-not-image' })
  }

  return isBase64
    ? new Uint8Array(Buffer.from(payload, 'base64'))
    : new Uint8Array(Buffer.from(decodeURIComponent(payload), 'utf8'))
}

function describe(asset: AssetIdentity): string {
  return asset.reference.localPath ?? asset.reference.url ?? asset.reference.original
}

/**
 * Structural description of the slice of `sharp` this module uses.
 *
 * Declared here rather than derived from `typeof import('sharp')` because sharp
 * is an optional dependency: a type query would make `typecheck` fail on any
 * machine where the native module could not be installed, even though the code
 * is designed to run fine without it.
 */
interface SharpInstance {
  metadata(): Promise<{
    format?: string
    width?: number
    hasAlpha?: boolean
    pages?: number
  }>
  resize(options: { width: number; withoutEnlargement: boolean }): SharpInstance
  flatten(options: { background: string }): SharpInstance
  png(options: { compressionLevel: number }): SharpInstance
  jpeg(options: { quality: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

type SharpModule = (input: Uint8Array, options: { limitInputPixels: number }) => SharpInstance

async function loadSharp(): Promise<SharpModule> {
  // Non-literal specifier so TypeScript does not try to resolve the module at
  // build time. The failure mode we want is a clear runtime error at the point
  // of use, not a type error for people who never publish images.
  const specifier = 'sharp'

  try {
    const module_ = (await import(specifier)) as { default: SharpModule }
    return module_.default
  } catch (cause) {
    throw new AssetError('需要 sharp 来规范化图片，但它不可用。请安装 sharp。', {
      code: 'sharp-unavailable',
      cause,
    })
  }
}
