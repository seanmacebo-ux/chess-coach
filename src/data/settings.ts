/**
 * Training preferences.
 *
 * Deliberately localStorage rather than the Dexie profile row. The profile is
 * synced to Supabase and carries the things that ARE your progress — rating,
 * deviation, streak. These are device knobs: how long you want today to be,
 * whether you want the training wheels on. Pushing them through the sync layer
 * would mean a schema migration and would make "quick session on my phone,
 * long session at my desk" impossible, since one device would overwrite the
 * other.
 *
 * Same defensive load pattern as the theme: every field is validated on its
 * own, so a single bad value can't wipe the rest.
 */

export interface Prefs {
  /** How many puzzles the daily session serves. */
  puzzlesPerDay: number
  /**
   * Ask "is anything hanging?" after you choose a move but before it plays.
   * Kotov's blunder-check, as a habit trainer rather than a lecture.
   */
  blunderCheck: boolean
  /** Board coordinates around the edge. */
  showCoordinates: boolean
  /** Move sounds. */
  sound: boolean
}

export const PUZZLE_COUNTS = [3, 5, 8, 12, 20] as const

const KEY = 'cc.prefs'

const DEFAULT: Prefs = {
  // Eight to finish a session, three tries on each. Eight is enough to cover
  // more than one category in a sitting, which is what stops a session from
  // being a narrow slice of whatever you happened to be served.
  puzzlesPerDay: 8,
  // Off by default: it's a real intervention in how a game feels, and turning
  // it on should be a choice you made rather than one you have to undo.
  blunderCheck: false,
  showCoordinates: true,
  sound: false,
}

function clampCount(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT.puzzlesPerDay
  return Math.max(1, Math.min(40, Math.round(n)))
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      puzzlesPerDay: clampCount(p.puzzlesPerDay),
      blunderCheck: typeof p.blunderCheck === 'boolean' ? p.blunderCheck : DEFAULT.blunderCheck,
      showCoordinates:
        typeof p.showCoordinates === 'boolean' ? p.showCoordinates : DEFAULT.showCoordinates,
      sound: typeof p.sound === 'boolean' ? p.sound : DEFAULT.sound,
    }
  } catch {
    return DEFAULT
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private browsing — preferences just won't persist */
  }
}
