import { describe, expect, it } from 'vitest'
import { FIELD_LIMITS } from '../src/constants.js'
import { WarningCollector } from '../src/errors.js'
import { assertWithinLimit, fitDigest } from '../src/source/validate.js'
import { codePointLength } from '../src/util/text.js'

const SOURCE = '/tmp/post.md'

describe('字段限制校验', () => {
  it('标题超限报错而非静默截断', () => {
    const title = '字'.repeat(FIELD_LIMITS.title.max + 1)
    expect(() => assertWithinLimit('title', title, SOURCE)).toThrow(/超出微信限制/)
  })

  it('刚好到达上限的标题通过', () => {
    const title = '字'.repeat(FIELD_LIMITS.title.max)
    expect(() => assertWithinLimit('title', title, SOURCE)).not.toThrow()
  })

  it('作者超限报错', () => {
    const author = 'a'.repeat(FIELD_LIMITS.author.max + 1)
    expect(() => assertWithinLimit('author', author, SOURCE)).toThrow(/超出微信限制/)
  })

  it('按码点而非 UTF-16 单元计数，避免误伤 emoji 标题', () => {
    // 每个 emoji 占两个 UTF-16 单元，按 .length 计会提前触发上限。
    const title = '🎯'.repeat(FIELD_LIMITS.title.max)
    expect(title.length).toBeGreaterThan(FIELD_LIMITS.title.max)
    expect(() => assertWithinLimit('title', title, SOURCE)).not.toThrow()
  })
})

describe('摘要截断', () => {
  it('超限时截断并警告，而不是让整篇文章失败', () => {
    const warnings = new WarningCollector()
    const digest = fitDigest('句子。'.repeat(200), warnings, SOURCE)

    expect(codePointLength(digest)).toBeLessThanOrEqual(FIELD_LIMITS.digest.max)
    expect(warnings.warnings.map((w) => w.code)).toContain('digest-truncated')
  })

  it('优先在句子边界截断', () => {
    const warnings = new WarningCollector()
    const digest = fitDigest(`${'字'.repeat(100)}。${'字'.repeat(100)}`, warnings, SOURCE)
    expect(digest.endsWith('。')).toBe(true)
  })

  it('未超限时原样返回且不警告', () => {
    const warnings = new WarningCollector()
    const digest = fitDigest('简短摘要。', warnings, SOURCE)
    expect(digest).toBe('简短摘要。')
    expect(warnings.isEmpty).toBe(true)
  })
})
