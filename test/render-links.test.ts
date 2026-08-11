import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/render/markdown.js'
import { rewriteOutboundLinks } from '../src/render/links.js'

const OPTIONS = { clickableHosts: [] as string[], referenceHeading: '参考链接' }

function rewrite(markdown: string, options = OPTIONS) {
  return rewriteOutboundLinks(renderMarkdown(markdown), options)
}

describe('出站链接改写', () => {
  it('外部链接降级为文本加编号，并生成参考列表', () => {
    const { html, references } = rewrite('见 [Astro 官网](https://astro.build) 说明。')

    expect(html).not.toContain('<a href="https://astro.build"')
    expect(html).toContain('Astro 官网')
    expect(html).toContain('[1]')
    expect(html).toContain('https://astro.build')
    expect(references).toEqual([{ index: 1, href: 'https://astro.build' }])
  })

  it('相同目标共用一个编号', () => {
    const { references } = rewrite(
      '[一](https://example.com/a) 和 [二](https://example.com/a) 还有 [三](https://example.com/b)',
    )

    expect(references.map((r) => r.href)).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(references.map((r) => r.index)).toEqual([1, 2])
  })

  it('文本本身就是 URL 时不重复加入参考列表', () => {
    const { html, references } = rewrite('[https://example.com](https://example.com)')

    expect(references).toHaveLength(0)
    expect(html).toContain('https://example.com')
    expect(html).not.toContain('[1]')
  })

  it('站内锚点保持原样', () => {
    const { html, references } = rewrite('[回到顶部](#top)')

    expect(html).toContain('href="#top"')
    expect(references).toHaveLength(0)
  })

  it('配置为可点击的域名保留为锚点', () => {
    const { html, references } = rewrite('[文章](https://mp.weixin.qq.com/s/abc)', {
      ...OPTIONS,
      clickableHosts: ['mp.weixin.qq.com'],
    })

    expect(html).toContain('href="https://mp.weixin.qq.com/s/abc"')
    expect(references).toHaveLength(0)
  })

  it('转义链接文本，防止内容注入标记', () => {
    const { html } = rewrite('[<b>粗体</b>](https://example.com)')
    expect(html).not.toContain('<b>粗体</b>')
  })
})

describe('与 Markdown 脚注共用编号空间', () => {
  const markdown = [
    '正文有脚注[^a] 和链接 [示例](https://example.com)。',
    '',
    '[^a]: 脚注内容。',
    '',
  ].join('\n')

  it('链接编号接在脚注之后，不与脚注冲突', () => {
    const { references } = rewrite(markdown)
    expect(references).toEqual([{ index: 2, href: 'https://example.com' }])
  })

  it('链接引用并入脚注列表，不另起一个列表', () => {
    const { html } = rewrite(markdown)
    expect(html).not.toContain('link-references')
    expect(html).toContain('link-ref-item')
  })
})
