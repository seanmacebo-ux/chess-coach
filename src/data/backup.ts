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
 * profile, the six section ratings) plus the localStorage trio (theme,
 * colour mode, training prefs). A backup that silently skipped one store
 * would be worse than none — you would trust it and it would lie.
 *
 * Restore is deliberately MERGE-shaped, not wipe-shaped: rows are bulkPut by
 * key, so importing an old backup on top of newer local data updates shared
 * rows and never deletes anything local-only. Importing cannot destroy; only
 * clearing site data can, and that is the disaster this file is for.
 */

import { db } from './db'

const LOCAL_KEYS = ['cc.theme', 'cc.colour', 'cc.prefs'] as const

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
    const v = localStorage.getItem(key)
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

export async function restoreBackup(file: File): Promise<Record<string, number>> {
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
    const rows = parsed.tables[table.name]
    if (!Array.isArray(rows) || rows.length === 0) continue
    // bulkPut: update-by-key, never delete. See the module comment — restore
    // must not be able to destroy anything.
    await table.bulkPut(rows)
    counts[table.name] = rows.length
  }

  for (const key of LOCAL_KEYS) {
    const v = parsed.local?.[key]
    if (typeof v === 'string') localStorage.setItem(key, v)
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
