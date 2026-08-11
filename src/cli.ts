#!/usr/bin/env node
import { relative, resolve } from 'node:path'
import { cac } from 'cac'
import { AstroWechatError } from './errors.js'
import { isSuspiciousSkip } from './eligibility.js'
import { changedMarkdownFiles } from './git/changed.js'
import {
  inspectArticle,
  listArticleFiles,
  openProject,
  prepareArticle,
  publishArticle,
} from './pipeline.js'
import { writePreview } from './preview/index.js'
import { JsonLedgerStore } from './state/store.js'
import { cleanupOrphans, listOrphans } from './sync/cleanup.js'
import { WeChatClient } from './wechat/client.js'
import { verifyProxy } from './wechat/proxy-verify.js'
import type { ArticleResult, ProjectConfig, ResolvedProject } from './types.js'

const cli = cac('astro-wechat')

interface CommonOptions {
  readonly root?: string
  readonly json?: boolean
  readonly theme?: string
  readonly contentDir?: string
  readonly siteUrl?: string
}

/**
 * Built by construction rather than assignment: `ProjectConfig` fields are
 * readonly, and that readonly-ness survives into `Partial<ProjectConfig>`.
 * Absent flags are omitted entirely so they never shadow a configured value
 * with `undefined`.
 */
function configOverrides(options: CommonOptions): Partial<ProjectConfig> {
  return {
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.contentDir ? { contentDir: options.contentDir } : {}),
    ...(options.siteUrl ? { siteUrl: options.siteUrl } : {}),
  }
}

async function project(target: string, options: CommonOptions): Promise<ResolvedProject> {
  return openProject(target, { root: options.root, configOverrides: configOverrides(options) })
}

function addCommonOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option('--root <dir>', 'Astro 项目根目录，默认从目标文件向上查找')
    .option('--content-dir <dir>', '内容目录，覆盖配置')
    .option('--site-url <url>', '站点 URL，用于推导 canonical URL')
    .option('--theme <name>', '渲染主题')
    .option('--json', '输出机器可读 JSON')
}

addCommonOptions(cli.command('inspect <file>', '显示规范化后的文章元数据与校验结果'))
  .option('--title <title>', '覆盖标题')
  .option('--cover <path>', '覆盖封面')
  .action(async (file: string, options: CommonOptions & { title?: string; cover?: string }) => {
    const target = resolve(file)
    const resolved = await project(target, options)
    const inspection = await inspectArticle(target, resolved, {
      title: options.title,
      cover: options.cover,
    })

    const payload = {
      sourcePath: relative(resolved.root, target),
      sourceId: inspection.document.sourceId,
      canonicalUrl: inspection.document.canonicalUrl ?? null,
      title: inspection.document.title,
      author: inspection.document.author ?? null,
      digest: inspection.document.digest,
      cover: inspection.document.cover,
      draft: inspection.document.draft,
      tags: inspection.document.tags,
      wechatEnabled: inspection.document.wechat.enabled === true,
      eligible: inspection.skipReason === undefined,
      skipReason: inspection.skipReason ?? null,
      warnings: inspection.warnings,
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
      return
    }

    printKeyValues(payload)
    printWarnings(inspection.warnings)
  })

addCommonOptions(cli.command('preview <file>', '生成本地独立 HTML 预览'))
  .option('--title <title>', '覆盖标题')
  .option('--cover <path>', '覆盖封面')
  .action(async (file: string, options: CommonOptions & { title?: string; cover?: string }) => {
    const target = resolve(file)
    const resolved = await project(target, options)
    const rendered = await prepareArticle(target, resolved, {
      title: options.title,
      cover: options.cover,
    })
    const path = await writePreview(rendered, resolved)

    const payload = {
      sourcePath: relative(resolved.root, target),
      title: rendered.document.title,
      contentHash: rendered.contentHash,
      bodyImageCount: rendered.bodyAssets.length,
      previewPath: path,
      warnings: rendered.warnings,
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
      return
    }

    printKeyValues(payload)
    printWarnings(rendered.warnings)
  })

