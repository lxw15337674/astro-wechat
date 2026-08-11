import { execFile } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { SourceValidationError } from '../errors.js'
import { contentRoot } from '../project/config.js'
import type { ResolvedProject } from '../types.js'

/**
 * Explicitly typed: `promisify` overloads on `execFile` resolve differently
 * depending on the `@types/node` version, and the encoding-dependent
 * `string | Buffer` result is not worth re-deriving at every call site.
 */
const run = promisify(execFile) as (
  file: string,
  args: readonly string[],
  options: { cwd: string; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>

export interface ChangedFilesOptions {
  /** Base revision. Defaults to the previous commit. */
  readonly from?: string
  /** Target revision. Defaults to the working tree's HEAD. */
  readonly to?: string
}

/**
 * Markdown files changed between two revisions, limited to the content
 * directory.
 *
 * Deletions and renames-away are excluded: an article that no longer exists
 * cannot be synchronized, and the first release never deletes a draft.
 *
 * Note that the CI design prefers the generator's own result manifest over a
 * Git diff, because a diff cannot distinguish articles produced by one grouped
 * task. This exists for human-authored pushes, where no manifest exists.
 */
export async function changedMarkdownFiles(
  project: ResolvedProject,
  options: ChangedFilesOptions = {},
): Promise<string[]> {
  const from = options.from ?? 'HEAD~1'
  const to = options.to ?? 'HEAD'

  let stdout: string
  try {
    ;({ stdout } = await run('git', ['diff', '--name-only', '--diff-filter=ACMR', from, to], {
      cwd: project.root,
      maxBuffer: 16 * 1024 * 1024,
    }))
  } catch (cause) {
    throw new SourceValidationError(
      `无法比较 ${from}..${to}。确认这是 Git 仓库，且 CI 检出深度足够包含这两个修订。`,
      { code: 'git-diff-failed', cause },
    )
  }

  // Trailing separator matters: a bare prefix check would also match a sibling
  // directory whose name merely starts with the content directory's name.
  const contentDirectory = `${contentRoot(project)}${sep}`

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'))
    .map((line) => resolve(project.root, line))
    .filter((path) => path.startsWith(contentDirectory))
    .sort()
}
