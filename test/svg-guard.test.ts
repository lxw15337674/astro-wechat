import { describe, expect, it } from 'vitest'
import { assertSafeSvg } from '../src/image/rasterize.js'

/**
 * These run without the native rasterizer installed.
 *
 * The guard is deliberately independent of `@resvg/resvg-js` so the security
 * behaviour stays testable even where the optional binary is unavailable.
 */
describe('SVG 安全检查', () => {
  it('接受普通 SVG', () => {
    expect(() => assertSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).not.toThrow()
  })

  it('拒绝 DOCTYPE，阻断 XXE 入口', () => {
    const svg = '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>'
    expect(() => assertSafeSvg(svg)).toThrow(/DOCTYPE/)
  })

  it('拒绝实体声明', () => {
    expect(() => assertSafeSvg('<svg><!ENTITY a "b"></svg>')).toThrow(/实体声明/)
  })

  it('拒绝脚本标签', () => {
    expect(() => assertSafeSvg('<svg><script>alert(1)</script></svg>')).toThrow(/脚本标签/)
  })

  it('拒绝事件处理属性', () => {
    expect(() => assertSafeSvg('<svg onload="alert(1)"></svg>')).toThrow(/事件处理属性/)
  })

  it('拒绝远程引用，避免渲染时产生外部请求', () => {
    const svg = '<svg><image xlink:href="https://evil.example/x.png"/></svg>'
    expect(() => assertSafeSvg(svg)).toThrow(/远程引用/)
  })

  it('允许 xmlns 中的 http URL，那不是资源引用', () => {
    expect(() => assertSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).not.toThrow()
  })
})
