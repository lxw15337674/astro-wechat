import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'

/**
 * markdown-it's default export is a value, not a class declaration, so its name
 * cannot be used as a type directly. Deriving the instance type keeps this
 * working across both the bundled types and DefinitelyTyped.
 */
export type MarkdownRenderer = InstanceType<typeof MarkdownIt>

/**
 * `markdown-it` rather than remark, per ADR-0003.
 *
 * Synchronous and deterministic, which keeps rendering snapshots meaningful.
 * `html: true` admits the limited raw HTML the design allows; the sanitizer,
 * not the parser, is what constrains it.
 */
export function createMarkdownRenderer(): MarkdownRenderer {
  const md = new MarkdownIt({
    html: true,
    // Turning bare URLs into links would create anchors the platform drops,
    // which the link rewriter would then have to undo. Better to never make
    // them.
    linkify: false,
    typographer: false,
    breaks: false,
  })

  md.use(footnote)
  return md
}

export function renderMarkdown(body: string): string {
  return createMarkdownRenderer().render(body)
}
