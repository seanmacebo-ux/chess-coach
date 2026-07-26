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
  const rating = Math.max(400, Math.min(2800, p.rating + delta))
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
 */
export async function recordTierAttempt(
  tierId: string,
  correct: boolean,
): Promise<TierStatus | null> {
  const tier = tierById(tierId)
  if (!tier) return null

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
