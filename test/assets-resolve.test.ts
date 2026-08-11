import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WarningCollector } from '../src/errors.js'
import { resolveAsset } from '../src/assets/resolve.js'
import { createFixtureProject, TINY_PNG_BASE64, type FixtureProject } from './helpers/project.js'

let project: FixtureProject
let warnings: WarningCollector

beforeEach(() => {
  project = createFixtureProject()
  warnings = new WarningCollector()
  project.writeBinary('public/images/cover.png', TINY_PNG_BASE64)
  project.writeBinary('src/data/blog/inline.png', TINY_PNG_BASE64)
})

afterEach(() => {
  project.cleanup()
})

function resolveIn(original: string, allowAbsolute = false) {
  return resolveAsset(
    original,
    {
      markdownDir: join(project.root, 'src/data/blog'),
      projectRoot: project.root,
      allowAbsolute,
      role: 'body',
    },
    warnings,
  )
}

describe('资源解析', () => {
  it('解析相对 Markdown 文件的路径', () => {
    const asset = resolveIn('./inline.png')
    expect(asset.kind).toBe('local')
    expect(asset.localPath).toBe(join(project.root, 'src/data/blog/inline.png'))
  })

  it('站点根路径从 public/ 解析', () => {
    const asset = resolveIn('/images/cover.png')
    expect(asset.localPath).toBe(join(project.root, 'public/images/cover.png'))
    expect(warnings.isEmpty).toBe(true)
  })

  it('识别 HTTP 远程图片', () => {
    const asset = resolveIn('https://example.com/a.png')
    expect(asset.kind).toBe('remote')
  })

  it('已托管在微信的图片单独归类', () => {
    const asset = resolveIn('https://mmbiz.qpic.cn/x.png')
    expect(asset.kind).toBe('wechat-hosted')
  })

  it('接受图片 data URI', () => {
    const asset = resolveIn(`data:image/png;base64,${TINY_PNG_BASE64}`)
    expect(asset.kind).toBe('data-uri')
  })

  it('拒绝非图片 data URI', () => {
    expect(() => resolveIn('data:text/html,<script>')).toThrow(/不是图片/)
  })

  it('拒绝非 HTTP 协议', () => {
    expect(() => resolveIn('ftp://example.com/a.png')).toThrow(/非 HTTP 协议/)
  })

  it('默认拒绝绝对文件系统路径', () => {
    expect(() => resolveIn('/etc/passwd')).toThrow()
  })

  it('拒绝逃逸出项目根目录的相对路径', () => {
    project.writeBinary('../outside.png', TINY_PNG_BASE64)
    expect(() => resolveIn('../../../../outside.png')).toThrow()
  })
})

describe('AstroPaper 的 public/ 前缀兼容', () => {
  // 内容目录在根下三层，因此 `../../../public/...` 本就是一条能走通的相对路径。
  // 真正需要兼容的是 `../` 数量与文件实际深度对不上的写法。
  const MISMATCHED = '../../../../../public/images/cover.png'
  const CORRECT_DEPTH = '../../../public/images/cover.png'

  it('层级数与实际深度不符时按 public/ 后缀回退并警告', () => {
    const asset = resolveIn(MISMATCHED)

    expect(asset.localPath).toBe(join(project.root, 'public/images/cover.png'))
    expect(warnings.warnings.map((w) => w.code)).toContain('ambiguous-public-path')
  })

  it('层级数正确时按普通相对路径解析，不走回退也不警告', () => {
    const asset = resolveIn(CORRECT_DEPTH)

    expect(asset.localPath).toBe(join(project.root, 'public/images/cover.png'))
    expect(warnings.isEmpty).toBe(true)
  })

  it('相对路径本身可用时不触发回退，也不警告', () => {
    const asset = resolveIn('./inline.png')
    expect(asset.localPath).toBe(join(project.root, 'src/data/blog/inline.png'))
    expect(warnings.isEmpty).toBe(true)
  })

  it('回退目标也不存在时报错，而不是无声通过', () => {
    expect(() => resolveIn('../../../../../public/images/missing.png')).toThrow(
      /无法解析资源路径/,
    )
  })
})
