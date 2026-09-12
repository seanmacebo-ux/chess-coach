/**
 * Progress: improvement and decline, measured, with the next action attached.
 *
 * Sean: "I still need to know what I need to do to show improvement and track
 * that, and also how we track declines and things you teach us." Fair — Learn
 * showed STATE (a rating, a ladder) but never MOTION. Every attempt, mistake
 * and game already carries a timestamp; nothing compared this week with last
 * week, so the app could not honestly say "you are getting better at X" or
 * "Y is slipping". This module is that comparison, and everything it says is
 * computed from the log — no vibes.
 *
 * Three questions, three answers:
 *
 *   WHAT DO I DO NOW — concrete steps from the ladder state: the exact tier
 *   to clear with its remaining numbers, and games to play when unlocking is
 *   what is left. Not advice — instructions with counts in them.
 *
 *   AM I IMPROVING — per section, puzzle accuracy this week vs the week
 *   before. Only spoken when both windows have enough attempts to mean
 *   something; "not enough data" is an honest answer and it comes with the
 *   number of reps that would fix it.
 *
 *   WHAT IS DECLINING — per habit tag, mistakes in the last 15 days vs the
 *   15 before. Fewer repeats of "hung a piece" IS the improvement; more is
 *   the decline, named while it is happening rather than after it has cost
 *   a rating band.
 */

import { db } from '../data/db'
import { tiersFor, PILLARS, type Pillar } from './tiers'
import { tierStatuses } from './profile'
import { TAG_LABEL, TAG_THEMES, type MistakeTag } from './analysis'

const DAY = 86_400_000

/** Windows: puzzles move fast (7 days), habits move slow (15). */
const SECTION_WINDOW = 7 * DAY
const HABIT_WINDOW = 15 * DAY

/** Fewer attempts than this and an accuracy is an anecdote, not a trend. */
const MIN_ATTEMPTS = 5

export interface SectionTrend {
  pillar: Pillar
  name: string
  recent: { n: number; accuracy: number }
  prior: { n: number; accuracy: number }
  /** 'na' = not enough data in one of the windows. */
  direction: 'up' | 'down' | 'flat' | 'na'
}

export interface HabitTrend {
  tag: MistakeTag
  label: string
  recent: number
  prior: number
  direction: 'better' | 'worse' | 'flat'
}

/**
 * Did training a weakness actually change anything in real games?
 *
 * The loop this app is built on is: play, find the leak, drill the leak, play
 * again. Every part of that existed and the last link was never shown — you
 * were asked to take on trust that the drills were doing something. This is
 * the receipt.
 *
 * HONESTY ABOUT WHAT THIS IS. It is an association, not a proof. Two windows
 * of a single person's games cannot isolate a cause: you also played more,
 * faced different opponents, and slept better. It is stated as what it is —
 * you drilled this, and here is what happened to it in games — and it refuses
 * to speak at all below a real amount of training.
 */
export interface TrainingEffect {
  tag: MistakeTag
  label: string
  /** Puzzle attempts on this theme in the recent window. */
  drills: number
  /** Mistakes of this kind IN GAMES, prior window then recent. */
  before: number
  after: number
  verdict: 'working' | 'holding' | 'not yet' | 'untested'
}

/** One pillar's row on the ladder strip: how far along it you are. */
export interface LadderRow {
  pillar: Pillar
  name: string
  total: number
  cleared: number
  /** Open to you now but not yet cleared — where the work is. */
  open: number
}

export interface ProgressReport {
  steps: string[]
  sections: SectionTrend[]
  habits: HabitTrend[]
  /** Whether the drills are showing up in games. The loop, proved or not. */
  effects: TrainingEffect[]
  /** The whole ladder at a glance, so "what have you taught me" is visible. */
  ladder: LadderRow[]
  clearedTiers: number
  totalTiers: number
  gamesThisWeek: number
}

