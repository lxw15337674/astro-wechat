import * as cheerio from 'cheerio'

export interface LinkReference {
  readonly index: number
  readonly href: string
}

export interface LinkRewriteResult {
  readonly html: string
  readonly references: readonly LinkReference[]
}

export interface LinkRewriteOptions {
  /** Hosts WeChat still renders as clickable anchors. Usually empty. */
  readonly clickableHosts: readonly string[]
  readonly referenceHeading: string
}

/**
 * Replace outbound links with numbered references.
 *
 * WeChat article bodies do not render arbitrary external hyperlinks as
 * clickable links, so an anchor written by the author would lose its
 * destination silently. That is a content-correctness bug, not a styling
 * difference, which is why this transform is not optional.
 *
 * Numbering continues from any Markdown footnotes already present so a single
 * article never shows two conflicting reference lists.
 */
export function rewriteOutboundLinks(
  html: string,
  options: LinkRewriteOptions,
): LinkRewriteResult {
  const $ = cheerio.load(html, null, false)

  const footnoteCount = $('.footnotes-list > li').length
  const assigned = new Map<string, number>()
  const references: LinkReference[] = []

  for (const element of $('a[href]').toArray()) {
    const anchor = $(element)
    const href = (anchor.attr('href') ?? '').trim()

    // In-document links are footnote references and heading anchors. They work
    // inside the article and must not be turned into external references.
    if (href === '' || href.startsWith('#')) continue
    if (anchor.closest('.footnote-ref, .footnote-backref').length > 0) continue

    if (isClickable(href, options.clickableHosts)) continue

    const text = anchor.text().trim()

    // A bare URL is already readable as text. Adding a reference to itself
    // would just duplicate the same string twice on screen.
    if (text === href) {
      anchor.replaceWith(escapeHtml(text))
      continue
    }

    let index = assigned.get(href)
    if (index === undefined) {
      index = footnoteCount + assigned.size + 1
      assigned.set(href, index)
      references.push({ index, href })
    }

    anchor.replaceWith(
      `${escapeHtml(text)}<sup class="link-ref">[${index}]</sup>`,
    )
  }

  if (references.length > 0) appendReferenceList($, references, options.referenceHeading)

  return { html: $.html(), references }
}

function isClickable(href: string, clickableHosts: readonly string[]): boolean {
  if (clickableHosts.length === 0) return false
  try {
    return clickableHosts.includes(new URL(href).hostname)
  } catch {
    return false
  }
}

/**
 * Append references to the footnote list when one exists, so both kinds share
 * a single numbered list rather than sitting in two competing sections.
 */
function appendReferenceList(
  $: cheerio.CheerioAPI,
  references: readonly LinkReference[],
  heading: string,
): void {
  const items = references
    .map((reference) => `<li class="link-ref-item">${escapeHtml(reference.href)}</li>`)
    .join('')

  const existing = $('.footnotes-list')
  if (existing.length > 0) {
    existing.append(items)
    return
  }

  $.root().append(
    `<section class="link-references"><p class="link-references-title">${escapeHtml(heading)}</p><ol class="footnotes-list">${items}</ol></section>`,
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
