import { describe, expect, it } from 'vitest'
import { checkEligibility, isSuspiciousSkip } from '../src/eligibility.js'
import { DEFAULT_CONFIG } from '../src/project/config.js'
import type { ArticleDocument, ProjectConfig } from '../src/types.js'

function article(overrides: Partial<ArticleDocument> = {}): ArticleDocument {
  return {
    sourceId: 'src/data/blog/post.md',
    canonicalUrl: undefined,
    title: '标题',
    body: '正文',
    author: '作者',
    digest: '摘要',
    cover: '/images/cover.png',
    draft: false,
    tags: ['tech'],
    wechat: { enabled: true },
    source: {
      absolutePath: '/project/src/data/blog/post.md',
      projectRelativePath: 'src/data/blog/post.md',
      frontmatter: {},
      body: '正文',
      format: 'md',
    },
    ...overrides,
  }
}

function config(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

describe('同步资格优先级', () => {
  it('draft 文章被排除，且优先于其他原因报告', () => {
    expect(checkEligibility(article({ draft: true }), config())).toBe('source-is-draft')
  })

  it('默认不发布：未设置 wechat.enabled 即排除', () => {
    expect(checkEligibility(article({ wechat: {} }), config())).toBe('not-enabled')
  })

  it('配置不能让文章 opt-in', () => {
    const result = checkEligibility(
      article({ wechat: { enabled: false }, tags: ['tech'] }),
      config({ eligibleTags: ['tech'] }),
    )
    expect(result).toBe('not-enabled')
  })

  it('配置可以排除已 opt-in 的文章', () => {
    const result = checkEligibility(article({ tags: ['life'] }), config({ eligibleTags: ['tech'] }))
    expect(result).toBe('excluded-by-config')
  })

  it('标签与路径过滤同时满足才算符合条件', () => {
    const both = config({ eligibleTags: ['tech'], eligibleSourcePaths: ['src/data/blog'] })
    expect(checkEligibility(article(), both)).toBeUndefined()

    const wrongPath = config({ eligibleTags: ['tech'], eligibleSourcePaths: ['src/data/notes'] })
    expect(checkEligibility(article(), wrongPath)).toBe('excluded-by-config')
  })

  it('未配置过滤器时不额外限制', () => {
    expect(checkEligibility(article(), config())).toBeUndefined()
  })

  it('路径过滤按目录判断，不是字符串前缀', () => {
    // `src/data/blog` 不应放行 `src/data/blog2` 里的文章。
    const neighbour = article({
      source: {
        absolutePath: '/project/src/data/blog2/post.md',
        projectRelativePath: 'src/data/blog2/post.md',
        frontmatter: {},
        body: '正文',
        format: 'md',
      },
    })

    expect(checkEligibility(neighbour, config({ eligibleSourcePaths: ['src/data/blog'] }))).toBe(
      'excluded-by-config',
    )
  })

  it('目录前缀写成带斜杠或不带斜杠都一样', () => {
    expect(
      checkEligibility(article(), config({ eligibleSourcePaths: ['src/data/blog/'] })),
    ).toBeUndefined()
  })
})

describe('可疑跳过', () => {
  it('opt-in 却被配置排除通常是配置错误，需要显著提示', () => {
    expect(isSuspiciousSkip('excluded-by-config')).toBe(true)
  })

  it('正常的未启用与 draft 不算可疑', () => {
    expect(isSuspiciousSkip('not-enabled')).toBe(false)
    expect(isSuspiciousSkip('source-is-draft')).toBe(false)
    expect(isSuspiciousSkip(undefined)).toBe(false)
  })
})
