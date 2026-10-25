/**
 * Your record against each bot.
 *
 * Sean asked for competitive drive, and the honest finding was that the app
 * could not give him one: GameRow had no botId, so a game stored an elo and a
 * style and the opponent was GUESSED back from the rating at display time.
 * That is fine for a label and useless for a record — two bots can share a
 * rating band, the slider can land between them, and you cannot have a
 * head-to-head against a number.
 *
 * WHY THIS IS THE WHOLE FEATURE. Eleven bots with faces and bios are still
 * eleven settings until one of them has beaten you. "3-1" turns a difficulty
 * dial into an opponent you have a history with, and "never beaten" turns the
 * next game into something worth playing. The record IS the drive; it does not
 * need a points system on top of it.
 *
 * DELIBERATELY PURE. Takes rows, returns rows, like coach/history.ts and for
 * the same reason: the arithmetic here is small and easy to get quietly wrong,
 * and a module that reads `db` directly cannot be tested outside a browser.
 */

import type { GameRow } from '../data/db'

export interface Record {
  botId: string
  played: number
  wins: number
  losses: number
  draws: number
  /** Most recent first — the last few results, for a form line. */
  recent: ('win' | 'loss' | 'draw')[]
  /** ISO date of the last game against them, or null. */
  lastPlayed: string | null
}

const BLANK = (botId: string): Record => ({
  botId, played: 0, wins: 0, losses: 0, draws: 0, recent: [], lastPlayed: null,
})

/** How many results the form line carries. */
const FORM = 5

/**
 * A game that counts toward a head-to-head.
 *
 * Imported chess.com games are excluded by construction — they have no botId
 * — but the check is explicit because `opponentStyle` on those rows is
 * `'chess.com · <name>'` and a future change that starts inferring a bot from
 * the elo would silently pull a stranger's games into Nadia's record.
 */
function counts(g: GameRow): boolean {
  if (!g.botId) return false
  if (typeof g.opponentStyle === 'string' && g.opponentStyle.startsWith('chess.com')) return false
  return g.result === 'win' || g.result === 'loss' || g.result === 'draw'
}

/** Every bot you have a game against, keyed by bot id. */
export function records(games: GameRow[]): Map<string, Record> {
  const byBot = new Map<string, Record>()
  // Oldest first, so `recent` can be built by unshifting and stays newest-first.
  const ordered = [...games].filter(counts).sort((a, b) =>
    (a.playedAt ?? '').localeCompare(b.playedAt ?? ''),
  )
  for (const g of ordered) {
    const rec = byBot.get(g.botId!) ?? BLANK(g.botId!)
    rec.played++
    if (g.result === 'win') rec.wins++
    else if (g.result === 'loss') rec.losses++
    else rec.draws++
    rec.recent.unshift(g.result)
    if (rec.recent.length > FORM) rec.recent.length = FORM
    rec.lastPlayed = g.playedAt ?? rec.lastPlayed
    byBot.set(g.botId!, rec)
  }
  return byBot
}

/** One bot's record, or a blank one. Never null — a bot you have not played is 0-0. */
export function recordVs(games: GameRow[], botId: string): Record {
  return records(games).get(botId) ?? BLANK(botId)
}

/**
 * The record as it goes on the bot's tile.
 *
 * Short enough to sit beside the stakes. Draws are only mentioned when there
 * are some, because "3-1-0" reads like a typo to anybody who has not been
 * told what the third number is.
 */
export function scoreline(rec: Record): string | null {
  if (rec.played === 0) return null
  return rec.draws > 0
    ? `${rec.wins}-${rec.losses}-${rec.draws}`
    : `${rec.wins}-${rec.losses}`
}

/**
 * One line for the bot's card: where you stand, and what is still owed.
 *
 * "Never beaten" is the most motivating thing the app can say about an
 * opponent, so it is said plainly rather than buried in a ratio.
 */
export function standing(rec: Record): string {
  if (rec.played === 0) return 'You have never played them.'
  if (rec.wins === 0) {
    return rec.played === 1
      ? 'Played once, lost. Never beaten.'
      : `${rec.played} games, never beaten.`
  }
  if (rec.losses === 0) {
    return rec.played === 1 ? 'Beaten once, first time.' : `${rec.wins} wins, never lost.`
  }
  const streak = runFrom(rec.recent)
  if (streak) return `${rec.wins}-${rec.losses} overall. ${streak}`
  return `${rec.wins}-${rec.losses} overall.`
}

/**
 * The part of `standing` a scoreline does NOT already say.
 *
 * Today shows the score as a chip next to the bot's name, so repeating
 * "1-2 overall" underneath it is a line of text that tells you nothing twice.
 * What is worth the space is the thing a scoreline cannot carry: that you
 * have never beaten them, that you have never lost, or that the last three
 * went one way. Null when the score says it all.
 */
export function form(rec: Record): string | null {
  if (rec.played === 0) return 'You have never played them.'
  if (rec.wins === 0) {
    return rec.played === 1 ? 'Lost the only one. Never beaten.' : 'Never beaten them.'
  }
  if (rec.losses === 0) return rec.played === 1 ? 'Beaten once, first time.' : 'Never lost to them.'
  return runFrom(rec.recent)
}

/** A run of the same result at the top of the form line, if there is one. */
function runFrom(recent: Record['recent']): string | null {
  const first = recent[0]
  if (!first) return null
  let n = 0
  for (const r of recent) {
    if (r !== first) break
    n++
  }
  if (n < 2) return null
  if (first === 'win') return `${n} wins in a row.`
  if (first === 'loss') return `${n} losses in a row.`
  return `${n} draws in a row.`
}