export async function buildProgress(rating: number): Promise<ProgressReport> {
  const now = Date.now()
  const [attempts, mistakes, games, statuses] = await Promise.all([
    db.puzzleAttempts.toArray(),
    db.mistakes.toArray(),
    db.games.toArray(),
    tierStatuses(rating),
  ])

  /* ------------------------------------------- sections: 7 vs 7 days */
  const pillarOf = new Map<string, Pillar>()
  for (const p of PILLARS) for (const t of tiersFor(p.id)) pillarOf.set(t.id, p.id)

  const sections: SectionTrend[] = PILLARS.map((p) => {
    // Attempts with no tier (the Climb, category drills) are tactics work.
    const mine = attempts.filter((a) => {
      const pillar = a.tierId ? (pillarOf.get(a.tierId) ?? 'tactics') : 'tactics'
      return pillar === p.id
    })
    const bucket = (from: number, to: number) => {
      const rows = mine.filter((a) => {
        const t = Date.parse(a.at)
        return t >= from && t < to
      })
      const n = rows.length
      const correct = rows.filter((a) => a.correct).length
      return { n, accuracy: n > 0 ? Math.round((correct / n) * 100) : 0 }
    }
    const recent = bucket(now - SECTION_WINDOW, now + 1)
    const prior = bucket(now - 2 * SECTION_WINDOW, now - SECTION_WINDOW)
    const direction =
      recent.n < MIN_ATTEMPTS || prior.n < MIN_ATTEMPTS
        ? ('na' as const)
        : recent.accuracy >= prior.accuracy + 5
          ? ('up' as const)
          : recent.accuracy <= prior.accuracy - 5
            ? ('down' as const)
            : ('flat' as const)
    return { pillar: p.id, name: p.name, recent, prior, direction }
  })

  /* --------------------------------------------- habits: 15 vs 15 days */
  /*
   * GAME mistakes only — not puzzle failures.
   *
   * A failed puzzle writes a mistake row too, which is right for deciding
   * what to train but catastrophic here: drill forks hard, miss a few, and
   * the count of "missed a fork" rises, so the app told you the weakness you
   * are actively working on is SLIPPING. The one screen meant to prove that
   * training works was punishing you for training. Your chess is what happens
   * in games; that is what these windows measure.
   */
  const fromGames = mistakes.filter((m) => (m.source ?? 'game') === 'game')

  const habitCount = (tag: MistakeTag, from: number, to: number) =>
    fromGames.filter((m) => {
      if (m.tag !== tag) return false
      const t = Date.parse(m.at)
      return t >= from && t < to
    }).length

  const tags = [...new Set(fromGames.map((m) => m.tag).filter((t): t is MistakeTag => t !== null))]
  const habits: HabitTrend[] = tags
    .map((tag) => {
      const recent = habitCount(tag, now - HABIT_WINDOW, now + 1)
      const prior = habitCount(tag, now - 2 * HABIT_WINDOW, now - HABIT_WINDOW)
      const direction =
        recent < prior ? ('better' as const) : recent > prior ? ('worse' as const) : ('flat' as const)
      return { tag, label: TAG_LABEL[tag], recent, prior, direction }
    })
    .filter((h) => h.recent + h.prior > 0)
    // Declines first — they are the ones that need to be seen — then by size.
    .sort((a, b) => {
      const rank = (h: HabitTrend) => (h.direction === 'worse' ? 0 : h.direction === 'flat' ? 1 : 2)
      return rank(a) - rank(b) || b.recent - a.recent
    })

  /* ------------------------------------- did the training do anything */
  /**
   * Enough drilling that the question is worth asking. Below this a claim
   * either way is noise dressed as a finding.
   */
  const MIN_DRILLS = 10

  const effects: TrainingEffect[] = tags
    .map((tag) => {
      /*
       * A drill counts for a weakness if it is the kind of drill the app
       * SERVES for that weakness — TAG_THEMES, the same mapping the session
       * builder uses to choose them.
       *
       * The first version used tagForThemes, which maps in the other
       * direction and disagrees: TAG_THEMES sends a "hung-piece" weakness to
       * hangingPiece puzzles, while tagForThemes files a hangingPiece attempt
       * under "missed-free-material". So drills the app had prescribed for a
       * weakness were credited to a different one, and the weakness he was
       * actually working on showed as never trained. The question being asked
       * is "did the training you were given change this", so the mapping has
       * to be the one that gave it.
       */
      const themesFor = new Set(TAG_THEMES[tag] ?? [])
      const drills = attempts.filter((a) => {
        const t = Date.parse(a.at)
        if (t < now - HABIT_WINDOW) return false
        return a.themes.split(' ').some((th) => themesFor.has(th))
      }).length
      const before = habitCount(tag, now - 2 * HABIT_WINDOW, now - HABIT_WINDOW)
      const after = habitCount(tag, now - HABIT_WINDOW, now + 1)
      const verdict: TrainingEffect['verdict'] =
        drills < MIN_DRILLS
          ? 'untested'
          : after < before
            ? 'working'
            : after > before
              ? 'not yet'
              : 'holding'
      return { tag, label: TAG_LABEL[tag], drills, before, after, verdict }
    })
    // Tested ones first, biggest improvement leading.
    .sort((a, b) => {
      const rank = (e: TrainingEffect) => (e.verdict === 'untested' ? 1 : 0)
      return rank(a) - rank(b) || b.before - b.after - (a.before - a.after)
    })

  /* -------------------------------------------------- the next steps */
  const steps: string[] = []
  const active = statuses.find((s) => s.inBand && !s.cleared)
  if (active) {
    const need = Math.max(0, active.tier.clear.solved - active.solved)
    const accNow = Math.round(active.accuracy * 100)
    const accNeed = Math.round(active.tier.clear.accuracy * 100)
    steps.push(
      need > 0
        ? `Clear "${active.tier.name}": solve ${need} more (${active.solved}/${active.tier.clear.solved} done, accuracy ${accNow}% — needs ${accNeed}%).`
        : `Clear "${active.tier.name}": the count is done, accuracy is ${accNow}% and needs ${accNeed}% — solve a few clean to lift it.`,
    )
  }
  const nextLocked = statuses
    .filter((s) => !s.cleared && s.tier.band[0] > rating)
    .sort((a, b) => a.tier.band[0] - b.tier.band[0])[0]
  const gamesThisWeek = games.filter((g) => now - Date.parse(g.playedAt) < SECTION_WINDOW).length
  if (nextLocked) {
    steps.push(
      `"${nextLocked.tier.name}" unlocks at rating ${nextLocked.tier.band[0]} — you are at ${rating}, and rating only moves by playing games (${gamesThisWeek} this week).`,
    )
  }
  const worst = habits.find((h) => h.direction === 'worse')
  if (worst) {
    steps.push(
      `"${worst.label}" is climbing (${worst.prior} → ${worst.recent} in 15 days). Today's session and Fix-your-own-mistakes both target it — do one set.`,
    )
  }

  /*
   * The ladder as state rather than a sentence. "2 of 24 cleared" tells you a
   * quantity; five rows of cells tell you WHERE — that tactics is moving and
   * endgames has not been started.
   */
  const ladder: LadderRow[] = PILLARS.map((p) => {
    const mine = statuses.filter((st) => st.tier.pillar === p.id)
    return {
      pillar: p.id,
      name: p.name,
      total: mine.length,
      cleared: mine.filter((st) => st.cleared).length,
      open: mine.filter((st) => st.inBand && !st.cleared).length,
    }
  })

  return {
    steps,
    sections,
    habits,
    effects,
    ladder,
    clearedTiers: statuses.filter((s) => s.cleared).length,
    totalTiers: statuses.length,
    gamesThisWeek,
  }
}
