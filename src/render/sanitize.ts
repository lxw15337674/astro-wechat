import sanitizeHtml from 'sanitize-html'

/**
 * Whitelist of what may reach WeChat.
 *
 * Deliberately narrower than what WeChat tolerates. Anything not listed is
 * dropped rather than escaped, because a tag that survives the editor but
 * renders unpredictably on a phone is worse than one that never appears.
 *
 * Runs after CSS inlining, so `style` attributes are the styling mechanism and
 * `class` is only kept for the preview and for tests to assert against.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'section', 'p', 'div', 'span', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'del', 's', 'sub', 'sup', 'mark',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'img', 'figure', 'figcaption', 'a',
  ],
  allowedAttributes: {
    '*': ['style', 'class'],
    img: ['src', 'alt', 'style', 'class', 'width', 'height'],
    a: ['href', 'style', 'class'],
    td: ['colspan', 'rowspan', 'style', 'class'],
    th: ['colspan', 'rowspan', 'style', 'class'],
  },
  // `data:` is needed for data-URI images, which the design permits within
  // configured size limits. It is scoped to img so it cannot appear on links.
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
    a: ['http', 'https', 'mailto'],
  },
  allowProtocolRelative: false,
  // Relative paths are still unresolved at this stage; the image pass runs
  // afterwards and replaces them with placeholders.
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  disallowedTagsMode: 'discard',
}

/**
 * Whitespace between list tags, which HTML ignores and the WeChat editor does not.
 *
 * The editor promotes a whitespace-only text node inside a list into an empty
 * `<li>`, so every real item gains an empty sibling: bullet lists grow blank
 * rows and ordered lists count to twice their length. Markdown renderers put a
 * newline between items, so this reaches every list we publish.
 */
const AFTER_LIST_TAG = /(<\/?(?:ul|ol|li)\b[^>]*>)\s+/g
const BEFORE_LIST_CLOSE = /\s+(<\/(?:ul|ol|li)>)/g

export function collapseListWhitespace(html: string): string {
  return html.replace(AFTER_LIST_TAG, '$1').replace(BEFORE_LIST_CLOSE, '$1')
}

export function sanitizeArticleHtml(html: string): string {
  return collapseListWhitespace(sanitizeHtml(html, OPTIONS))
}
