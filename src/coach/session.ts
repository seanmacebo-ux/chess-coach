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
import { loadPrefs } from '../data/settings'
import { pickPuzzles, type Puzzle } from '../data/puzzles'
import { buildRedoSet } from './redo'
import { computeStreak, computeWeaknesses, nextTier, type Weakness } from './profile'
import { puzzleRating } from './rating'
import { LICHESS_MOTIFS, isExerciseBacked, puzzleThemes, type Tier } from './tiers'
import { BOTS, suggestedBot, type Bot } from '../engine/roster'
import type { Style } from '../engine/types'

export interface SessionGame {
  /**
   * Who you are playing. A roster id, not a rating.
   *
   * Today used to emit `{elo: round(rating/100)*100, style}` and the screen
   * printed it: "One game as black vs human bot 800" — the opponent's STYLE
   * and a rounded number, which is the exact failure botLabel() was written
   * to fix on two other screens. You do not remember losing to human 800.
   * You remember losing to Bud.
   *
   * It also meant the number Today asked for was nobody: at 870 it asked for
   * a 900 bot, the roster has none, and Play fell back to the nearest
   * character — so the opponent you got and the opponent Today described
   * could differ, and the opening book that came with it belonged to a third
   * bot. Picking from the roster makes those one thing.
   */
  botId: string
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
  /** How many of `puzzles` are the user's own positions, served first. */
  ownCount: number
  drill: Tier | null
  /** Drill has no puzzle stock — it's trained by generated exercises. */
  drillIsExercise: boolean
  /** True when there's no history yet and the ladder is driving alone. */
  coldStart: boolean
}

/**
 * Who, off the roster, you play today.
 *
 * The style the weakness profile asks for is a PREFERENCE over the bots
 * within reach, never a reason to reach past them: handing a 500 a 1600
 * because the 1600 is the tactical one is not coaching. If nobody in range
 * plays that style, range wins and the reason shown changes to match — the
 * alternative is a screen that says "tactical bot" above a positional one.
 *
 * Within the shortlist, the nearest AT OR ABOVE you, which is the same rule
 * suggestedBot uses and for the same reason: the opponent is a test, not a
 * mirror.
 */
function gameFor(
  rating: number,
  style: Style,
  colour: 'white' | 'black',
  styleWhy: string,
): SessionGame {
  const bot = botForToday(rating, style)
  return {
    botId: bot.id,
    // The bot's OWN rating and style, not the ones we asked for — Play
    // resolves the character from the rating, so these have to agree or you
    // are told about one opponent and given another.
    elo: bot.elo,
    style: bot.style,
    colour,
    why:
      bot.style === style
        ? styleWhy
        : `${bot.name} is the closest test at your rating. ${bot.plays}`,
  }
}

export function botForToday(rating: number, style: Style): Bot {
  const reach = BOTS.filter((b) => b.elo >= rating - 150 && b.elo <= rating + 250)
  const pool = reach.length > 0 ? reach : [suggestedBot(rating)]
  const atOrAbove = (xs: Bot[]): Bot | undefined =>
    [...xs].filter((b) => b.elo >= rating).sort((a, b) => a.elo - b.elo)[0]

  /*
   * Style is a tie-break among the bots that are already a test. A style
   * match BELOW you is not worth taking: it drops the one thing the opponent
   * is for, and "we found you a tactical bot" is poor consolation for an
   * easier game. The last fallback only fires once you have outgrown the
   * roster entirely.
   */
  return (
    atOrAbove(pool.filter((b) => b.style === style)) ??
    atOrAbove(pool) ??
    [...pool].sort((a, b) => b.elo - a.elo)[0]!
  )
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
  // Session length is the user's call, not a hardcoded three. An explicit
  // argument still wins so tests and previews stay deterministic.
  const puzzleCount = opts.puzzleCount ?? loadPrefs().puzzlesPerDay

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

  /*
   * YOUR positions first. The focus card says "missed a tactic, N times" and
   * those N times happened in the user's own games — so the session opens
   * with up to three of those exact positions before any corpus puzzle.
   * Sean: "I am missing tactics but never really able to mimic those things
   * — it's always just connected to weird puzzles." This is the join. Cold
   * start skips it for the same reason it skips the focus: no reviewed
   * games, nothing of yours to serve.
   */
  const own = coldStart ? [] : await buildRedoSet(Math.min(3, puzzleCount))

  const picked = await pickPuzzles({
    // Tactics rating, not the overall one — see coach/rating.ts: puzzleRating.
    // The overall number moves when you beat a bot, and keying puzzles to it
    // meant a good run against the bots made the puzzles harder.
    rating: await puzzleRating(),
    themes,
    count: Math.max(0, puzzleCount - own.length),
    exclude: seen,
    rng: opts.rng,
  })
  const puzzles = [...own, ...picked]

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
    streak: await computeStreak(now),
    focus,
    game: gameFor(profile.rating, style, colour, why),
    puzzles,
    ownCount: own.length,
    drill,
    drillIsExercise: drill ? isExerciseBacked(drill) : false,
    coldStart,
  }
}
