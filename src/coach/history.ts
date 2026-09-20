/**
 * Progression over time, and a record of what you actually did.
 *
 * Sean: "I love that style, but recording my progression is difficult, and
 * also tracing my usage and training is hard with this."
 *
 * Both halves of that are true and they are different problems.
 *
 * PROGRESSION. Learn is built entirely out of pairwise snapshots — 67% from
 * 60%, 3 → 10 in 15 days, 15 drilled. Every one of those compares exactly two
 * points, so the screen can tell you whether this week beat last week and can
 * never show you a shape. Six weeks of steady improvement and six weeks of
 * thrashing about produce the same pair of numbers. A trend needs more than
 * two points and nothing here was keeping more than two.
 *
 * USAGE. There was no record of training at all. History lists GAMES; the
 * puzzles, drills and sessions — most of what he actually does in the app —
 * were written to the database as individual attempts and never shown back in
 * any form. "Did I train on Tuesday" was unanswerable.
 *
 * WHY THIS IS A PURE FUNCTION OVER ARRAYS. Everything else that aggregates in
 * this app reads `db` directly, which means none of it can be tested outside a
 * browser — and the arithmetic here (week boundaries, local days, rolling
 * windows) is exactly the kind that goes wrong quietly. So the aggregation
 * takes rows and returns rows, `loadActivity` is the four lines that fetch
 * them, and scripts/verify-history.ts runs the real thing against fixtures.
 */

import { db, type GameRow, type PuzzleAttemptRow } from '../data/db'

const DAY = 86_400_000

/** How far back the calendar and the trend lines look. */
export const WINDOW_DAYS = 84
const WEEKS = 12

export interface DayActivity {
  /** Local calendar day, YYYY-MM-DD. */
  date: string
  puzzles: number
  solved: number
  games: number
  /** Everything done that day, for the "how hard was this day" shading. */
  total: number
}

export interface WeekPoint {
  /** Local date of the week's first day. */
  start: string
  puzzles: number
  solved: number
  games: number
  /** Puzzle accuracy that week, or null when too few attempts to mean anything. */
  accuracy: number | null
  /** Mean performance rating of games analysed that week, or null. */
  perf: number | null
  /** Game mistakes logged that week, per game played. */
  mistakesPerGame: number | null
}

export interface Activity {
  days: DayActivity[]
  weeks: WeekPoint[]
  /** Days out of the window with any training on them. */
  activeDays: number
  /** Longest run of consecutive active days inside the window. */
  bestRun: number
  /** Current run ending today or yesterday; 0 once a day has been missed. */
  currentRun: number
  totalPuzzles: number
  totalGames: number
}

/**
 * LOCAL day key, not UTC.
 *
 * The same trap the streak had: toISOString() renders in UTC, so anything
 * trained after midnight-minus-the-offset lands on the wrong square of the
 * calendar. For someone training in the evening that is most of their
 * sessions filed under tomorrow.
 */
export function dayKey(t: number | string | Date): string {
  const d = t instanceof Date ? t : new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Midnight local, as a timestamp. */
function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Puzzle attempts below this in a week make an accuracy meaningless. */
const MIN_WEEK_ATTEMPTS = 8

export function buildActivity(
  games: Pick<GameRow, 'playedAt' | 'performanceRating'>[],
  attempts: Pick<PuzzleAttemptRow, 'at' | 'correct'>[],
  mistakeDates: string[],
  now = Date.now(),
): Activity {
  const today = startOfDay(now)
  const first = today - (WINDOW_DAYS - 1) * DAY

  /* ------------------------------------------------- one row per day */
  const byDay = new Map<string, DayActivity>()
  const days: DayActivity[] = []
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const row: DayActivity = {
      date: dayKey(first + i * DAY),
      puzzles: 0, solved: 0, games: 0, total: 0,
    }
    days.push(row)
    byDay.set(row.date, row)
  }

  for (const a of attempts) {
    const row = byDay.get(dayKey(a.at))
    if (!row) continue
    row.puzzles++
    if (a.correct) row.solved++
    row.total++
  }
  for (const g of games) {
    const row = byDay.get(dayKey(g.playedAt))
    if (!row) continue
    row.games++
    // A game is a session's worth of work, so it counts for more than one
    // puzzle when shading the calendar. Otherwise a day spent playing three
    // long games reads as lighter than five minutes of puzzle-tapping.
    row.total += 4
  }

  /* ------------------------------------------------ runs of active days */
  let activeDays = 0
  let bestRun = 0
  let run = 0
  for (const d of days) {
    if (d.total > 0) {
      activeDays++
      run++
      if (run > bestRun) bestRun = run
    } else {
      run = 0
    }
  }
  /*
   * The current run may legitimately end yesterday — it is not broken until a
   * whole day has been missed, otherwise the number reads zero every morning
   * until the first puzzle of the day.
   */
  let currentRun = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.total > 0) currentRun++
    else if (i === days.length - 1) continue
    else break
  }

  /* --------------------------------------------------- weekly points */
  const mistakesByDay = new Map<string, number>()
  for (const at of mistakeDates) {
    const k = dayKey(at)
    mistakesByDay.set(k, (mistakesByDay.get(k) ?? 0) + 1)
  }
  const perfByDay = new Map<string, number[]>()
  for (const g of games) {
    if (g.performanceRating === null) continue
    const k = dayKey(g.playedAt)
    perfByDay.set(k, [...(perfByDay.get(k) ?? []), g.performanceRating])
  }

  const weeks: WeekPoint[] = []
  for (let w = 0; w < WEEKS; w++) {
    const slice = days.slice(w * 7, w * 7 + 7)
    if (slice.length === 0) continue
    let puzzles = 0, solved = 0, gameCount = 0, mistakes = 0
    const perfs: number[] = []
    for (const d of slice) {
      puzzles += d.puzzles
      solved += d.solved
      gameCount += d.games
      mistakes += mistakesByDay.get(d.date) ?? 0
      perfs.push(...(perfByDay.get(d.date) ?? []))
    }
    weeks.push({
      start: slice[0]!.date,
      puzzles, solved, games: gameCount,
      accuracy: puzzles >= MIN_WEEK_ATTEMPTS ? Math.round((solved / puzzles) * 100) : null,
      perf: perfs.length > 0 ? Math.round(perfs.reduce((a, c) => a + c, 0) / perfs.length) : null,
      mistakesPerGame: gameCount > 0 ? Math.round((mistakes / gameCount) * 10) / 10 : null,
    })
  }

  return {
    days,
    weeks,
    activeDays,
    bestRun,
    currentRun,
    totalPuzzles: days.reduce((a, d) => a + d.puzzles, 0),
    totalGames: days.reduce((a, d) => a + d.games, 0),
  }
}

/** The four lines that fetch. Kept apart so the arithmetic above is testable. */
export async function loadActivity(now = Date.now()): Promise<Activity> {
  const [games, attempts, mistakes] = await Promise.all([
    db.games.toArray(),
    db.puzzleAttempts.toArray(),
    db.mistakes.toArray(),
  ])
  return buildActivity(
    games,
    attempts,
    mistakes.filter((m) => (m.source ?? 'game') === 'game').map((m) => m.at),
    now,
  )
}
