import type { StateStore } from '../state/store.js'
import type { WeChatClient } from '../wechat/client.js'

export interface OrphanRecord {
  readonly sourceId: string
  readonly materialId: string
}

export interface CleanupResult {
  readonly deleted: readonly OrphanRecord[]
  readonly failed: readonly (OrphanRecord & { reason: string })[]
}

/** Every recorded cover material that no draft references. */
export async function listOrphans(store: StateStore): Promise<OrphanRecord[]> {
  const entries = await store.all()

  return entries.flatMap((entry) =>
    (entry.orphanedCoverMaterialIds ?? []).map((materialId) => ({
      sourceId: entry.sourceId,
      materialId,
    })),
  )
}

/**
 * Delete recorded orphaned cover materials.
 *
 * Never runs as part of publishing. Deleting permanent material is
 * irreversible, and orphan cleanup is infrequent manual maintenance, so it
 * stays behind an explicit command and — on the proxy side — a path that is not
 * in the allowlist by default.
 *
 * A failure to delete one orphan does not stop the rest: the whole point is to
 * reclaim as much quota as possible in one pass.
 */
export async function cleanupOrphans(
  store: StateStore,
  client: WeChatClient,
): Promise<CleanupResult> {
  const orphans = await listOrphans(store)
  const deleted: OrphanRecord[] = []
  const failed: (OrphanRecord & { reason: string })[] = []

  for (const orphan of orphans) {
    try {
      await client.deleteMaterial(orphan.materialId)
      await store.clearOrphan(orphan.sourceId, orphan.materialId)
      deleted.push(orphan)
    } catch (error) {
      failed.push({
        ...orphan,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { deleted, failed }
}
