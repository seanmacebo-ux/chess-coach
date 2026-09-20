/**
 * Do your own mistakes come back as puzzles that still look like your game?
 *
 * Two things are being checked and the second is the one that bites.
 *
 * The position has to survive the round trip: a mistake row stores a FEN and
 * a ply, and the arrow comes from replaying the game's PGN to that ply. Those
 * are two independent records of the same moment, written at different times
 * by different code, and "replay N plies" is exactly the arithmetic that is
 * quietly off by one. If they disagree the position must be shown with NO
 * arrow — an arrow pointing at a move that was not played is worse than no
 * arrow, because it is confidently wrong.
 *
 *   npm run verify:redo
 */

import { Chess } from 'chess.js'
import { contextFor, redoFrom } from '../src/coach/redo'
import type { GameRow, MistakeRow } from '../src/data/db'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'Bg5', 'h6', 'Bh4', 'g5']

function pgnOf(sans: string[]): string {
  const c = new Chess()
  for (const s of sans) c.move(s)
  return c.pgn()
}

/** The position before ply `n`, which is what a mistake row stores. */
function fenAt(n: number): string {
  const c = new Chess()
  // Clamped, because a fixture deliberately asks for a ply past the end of
  // the game and the helper should not be the thing that falls over.
  for (let i = 0; i < Math.min(n, SANS.length); i++) c.move(SANS[i]!)
  return c.fen()
}

const game: GameRow = {
  id: 1, playedAt: new Date().toISOString(), humanColour: 'w', opponentElo: 1200,
  opponentStyle: 'human', result: 'loss', reason: 'Checkmate', pgn: pgnOf(SANS),
  acpl: 60, performanceRating: 800, analysedAt: null,
}

const row = (ply: number, over: Partial<MistakeRow> = {}): MistakeRow => ({
  id: ply, gameId: 1, source: 'game', ply, fen: fenAt(ply), san: SANS[ply] ?? 'e4',
  bestSan: 'Nc3', lossCp: 200, severity: 'blunder', tag: 'hung-piece',
  phase: 'middlegame', at: new Date().toISOString(), ...over,
})

/* ------------------------------------------------------- the arrow --- */

const at6 = contextFor(row(6), game)
check('the setup move is the OPPONENT\'s move before yours',
      at6.setup === 'f8c5', String(at6.setup))
check('and it names the game and move number',
      at6.from === 'Your game vs the 1200 bot · move 4', String(at6.from))

const at1 = contextFor(row(1), game)
check('a mistake on ply 1 takes the move before it', at1.setup === 'e2e4', String(at1.setup))

check('ply 0 has nothing before it, so no arrow',
      contextFor(row(0), game).setup === undefined)

/*
 * THE ONE THAT MATTERS. A row whose stored FEN does not match the replay is
 * a row whose ply is not what it says. Drawing the arrow anyway would put a
 * confident mark on a move that was never played in that position.
 */
const mismatched = contextFor({ ply: 6, fen: fenAt(9) }, game)
check('a ply that disagrees with the stored position draws no arrow',
      mismatched.setup === undefined && mismatched.from === undefined,
      JSON.stringify(mismatched))

check('a ply past the end of the game draws no arrow',
      contextFor(row(99, { fen: fenAt(6) }), game).setup === undefined)
check('no game at all draws no arrow', contextFor(row(6), undefined).setup === undefined)
check('an unreadable pgn draws no arrow',
      contextFor(row(6), { ...game, pgn: 'not a pgn at all' }).setup === undefined)

/* -------------------------------------------------------- the set ---- */

const games = new Map([[1, game]])
const set = redoFrom([row(6), row(8)], games, 10)
check('both mistakes become puzzles', set.length === 2, String(set.length))
check('each carries its arrow', set.every((p) => Boolean(p.setup)))
check('each carries its provenance', set.every((p) => Boolean(p.from)))
check('the solver plays the side that erred', set[0]!.colour === 'white', set[0]!.colour)
check('own-game puzzles stay unrated', set.every((p) => p.rating === 0))

/* Rows that cannot make a puzzle are skipped, not thrown on. */
const junk = redoFrom(
  [
    row(6, { fen: 'this is not a fen' }),
    row(6, { bestSan: null }),
    row(6, { source: 'puzzle' }),
    row(6, { severity: 'inaccuracy' }),
    row(8),
  ],
  games,
  10,
)
check('unusable rows are skipped rather than thrown on', junk.length === 1, String(junk.length))

/* Duplicate positions are only worth solving once. */
check('the same position is not served twice',
      redoFrom([row(6), row(6)], games, 10).length === 1)

console.log(fail === 0 ? '\n✓ own-game puzzles keep their shape' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
