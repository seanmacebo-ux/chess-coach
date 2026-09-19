/**
 * What opening was that?
 *
 * The app could rate every move in a game and never say the game was a
 * Najdorf. Sean pointed at the gap — "there are repositories for this" — and
 * he is right: lichess-org/chess-openings is 3,810 curated openings with
 * their ECO codes, CC0, and scripts/build-eco.ts turns it into a position →
 * name map. This is the reading end.
 *
 * TWO USES, AND THE SECOND ONE MATTERS MORE.
 *
 * Naming the game is the obvious one, and is what every other app does.
 *
 * The one that changes the coaching is BOOK PLIES. src/coach/report.ts has
 * been able to rate a move 'book' since it was written, and nothing ever
 * passed it a single book ply — `buildReport(moves)` defaulted the set to
 * empty at both call sites. So a prepared move was scored as though you had
 * worked it out at the board: praised as Best when you had simply remembered
 * it, or marked an Inaccuracy for leaving a main line the engine mildly
 * dislikes. Neither is feedback about your chess.
 *
 * WHERE BOOK STOPS is decided by the position, not by a move number. Some
 * games are out of book at move 4 and some are still in it at move 18, and
 * "the first N moves are the opening" is wrong in both directions.
 */

import { Chess } from 'chess.js'

/** [position key, ECO code, name] — the shape build-eco.ts writes. */
type Row = [string, string, string]

export interface OpeningName {
  eco: string
  name: string
  /** Ply index of the last position that was still in the book. */
  ply: number
}

let cache: Map<string, [string, string]> | null = null
let inflight: Promise<Map<string, [string, string]>> | null = null

/** Same key as the opening tree: FEN without the clocks, so transpositions hit. */
function key(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

export async function loadEco(): Promise<Map<string, [string, string]>> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}book/eco.json`)
      if (!res.ok) throw new Error(String(res.status))
      const rows = (await res.json()) as Row[]
      cache = new Map(rows.map((r) => [r[0], [r[1], r[2]] as [string, string]]))
    } catch {
      // No names is a review that cannot say "Najdorf". It is not a broken
      // review, and it must not take the rest of the screen down with it.
      cache = new Map()
    }
    return cache
  })()
  return inflight
}

/**
 * How deep does the book go, and what is it called?
 *
 * Walks the game and keeps the DEEPEST position that has a name, rather than
 * stopping at the first gap. Not every position along a named line is itself
 * named — the dataset names the ends of lines, not every step — so stopping
 * at the first miss would call most Najdorfs a Sicilian Defence and leave the
 * book ending four plies early.
 *
 * Only the opening can be book, so the walk stops at MAX_PLY. Without that, a
 * position reached again by transposition at move 40 would extend "the book"
 * across the whole middlegame.
 */
const MAX_PLY = 40

export function nameOpening(
  eco: Map<string, [string, string]>,
  positions: string[],
): OpeningName | null {
  let best: OpeningName | null = null
  const limit = Math.min(positions.length, MAX_PLY)
  for (let i = 0; i < limit; i++) {
    const hit = eco.get(key(positions[i]!))
    if (hit) best = { eco: hit[0], name: hit[1], ply: i }
  }
  return best
}

/**
 * Which of YOUR plies were still in the book.
 *
 * `positions[i]` is the position AFTER ply i, so a named position at index i
 * means ply i was a book move. Every ply up to and including the deepest
 * named one counts, which is the honest reading: you were following theory
 * until the point where the game left it, whether or not each intermediate
 * position happens to have a name of its own.
 */
export function bookPlies(opening: OpeningName | null): Set<number> {
  const out = new Set<number>()
  if (!opening) return out
  for (let i = 0; i <= opening.ply; i++) out.add(i)
  return out
}

/**
 * Name the opening of a game, given its PGN.
 *
 * The single entry point, because both places that show a review have the
 * PGN and neither has the list of positions. Working it out from the
 * assessments instead is not possible: those cover only ONE side's moves, so
 * half the opening is missing from them.
 */
export async function openingOfPgn(pgn: string): Promise<OpeningName | null> {
  let history: string[]
  try {
    const game = new Chess()
    game.loadPgn(pgn)
    history = game.history()
  } catch {
    return null
  }
  const eco = await loadEco()
  if (eco.size === 0) return null

  const replay = new Chess()
  const positions: string[] = []
  for (const san of history.slice(0, MAX_PLY)) {
    try {
      replay.move(san)
    } catch {
      break
    }
    positions.push(replay.fen())
  }
  return nameOpening(eco, positions)
}
