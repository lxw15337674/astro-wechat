/**
 * Length in Unicode code points rather than UTF-16 units.
 *
 * `"字".length` and `"𝒳".length` disagree about what a character is, and WeChat
 * counts the way a reader would. Using `.length` would reject valid titles that
 * contain emoji or rare CJK characters.
 */
export function codePointLength(value: string): number {
  return [...value].length
}

const SENTENCE_ENDINGS = ['。', '！', '？', '；', '.', '!', '?', ';']

/**
 * Truncate to at most `max` code points, preferring a sentence boundary.
 *
 * Falls back to a hard cut with an ellipsis when no boundary sits in the last
 * third of the allowance, because a digest cut at 40% of its budget reads worse
 * than one cut mid-sentence.
 */
export function truncateOnBoundary(value: string, max: number): string {
  const points = [...value]
  if (points.length <= max) return value

  const window = points.slice(0, max)
  const minimumKept = Math.floor(max * (2 / 3))

  for (let i = window.length - 1; i >= minimumKept; i -= 1) {
    if (SENTENCE_ENDINGS.includes(window[i] as string)) {
      return window.slice(0, i + 1).join('')
    }
  }

  return `${window.slice(0, max - 1).join('')}…`
}

/**
 * Strip Markdown syntax to plain text.
 *
 * Only used to derive a digest when the author supplied none, so it optimizes
 * for readable output over exhaustive syntax coverage. Anything it misses ends
 * up as stray punctuation in a summary, not as broken article content.
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalize a project-relative path for use as a stable identifier. */
export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}
