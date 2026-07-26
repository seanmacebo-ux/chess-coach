/**
 * The daily session generator.
 *
 * This is the front door and the answer to "I'm not sure what to work on":
 * you never choose. Every morning it reads your rating, your ladder position
 * and your weakness profile, and emits one ~15-minute session.
 *
 * The ordering rule that matters: the LADDER decides by default, the WEAKNESS
 * PROFILE reorders it. Not the other way round. With no game history the
 * profile is empty and an adaptive-first design would just guess; with plenty
 * of history the profile is the sharper signal and pulls the relevant tier
 * forward. Same machinery, gracefully degrading to a sane cold start.
 *
 * Deliberately NOT here: difficulty that drops when you lose. Opponent
 * strength tracks your rating, and your rating only moves on results. A bot
 * that gets easier because you're struggling would feel kind and destroy the
 * entire point of the app.
 */

import { getProfile, db } from '../data/db'
import { pickPuzzles, type Puzzle } from '../data/puzzles'
import { computeWeaknesses, nextTier, type Weakness } from './profile'
import { LICHESS_MOTIFS, isExerciseBacked, puzzleThemes, type Tier } from './tiers'
import type { Style } from '../engine/types'

export interface SessionGame {
  elo: number
  style: Style
  colour: 'white' | 'black'
  /** Why this opponent, in one line, shown to the user. */
  why: string
}

export interface DailySession {
  /** YYYY-MM-DD. */
  date: string
  rating: number
  streak: number
  /** What today is aimed at. Null on a cold start. */
  focus: { label: string; why: string; themes: string[] } | null
  game: SessionGame
  puzzles: Puzzle[]
  drill: Tier | null
  /** Drill has no puzzle stock — it's trained by generated exercises. */
  drillIsExercise: boolean
  /** True when there's no history yet and the ladder is driving alone. */
  coldStart: boolean
}

/**
 * Opponent style is chosen to STRESS the weakness, not to accommodate it.
 * Walking into forks means facing a tactical bot until you stop.
 */
function styleForWeakness(w: Weakness | undefined): { style: Style; why: string } {
  if (!w) return { style: 'human', why: 'A normal opponent at your level.' }

  switch (w.tag) {
    case 'allowed-fork':
    case 'missed-fork':
    case 'missed-tactic':
      return {
        style: 'tactical',
        why: 'Tactical bot — you keep missing shots, so it will punish that.',
      }
    case 'king-safety':
      return {
        style: 'aggressive',
        why: 'Aggressive bot — it will go at your king until you learn to hold it.',
      }
    case 'passive':
      return {
        style: 'positional',
        why: 'Positional bot — it squeezes. Find a plan or get pushed off the board.',
      }
    case 'hung-piece':
    case 'missed-free-material':
      return {
        style: 'solid',
        why: 'Solid bot — it will not gift you anything, so every loose piece costs.',
      }
    case 'endgame-technique':
      return {
        style: 'solid',
        why: 'Solid bot — it trades down and makes you play the endgame.',
      }
    default:
      return { style: 'human', why: 'A normal opponent at your level.' }
  }
}

export interface BuildOptions {
  puzzleCount?: number
  /** Override the date (tests, or "tomorrow's session" previews). */
  now?: Date
  rng?: () => number
}

export async function buildDailySession(opts: BuildOptions = {}): Promise<DailySession> {
  const now = opts.now ?? new Date()
  const date = now.toISOString().slice(0, 10)
  const puzzleCount = opts.puzzleCount ?? 3

  const profile = await getProfile()
  const weaknesses = await computeWeaknesses(5)
  const top = weaknesses[0]

  const gameCount = await db.games.count()
  // Fewer than three analysed games is not a profile, it's an anecdote.
  const coldStart = gameCount < 3 || weaknesses.length === 0

  const focusThemes = coldStart ? [] : (top?.themes ?? [])
  const drill = await nextTier(profile.rating, focusThemes)

  // Never repeat a puzzle already seen.
  const seenRows = await db.puzzleAttempts.toArray()
  const seen = new Set(seenRows.map((r) => r.puzzleId))

  // Only ask the picker for motifs the corpus actually contains. Passing
  // concept keys like 'threat-detection' matches nothing and silently
  // degrades to random puzzles while the UI still claims to be targeted.
  const drillMotifs = puzzleThemes(drill)
  const focusMotifs = focusThemes.filter((t) => LICHESS_MOTIFS.has(t))
  const themes = coldStart ? drillMotifs : [...focusMotifs, ...drillMotifs]

  const puzzles = await pickPuzzles({
    rating: profile.rating,
    themes,
    count: puzzleCount,
    exclude: seen,
    rng: opts.rng,
  })

  const { style, why } = coldStart
    ? {
        style: 'human' as Style,
        why: 'A normal opponent at your level while we learn your game.',
      }
    : styleForWeakness(top)

  // Alternate colour by day so black doesn't quietly get neglected — most
  // players are markedly worse with it precisely because they play it less.
  const dayIndex = Math.floor(Date.parse(date) / 86_400_000)
  const colour: 'white' | 'black' = dayIndex % 2 === 0 ? 'white' : 'black'

  const focus =
    coldStart || !top
      ? null
      : {
          label: top.label,
          why: `${top.recentCount} times in the last 30 days, costing ${Math.round(
            top.totalLossCp / 100,
          )} pawns.`,
          themes: focusThemes,
        }

  return {
    date,
    rating: profile.rating,
    streak: profile.streak,
    focus,
    game: { elo: Math.round(profile.rating / 100) * 100, style, colour, why },
    puzzles,
    drill,
    drillIsExercise: drill ? isExerciseBacked(drill) : false,
    coldStart,
  }
}
