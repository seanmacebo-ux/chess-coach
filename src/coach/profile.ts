/**
 * The weakness profile — "where do I lack", computed rather than guessed.
 *
 * Reads the mistake log, weights it by recency and cost, and returns a ranked
 * list of what to fix. This is the input the session generator plans against.
 *
 * Two deliberate choices:
 *
 *   RECENCY DECAY. A blunder from two months ago should not outrank one from
 *   Tuesday. Weight halves roughly every three weeks, so the profile tracks
 *   what you're doing NOW rather than accumulating a permanent rap sheet.
 *
 *   COST, NOT COUNT. Ten 60cp inaccuracies matter less than two dropped
 *   rooks. Ranking by centipawns lost puts the expensive habit on top.
 */

import { db, getProfile, saveProfile, type MistakeRow } from '../data/db'
import { TAG_LABEL, TAG_THEMES, type MistakeTag } from './analysis'
import { CATEGORIES, categoryOf, type Category } from './categories'
import { recordTierResult } from './rating'
import { ALL_TIERS, tierById, type Tier } from './tiers'

/** Recency weight halves about every 21 days. */
const HALF_LIFE_DAYS = 21

function recencyWeight(iso: string, now = Date.now()): number {
  const ageDays = (now - Date.parse(iso)) / 86_400_000
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
}

export interface Weakness {
  tag: MistakeTag
  label: string
  /** All-time occurrences. */
  count: number
  /** Occurrences in the last 30 days. */
  recentCount: number
  totalLossCp: number
  /** Recency- and cost-weighted ranking score. Higher = more urgent. */
  score: number
  /** Tier themes that train this away. */
  themes: string[]
  lastSeen: string
}

