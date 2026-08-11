import { AssetError } from '../errors.js'
import { IMAGE_BOUNDS } from '../constants.js'

/**
 * Patterns that make an SVG unsafe to hand to any parser.
 *
 * `resvg` does not resolve external entities or execute scripts, so this is a
 * second line rather than the only one. It exists because the same bytes may
 * later reach a different tool — a browser opening the preview file, for
 * instance — where the guarantees are weaker.
 */
const UNSAFE_SVG_PATTERNS: readonly [RegExp, string][] = [
  [/<!DOCTYPE/i, 'DOCTYPE 声明'],
  [/<!ENTITY/i, '实体声明'],
  [/<script[\s>]/i, '脚本标签'],
  [/\son\w+\s*=/i, '事件处理属性'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i, '远程引用'],
]

export function assertSafeSvg(svg: string): void {
  for (const [pattern, description] of UNSAFE_SVG_PATTERNS) {
    if (pattern.test(svg)) {
      throw new AssetError(`SVG 含${description}，拒绝处理。`, { code: 'unsafe-svg' })
    }
  }
}

/**
 * Rasterize an SVG locally.
 *
 * SVG is never uploaded and never inlined into article HTML (technical design
 * section 5.6). `@resvg/resvg-js` is used rather than `sharp` because it has no
 * network access and no script engine at all, which is stronger than disabling
 * those features on a library that has them.
 *
 * Imported lazily so commands that touch no SVG do not pay for loading a native
 * module, and so a missing optional binary fails at the point of use with a
 * useful message.
 */
export async function rasterizeSvg(svg: string, width = IMAGE_BOUNDS.svgFallbackWidth): Promise<Buffer> {
  assertSafeSvg(svg)

  let Resvg: typeof import('@resvg/resvg-js').Resvg
  try {
    ;({ Resvg } = await import('@resvg/resvg-js'))
  } catch (cause) {
    throw new AssetError(
      '需要 @resvg/resvg-js 来栅格化 SVG，但它不可用。安装它，或改用非 SVG 封面。',
      { code: 'rasterizer-unavailable', cause },
    )
  }

  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.min(width, IMAGE_BOUNDS.maxWidth) },
    // No filesystem or network resolution: a font or image the SVG references
    // must not become an I/O path triggered by article content.
    background: 'white',
  })

  return Buffer.from(renderer.render().asPng())
}
