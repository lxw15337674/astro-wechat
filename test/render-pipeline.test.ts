import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPlaceholder } from '../src/assets/identity.js'
import { computeContentHash } from '../src/render/hash.js'
import { substitutePlaceholders } from '../src/render/images.js'
import { prepareArticle } from '../src/pipeline.js'
import { createFixtureProject, TINY_PNG_BASE64, writePost, type FixtureProject } from './helpers/project.js'

let project: FixtureProject

beforeEach(() => {
  project = createFixtureProject()
  project.writeBinary('public/images/cover.png', TINY_PNG_BASE64)
  project.writeBinary('src/data/blog/inline.png', TINY_PNG_BASE64)
})

afterEach(() => {
  project.cleanup()
})

async function render(
  body: string,
  frontmatter: Record<string, unknown> = {},
  config: Record<string, unknown> = {},
) {
  const path = writePost(project, { body, frontmatter })
  const resolved = await project.resolved({ siteUrl: 'https://example.com', ...config })
  return prepareArticle(path, resolved)
}

describe('渲染流水线', () => {
  it('内联 CSS，因为微信不支持外部样式表', async () => {
    const rendered = await render('段落。\n')
    expect(rendered.html).not.toContain('<style')
    expect(rendered.html).toMatch(/<p[^>]*style="/)
  })

  it('支持 doocs-default 主题，并将主题变量预先解析为微信可用的值', async () => {
    const rendered = await render('# 一级标题\n\n## 二级标题\n\n`行内代码`\n', {}, { theme: 'doocs-default' })

    expect(rendered.html).toContain('border-bottom:2px solid #0f4c81')
    expect(rendered.html).toContain('background:#0f4c81')
    expect(rendered.html).toContain('rgba(15, 76, 129, 0.08)')
    expect(rendered.html).not.toContain('var(--')
  })

  it('去掉列表标签之间的空白，否则微信编辑器会插入空列表项', async () => {
    // 微信把 ul/ol 内的纯空白文本节点提升成空 <li>：无序列表多出空行，
    // 有序列表的编号直接翻倍（10 条故事会数到 20）。
    const rendered = await render('1. 第一条\n2. 第二条\n\n- 甲\n- 乙\n')

    expect(rendered.html).not.toMatch(/<\/li>\s+<li/)
    expect(rendered.html).not.toMatch(/<(?:ul|ol)[^>]*>\s+<li/)
    expect(rendered.html).not.toMatch(/<\/li>\s+<\/(?:ul|ol)>/)
    // 列表项自身的文本不受影响。
    expect(rendered.html).toContain('第一条')
    expect(rendered.html).toContain('第二条')
  })

  it('松散列表里的段落同样不留标签间空白', async () => {
    const rendered = await render('1. 第一条\n\n2. 第二条\n')

    expect(rendered.html).not.toMatch(/<\/li>\s+<li/)
    expect(rendered.html).not.toMatch(/<li[^>]*>\s+<p/)
  })

  it('净化掉脚本与事件处理属性', async () => {
    const rendered = await render('<script>alert(1)</script>\n\n<p onclick="x()">文本</p>\n')
    expect(rendered.html).not.toContain('<script')
    expect(rendered.html).not.toContain('onclick')
  })

  it('给正文图片强制响应式样式', async () => {
    const rendered = await render('![图](./inline.png)\n')
    expect(rendered.html).toContain('max-width:100%')
  })

  it('保留 alt 文本', async () => {
    const rendered = await render('![描述文字](./inline.png)\n')
    expect(rendered.html).toContain('alt="描述文字"')
  })

  it('原始 HTML 图片与 Markdown 图片走同一条处理路径', async () => {
    const rendered = await render('<img src="./inline.png" alt="raw">\n')
    expect(rendered.bodyAssets).toHaveLength(1)
    expect(isPlaceholder(rendered.bodyAssets[0]!.placeholder)).toBe(true)
  })

  it('相同图片被引用多次时只登记一份资源', async () => {
    const rendered = await render('![a](./inline.png)\n\n![b](./inline.png)\n')
    expect(rendered.bodyAssets).toHaveLength(1)
  })
})

describe('上传前哈希', () => {
  it('渲染结果只含占位符，不含任何已上传地址', async () => {
    const rendered = await render('![图](./inline.png)\n')

    expect(rendered.html).toContain('asset.astro-wechat.invalid')
    expect(rendered.html).not.toContain('mmbiz.qpic.cn')
  })

  it('相同输入产生相同哈希', async () => {
    const first = await render('稳定的正文。\n')
    const second = await render('稳定的正文。\n')
    expect(second.contentHash).toBe(first.contentHash)
  })

  it('正文改变时哈希改变', async () => {
    const first = await render('原始正文。\n')
    const second = await render('修改后的正文。\n')
    expect(second.contentHash).not.toBe(first.contentHash)
  })

  it('图片字节改变时哈希改变，即使路径不变', async () => {
    const before = await render('![图](./inline.png)\n')

    // 换成一个不同的 1x1 PNG：路径与文件名都没变，只有内容变了。
    project.writeBinary(
      'src/data/blog/inline.png',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    )
    const after = await render('![图](./inline.png)\n')

    expect(after.contentHash).not.toBe(before.contentHash)
  })

  it('哈希与上传后的 URL 无关：若改为上传后再哈希，本断言会失败', async () => {
    const rendered = await render('![图](./inline.png)\n')

    const substituted = substitutePlaceholders(
      rendered.html,
      new Map(rendered.bodyAssets.map((asset) => [asset.placeholder, 'https://mmbiz.qpic.cn/uploaded'])),
    )

    // 替换确实改变了 HTML……
    expect(substituted).not.toBe(rendered.html)
    expect(substituted).toContain('mmbiz.qpic.cn')

    // ……因此若哈希在上传之后计算，结果会不同。当前实现在上传前计算，
    // 跳过决策才可能在零上传的情况下作出（ADR-0002）。
    const hashIfComputedAfterUpload = computeContentHash({
      document: rendered.document,
      html: substituted,
      bodyAssets: rendered.bodyAssets,
      coverAsset: rendered.coverAsset,
      themeName: 'default',
    })

    expect(hashIfComputedAfterUpload).not.toBe(rendered.contentHash)
  })
})

describe('外部链接在完整流水线中的表现', () => {
  it('参考列表出现在最终 HTML 中', async () => {
    const rendered = await render('见 [文档](https://docs.example.com)。\n')

    expect(rendered.html).not.toContain('href="https://docs.example.com"')
    expect(rendered.html).toContain('https://docs.example.com')
    expect(rendered.html).toContain('参考链接')
  })
})