export async function computeWeaknesses(limit = 8): Promise<Weakness[]> {
  const rows = (await db.mistakes.toArray()) as MistakeRow[]
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 86_400_000

  const byTag = new Map<MistakeTag, Weakness>()

  for (const m of rows) {
    if (!m.tag) continue
    let w = byTag.get(m.tag)
    if (!w) {
      w = {
        tag: m.tag,
        label: TAG_LABEL[m.tag],
        count: 0,
        recentCount: 0,
        totalLossCp: 0,
        score: 0,
        themes: TAG_THEMES[m.tag] ?? [],
        lastSeen: m.at,
      }
      byTag.set(m.tag, w)
    }
    w.count++
    if (Date.parse(m.at) >= thirtyDaysAgo) w.recentCount++
    w.totalLossCp += m.lossCp
    w.score += m.lossCp * recencyWeight(m.at, now)
    if (Date.parse(m.at) > Date.parse(w.lastSeen)) w.lastSeen = m.at
  }

  return [...byTag.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

export interface Pattern {
  /** Short headline — the finding itself. */
  title: string
  /** The evidence, so it can be argued with rather than taken on faith. */
  detail: string
  /** What to actually do about it. */
  action: string
  /** How much to trust it. Low = interesting, not yet proven. */
  confidence: 'low' | 'solid'
}

/**
 * Look across the whole history for habits, not incidents.
 *
 * The weakness list already says WHAT you get wrong. This asks the harder
 * questions: when does it happen, with which colour, in which phase, and is it
 * getting better or worse. Those are the things you can actually change your
 * routine around.
 *
 * Everything here states its own sample size and marks itself `low` confidence
 * below a threshold. A pattern claimed from four games is a coincidence with
 * good PR, and the app pointing you at a fake habit is worse than saying
 * nothing.
 */
export async function detectPatterns(): Promise<Pattern[]> {
  const [games, mistakes] = await Promise.all([db.games.toArray(), db.mistakes.toArray()])
  const out: Pattern[] = []
  if (mistakes.length === 0 && games.length === 0) return out

  const fromGames = mistakes.filter((m) => (m.source ?? 'game') === 'game')

  /* --- which phase costs you most ------------------------------------ */
  const byPhase = new Map<string, { n: number; cp: number }>()
  for (const m of fromGames) {
    const e = byPhase.get(m.phase) ?? { n: 0, cp: 0 }
    e.n++
    e.cp += m.lossCp
    byPhase.set(m.phase, e)
  }
  if (byPhase.size >= 2) {
    const ranked = [...byPhase.entries()].sort((a, b) => b[1].cp - a[1].cp)
    const [worst, worstV] = ranked[0]!
    const total = ranked.reduce((s, [, v]) => s + v.cp, 0)
    const share = Math.round((worstV.cp / total) * 100)
    if (share >= 45) {
      out.push({
        title: `Your ${worst} is where games are lost`,
        detail: `${share}% of everything you've dropped came in the ${worst}, across ${worstV.n} mistakes.`,
        action:
          worst === 'opening'
            ? 'Slow down before move 12 — most of this is development order, not theory.'
            : worst === 'endgame'
              ? 'Endgame technique is trainable and permanent. Work the endgame ladder.'
              : 'This is where plans matter. Ask what they want before deciding what you want.',
        confidence: worstV.n >= 12 ? 'solid' : 'low',
      })
    }
  }

  /* --- white or black ------------------------------------------------ */
  const asWhite = games.filter((g) => g.humanColour === 'w')
  const asBlack = games.filter((g) => g.humanColour === 'b')
  if (asWhite.length >= 3 && asBlack.length >= 3) {
    const rate = (gs: typeof games) =>
      gs.filter((g) => g.result === 'win').length / Math.max(1, gs.length)
    const w = rate(asWhite)
    const b = rate(asBlack)
    if (Math.abs(w - b) >= 0.25) {
      const weaker = w < b ? 'white' : 'black'
      const strong = w < b ? 'black' : 'white'
      out.push({
        title: `You're markedly worse with ${weaker}`,
        detail: `${Math.round(Math.min(w, b) * 100)}% wins as ${weaker} against ${Math.round(
          Math.max(w, b) * 100,
        )}% as ${strong}, over ${asWhite.length + asBlack.length} games.`,
        action: `Play ${weaker} deliberately for a week. The gap is almost always familiarity, not talent.`,
        confidence: asWhite.length + asBlack.length >= 16 ? 'solid' : 'low',
      })
    }
  }

  /* --- when in the game ---------------------------------------------- */
  if (fromGames.length >= 10) {
    const early = fromGames.filter((m) => m.ply < 20)
    const mid = fromGames.filter((m) => m.ply >= 20 && m.ply < 50)
    const late = fromGames.filter((m) => m.ply >= 50)
    const buckets: [string, typeof early][] = [
      ['the first 10 moves', early],
      ['moves 10-25', mid],
      ['after move 25', late],
    ]
    const ranked = buckets.sort((a, b) => b[1].length - a[1].length)
    const [label, rows] = ranked[0]!
    const share = Math.round((rows.length / fromGames.length) * 100)
    if (share >= 50) {
      out.push({
        title: `Most of your mistakes land in ${label}`,
        detail: `${rows.length} of ${fromGames.length} logged mistakes, ${share}% of the total.`,
        action:
          label === 'after move 25'
            ? 'That is tiredness or technique, not talent. Shorter sessions, and drill conversion.'
            : 'Set a rule: no move in this stretch without naming their threat first.',
        confidence: fromGames.length >= 25 ? 'solid' : 'low',
      })
    }
  }

  /* --- one expensive habit ------------------------------------------- */
  const byTag = new Map<string, number>()
  for (const m of mistakes) {
    if (!m.tag) continue
    byTag.set(m.tag, (byTag.get(m.tag) ?? 0) + m.lossCp)
  }
  if (byTag.size >= 2) {
    const ranked = [...byTag.entries()].sort((a, b) => b[1] - a[1])
    const [tag, cp] = ranked[0]!
    const total = ranked.reduce((s, [, v]) => s + v, 0)
    const share = Math.round((cp / total) * 100)
    if (share >= 35) {
      out.push({
        title: `One habit is costing you more than everything else`,
        detail: `"${TAG_LABEL[tag as MistakeTag] ?? tag}" accounts for ${share}% of everything you've lost — about ${Math.round(
          cp / 100,
        )} pawns.`,
        action: 'Fixing this single thing would be worth more than all your other work combined.',
        confidence: 'solid',
      })
    }
  }

  /* --- are you improving --------------------------------------------- */
  const analysed = games.filter((g) => g.acpl !== null).sort((a, b) => a.playedAt.localeCompare(b.playedAt))
  if (analysed.length >= 8) {
    const half = Math.floor(analysed.length / 2)
    const mean = (gs: typeof analysed) =>
      gs.reduce((s, g) => s + (g.acpl ?? 0), 0) / Math.max(1, gs.length)
    const older = mean(analysed.slice(0, half))
    const newer = mean(analysed.slice(half))
    const delta = Math.round(older - newer)
    if (Math.abs(delta) >= 8) {
      out.push({
        title: delta > 0 ? 'You are getting more accurate' : 'Your accuracy has slipped',
        detail: `${Math.round(older)} centipawns lost per move over your first ${half} games, ${Math.round(
          newer,
        )} over the last ${analysed.length - half}.`,
        action:
          delta > 0
            ? 'Whatever you changed is working. Keep the routine.'
            : 'Usually means playing faster or longer sessions. Shorter and slower beats more.',
        confidence: analysed.length >= 20 ? 'solid' : 'low',
      })
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Rating                                                              */
/* ------------------------------------------------------------------ */

/**
 * Update the player rating after a game.
 *
 * Glicko-lite: K scales with rating deviation, so early games move the number
 * fast and later ones barely nudge it. RD shrinks with every game and is
 * floored so the rating never becomes completely rigid.
 */
export async function updateRatingFromGame(
  opponentElo: number,
  score: 0 | 0.5 | 1,
): Promise<{ rating: number; delta: number }> {
  const p = await getProfile()
  const expected = 1 / (1 + Math.pow(10, (opponentElo - p.rating) / 400))
  // RD 250 (fresh) -> K 40; RD 45 (settled) -> K ~20.
  const k = 16 + (p.ratingDeviation / 250) * 24
  const delta = Math.round(k * (score - expected))
  // Floor at 100, not 400. The old floor sat above real beginners: a player
  // rated 316 could never have their rating go DOWN, so every loss was
  // silently discarded and the number they were coached against was fiction.
  const rating = Math.max(100, Math.min(2800, p.rating + delta))
  const ratingDeviation = Math.max(45, p.ratingDeviation * 0.94)
  await saveProfile({ rating, ratingDeviation })
  return { rating, delta }
}

/** Day-streak bookkeeping. Call once when a daily session completes. */
export async function markSessionComplete(today = new Date()): Promise<number> {
  const p = await getProfile()
  const dayKey = today.toISOString().slice(0, 10)
  if (p.lastSessionDate === dayKey) return p.streak

  const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)
  const streak = p.lastSessionDate === yesterday ? p.streak + 1 : 1
  await saveProfile({ lastSessionDate: dayKey, streak })
  return streak
}

/* ------------------------------------------------------------------ */
/* Tier progress                                                       */
/* ------------------------------------------------------------------ */

export interface TierStatus {
  tier: Tier
  solved: number
  correct: number
  accuracy: number
  cleared: boolean
  /** 0..1 toward the clear requirement. */
  progress: number
  /** In your rating window right now. */
  inBand: boolean
}

export async function tierStatuses(rating: number): Promise<TierStatus[]> {
  const rows = await db.tierProgress.toArray()
  const byId = new Map(rows.map((r) => [r.id, r]))

  return ALL_TIERS.map((tier) => {
    const r = byId.get(tier.id)
    const solved = r?.solved ?? 0
    const correct = r?.correct ?? 0
    const accuracy = solved > 0 ? correct / solved : 0
    return {
      tier,
      solved,
      correct,
      accuracy,
      cleared: r?.cleared ?? false,
      progress: Math.min(1, solved / tier.clear.solved),
      inBand: rating >= tier.band[0] && rating <= tier.band[1],
    }
  })
}

/**
 * Record a puzzle result against a tier and clear it if the bar is met.
 * A tier clears on volume AND accuracy — grinding 20 puzzles at 40% is not
 * mastery, and letting it count would hollow out the whole ladder.
 *
 * This also moves the SECTION RATING, and that is why the extra behaviour was
 * put here rather than in a new function. Both callers — the puzzle runner and
 * the endgame play-out — already call this with a tier id, and a tier already
 * knows its pillar, so hanging the rating update off this seam means every
 * existing training surface starts feeding the per-section ratings without a
 * single call site changing. A separate function would have needed each runner
 * edited to call both, and the one that got forgotten would have been a
 * section that silently never moved.
 *
 * A failure to write the rating must not lose the tier progress, so it is
 * caught rather than allowed to reject: the tier tally is the older and more
 * load-bearing record of the two.
 */
export async function recordTierAttempt(
  tierId: string,
  correct: boolean,
  /** Difficulty of the specific item, when the caller knows it. Puzzles carry
   *  their own Lichess rating, which is far better evidence than the tier band
   *  midpoint — a 900-rated fork and a 1600-rated fork sit in the same tier. */
  itemRating?: number,
): Promise<TierStatus | null> {
  const tier = tierById(tierId)
  if (!tier) return null

  try {
    await recordTierResult(tierId, correct, itemRating)
  } catch (err) {
    console.error('[rating] section update failed, tier progress kept', err)
  }

  const now = new Date().toISOString()
  const existing = await db.tierProgress.get(tierId)
  const solved = (existing?.solved ?? 0) + 1
  const correctCount = (existing?.correct ?? 0) + (correct ? 1 : 0)
  const accuracy = correctCount / solved
  const cleared =
    (existing?.cleared ?? false) ||
    (solved >= tier.clear.solved && accuracy >= tier.clear.accuracy)

  await db.tierProgress.put({
    id: tierId,
    solved,
    correct: correctCount,
    cleared,
    clearedAt: cleared ? (existing?.clearedAt ?? now) : null,
    updatedAt: now,
  })

  return {
    tier,
    solved,
    correct: correctCount,
    accuracy,
    cleared,
    progress: Math.min(1, solved / tier.clear.solved),
    inBand: true,
  }
}

/**
 * The next tier to work on: lowest-index uncleared tier inside your rating
 * window, optionally biased to a pillar the weakness profile points at.
 */
export async function nextTier(rating: number, preferThemes: string[] = []): Promise<Tier | null> {
  const statuses = await tierStatuses(rating)
  const open = statuses.filter((s) => s.inBand && !s.cleared)
  if (open.length === 0) {
    // Everything in-band is done — reach up to the next tier above the window.
    const above = statuses
      .filter((s) => !s.cleared && s.tier.band[0] > rating)
      .sort((a, b) => a.tier.band[0] - b.tier.band[0])
    return above[0]?.tier ?? null
  }
  if (preferThemes.length > 0) {
    const matching = open.filter((s) => s.tier.themes.some((t) => preferThemes.includes(t)))
    if (matching.length > 0) {
      matching.sort((a, b) => a.tier.index - b.tier.index)
      return matching[0]!.tier
    }
  }
  open.sort((a, b) => a.tier.index - b.tier.index)
  return open[0]!.tier
}

/* ------------------------------------------------------------------ */
/* Are you gaining in one place and losing it in another?              */
/* ------------------------------------------------------------------ */

export type TrendState = 'gaining' | 'holding' | 'slipping' | 'untested' | 'new'

export interface CategoryTrend {
  category: Category
  /** Attempts in the recent window. */
  recent: number
  recentAccuracy: number | null
  /** Attempts in the window before that. */
  prior: number
  priorAccuracy: number | null
  /** Percentage points, recent minus prior. */
  delta: number | null
  state: TrendState
  /** Days since you last touched this category. Null if never. */
  daysSince: number | null
}

const DAY = 86_400_000
/** "Recently" — long enough to gather a sample, short enough to be current. */
const RECENT_DAYS = 14
/** How far back the comparison window runs. */
const PRIOR_DAYS = 42
/** Below this, an accuracy figure is noise rather than a measurement. */
const MIN_SAMPLE = 5
/** Percentage points of movement before it counts as a real change. */
const MOVE_PP = 8
/** Untouched for this long and it is decaying whether or not you notice. */
const STALE_DAYS = 21

/**
 * Per-category direction of travel.
 *
 * The brief was "watch what I am gaining, but do not let me weaken elsewhere",
 * and that needs two windows rather than one number. A single accuracy figure
 * tells you where you are; comparing the last fortnight against the month
 * before it tells you which way you are moving — which is the only way to
 * catch the classic failure mode of grinding one category while three others
 * quietly rot.
 *
 * Deliberate choices:
 *
 *   A category you have NOT TOUCHED is reported, not skipped. Silence is the
 *   most common way skills decay, and a monitor that only reports on things
 *   you are already practising would miss it entirely.
 *
 *   Small samples say "new" rather than inventing a trend. Two puzzles is not
 *   evidence of anything, and a confident wrong readout is worse than a
 *   hedge.
 */
export async function categoryTrends(): Promise<CategoryTrend[]> {
  const attempts = await db.puzzleAttempts.toArray()
  const now = Date.now()

  return CATEGORIES.map((category): CategoryTrend => {
    const mine = attempts.filter((a) => {
      const themes = a.themes.split(' ').filter(Boolean)
      return categoryOf(themes).id === category.id
    })

    if (mine.length === 0) {
      return {
        category,
        recent: 0,
        recentAccuracy: null,
        prior: 0,
        priorAccuracy: null,
        delta: null,
        state: 'untested',
        daysSince: null,
      }
    }

    const newest = Math.max(...mine.map((a) => Date.parse(a.at)))
    const daysSince = Math.floor((now - newest) / DAY)

    const recentRows = mine.filter((a) => now - Date.parse(a.at) <= RECENT_DAYS * DAY)
    const priorRows = mine.filter((a) => {
      const age = now - Date.parse(a.at)
      return age > RECENT_DAYS * DAY && age <= PRIOR_DAYS * DAY
    })

    const acc = (rows: typeof mine) =>
      rows.length === 0 ? null : (rows.filter((r) => r.correct).length / rows.length) * 100

    const recentAccuracy = acc(recentRows)
    const priorAccuracy = acc(priorRows)

    let state: TrendState
    let delta: number | null = null

    if (recentRows.length === 0) {
      // Nothing lately. Stale is a finding in its own right.
      state = daysSince >= STALE_DAYS ? 'slipping' : 'holding'
    } else if (
      recentRows.length < MIN_SAMPLE ||
      priorRows.length < MIN_SAMPLE ||
      recentAccuracy === null ||
      priorAccuracy === null
    ) {
      state = 'new'
    } else {
      delta = Math.round(recentAccuracy - priorAccuracy)
      state = delta >= MOVE_PP ? 'gaining' : delta <= -MOVE_PP ? 'slipping' : 'holding'
    }

    return {
      category,
      recent: recentRows.length,
      recentAccuracy: recentAccuracy === null ? null : Math.round(recentAccuracy),
      prior: priorRows.length,
      priorAccuracy: priorAccuracy === null ? null : Math.round(priorAccuracy),
      delta,
      state,
      daysSince,
    }
  })
}

/**
 * The one-line verdict: what is improving, and what is being neglected to pay
 * for it. Returns null when there is not enough history to say anything
 * honest.
 */
export function balanceVerdict(trends: CategoryTrend[]): string | null {
  const gaining = trends.filter((t) => t.state === 'gaining')
  const slipping = trends.filter((t) => t.state === 'slipping')
  const untested = trends.filter((t) => t.state === 'untested')

  if (gaining.length === 0 && slipping.length === 0 && untested.length < 3) return null

  const parts: string[] = []
  if (gaining.length > 0) {
    parts.push(`Climbing in ${gaining.map((t) => t.category.name.toLowerCase()).join(' and ')}`)
  }
  if (slipping.length > 0) {
    const names = slipping.map((t) => t.category.name.toLowerCase()).join(' and ')
    parts.push(
      parts.length > 0
        ? `but ${names} ${slipping.length === 1 ? 'has' : 'have'} gone backwards`
        : `Slipping in ${names}`,
    )
  }
  if (untested.length >= 3 && parts.length === 0) {
    return `${untested.length} categories untouched so far. Breadth first — a gap you have never tested is a gap you cannot see.`
  }
  if (untested.length > 0) {
    parts.push(`${untested.length} still untouched`)
  }
  return parts.join(', ') + '.'
}
