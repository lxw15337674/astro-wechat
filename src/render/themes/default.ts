/**
 * Default WeChat theme.
 *
 * ADR-0003 keeps the theme as a standalone CSS asset with no code around it, so
 * it can be swapped for a community theme without touching the pipeline. Two
 * constraints shape what may appear here:
 *
 * 1. Everything is inlined by `juice` before publishing, so only declarations
 *    that survive as element `style` attributes are useful. Pseudo-elements,
 *    media queries, and `@font-face` silently do nothing.
 * 2. WeChat strips `class` attributes, so selectors exist only to target
 *    elements during inlining, never at read time.
 */
export const DEFAULT_THEME_CSS = `
.astro-wechat-article {
  font-size: 15px;
  line-height: 1.75;
  color: #2f3437;
  word-break: break-word;
  letter-spacing: 0.02em;
}

.astro-wechat-article p {
  margin: 1.2em 0;
}

.astro-wechat-article h1,
.astro-wechat-article h2,
.astro-wechat-article h3,
.astro-wechat-article h4 {
  margin: 1.8em 0 0.9em;
  font-weight: 600;
  line-height: 1.4;
  color: #1a1d1f;
}

.astro-wechat-article h1 { font-size: 21px; }
.astro-wechat-article h2 { font-size: 19px; }
.astro-wechat-article h3 { font-size: 17px; }
.astro-wechat-article h4 { font-size: 15px; }

.astro-wechat-article strong {
  font-weight: 600;
  color: #1a1d1f;
}

/* A bold heading must keep the heading's own color: the rule above targets a
   descendant, so it would otherwise override whatever the heading set. */
.astro-wechat-article h1 strong,
.astro-wechat-article h2 strong,
.astro-wechat-article h3 strong,
.astro-wechat-article h4 strong,
.astro-wechat-article h5 strong,
.astro-wechat-article h6 strong {
  color: inherit;
}

.astro-wechat-article em {
  font-style: italic;
}

.astro-wechat-article del {
  color: #8a9199;
}

/* Wide enough for a three-digit marker: markers render outside the content
   box, and anything narrower gets clipped by the article container once the
   list passes nine items. */
.astro-wechat-article ul,
.astro-wechat-article ol {
  margin: 1.2em 0;
  padding-left: 2em;
}

.astro-wechat-article li {
  margin: 0.5em 0;
}

.astro-wechat-article blockquote {
  margin: 1.4em 0;
  padding: 0.6em 1em;
  border-left: 3px solid #d8dde2;
  background: #f7f8f9;
  color: #4a5158;
}

.astro-wechat-article blockquote p {
  margin: 0.4em 0;
}

.astro-wechat-article code {
  padding: 0.15em 0.35em;
  font-family: Menlo, Consolas, monospace;
  font-size: 13px;
  background: #f2f3f5;
  border-radius: 3px;
  color: #c7254e;
}

.astro-wechat-article pre {
  margin: 1.4em 0;
  padding: 1em;
  overflow-x: auto;
  background: #f7f8f9;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
}

.astro-wechat-article pre code {
  padding: 0;
  background: transparent;
  color: #2f3437;
  font-size: 13px;
}

.astro-wechat-article table {
  width: 100%;
  margin: 1.4em 0;
  border-collapse: collapse;
  font-size: 14px;
}

.astro-wechat-article th,
.astro-wechat-article td {
  padding: 0.5em 0.7em;
  border: 1px solid #e3e6e8;
  text-align: left;
}

.astro-wechat-article th {
  background: #f7f8f9;
  font-weight: 600;
}

.astro-wechat-article hr {
  margin: 2em 0;
  border: none;
  border-top: 1px solid #e3e6e8;
}

.astro-wechat-article sup {
  font-size: 12px;
  color: #6b7580;
}

.astro-wechat-article .link-references,
.astro-wechat-article .footnotes {
  margin-top: 2.4em;
  padding-top: 1em;
  border-top: 1px solid #e3e6e8;
  font-size: 13px;
  color: #6b7580;
}

.astro-wechat-article .link-references-title {
  margin: 0 0 0.6em;
  font-weight: 600;
  color: #4a5158;
}

.astro-wechat-article .footnotes-list {
  padding-left: 2em;
  margin: 0;
}

.astro-wechat-article .footnotes-list li {
  margin: 0.35em 0;
  word-break: break-all;
}
`
