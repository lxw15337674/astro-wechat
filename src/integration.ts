import { openProject, inspectArticle, listArticleFiles } from './pipeline.js'
import { isSuspiciousSkip } from './eligibility.js'
import type { ProjectConfig } from './types.js'

/**
 * Minimal structural type for the pieces of Zod this schema helper uses.
 *
 * Taking the validator as an argument rather than importing Zod keeps the
 * package from depending on whichever version the consumer's Astro pins, and
 * keeps this module loadable without Astro installed.
 */
export interface ZodLike {
  object(shape: Record<string, unknown>): { optional(): unknown }
  boolean(): { optional(): unknown }
  string(): { optional(): unknown; url(): { optional(): unknown } }
}

/**
 * Schema fragment for the optional `wechat` frontmatter object.
 *
 * Exported so an Astro content collection can validate the object without
 * restating its shape — two copies of a schema drift, and the copy that drifts
 * is usually the one doing the validating.
 *
 * ```ts
 * import { z, defineCollection } from 'astro:content'
 * import { wechatFrontmatterSchema } from 'astro-wechat/integration'
 *
 * const blog = defineCollection({
 *   schema: z.object({
 *     title: z.string(),
 *     wechat: wechatFrontmatterSchema(z),
 *   }),
 * })
 * ```
 */
export function wechatFrontmatterSchema(z: ZodLike): unknown {
  return z
    .object({
      enabled: z.boolean().optional(),
      title: z.string().optional(),
      cover: z.string().optional(),
      author: z.string().optional(),
      digest: z.string().optional(),
      sourceURL: z.string().url().optional(),
    })
    .optional()
}

/**
 * Minimal structural type for an Astro integration.
 *
 * Declared here rather than imported from `astro` so the integration module
 * type-checks without Astro installed. Astro is an optional peer dependency and
 * this file is the only place that assumes it exists at runtime.
 */
export interface AstroIntegrationLike {
  name: string
  hooks: {
    'astro:config:done'?: (options: { config: { root: URL } }) => void | Promise<void>
    'astro:build:done'?: () => void | Promise<void>
  }
}

export interface AstroWechatIntegrationOptions extends Partial<ProjectConfig> {
  /** Fail the build when an eligible article does not validate. */
  readonly failOnInvalid?: boolean
}

/**
 * Validate WeChat-eligible articles during an Astro build.
 *
 * Never publishes. Creating or updating a draft is an external side effect and
 * builds are repeatable operations that run in dev, preview, and CI (ADR-0001),
 * so this hook only reads.
 */
export default function astroWechat(
  options: AstroWechatIntegrationOptions = {},
): AstroIntegrationLike {
  const { failOnInvalid = false, ...configOverrides } = options
  let projectRoot: string | undefined

  return {
    name: 'astro-wechat',
    hooks: {
      'astro:config:done': ({ config }) => {
        projectRoot = config.root.pathname
      },

      'astro:build:done': async () => {
        if (!projectRoot) return

        const project = await openProject(projectRoot, {
          root: projectRoot,
          configOverrides,
        })

        const files = await listArticleFiles(project)
        const problems: string[] = []

        for (const file of files) {
          try {
            const inspection = await inspectArticle(file, project)
            if (inspection.skipReason && !isSuspiciousSkip(inspection.skipReason)) continue

            for (const warning of inspection.warnings) {
              console.warn(`[astro-wechat] ${warning.code}: ${warning.message}`)
            }
            if (isSuspiciousSkip(inspection.skipReason)) {
              console.warn(
                `[astro-wechat] ${file} 设置了 wechat.enabled 却被配置过滤排除，通常是配置错误。`,
              )
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            problems.push(`${file}: ${message}`)
          }
        }

        if (problems.length === 0) return

        const summary = `[astro-wechat] ${problems.length} 篇文章未通过校验：\n${problems.join('\n')}`
        if (failOnInvalid) throw new Error(summary)
        console.warn(summary)
      },
    },
  }
}
