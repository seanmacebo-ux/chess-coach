/**
 * One rating per section, so "how am I doing at endgames" has an answer.
 *
 * RECONSTRUCTED. The commit that introduced this module imported it from six
 * places and never committed the file itself, so `main` has not built — or
 * deployed — since. The API here is derived from those call sites exactly; the
 * behaviour is rebuilt from the design stated in `SectionRatingRow` in
 * data/db.ts, which did survive and is unusually explicit about intent.
 *
 * WHY IT EXISTS. Before this there was exactly one number in the app,
 * `profile.rating`, and it moved only when a game against a bot finished.
 * Every puzzle, drill, scan and endgame play-out changed nothing. So the Learn
 * screen could not answer the only question it exists to answer — am I getting
 * better, and at which part.
 *
 * Rating rather than accuracy, because accuracy alone is meaningless without
 * difficulty: eight from ten on 500-rated puzzles and eight from ten on
 * 1200-rated ones are not the same event and a percentage cannot tell them
 * apart.
 *
 * THE ITEM IS THE OPPONENT. Every attempt is scored as a game against something
 * with a rating: the puzzle's own Lichess rating where the caller knows it,
 * otherwise the midpoint of the tier's band. Solving a puzzle rated well above
 * you moves the number a lot; solving one below you barely moves it, and
 * failing it costs. That is the whole model, and it is the same Elo update the
 * bot games already use — deliberately, because two rating systems in one app
 * that disagree is worse than either.
 *
 * PROVISIONAL IS A FIRST-CLASS STATE. A number derived from two attempts is a
 * guess wearing a measurement's clothes. Sections say so until there is enough
 * behind them, and every surface that shows a rating is expected to show that
 * flag with it.
 */

import { db, getProfile, type SectionRatingRow } from '../data/db'
import { PILLARS, tierById, type Pillar } from './tiers'

export type SectionId = Pillar

export const SECTION_IDS: SectionId[] = PILLARS.map((p) => p.id)

export const SECTION_NAME: Record<SectionId, string> = {
  tactics: 'Tactics',
  endgame: 'Endgames',
  positional: 'Position',
  strategy: 'Strategy',
  opening: 'Openings',
}

/** Below this many attempts the number is a guess, and says so. */
const PROVISIONAL_BELOW = 6

/** Fresh sections start wide open; settled ones stop lurching. */
const RD_START = 250
const RD_FLOOR = 60
/** Each attempt shrinks the deviation by this factor. */
const RD_SHRINK = 0.93
/**
 * Idle sections drift back toward uncertainty. Without this a section you
 * trained hard in March keeps a confident number in July, which is the exact
 * failure the decay monitor exists to catch elsewhere in the app.
 */
const RD_GROWTH_PER_DAY = 1.6

/** Enough to draw a trend from, few enough to keep the row small. */
const HISTORY_CAP = 40
/** The trail window a trend is computed over. */
const TREND_OVER = 10

export interface SectionRating {
  section: SectionId
  rating: number
  rd: number
  played: number
  correct: number
  /** Not enough attempts behind it to be called a measurement. */
  provisional: boolean
  updatedAt: string | null
  /** Points moved across the recent trail. 0 when there is nothing to compare. */
  trend: number
  /** Days since the last attempt, or null if there has never been one. */
  daysIdle: number | null
  history: { at: string; rating: number }[]
}

const DAY = 86_400_000

function decayedRd(row: SectionRatingRow, now: number): number {
  if (!row.updatedAt) return row.rd
  const days = Math.max(0, (now - Date.parse(row.updatedAt)) / DAY)
  return Math.min(RD_START, row.rd + days * RD_GROWTH_PER_DAY)
}

function hydrate(row: SectionRatingRow, now: number): SectionRating {
  const history = row.history ?? []
  const window = history.slice(-TREND_OVER)
  const first = window[0]
  const trend = first ? row.rating - first.rating : 0
  return {
    section: row.section as SectionId,
    rating: Math.round(row.rating),
    rd: Math.round(decayedRd(row, now)),
    played: row.played,
    correct: row.correct,
    provisional: row.played < PROVISIONAL_BELOW,
    updatedAt: row.updatedAt,
    trend: Math.round(trend),
    daysIdle: row.updatedAt ? Math.floor((now - Date.parse(row.updatedAt)) / DAY) : null,
    history,
  }
}

function blank(section: SectionId, seed: number): SectionRatingRow {
  return {
    section,
    rating: seed,
    rd: RD_START,
    played: 0,
    correct: 0,
    updatedAt: null,
    history: [],
  }
}

/**
 * Every section, whether or not it has been trained.
 *
 * Missing sections come back seeded from the overall profile rating rather than
 * absent. A screen that has to handle "this section does not exist yet"
 * separately from "this section is untrained" ends up with two empty states
 * that mean the same thing, and one of them always gets forgotten.
 */
export async function getSectionRatings(): Promise<Record<SectionId, SectionRating>> {
  const [rows, profile] = await Promise.all([db.sectionRatings.toArray(), getProfile()])
  const byId = new Map(rows.map((r) => [r.section, r]))
  const now = Date.now()

  const out = {} as Record<SectionId, SectionRating>
  for (const id of SECTION_IDS) {
    out[id] = hydrate(byId.get(id) ?? blank(id, profile.rating), now)
  }
  return out
}

/** Standard Elo expectation. Shared with the bot-game update by design. */
function expected(mine: number, theirs: number): number {
  return 1 / (1 + Math.pow(10, (theirs - mine) / 400))
}

