import { RenderError } from '../errors.js'
import { DEFAULT_THEME_CSS } from './themes/default.js'
import { DOOCS_DEFAULT_THEME_CSS } from './themes/doocs-default.js'

export interface Theme {
  readonly name: string
  readonly css: string
  /** Heading placed above the generated link reference list. */
  readonly referenceHeading: string
}

const THEMES = new Map<string, Theme>([
  ['default', { name: 'default', css: DEFAULT_THEME_CSS, referenceHeading: '参考链接' }],
  ['doocs-default', { name: 'doocs-default', css: DOOCS_DEFAULT_THEME_CSS, referenceHeading: '参考链接' }],
])

export function getTheme(name: string): Theme {
  const theme = THEMES.get(name)
  if (!theme) {
    const known = [...THEMES.keys()].join(', ')
    throw new RenderError(`未知主题 ${name}。可用：${known}`, { code: 'unknown-theme' })
  }
  return theme
}

/** Root class the theme selectors hang off. */
export const ARTICLE_CLASS = 'astro-wechat-article'
