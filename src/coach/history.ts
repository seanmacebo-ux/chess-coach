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

/* ------------------------------------------------------------------ */
/* Reading a trend out loud                                            */
/* ------------------------------------------------------------------ */

/*
 * Sean, about this whole section: "even the trackers, it's hard to
 * interpret."
 *
 * He is right, and the reason is worth naming precisely. Every chart here
 * rendered a number and a delta — "50%" and a red "-14" — and left the
 * reader to supply three things the screen knew and did not say: what the
 * number was fourteen less THAN, what the fourteen is measured in, and
 * whether down is good. Mistakes-per-game sat directly below puzzle accuracy
 * with the same red styling for a falling line, where falling is the entire
 * goal. A tracker that needs a legend you do not have is decoration.
 *
 * So the reading is done here, in words, as a pure function over the same
 * points the line is drawn from — which also means it can be tested, and
 * tested is the only way the sentence and the picture stay in agreement.
 */

export interface TrendRead {
  /** Latest value with enough data behind it. */
  now: number | null
  /** Earliest one in the window. */
  then: number | null
  change: number | null
  /** Judged against goodWhen, not against the sign. */
  direction: 'better' | 'worse' | 'flat' | 'unknown'
  /** A whole sentence. No legend required. */
  sentence: string
  /** How many of the weeks in the window had enough work to plot. */
  covered: number
}

export interface TrendSpec {
  /** Rendered after every number, e.g. '%'. */
  unit?: string
  /** Which way is progress. */
  goodWhen: 'up' | 'down'
  /** How small a change is not a change. In the metric's own units. */
  noise?: number
  /** What one point of this metric IS, for the sentence: "points", "mistakes". */
  noun?: string
}

/** Two decimal places at most, and never 83.80000000000001. */
export function tidy(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export function readTrend(points: (number | null)[], spec: TrendSpec): TrendRead {
  const { unit = '', goodWhen, noise = 0, noun = 'points' } = spec
  const real = points.filter((p): p is number => p !== null)
  const covered = real.length

  if (covered === 0) {
    return {
      now: null, then: null, change: null, direction: 'unknown', covered,
      sentence: 'Nothing here yet — this fills in once you have a week of work behind you.',
    }
  }
  const now = real[real.length - 1]!
  if (covered === 1) {
    return {
      now, then: null, change: null, direction: 'unknown', covered,
      sentence: `${tidy(now)}${unit} so far. One week is a reading, not a trend — come back after another.`,
    }
  }

  const then = real[0]!
  const change = now - then
  const moved = Math.abs(change) > noise
  const direction = !moved ? 'flat' : (change > 0) === (goodWhen === 'up') ? 'better' : 'worse'
  const word = change > 0 ? 'up' : 'down'

  const sentence = !moved
    ? `Flat: ${tidy(then)}${unit} then, ${tidy(now)}${unit} now. Holding steady.`
    // "up 11 %" is not a thing anybody says, and "up 11%" from 62% to 73%
    // reads as eleven percent OF sixty-two. Percentages move in points.
    : `${tidy(then)}${unit} twelve weeks ago, ${tidy(now)}${unit} now — ` +
      `${word} ${tidy(Math.abs(change))} ${noun}. ` +
      (direction === 'better' ? 'That is the right direction.' : 'That is the wrong direction.')

  return { now, then, change, direction, sentence, covered }
}

/**
 * The answer to the question the heading asks.
 *
 * "Is it working" was a heading above three charts and nothing ever said yes
 * or no. The one case worth calling out by name is the disagreement: puzzle
 * accuracy climbing while the games get worse means the drilling is not
 * reaching the board, and that is a different problem with a different fix
 * from simply not improving.
 */
export function readProgress(reads: {
  /** 'puzzles' | 'play' — which side of the app this measures. */
  side: 'puzzles' | 'play'
  direction: TrendRead['direction']
}[]): string {
  const known = reads.filter((r) => r.direction !== 'unknown')
  if (known.length === 0) {
    return 'Not enough history yet. Train for a fortnight and this starts answering itself.'
  }
  const better = known.filter((r) => r.direction === 'better')
  const worse = known.filter((r) => r.direction === 'worse')

  const puzzlesUp = better.some((r) => r.side === 'puzzles')
  const playDown = worse.some((r) => r.side === 'play')
  if (puzzlesUp && playDown) {
    return 'Mixed, and in the way that matters: the puzzles are improving but the games are not. ' +
      'The drilling is not reaching the board yet — play more and review them.'
  }
  if (worse.length === 0 && better.length > 0) {
    return better.length === known.length
      ? 'Yes. Every measure here is moving the right way.'
      : 'Yes, on balance. Nothing is going backwards.'
  }
  if (better.length === 0 && worse.length > 0) {
    return 'Not right now — everything here has slipped over the window. ' +
      'That usually means less training rather than worse training; check the calendar above.'
  }
  return `Partly: ${better.length} of ${known.length} measures are improving.`
}