addCommonOptions(cli.command('list', '列出可发现的文章及其同步资格')).action(
  async (options: CommonOptions) => {
    const resolved = await project(process.cwd(), options)
    const files = await listArticleFiles(resolved)

    const rows = []
    for (const file of files) {
      try {
        const inspection = await inspectArticle(file, resolved)
        rows.push({
          sourcePath: relative(resolved.root, file),
          title: inspection.document.title,
          eligible: inspection.skipReason === undefined,
          skipReason: inspection.skipReason ?? null,
          suspicious: isSuspiciousSkip(inspection.skipReason),
          error: null,
        })
      } catch (error) {
        rows.push({
          sourcePath: relative(resolved.root, file),
          title: null,
          eligible: false,
          skipReason: null,
          suspicious: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return
    }

    for (const row of rows) {
      const mark = row.error ? '!' : row.eligible ? '+' : '-'
      const note = row.error ?? row.skipReason ?? ''
      process.stdout.write(`${mark} ${row.sourcePath}${note ? `  (${note})` : ''}\n`)
    }

    const eligible = rows.filter((row) => row.eligible).length
    const failed = rows.filter((row) => row.error).length
    process.stdout.write(`\n共 ${rows.length} 篇，符合同步条件 ${eligible} 篇，校验失败 ${failed} 篇。\n`)
  },
)

interface PublishFlags extends CommonOptions {
  readonly dryRun?: boolean
  readonly forceCreate?: boolean
  readonly allowDraft?: boolean
}

function addPublishOptions(command: ReturnType<typeof cli.command>) {
  return addCommonOptions(command)
    .option('--dry-run', '执行到创建决策为止，报告计划操作但不写入')
    .option('--force-create', '为已同步的文章再建一份草稿，会在草稿箱产生重复')
    .option('--allow-draft', '忽略 draft: true，发布未完成的文章')
}

/**
 * Run publishing over a set of files and report per-article results.
 *
 * One failure never stops the batch: articles already created must stay
 * reported as created rather than being conceptually rolled back. The exit code
 * still reflects that something failed.
 */
async function runPublish(
  files: string[],
  resolved: ResolvedProject,
  options: PublishFlags,
): Promise<void> {
  if (files.length === 0) {
    process.stdout.write(options.json ? '[]\n' : '没有需要同步的文章。\n')
    return
  }

  const deps = {
    client: WeChatClient.fromEnvironment(),
    store: JsonLedgerStore.forProject(resolved),
  }

  const results: ArticleResult[] = []
  for (const file of files) {
    results.push(
      await publishArticle(file, resolved, deps, {
        dryRun: options.dryRun,
        forceCreate: options.forceCreate,
        allowDraft: options.allowDraft,
      }),
    )
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  } else {
    for (const result of results) {
      process.stdout.write(`${statusMark(result)} ${result.sourcePath}${describeResult(result)}\n`)
      printWarnings(result.warnings)
    }
  }

  const failed = results.filter((result) => result.status === 'failed')
  if (failed.length > 0) process.exitCode = 1
}

function statusMark(result: ArticleResult): string {
  switch (result.status) {
    case 'created':
      return '+'
    case 'planned':
      return '?'
    case 'failed':
      return '!'
    default:
      return '-'
  }
}

function describeResult(result: ArticleResult): string {
  const notes: string[] = []
  if (result.skipReason) notes.push(result.skipReason)
  if (result.reconciled) notes.push('已与微信核对')
  if (result.drift) notes.push('源已变更，草稿不会更新')
  if (result.mediaId) notes.push(`media_id=${result.mediaId}`)
  if (result.errorMessage) notes.push(`${result.errorCategory}: ${result.errorMessage}`)
  return notes.length > 0 ? `  (${notes.join('; ')})` : ''
}

addPublishOptions(cli.command('publish <...files>', '同步一篇或多篇显式指定的文章')).action(
  async (files: string[], options: PublishFlags) => {
    const targets = files.map((file) => resolve(file))
    const resolved = await project(targets[0] ?? process.cwd(), options)
    await runPublish(targets, resolved, options)
  },
)

addPublishOptions(cli.command('publish-changed', '同步两个 Git 修订之间变更的符合条件文章'))
  .option('--from <rev>', '基线修订，默认 HEAD~1')
  .option('--to <rev>', '目标修订，默认 HEAD')
  .action(async (options: PublishFlags & { from?: string; to?: string }) => {
    const resolved = await project(process.cwd(), options)
    const files = await changedMarkdownFiles(resolved, { from: options.from, to: options.to })
    await runPublish(files, resolved, options)
  })

addCommonOptions(cli.command('cleanup-orphans', '删除台账中记录的孤儿封面素材'))
  .option('--yes', '确认执行删除。不加此标志只列出，不删除')
  .action(async (options: CommonOptions & { yes?: boolean }) => {
    const resolved = await project(process.cwd(), options)
    const store = JsonLedgerStore.forProject(resolved)
    const orphans = await listOrphans(store)

    // Deleting permanent material is irreversible, so listing is the default
    // and deleting requires saying so.
    if (!options.yes) {
      const payload = { orphans, deleted: false }
      if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
        return
      }
      for (const orphan of orphans) {
        process.stdout.write(`${orphan.materialId}  (${orphan.sourceId})\n`)
      }
      process.stdout.write(`\n共 ${orphans.length} 个孤儿素材。加 --yes 执行删除。\n`)
      return
    }

    const result = await cleanupOrphans(store, WeChatClient.fromEnvironment())

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      process.stdout.write(`已删除 ${result.deleted.length} 个，失败 ${result.failed.length} 个。\n`)
      for (const failure of result.failed) {
        process.stderr.write(`  ${failure.materialId}: ${failure.reason}\n`)
      }
    }

    if (result.failed.length > 0) process.exitCode = 1
  })

cli
  .command('verify-proxy', '验证已部署转发代理的认证、白名单与原样透传')
  .option('--json', '输出机器可读 JSON')
  .option('--timeout <ms>', '每个自检请求的超时毫秒数', { default: '15000' })
  .action(async (options: { json?: boolean; timeout?: string }) => {
    const proxyUrl = process.env.WECHAT_PROXY_URL?.trim() ?? ''
    const proxyToken = process.env.WECHAT_PROXY_TOKEN?.trim() ?? ''
    const timeoutMs = Number.parseInt(options.timeout ?? '15000', 10)
    const result = await verifyProxy({
      proxyUrl,
      proxyToken,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
    })

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      for (const check of result.checks) {
        process.stdout.write(
          `${check.passed ? '+' : '!'} ${check.name}: ${check.actual}（预期 ${check.expected}）\n`,
        )
      }
    }

    if (!result.passed) process.exitCode = 1
  })

cli.help()
cli.version('0.0.0')

function printKeyValues(payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'warnings') continue
    process.stdout.write(`${key.padEnd(16)} ${formatValue(value)}\n`)
  }
}

function formatValue(value: unknown): string {
  if (value === null) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

function printWarnings(warnings: readonly { code: string; message: string }[]): void {
  if (warnings.length === 0) return
  process.stderr.write('\n警告：\n')
  for (const warning of warnings) {
    process.stderr.write(`  [${warning.code}] ${warning.message}\n`)
  }
}

async function main(): Promise<void> {
  try {
    cli.parse(process.argv, { run: false })
    await cli.runMatchedCommand()
  } catch (error) {
    if (error instanceof AstroWechatError) {
      process.stderr.write(`[${error.category}/${error.code}] ${error.message}\n`)
      if (error.sourcePath) process.stderr.write(`  来源：${error.sourcePath}\n`)
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    }
    process.exitCode = 1
  }
}

void main()
