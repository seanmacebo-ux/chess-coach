/**
 * Puzzle access.
 *
 * Bands are fetched on demand and cached in memory; the service worker keeps
 * them on disk after first use (see vite.config.ts runtimeCaching). Only the
 * bands near your rating are ever downloaded — all nine is ~4.5MB and nobody
 * needs mate-in-one at 2200.
 *
 * On the Lichess format: `f` is the position BEFORE the opponent's move and
 * moves[0] IS that move. The position the solver actually sees comes after
 * applying it, and the solution is moves[1], [3], [5]... Getting this wrong
 * shows the user a position one ply early and every answer looks wrong.
 */

import { Chess } from 'chess.js'

/** Raw row as shipped in public/puzzles/band-*.json. */
interface RawPuzzle {
  i: string
  f: string
  m: string
  r: number
  t: string
  o: string
}

export interface Puzzle {
  id: string
  /** Position the SOLVER sees (after the opponent's setup move). */
  fen: string
  /** Solution moves in UCI, solver's moves only. */
  solution: string[]
  /** Full alternating line including the opponent's replies. */
  line: string[]
  rating: number
  themes: string[]
  opening: string
  /** Side the solver plays. */
  colour: 'white' | 'black'
}

const BAND_SIZE = 200
const MIN_BAND = 600
const MAX_BAND = 2200

const cache = new Map<number, Puzzle[]>()
const inflight = new Map<number, Promise<Puzzle[]>>()

function bandOf(rating: number): number {
  const b = Math.floor(rating / BAND_SIZE) * BAND_SIZE
  return Math.max(MIN_BAND, Math.min(MAX_BAND, b))
}

function hydrate(raw: RawPuzzle): Puzzle | null {
  const all = raw.m.split(' ').filter(Boolean)
  const setup = all[0]
  if (!setup) return null

  const board = new Chess(raw.f)
  try {
    board.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] })
  } catch {
    return null
  }

  const rest = all.slice(1)
  return {
    id: raw.i,
    fen: board.fen(),
    // Solver moves are the even indices of what remains.
    solution: rest.filter((_, i) => i % 2 === 0),
    line: rest,
    rating: raw.r,
    themes: raw.t.split(' ').filter(Boolean),
    opening: raw.o,
    colour: board.turn() === 'w' ? 'white' : 'black',
  }
}

export async function loadBand(rating: number): Promise<Puzzle[]> {
  const band = bandOf(rating)
  const hit = cache.get(band)
  if (hit) return hit

  const pending = inflight.get(band)
  if (pending) return pending

  const p = (async () => {
    const url = `${import.meta.env.BASE_URL}puzzles/band-${band}.json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`puzzle band ${band} failed: ${res.status}`)
    const raw = (await res.json()) as RawPuzzle[]
    const puzzles = raw.map(hydrate).filter((x): x is Puzzle => x !== null)
    cache.set(band, puzzles)
    inflight.delete(band)
    return puzzles
  })()

  inflight.set(band, p)
  return p
}

/* ------------------------------------------------------------------ */
/* Briefing                                                            */
/* ------------------------------------------------------------------ */

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export interface Briefing {
  /** What you're trying to achieve, in plain words. */
  objective: string
  /** How many moves YOU play. */
  yourMoves: number
  /** How many legal moves exist right now — the size of the haystack. */
  legalMoves: number
  /** The named ideas involved. */
  ideas: string[]
}

/**
 * Work out what a puzzle is actually asking for.
 *
 * The objective tags (crushing / advantage / equality / mate) were stripped
 * out when the corpus was built — I classed them as "not real motifs", which
 * was wrong: they're precisely the answer to "what am I trying to do here".
 * Rather than re-scan 6M rows, derive it from the solution line, which is
 * exact anyway: play it out and look at what changed.
 */
export function briefing(puzzle: Puzzle): Briefing {
  const board = new Chess(puzzle.fen)
  const me = board.turn()
  const legalMoves = board.moves().length

  const materialFor = (b: Chess, colour: 'w' | 'b') => {
    let total = 0
    for (const row of b.board()) {
      for (const cell of row) {
        if (cell && cell.color === colour) total += VALUE[cell.type] ?? 0
      }
    }
    return total
  }

  const before = materialFor(board, me) - materialFor(board, me === 'w' ? 'b' : 'w')

  for (const m of puzzle.line) {
    try {
      board.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })
    } catch {
      break
    }
  }

  const after = materialFor(board, me) - materialFor(board, me === 'w' ? 'b' : 'w')
  const swing = after - before
  const yourMoves = puzzle.solution.length

  let objective: string
  if (board.isCheckmate()) {
    objective = yourMoves === 1 ? 'Checkmate in one move' : `Checkmate in ${yourMoves} moves`
  } else if (swing >= 8) {
    objective = 'Win the queen'
  } else if (swing >= 5) {
    objective = 'Win a rook'
  } else if (swing >= 3) {
    objective = 'Win a piece'
  } else if (swing >= 1) {
    objective = swing >= 2 ? `Win ${swing} pawns` : 'Win a pawn'
  } else if (swing <= -1) {
    // You end up down material and it's still the best line — that's a
    // sacrifice, or a defensive save.
    objective = board.isStalemate() ? 'Save yourself — force stalemate' : 'Hold the position'
  } else {
    objective = 'Find the strongest move'
  }

  const ideas = puzzle.themes.filter((t) => !t.startsWith('mateIn'))

  return { objective, yourMoves, legalMoves, ideas }
}

export interface PickOptions {
  rating: number
  /** Prefer puzzles carrying any of these motifs. */
  themes?: string[]
  count: number
  /** Puzzle ids to skip — normally ones already seen. */
  exclude?: Set<string>
  /** Rating window either side of `rating`. */
  spread?: number
  rng?: () => number
}

/**
 * Pick puzzles, preferring the requested themes but never failing because of
 * them. A weakness-targeted session that returns three puzzles is better than
 * a perfectly-targeted one that returns zero, so theme matching degrades to
 * rating matching rather than coming up empty.
 */
export async function pickPuzzles(opts: PickOptions): Promise<Puzzle[]> {
  const { rating, themes = [], count, exclude = new Set<string>(), spread = 150 } = opts
  const rng = opts.rng ?? Math.random

  // Pull the home band plus neighbours so the rating window is honoured near
  // band edges rather than silently clipping.
  const bands = new Set([bandOf(rating - spread), bandOf(rating), bandOf(rating + spread)])
  const pools = await Promise.all([...bands].map((b) => loadBand(b)))
  const all = pools.flat()

  const inWindow = all.filter((p) => !exclude.has(p.id) && Math.abs(p.rating - rating) <= spread)
  const pool = inWindow.length >= count ? inWindow : all.filter((p) => !exclude.has(p.id))

  const wantedSet = new Set<string>()
  const wanted: Puzzle[] = []
  if (themes.length > 0) {
    for (const p of pool) {
      if (p.themes.some((t) => themes.includes(t))) {
        wanted.push(p)
        wantedSet.add(p.id)
      }
    }
  }
  const rest = pool.filter((p) => !wantedSet.has(p.id))

  const shuffle = (xs: Puzzle[]) => {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = a[i]!
      a[i] = a[j]!
      a[j] = tmp
    }
    return a
  }

  return [...shuffle(wanted), ...shuffle(rest)].slice(0, count)
}
