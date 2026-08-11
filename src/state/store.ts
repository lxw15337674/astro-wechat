import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DraftIdentity, ResolvedProject } from '../types.js'

export interface StateStore {
  get(sourceId: string): Promise<DraftIdentity | undefined>
  /** Record intent before calling WeChat. */
  putPending(entry: Omit<DraftIdentity, 'writeState'>): Promise<void>
  /** Mark a pending entry as committed with the identifiers WeChat returned. */
  commit(sourceId: string, result: CommitResult): Promise<void>
  /** Note a permanent material that no draft references. */
  recordOrphan(sourceId: string, materialId: string): Promise<void>
  /**
   * Drop an orphan record once a draft references that material.
   *
   * Part of the interface rather than something callers emulate with
   * putPending plus commit: that sequence would briefly move a committed entry
   * back to pending, and an interruption in the middle would make a published
   * article look like one whose outcome is unknown.
   */
  clearOrphan(sourceId: string, materialId: string): Promise<void>
  all(): Promise<readonly DraftIdentity[]>
}

export interface CommitResult {
  readonly mediaId: string
  readonly coverMaterialId?: string
  readonly coverContentHash?: string
}

interface LedgerFile {
  version: number
  entries: Record<string, DraftIdentity>
}

const LEDGER_VERSION = 1

/**
 * Draft state as a JSON file in the Astro repository.
 *
 * Chosen over an external store so every synchronization shows up in the commit
 * history and can be reviewed in a pull request (ADR-0002). The cost is bot
 * commits, which the CI workflow must exclude from anything that treats a
 * repository change as new content.
 */
export class JsonLedgerStore implements StateStore {
  readonly #path: string
  #cache: LedgerFile | undefined

  constructor(path: string) {
    this.#path = path
  }

  static forProject(project: ResolvedProject): JsonLedgerStore {
    return new JsonLedgerStore(resolve(project.root, project.config.ledgerPath))
  }

  get path(): string {
    return this.#path
  }

  async get(sourceId: string): Promise<DraftIdentity | undefined> {
    const ledger = await this.#load()
    return ledger.entries[sourceId]
  }

  async all(): Promise<readonly DraftIdentity[]> {
    const ledger = await this.#load()
    return Object.values(ledger.entries)
  }

  async putPending(entry: Omit<DraftIdentity, 'writeState'>): Promise<void> {
    const ledger = await this.#load()
    const previous = ledger.entries[entry.sourceId]

    ledger.entries[entry.sourceId] = {
      ...previous,
      ...entry,
      // Orphan records survive a rewrite: they are the only trace of material
      // that is already consuming quota.
      orphanedCoverMaterialIds: previous?.orphanedCoverMaterialIds ?? [],
      writeState: 'pending',
      updatedAt: new Date().toISOString(),
    }

    await this.#save(ledger)
  }

  async commit(sourceId: string, result: CommitResult): Promise<void> {
    const ledger = await this.#load()
    const previous = ledger.entries[sourceId]

    if (!previous) {
      throw new Error(`台账中没有 ${sourceId} 的 pending 记录，无法提交。`)
    }

    ledger.entries[sourceId] = {
      ...previous,
      mediaId: result.mediaId,
      coverMaterialId: result.coverMaterialId ?? previous.coverMaterialId,
      coverContentHash: result.coverContentHash ?? previous.coverContentHash,
      writeState: 'committed',
      updatedAt: new Date().toISOString(),
    }

    await this.#save(ledger)
  }

  async recordOrphan(sourceId: string, materialId: string): Promise<void> {
    const ledger = await this.#load()
    const previous = ledger.entries[sourceId]
    if (!previous) return

    const existing = previous.orphanedCoverMaterialIds ?? []
    if (existing.includes(materialId)) return

    ledger.entries[sourceId] = {
      ...previous,
      orphanedCoverMaterialIds: [...existing, materialId],
      updatedAt: new Date().toISOString(),
    }

    await this.#save(ledger)
  }

  async clearOrphan(sourceId: string, materialId: string): Promise<void> {
    const ledger = await this.#load()
    const previous = ledger.entries[sourceId]
    const existing = previous?.orphanedCoverMaterialIds
    if (!previous || !existing?.includes(materialId)) return

    ledger.entries[sourceId] = {
      ...previous,
      orphanedCoverMaterialIds: existing.filter((id) => id !== materialId),
      updatedAt: new Date().toISOString(),
    }

    await this.#save(ledger)
  }