/**
 * Record one training result against the section its tier belongs to.
 *
 * Hung off `recordTierAttempt` rather than given its own call sites: every
 * training surface already reports there with a tier id, and a tier already
 * knows its pillar. A separate function would have needed each runner edited
 * to call both, and the one that got forgotten would be a section that
 * silently never moved.
 */
export async function recordTierResult(
  tierId: string,
  correct: boolean,
  itemRating?: number,
): Promise<SectionRating | null> {
  const tier = tierById(tierId)
  if (!tier) return null

  const section = tier.pillar
  const now = new Date()
  const nowMs = now.getTime()

  const profile = await getProfile()
  const existing = (await db.sectionRatings.get(section)) ?? blank(section, profile.rating)

  // The item is the opponent. Its own rating where the caller knows it — a
  // puzzle carries a real one — otherwise the middle of the tier's band, which
  // is the honest estimate of what that tier is asking of you.
  const opponent = itemRating ?? Math.round((tier.band[0] + tier.band[1]) / 2)

  const rd = decayedRd(existing, nowMs)
  // K scales with how unsure we are, so early attempts move fast and a settled
  // section stops lurching on one puzzle.
  const k = 12 + (rd / RD_START) * 26
  const score = correct ? 1 : 0
  const rating = Math.max(
    100,
    Math.min(3000, existing.rating + k * (score - expected(existing.rating, opponent))),
  )

  const history = [...(existing.history ?? []), { at: now.toISOString(), rating: Math.round(rating) }]
  const row: SectionRatingRow = {
    section,
    rating,
    rd: Math.max(RD_FLOOR, rd * RD_SHRINK),
    played: existing.played + 1,
    correct: existing.correct + (correct ? 1 : 0),
    updatedAt: now.toISOString(),
    history: history.slice(-HISTORY_CAP),
  }

  await db.sectionRatings.put(row)
  return hydrate(row, nowMs)
}

/**
 * Set untrained sections to a known rating, without touching trained ones.
 *
 * Used by the chess.com import. Deliberately non-destructive: a section with
 * real attempts behind it holds a MEASUREMENT, and overwriting a measurement
 * with an import is throwing away the better evidence for the worse. Returns
 * the sections it actually changed so the caller can say so rather than
 * claiming a blanket reset.
 */
export async function seedSections(rating: number): Promise<SectionId[]> {
  const rows = await db.sectionRatings.toArray()
  const byId = new Map(rows.map((r) => [r.section, r]))
  const seeded: SectionId[] = []

  for (const id of SECTION_IDS) {
    const existing = byId.get(id)
    if (existing && existing.played > 0) continue
    await db.sectionRatings.put({ ...blank(id, rating) })
    seeded.push(id)
  }
  return seeded
}

/**
 * What a section's number means, in words, on the surface where it appears.
 *
 * The rule this serves: no bare numbers. A rating you cannot interpret is
 * decoration with extra steps, and "1240" on its own tells you nothing about
 * whether it is trustworthy, which way it is going, or what would move it.
 */
export function explainSection(r: SectionRating | undefined): {
  what: string
  moved: string
  next: string
} {
  if (!r) {
    return {
      what: 'No training recorded here yet.',
      moved: '',
      next: 'Do anything in this section and it starts measuring.',
    }
  }

  const what = r.provisional
    ? `${r.rating} is a starting guess — ${r.played} of ${PROVISIONAL_BELOW} attempts needed before it means anything.`
    : `${r.rating}, from ${r.played} attempts at ${Math.round((r.correct / Math.max(1, r.played)) * 100)}% correct.`

  const moved =
    r.trend === 0
      ? r.played === 0
        ? ''
        : 'Level over your recent attempts.'
      : r.trend > 0
        ? `Up ${r.trend} points recently.`
        : `Down ${Math.abs(r.trend)} points recently.`

  const next =
    r.daysIdle !== null && r.daysIdle >= 21
      ? `Untouched for ${r.daysIdle} days — the number is going stale, not the skill.`
      : r.provisional
        ? 'Keep going: harder items move it further, both ways.'
        : 'Items rated above you move it most. Easy ones barely count.'

  return { what, moved, next }
}

/**
 * One line across all five, naming the strongest and the weakest.
 *
 * Only counts sections that are past provisional. Ranking five guesses against
 * each other produces a confident sentence about noise, which is worse than
 * saying nothing — so below two real measurements this returns null and the
 * caller shows nothing.
 */
export function overallVerdict(ratings: Record<SectionId, SectionRating>): string | null {
  const real = SECTION_IDS.map((id) => ratings[id]).filter((r) => r && !r.provisional)
  if (real.length < 2) {
    const done = SECTION_IDS.filter((id) => (ratings[id]?.played ?? 0) > 0).length
    return done === 0
      ? 'Nothing measured yet. Train anything and these start moving.'
      : 'Not enough training behind these to compare them yet.'
  }

  const sorted = [...real].sort((a, b) => b.rating - a.rating)
  const best = sorted[0]!
  const worst = sorted[sorted.length - 1]!
  const gap = best.rating - worst.rating

  if (gap < 100) {
    return `Even across the board, within ${gap} points. No single part is holding you back.`
  }
  return `${SECTION_NAME[best.section]} is your strongest at ${best.rating} and ${SECTION_NAME[
    worst.section
  ].toLowerCase()} your weakest at ${worst.rating} — a ${gap}-point gap. That gap is where the cheapest rating points are.`
}
