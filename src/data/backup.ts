/**
 * Backup and restore — persistence Sean actually controls.
 *
 * THE HONEST SITUATION, which this module exists to fix: everything the app
 * knows lives in this browser's IndexedDB. Clear site data, lose the phone,
 * reinstall the PWA — gone. The Supabase sync was built for this and it works
 * when signed in, but it depends on a hosted project that has already been
 * caught paused once ("Failed to fetch"), and a safety net that can silently
 * be down is not a safety net.
 *
 * So: one button writes EVERYTHING to a JSON file you keep, one button reads
 * it back. No server, no account, no dependency that can lapse. The file is
 * yours — drive, chat thread, wherever — and restoring on a new phone is
 * import + done.
 *
 * Everything means everything: all six Dexie tables (games with full PGNs,
 * every mistake with its tag, every puzzle attempt, tier progress, the
 * profile, the six section ratings) plus the localStorage keys (theme,
 * colour mode, training prefs, climb record). A backup that silently skipped one store
 * would be worse than none — you would trust it and it would lie.
 *
 * Restore is deliberately MERGE-shaped, not wipe-shaped: rows are bulkPut by
 * key, so importing an old backup on top of newer local data updates shared
 * rows and never deletes anything local-only. Importing cannot destroy; only
 * clearing site data can, and that is the disaster this file is for.
 */

import { db } from './db'
import { readLocal, writeLocal } from './local'

const LOCAL_KEYS = [
  'cc.theme',
  'cc.colour',
  'cc.prefs',
  'cc.climb',
  'cc.coached',
  'cc.clock',
  'cc.coachedBot',
  'cc.calib',
] as const

/** Bumped if the shape ever changes, so restore can refuse what it cannot read. */
const FORMAT = 1

interface Backup {
  format: number
  exportedAt: string
  tables: Record<string, unknown[]>
  local: Record<string, string>
}

export async function buildBackup(): Promise<{ json: string; counts: Record<string, number> }> {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const table of db.tables) {
    const rows = await table.toArray()
    tables[table.name] = rows
    counts[table.name] = rows.length
  }

  const local: Record<string, string> = {}
  for (const key of LOCAL_KEYS) {
    const v = readLocal(key)
    if (v !== null) local[key] = v
  }

  const backup: Backup = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    tables,
    local,
  }
  return { json: JSON.stringify(backup), counts }
}

/** Trigger a download of the backup file. Returns the per-table row counts. */
export async function downloadBackup(): Promise<Record<string, number>> {
  const { json, counts } = await buildBackup()
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chess-coach-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  return counts
}

/**
 * A backup file is UNTRUSTED INPUT, and it did not used to be treated as any.
 *
 * It arrives from a file picker, so it can be anything: a corrupted download,
 * a truncated sync from a cloud drive, or a file somebody handed over. Three
 * things were missing.
 *
 *   NO SIZE LIMIT. `await file.text()` on a multi-gigabyte file hangs the tab
 *   with no way back.
 *
 *   NO ROW VALIDATION. Rows went into Dexie exactly as they were parsed, so a
 *   backup could plant a `mistakes` row whose fen is a number — which is the
 *   precise shape of the bug that took the Today screen down. The restore path
 *   could manufacture that state deliberately.
 *
 *   IDS WERE HONOURED. bulkPut is upsert-by-primary-key, and the keys came
 *   from the file. A crafted or simply mismatched backup could overwrite the
 *   rows it names — a different game landing on the id of one already there.
 *   The module comment promises "importing cannot destroy". It could.
 */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024

/** Every row must at least be a plain object before Dexie ever sees it. */
function usableRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (r): r is Record<string, unknown> =>
      typeof r === 'object' && r !== null && !Array.isArray(r),
  )
}

export async function restoreBackup(file: File): Promise<Record<string, number>> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new Error(
      `That file is ${Math.round(file.size / 1e6)}MB. A chess-coach backup is a few megabytes — ` +
      'this is not one.',
    )
  }

  let parsed: Backup
  try {
    parsed = JSON.parse(await file.text()) as Backup
  } catch {
    throw new Error('That file is not a chess-coach backup (it does not parse as JSON).')
  }
  if (parsed.format !== FORMAT || typeof parsed.tables !== 'object' || parsed.tables === null) {
    throw new Error('That file is not a chess-coach backup, or it is from a newer version of the app.')
  }

  const counts: Record<string, number> = {}
  for (const table of db.tables) {
    const rows = usableRows(parsed.tables[table.name])
    if (rows.length === 0) continue

    /*
     * Auto-keyed tables get their ids DROPPED and are added fresh.
     *
     * The alternative is letting the file choose primary keys, which is how
     * a restore overwrites rows it has no business touching. Appending costs
     * duplicates when you restore the same file twice — annoying, and
     * recoverable. Overwriting is not recoverable, and this module's whole
     * promise is that importing cannot destroy anything.
     *
     * Tables with a natural key (tierProgress by id, profile by id,
     * sectionRatings by section) are genuinely merge-shaped and keep theirs.
     */
    const autoKeyed = table.schema.primKey.auto
    try {
      if (autoKeyed) {
        await table.bulkAdd(rows.map(({ id: _id, ...rest }) => rest) as unknown[])
      } else {
        await table.bulkPut(rows as unknown[])
      }
      counts[table.name] = rows.length
    } catch (err) {
      /*
       * Dexie throws BulkError when SOME rows fail, after writing the rest.
       * Letting that escape would abandon the restore half-done with no
       * report — the worst possible outcome for the one feature whose entire
       * job is getting your history back. A table that partly fails is
       * counted for what landed and the rest of the restore continues.
       */
      const failures =
        typeof err === 'object' && err !== null && 'failures' in err
          ? (err as { failures: unknown[] }).failures.length
          : rows.length
      counts[table.name] = Math.max(0, rows.length - failures)
    }
  }

  for (const key of LOCAL_KEYS) {
    const v = parsed.local?.[key]
    // The key list is an allowlist, so a file cannot write anywhere else —
    // and the value must be a string, because localStorage stores nothing
    // else and a non-string would be coerced into one that parses oddly.
    if (typeof v === 'string' && v.length <= 1_000_000) writeLocal(key, v)
  }

  return counts
}

/** "34 games, 210 puzzle attempts" — for the confirmation line. */
export function describeCounts(counts: Record<string, number>): string {
  const label: Record<string, string> = {
    games: 'games',
    mistakes: 'mistakes',
    puzzleAttempts: 'puzzle attempts',
    tierProgress: 'tier records',
    profile: 'profile',
    sectionRatings: 'section ratings',
  }
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${label[k] ?? k}`)
  return parts.length ? parts.join(', ') : 'nothing yet'
}
