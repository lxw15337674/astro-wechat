/**
 * Types for dependencies that ship none.
 *
 * Kept minimal on purpose: only the shape this package actually uses. A fuller
 * declaration would claim to describe an API we do not exercise and cannot
 * verify against the implementation.
 */

declare module 'markdown-it-footnote' {
  // Deliberately does not reference markdown-it's types. Its default export is
  // a value rather than a class declaration, so naming it as a type here would
  // break the same way it did in the renderer — but silently, because
  // `skipLibCheck` does not check this file.
  //
  // `unknown` is safe: parameters are contravariant, so this stays assignable
  // wherever a plugin taking a concrete MarkdownIt instance is expected.
  const footnotePlugin: (md: unknown, ...params: unknown[]) => void
  export default footnotePlugin
}
