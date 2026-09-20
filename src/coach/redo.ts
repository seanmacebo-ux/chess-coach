/**
 * Your own mistakes, rebuilt as one-move puzzles.
 *
 * Shared by the Fix-your-own-games drill (Learn) and the daily session —
 * because "the diagnosis is from MY games but the training never is" was the
 * exact complaint, the daily prescription leads with these before any corpus
 * puzzle. Everything a one-move puzzle needs was already in the mistakes
 * table: the position (fen) and the better move (bestSan). The engine
 * adjudication in the runner does the rest, so a move as good as the one you
 * missed passes.
 *
 * THE SHAPE. Sean, later: "the puzzles are good and from my game, but
 * they're losing the shape." They were. A position arrived with no move
 * highlighted and no word about where it came from — the same cold drop as a
 * stranger's puzzle, except this one was your own game, which is the entire
 * reason it is worth doing. So each position now carries the move the
 * OPPONENT played into it, recovered by replaying the game to that ply, and
 * a line saying which game and which move number.
 *
 * The aggregation is a pure function over rows so it can be tested outside a
 * browser; loadRedoSet is the part that fetches. Replaying a PGN to an
 * arbitrary ply and expecting the position to match a separately stored FEN
 * is exactly the sort of thing that is quietly off by one.
 */

import { Chess } from 'chess.js'
import { db, type GameRow, type MistakeRow } from '../data/db'
import { TAG_THEMES } from './analysis'
import type { Puzzle } from '../data/puzzles'

/** Position key without the clocks, to compare a replay against a stored FEN. */
function samePosition(a: string, b: string): boolean {
  return a.split(' ').slice(0, 4).join(' ') === b.split(' ').slice(0, 4).join(' ')
}

/**
 * The move played INTO this position, and what to call the game it came from.
 *
 * Returns null when the game cannot be replayed to that ply or the position
 * does not match — which is not an error worth surfacing, just a position
 * that gets shown without its arrow rather than with a wrong one. An arrow
 * pointing at a move that was not played is worse than no arrow.
 */
export function contextFor(
  row: Pick<MistakeRow, 'ply' | 'fen'>,
  game: Pick<GameRow, 'pgn' | 'opponentElo' | 'playedAt'> | undefined,
): { setup?: string; from?: string } {
  if (!game?.pgn || row.ply <= 0) return {}
  let history
  try {
    const full = new Chess()
    full.loadPgn(game.pgn)
    history = full.history({ verbose: true })
  } catch {
    return {}
  }
  if (row.ply > history.length) return {}

  const board = new Chess()
  for (let i = 0; i < row.ply; i++) {
    const h = history[i]
    if (!h) return {}
    try {
      board.move({ from: h.from, to: h.to, promotion: h.promotion })
    } catch {
      return {}
    }
  }
  // The replay must actually land on the position that was stored. If the
  // two disagree the ply is not what it claims and nothing here is safe.
  if (!samePosition(board.fen(), row.fen)) return {}

  const prev = history[row.ply - 1]
  const moveNo = Math.floor(row.ply / 2) + 1
  return {
    ...(prev ? { setup: `${prev.from}${prev.to}${prev.promotion ?? ''}` } : {}),
    from: `Your game vs the ${game.opponentElo} bot · move ${moveNo}`,
  }
}

export function redoFrom(rows: MistakeRow[], games: Map<number, GameRow>, limit: number): Puzzle[] {
  const seen = new Set<string>()
  const out: Puzzle[] = []
  for (const r of rows) {
    // Puzzle-sourced rows have no position of "your game" behind them, and
    // rows without a better move recorded have nothing to find.
    if (r.source === 'puzzle' || !r.bestSan || !r.fen) continue
    if (r.severity !== 'blunder' && r.severity !== 'mistake') continue
    if (seen.has(r.fen)) continue

    /*
     * THE CONSTRUCTOR GOES INSIDE THE TRY.
     *
     * It used to sit one line above it, which reads as a detail and is not.
     * new Chess(fen) THROWS on a position it cannot load, so a single
     * unusable row did not get skipped here — it threw out of this loop, out
     * of buildDailySession, and Today rendered "Could not build today's
     * session" instead of the app.
     */
    let uci: string | null = null
    let turn: 'w' | 'b' = 'w'
    try {
      const probe = new Chess(r.fen)
      turn = probe.turn()
      const m = probe.move(r.bestSan)
      if (m) uci = `${m.from}${m.to}${m.promotion ?? ''}`
    } catch {
      uci = null
    }
    if (!uci) continue
    seen.add(r.fen)

    const ctx = contextFor(r, games.get(r.gameId))
    out.push({
      id: `redo-${r.id ?? out.length}`,
      fen: r.fen,
      solution: [uci],
      line: [uci],
      // 0 = unrated: this is your game, not a calibrated puzzle, and the
      // runner knows to say nothing rather than "rated 0".
      rating: 0,
      themes: r.tag ? TAG_THEMES[r.tag] : [],
      opening: '',
      // Read from the probe above rather than loading the position a second
      // time — which was both wasted work and a second unguarded throw.
      colour: turn === 'w' ? 'white' : 'black',
      ...ctx,
    })
    if (out.length >= limit) break
  }
  return out
}

export async function buildRedoSet(limit: number): Promise<Puzzle[]> {
  // Newest first: the mistake you made yesterday is the one still in your
  // hands. 200 rows is plenty of pool after dedup.
  const rows = await db.mistakes.orderBy('at').reverse().limit(200).toArray()
  const ids = [...new Set(rows.map((r) => r.gameId).filter((n) => typeof n === 'number'))]
  const games = new Map<number, GameRow>()
  for (const g of await db.games.bulkGet(ids)) {
    if (g?.id !== undefined) games.set(g.id, g)
  }
  return redoFrom(rows, games, limit)
}