  /**
   * Read the ledger, distinguishing "not there yet" from "could not be read".
   *
   * Only a missing file yields an empty ledger. Every other failure throws.
   *
   * The tempting shortcut — treat any read failure as first-run — produces
   * exactly the outcome this file exists to prevent: an empty ledger makes
   * every article look new, so the next publish recreates drafts for the entire
   * blog. A permissions error or a truncated write would silently do that.
   *
   * Nor can a lost ledger be rebuilt automatically: the remote scan only runs
   * for entries already marked pending, and an empty ledger has none.
   */
  async #load(): Promise<LedgerFile> {
    if (this.#cache) return this.#cache

    let raw: string
    try {
      raw = await readFile(this.#path, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#cache = { version: LEDGER_VERSION, entries: {} }
        return this.#cache
      }
      throw new Error(
        `无法读取台账 ${this.#path}。继续运行会把所有文章当成新文章重新创建，因此中止。`,
        { cause },
      )
    }

    let parsed: LedgerFile
    try {
      parsed = JSON.parse(raw) as LedgerFile
    } catch (cause) {
      throw new Error(
        `台账 ${this.#path} 不是合法 JSON。请从版本历史恢复它，不要删除后重跑 —— ` +
          '空台账会导致每篇文章都被重新创建一份草稿。',
        { cause },
      )
    }

    this.#cache = { version: parsed.version ?? LEDGER_VERSION, entries: parsed.entries ?? {} }
    return this.#cache
  }

  /**
   * Write atomically, with sorted keys.
   *
   * Sorting keeps diffs reviewable — the point of putting this in the
   * repository. Writing through a temporary file means an interrupted run
   * cannot leave a half-written ledger, which would look like "nothing was
   * ever published".
   */
  async #save(ledger: LedgerFile): Promise<void> {
    this.#cache = ledger

    const sorted: Record<string, DraftIdentity> = {}
    for (const key of Object.keys(ledger.entries).sort()) {
      sorted[key] = ledger.entries[key]!
    }

    const serialized = `${JSON.stringify({ version: ledger.version, entries: sorted }, null, 2)}\n`
    const temporary = `${this.#path}.tmp`

    await mkdir(dirname(this.#path), { recursive: true })
    await writeFile(temporary, serialized, 'utf8')
    await rename(temporary, this.#path)
  }
}

/** In-memory store for tests and dry runs. */
export class MemoryStateStore implements StateStore {
  readonly #entries = new Map<string, DraftIdentity>()

  async get(sourceId: string): Promise<DraftIdentity | undefined> {
    return this.#entries.get(sourceId)
  }

  async all(): Promise<readonly DraftIdentity[]> {
    return [...this.#entries.values()]
  }

  async putPending(entry: Omit<DraftIdentity, 'writeState'>): Promise<void> {
    const previous = this.#entries.get(entry.sourceId)
    this.#entries.set(entry.sourceId, {
      ...previous,
      ...entry,
      orphanedCoverMaterialIds: previous?.orphanedCoverMaterialIds ?? [],
      writeState: 'pending',
    })
  }

  async commit(sourceId: string, result: CommitResult): Promise<void> {
    const previous = this.#entries.get(sourceId)
    if (!previous) throw new Error(`没有 ${sourceId} 的 pending 记录。`)

    this.#entries.set(sourceId, {
      ...previous,
      mediaId: result.mediaId,
      coverMaterialId: result.coverMaterialId ?? previous.coverMaterialId,
      coverContentHash: result.coverContentHash ?? previous.coverContentHash,
      writeState: 'committed',
    })
  }

  async recordOrphan(sourceId: string, materialId: string): Promise<void> {
    const previous = this.#entries.get(sourceId)
    if (!previous) return
    const existing = previous.orphanedCoverMaterialIds ?? []
    if (existing.includes(materialId)) return
    this.#entries.set(sourceId, {
      ...previous,
      orphanedCoverMaterialIds: [...existing, materialId],
    })
  }

  async clearOrphan(sourceId: string, materialId: string): Promise<void> {
    const previous = this.#entries.get(sourceId)
    const existing = previous?.orphanedCoverMaterialIds
    if (!previous || !existing?.includes(materialId)) return

    this.#entries.set(sourceId, {
      ...previous,
      orphanedCoverMaterialIds: existing.filter((id) => id !== materialId),
    })
  }
}
