import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WarningCollector } from '../src/errors.js'
import { toArticleDocument } from '../src/source/adapter.js'
import { loadSourceArticle } from '../src/source/load.js'
import { createFixtureProject, writePost, type FixtureProject } from './helpers/project.js'

let project: FixtureProject

beforeEach(() => {
  project = createFixtureProject()
})

afterEach(() => {
  project.cleanup()
})

async function adapt(path: string, overrides = {}, configOverrides = {}) {
  const resolved = await project.resolved(configOverrides)
  const warnings = new WarningCollector()
  const source = await loadSourceArticle(path, resolved.root)
  const document = toArticleDocument(source, resolved, warnings, overrides)
  return { document, warnings }
}

describe('标题优先级', () => {
  it('CLI 覆盖优先于所有 frontmatter 来源', async () => {
    const path = writePost(project, { frontmatter: { wechat: { enabled: true, title: 'wechat 标题' } } })
    const { document } = await adapt(path, { title: 'CLI 标题' })
    expect(document.title).toBe('CLI 标题')
  })

  it('wechat.title 优先于 frontmatter.title', async () => {
    const path = writePost(project, {
      frontmatter: { title: '通用标题', wechat: { enabled: true, title: '公众号标题' } },
    })
    const { document } = await adapt(path)
    expect(document.title).toBe('公众号标题')
  })

  it('没有 title 时回退到正文第一个 H1', async () => {
    const path = writePost(project, {
      frontmatter: { title: undefined },
      body: '# 来自正文的标题\n\n段落。\n',
    })
    const { document } = await adapt(path)
    expect(document.title).toBe('来自正文的标题')
  })

  it('标题和 H1 都没有时报错', async () => {
    const path = writePost(project, { frontmatter: { title: undefined }, body: '只有段落。\n' })
    await expect(adapt(path)).rejects.toThrow(/无法确定标题/)
  })
})

describe('正文首个 H1 去重', () => {
  it('H1 与标题相同时移除，避免微信正文重复', async () => {
    const path = writePost(project, {
      frontmatter: { title: '重复的标题' },
      body: '# 重复的标题\n\n正文。\n',
    })
    const { document } = await adapt(path)
    expect(document.body).not.toContain('# 重复的标题')
    expect(document.body.trim()).toBe('正文。')
  })

  it('H1 与标题不同时保留，因为那是真实内容', async () => {
    const path = writePost(project, {
      frontmatter: { title: '文章标题' },
      body: '# 另一个小节\n\n正文。\n',
    })
    const { document } = await adapt(path)
    expect(document.body).toContain('# 另一个小节')
  })

  it('代码块里的 # 不算 H1', async () => {
    const path = writePost(project, {
      frontmatter: { title: undefined },
      body: '```sh\n# 这是注释\n```\n\n# 真正的标题\n',
    })
    const { document } = await adapt(path)
    expect(document.title).toBe('真正的标题')
  })
})

describe('封面优先级', () => {
  it('缺少所有来源时报错', async () => {
    const path = writePost(project, { frontmatter: { ogImage: undefined } })
    await expect(adapt(path)).rejects.toThrow(/无法确定封面/)
  })

  it('回退到配置的默认封面', async () => {
    const path = writePost(project, { frontmatter: { ogImage: undefined } })
    const { document } = await adapt(path, {}, { defaultCover: '/images/default.png' })
    expect(document.cover).toBe('/images/default.png')
  })

  it('接受 Astro image() 产生的对象形态 ogImage', async () => {
    const path = writePost(project, { frontmatter: { ogImage: { src: '/images/from-object.png' } } })
    const { document } = await adapt(path)
    expect(document.cover).toBe('/images/from-object.png')
  })
})

describe('canonical URL 与源标识符', () => {
  it('由 siteUrl 与 permalink 模板推导', async () => {
    const path = writePost(project, { slug: 'hello-world' })
    const { document } = await adapt(path, {}, { siteUrl: 'https://example.com' })
    expect(document.canonicalUrl).toBe('https://example.com/posts/hello-world/')
    expect(document.sourceId).toBe('https://example.com/posts/hello-world/')
  })

  it('wechat.sourceURL 覆盖推导结果', async () => {
    const path = writePost(project, {
      frontmatter: { wechat: { enabled: true, sourceURL: 'https://example.com/custom/' } },
    })
    const { document } = await adapt(path, {}, { siteUrl: 'https://example.com' })
    expect(document.canonicalUrl).toBe('https://example.com/custom/')
  })

  it('没有 canonical URL 时回退到相对路径并警告身份无法远程恢复', async () => {
    const path = writePost(project, { slug: 'no-url' })
    const { document, warnings } = await adapt(path)
    expect(document.canonicalUrl).toBeUndefined()
    expect(document.sourceId).toBe('src/data/blog/no-url.md')
    expect(warnings.warnings.map((w) => w.code)).toContain('no-canonical-url')
  })
})

describe('摘要', () => {
  it('缺少 description 时从正文推导', async () => {
    const path = writePost(project, {
      frontmatter: { description: undefined },
      body: '# 标题\n\n这是**正文**的第一段，带 [链接](https://example.com)。\n',
    })
    const { document } = await adapt(path)
    expect(document.digest).toContain('这是正文的第一段')
    expect(document.digest).not.toContain('**')
    expect(document.digest).not.toContain('https://example.com')
  })
})

describe('MDX', () => {
  it('拒绝 .mdx，因为渲染必须是确定性纯转换', async () => {
    const path = project.write('src/data/blog/post.mdx', '---\ntitle: "x"\n---\n')
    const resolved = await project.resolved()
    await expect(loadSourceArticle(path, resolved.root)).rejects.toThrow(/MDX/)
  })
})
