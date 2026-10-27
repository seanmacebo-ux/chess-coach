/**
 * What you actually know of your openings, and what has gone stale.
 *
 * WHY THIS EXISTS. Sean: "even learning from opening its hard to tell and to
 * track that right now." He was right, and the cause was not that the data
 * was missing — OpeningTrainer has been writing a puzzleAttempts row for
 * every completed line since it was built, keyed `opening:<openingId>:<lineId>`
 * with `correct` meaning a clean run. Nothing ever read it back. The Openings
 * screen said "6 lines · at your level" whether you had drilled an opening ten
 * times or never opened it, so there was no difference on screen between a
 * repertoire you had learned and one you had merely been offered.
 *
 * KNOWING A LINE ONCE IS NOT LEARNING IT, which is the other half of "hard to
 * tell". A count of lines ever completed would go up and never come down, and
 * a number that only goes up answers "what have I touched", not "what do I
 * know". So a clean run puts a line to sleep for a while and it wakes up
 * needing to be shown again — longer each time it survives. That interval IS
 * the claim about learning: a line you have produced correctly four times,
 * weeks apart, is one you know, and the app can say so because it watched it
 * happen.
 *
 * DELIBERATELY PURE, like coach/headtohead.ts and coach/redo.ts. Rows in,
 * answers out, no `db` — the arithmetic around dates and intervals is exactly
 * the sort of thing that is quietly off by one, and a module that reads the
 * database cannot be tested outside a browser.
 */

import type { PuzzleAttemptRow } from '../data/db'

export type LineState =
  /** Never completed. */
  | 'untried'
  /** Completed, but never cleanly — you have seen it, you cannot produce it. */
  | 'learning'
  /** Clean at least once and not yet due again. */
  | 'known'
  /** Clean before, but long enough ago that it needs showing again. */
  | 'due'

export interface LineProgress {
  openingId: string
  lineId: string
  /** Completed runs, clean or not. */
  tries: number
  /** Consecutive clean runs, most recent first. Resets on a miss. */
  streak: number
  /** ISO of the last clean run, or null. */
  lastCleanAt: string | null
  /** ISO of the last run of any kind, or null. */
  lastTriedAt: string | null
  state: LineState
  /** Days until it is due again. 0 when it is due now or untried. */
  restDays: number
}

/**
 * How long a line sleeps after a clean run, by how many clean runs it has
 * survived.
 *
 * A day, three, a week, three weeks, then two months. Not tuned against
 * anything — there is no data to tune it against yet, and saying so is better
 * than implying there is. What matters more than the exact numbers is that
 * the interval GROWS, so a line you keep producing stops asking for time and
 * the ones you are shaky on keep coming back.
 */
const REST_DAYS = [1, 3, 7, 21, 60]

const restFor = (streak: number): number =>
  REST_DAYS[Math.min(streak, REST_DAYS.length) - 1] ?? REST_DAYS[REST_DAYS.length - 1]!

const DAY_MS = 86_400_000

/** `opening:<openingId>:<lineId>` — written by OpeningTrainer. */
export function parseId(puzzleId: string): { openingId: string; lineId: string } | null {
  if (!puzzleId.startsWith('opening:')) return null
  const rest = puzzleId.slice('opening:'.length)
  // Line ids may contain colons; the opening id is the first segment only.
  const cut = rest.indexOf(':')
  if (cut <= 0 || cut === rest.length - 1) return null
  return { openingId: rest.slice(0, cut), lineId: rest.slice(cut + 1) }
}

/**
 * Progress on every line that has ever been completed.
 *
 * Untried lines are absent — this module does not know what lines exist, and
 * inventing them from attempt rows would quietly limit the repertoire to the
 * part of it you have already touched. `summarise` takes the real list.
 */
export function progress(attempts: PuzzleAttemptRow[], now = new Date()): Map<string, LineProgress> {
  const byLine = new Map<string, PuzzleAttemptRow[]>()
  for (const a of attempts) {
    const id = parseId(a.puzzleId)
    if (!id) continue
    const key = `${id.openingId}:${id.lineId}`
    const list = byLine.get(key)
    if (list) list.push(a)
    else byLine.set(key, [a])
  }

  const out = new Map<string, LineProgress>()
  for (const [key, rows] of byLine) {
    const id = parseId(`opening:${key}`)
    if (!id) continue
    // Newest first. Rows with no date sort last rather than throwing — a
    // restored backup can carry them.
    const sorted = [...rows].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

    let streak = 0
    for (const r of sorted) {
      if (!r.correct) break
      streak++
    }
    const lastClean = sorted.find((r) => r.correct)?.at ?? null
    const lastTried = sorted[0]?.at ?? null

    let state: LineState
    let restDays = 0
    if (streak === 0) {
      // Completed at least once (it is in this map) but not cleanly, or the
      // last run was a miss — either way it is not known.
      state = 'learning'
    } else {
      const rest = restFor(streak)
      const since = lastClean ? (now.getTime() - new Date(lastClean).getTime()) / DAY_MS : rest
      restDays = Math.max(0, Math.ceil(rest - since))
      state = restDays > 0 ? 'known' : 'due'
    }

    out.set(key, {
      openingId: id.openingId,
      lineId: id.lineId,
      tries: rows.length,
      streak,
      lastCleanAt: lastClean,
      lastTriedAt: lastTried,
      state,
      restDays,
    })
  }
  return out
}

export interface OpeningSummary {
  openingId: string
  /** Every line the opening has. */
  total: number
  /** Clean at least once and not yet due. */
  known: number
  /** Clean before, needing a look now. */
  due: number
  /** Completed but never cleanly. */
  learning: number
  /** Never completed. */
  untried: number
}

/**
 * One opening, counted against the lines it actually has.
 *
 * `lineIds` comes from the content rather than from the attempts, so a line
 * you have never opened is counted as untried instead of not existing.
 */
export function summarise(
  openingId: string,
  lineIds: string[],
  byLine: Map<string, LineProgress>,
): OpeningSummary {
  const s: OpeningSummary = {
    openingId,
    total: lineIds.length,
    known: 0,
    due: 0,
    learning: 0,
    untried: 0,
  }
  for (const lineId of lineIds) {
    const p = byLine.get(`${openingId}:${lineId}`)
    if (!p) s.untried++
    else if (p.state === 'known') s.known++
    else if (p.state === 'due') s.due++
    else s.learning++
  }
  return s
}

/**
 * The line on the card: where you are, in the fewest words that are true.
 *
 * "4 of 6" rather than a percentage, because six lines is not a population
 * and 67% implies a precision that is not there. Due comes second and is
 * never hidden — a repertoire that has gone stale looks identical to one you
 * know until something says otherwise, which was the whole complaint.
 */
export function summaryLine(s: OpeningSummary): string {
  if (s.total === 0) return 'no lines yet'
  if (s.known + s.due + s.learning === 0) return `${s.total} lines · not started`
  const parts = [`${s.known} of ${s.total} known`]
  if (s.due > 0) parts.push(`${s.due} due`)
  if (s.learning > 0) parts.push(`${s.learning} shaky`)
  return parts.join(' · ')
}

/** Everything across the repertoire that wants looking at today. */
export function dueLines(byLine: Map<string, LineProgress>): LineProgress[] {
  return [...byLine.values()]
    .filter((p) => p.state === 'due' || p.state === 'learning')
    .sort((a, b) => (a.lastTriedAt ?? '').localeCompare(b.lastTriedAt ?? ''))
}
