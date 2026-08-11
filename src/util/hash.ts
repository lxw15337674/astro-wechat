import { createHash } from 'node:crypto'

/** Full hex digest. Used wherever content identity is compared. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Shortened digest for placeholders and log lines.
 *
 * Sixteen hex characters is 64 bits, which is far beyond collision range for
 * the number of images in one article, and short enough to read in a diff.
 */
export function shortHash(input: string | Uint8Array): string {
  return sha256Hex(input).slice(0, 16)
}

/**
 * Deterministic serialization for hash inputs.
 *
 * `JSON.stringify` on an object literal preserves insertion order, which makes
 * the hash depend on where a field happens to sit in the source. Sorting keys
 * removes that coupling, so reordering the struct never invalidates every
 * recorded hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const out: Record<string, unknown> = {}
  for (const [key, v] of entries) out[key] = sortValue(v)
  return out
}
