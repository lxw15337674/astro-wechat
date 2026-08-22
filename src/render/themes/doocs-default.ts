/**
 * Doocs MD's classic default theme, adapted for AstroWechat's semantic HTML.
 *
 * Source: https://github.com/doocs/md/tree/130f8d5d434420da3d442ae30ee709d2663bf6e1/packages/shared/src/configs/theme-css
 *
 * Doocs resolves editor CSS variables before copying HTML to WeChat. This
 * version carries those default values directly, because WeChat only receives
 * inline styles after `juice` processes this stylesheet.
 */
export const DOOCS_DEFAULT_THEME_CSS = `
.astro-wechat-article {
  font-family: -apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.75;
  text-align: left;
  color: #0a0a0a;
  word-break: break-word;
}

.astro-wechat-article > :first-child {
  margin-top: 0;
}

.astro-wechat-article h1 {
  display: table;
  padding: 0 1em;
  border-bottom: 2px solid #0f4c81;
  margin: 2em auto 1em;
  color: #0a0a0a;
  font-size: 19.2px;
  font-weight: bold;
  text-align: center;
}

.astro-wechat-article h2 {
  display: table;
  padding: 0 0.2em;
  margin: 4em auto 2em;
  color: #fff;
  background: #0f4c81;
  font-size: 19.2px;
  font-weight: bold;
  text-align: center;
}

.astro-wechat-article h3 {
  padding-left: 8px;
  border-left: 3px solid #0f4c81;
  margin: 2em 8px 0.75em 0;
  color: #0a0a0a;
  font-size: 17.6px;
  font-weight: bold;
  line-height: 1.2;
}

.astro-wechat-article h4,
.astro-wechat-article h5,
.astro-wechat-article h6 {
  margin: 1.5em 8px 0.5em;
  color: #0f4c81;
  font-size: 16px;
  font-weight: bold;
}

.astro-wechat-article h4 {
  margin-top: 2em;
}

.astro-wechat-article p {
  margin: 1.5em 8px;
  letter-spacing: 0.1em;
  color: #0a0a0a;
}

.astro-wechat-article blockquote {
  margin: 0 0 1em;
  padding: 1em;
  border-left: 4px solid #0f4c81;
  border-radius: 6px;
  color: #0a0a0a;
  background: #f7f7f7;
}

.astro-wechat-article blockquote > p {
  display: block;
  margin: 0;
  font-size: 1em;
  letter-spacing: 0.1em;
  color: #0a0a0a;
}

/* Markers sit outside the content box, in this padding. One em fits a single
   digit; "29." and beyond overflow past the left edge and the article
   container clips them, so a list longer than nine items loses the tens
   place. Two em holds three digits. */
.astro-wechat-article ul,
.astro-wechat-article ol {
  margin: 1em 0;
  padding-left: 2em;
  color: #0a0a0a;
}

.astro-wechat-article ul {
  list-style: circle;
}

.astro-wechat-article li {
  margin: 0.2em 8px;
  color: #0a0a0a;
}

.astro-wechat-article pre {
  margin: 10px 8px;
  padding: 0.5em 1em 1em;
  overflow-x: auto;
  border-radius: 8px;
  background: #f7f7f7;
  color: #0a0a0a;
  font-family: Menlo, Monaco, "Courier New", monospace;
  font-size: 14.4px;
  line-height: 1.5;
}

.astro-wechat-article pre code {
  display: block;
  padding: 0;
  color: inherit;
  background: transparent;
  font-size: inherit;
  white-space: pre;
}

.astro-wechat-article :not(pre) > code {
  padding: 3px 5px;
  border: 1px solid rgba(15, 76, 129, 0.2);
  border-radius: 4px;
  background: rgba(15, 76, 129, 0.08);
  color: #0f4c81;
  font-family: Menlo, Monaco, "Courier New", monospace;
  font-size: 90%;
}

.astro-wechat-article img {
  display: block;
  max-width: 100%;
  margin: 0.1em auto 0.5em;
  border-radius: 4px;
}

.astro-wechat-article hr {
  height: 0.4em;
  margin: 1.5em 0;
  border: solid rgba(0, 0, 0, 0.1);
  border-width: 2px 0 0;
}

.astro-wechat-article a {
  color: #576b95;
  text-decoration: none;
}

.astro-wechat-article strong {
  color: #0f4c81;
  font-size: inherit;
  font-weight: bold;
}

/* Markdown lets a heading carry bold text, and Substack-style sources emit
   <h2><strong>…</strong></h2> routinely. Without this the brand color above
   wins on the inner element and an h2 renders dark blue on its own dark blue
   background. Headings are already bold, so the emphasis only owes them their
   own color. */
.astro-wechat-article h1 strong,
.astro-wechat-article h2 strong,
.astro-wechat-article h3 strong,
.astro-wechat-article h4 strong,
.astro-wechat-article h5 strong,
.astro-wechat-article h6 strong {
  color: inherit;
}

.astro-wechat-article em {
  font-size: inherit;
  font-style: italic;
}

.astro-wechat-article table {
  width: 100%;
  min-width: 100%;
  margin: 1.2em 0;
  border-collapse: collapse;
  color: #0a0a0a;
}

.astro-wechat-article thead {
  color: #0a0a0a;
  font-weight: bold;
}

.astro-wechat-article th,
.astro-wechat-article td {
  padding: 0.25em 0.5em;
  border: 1px solid rgba(10, 10, 10, 0.15);
  color: #0a0a0a;
  word-break: keep-all;
}

.astro-wechat-article th {
  background: rgba(10, 10, 10, 0.05);
}

.astro-wechat-article .link-references,
.astro-wechat-article .footnotes {
  margin-top: 2em;
  padding-top: 0.5em;
  border-top: 1px solid rgba(10, 10, 10, 0.15);
  color: #0a0a0a;
  font-size: 80%;
}

.astro-wechat-article .link-references-title {
  margin: 0 0 0.6em;
  color: #0f4c81;
  font-weight: bold;
}

.astro-wechat-article .footnotes-list {
  margin: 0;
  padding-left: 2em;
}
`
