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

async function render(body: string, frontmatter: Record<string, unknown> = {}) {
  const path = writePost(project, { body, frontmatter })
  const resolved = await project.resolved({ siteUrl: 'https://example.com' })
  return prepareArticle(path, resolved)
}

describe('渲染流水线', () => {
  it('内联 CSS，因为微信不支持外部样式表', async () => {
    const rendered = await render('段落。\n')
    expect(rendered.html).not.toContain('<style')
    expect(rendered.html).toMatch(/<p[^>]*style="/)
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
