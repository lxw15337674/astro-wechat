import { describe, expect, it } from 'vitest'
import {
  chooseOutputFormat,
  contentTypeFor,
  decodeDataUri,
  isSvgDataUri,
} from '../src/image/normalize.js'
import { TINY_PNG_BASE64 } from './helpers/project.js'

/**
 * Covers the parts of image normalization that need no native module, so this
 * file runs everywhere. The encoding ladder itself is exercised only when
 * `sharp` is installed.
 */
describe('输出格式选择', () => {
  it('有 alpha 通道时用 PNG，避免透明区域被铺成实色', () => {
    expect(chooseOutputFormat(true)).toBe('png')
  })

  it('没有 alpha 时用 JPEG', () => {
    expect(chooseOutputFormat(false)).toBe('jpeg')
  })

  it('格式与 MIME 一一对应', () => {
    expect(contentTypeFor('png')).toBe('image/png')
    expect(contentTypeFor('jpeg')).toBe('image/jpeg')
  })
})

describe('data URI 解码', () => {
  it('解出 base64 图片的字节', () => {
    const bytes = decodeDataUri(`data:image/png;base64,${TINY_PNG_BASE64}`)

    // PNG magic number：确认解出来的是真正的图片字节，不是被当成文本处理。
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('支持非 base64 的百分号编码形式', () => {
    const bytes = decodeDataUri('data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E')
    expect(Buffer.from(bytes).toString('utf8')).toBe('<svg></svg>')
  })

  it('拒绝非图片的 data URI', () => {
    expect(() => decodeDataUri('data:text/html;base64,PHNjcmlwdD4=')).toThrow(/不是图片/)
  })

  it('拒绝格式不合法的 data URI', () => {
    expect(() => decodeDataUri('data:garbage')).toThrow(/格式无效/)
  })
})

describe('内联 SVG 识别', () => {
  // 内联 SVG 若不被识别出来，就会绕过安全检查直接交给图片管道栅格化。
  it('识别 base64 与百分号编码两种写法', () => {
    expect(isSvgDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true)
    expect(isSvgDataUri('data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E')).toBe(true)
  })

  it('大小写不影响识别', () => {
    expect(isSvgDataUri('DATA:IMAGE/SVG+XML,%3Csvg%3E')).toBe(true)
  })

  it('不误判其他图片类型', () => {
    expect(isSvgDataUri(`data:image/png;base64,${TINY_PNG_BASE64}`)).toBe(false)
  })
})
