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

/**
 * Raw row as shipped in public/puzzles/band-*.json.
 *
 * Exported along with hydrate() so the sandbox script can drive the REAL
 * parser rather than a copy of it. A validator that reimplements the thing it
 * validates only ever proves the copy is self-consistent.
 */
export interface RawPuzzle {
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
  /**
   * The move that produced this position — the opponent's, in UCI.
   *
   * Sean: "the puzzles are good and from my game, but they're losing the
   * shape." This is the shape. Every puzzle site highlights the move that
   * just happened, because that is how you orient in a position you have
   * never seen: the arrow tells you what changed, and a tactic is almost
   * always an answer to what changed. Without it you are handed thirty-two
   * pieces and asked to work out the whole story before you can start.
   *
   * hydrate() has always PLAYED this move to reach the position and then
   * thrown the notation away, so the information was there all along and
   * never reached the board.
   */
  setup?: string
  /** Where this came from, when it is worth saying. Own-game positions. */
  from?: string
  /**
   * Pieces on the board in the position you are shown.
   *
   * Free — hydrate() already builds the board to apply the setup move — and
   * it is the single best predictor of whether a beginner can read a puzzle
   * at all. See `readability`.
   */
  pieces: number
}

/**
 * HOW HARD A PUZZLE IS TO READ, which is not the same as how hard it is.
 *
 * Sean, rated around 350: "the puzzles don't seem to make sense." Measured,
 * the easiest band in the corpus — the floor, 600, already 250 points above
 * him — has a MEDIAN of 17 pieces on the board and 29 legal moves, and 59% of
 * its puzzles need more than one move from you. That is not a puzzle at his
 * level, it is a position from somebody else's middlegame with a tactic
 * buried in it. The rating says "easy" because a 600-rated player finds it
 * easy; it says nothing about whether a beginner can even parse the board.
 *
 * And the simple ones are right there. Band 600 alone holds 291 one-move
 * puzzles with fourteen pieces or fewer, including four-piece mates. They
 * were never preferred, so they were served at the same rate as everything
 * else — about one in eleven.
 *
 * Lower is clearer. Two terms, both deliberately crude.
 *
 * Pieces, because that is what you have to read before you can begin. And
 * solution length, weighted HARD — sixteen points per extra move, eight
 * pieces' worth — because the gap between one move and two is not one more
 * move. It is having to predict the reply as well, which is a different skill
 * and not the one a mate-in-one is teaching. At ten points the corpus average
 * barely shifted: 1.65 moves against its own 1.70.
 */
export function readability(p: Pick<Puzzle, 'pieces' | 'solution'>): number {
  return p.pieces * 2 + (p.solution.length - 1) * 16
}

/**
 * The readability a player at this rating should be served, if it is going.
 *
 * Fades out: below the corpus floor nothing in the set was built for you, so
 * clarity is most of what can be offered. By the time you are comfortably
 * inside the corpus the position's complexity IS part of the exercise and
 * filtering it away would hold you back.
 */
export function clarityBudget(rating: number): number | null {
  if (rating >= 1000) return null
  if (rating < 700) return 30
  if (rating < 850) return 40
  return 50
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

export function hydrate(raw: RawPuzzle): Puzzle | null {
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
    setup,
    pieces: board.board().reduce((n, row) => n + row.filter(Boolean).length, 0),
  }
}

/**
 * Resolved lazily, for the same reason engine/uci.ts resolves its worker URL
 * lazily: `import.meta.env` does not exist until Vite has processed the
 * module, so reading it anywhere a Node script can reach makes the whole file
 * unimportable outside the browser bundle. uci.ts already lost `loosePieces`
 * to this — "one constant made an entire layer untestable" — and it had just
 * cost pickPuzzles the same way, which is the function the clarity budget
 * most needs a test around.
 */
function baseUrl(): string {
  return import.meta.env?.BASE_URL ?? '/'
}

export async function loadBand(rating: number): Promise<Puzzle[]> {
  const band = bandOf(rating)
  const hit = cache.get(band)
  if (hit) return hit

  const pending = inflight.get(band)
  if (pending) return pending

  const p = (async () => {
    const url = `${baseUrl()}puzzles/band-${band}.json`
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
  /**
   * Are you in check in the position you are shown?
   *
   * It was never said, and on a crowded board a beginner can miss it
   * entirely — which turns the puzzle into a riddle, because every move they
   * consider is illegal and nothing on screen explains why the board keeps
   * refusing them. Measured across the corpus: 4.2% of the easiest band opens
   * in check, 4.0% at 800, 2.9% at 1400. Small, and the ones it rescues are
   * the most confusing puzzles in the set.
   */
  inCheck: boolean
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
    // "Mate in two", not "Checkmate in 2 moves" — the standard term, and the
    // move count lives inside it, so the prompt line never says "one move"
    // twice. Part of making the puzzle screen read like a chess app rather
    // than a tutorial that never ends.
    const W = ['zero', 'one', 'two', 'three', 'four', 'five'] as const
    objective = `Mate in ${W[yourMoves] ?? yourMoves}`
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

  return { objective, yourMoves, legalMoves, ideas, inCheck: new Chess(puzzle.fen).isCheck() }
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
  /*
   * Below the corpus floor the window is empty and the fallback matters.
   *
   * The easiest band shipped is 600-799, so a player rated 316 has NOTHING in
   * window and used to get a random draw from the whole band — puzzles 300 to
   * 480 points above them, served as if they were targeted. Sorting the
   * fallback by rating means they at least get the easiest ones that exist,
   * which is the honest best available rather than a shrug.
   */
  const unseen = all.filter((p) => !exclude.has(p.id))
  const pool =
    inWindow.length >= count
      ? inWindow
      : rating < MIN_BAND
        ? [...unseen].sort((a, b) => a.rating - b.rating)
        : unseen

  /*
   * CLARITY FIRST, AT THE BOTTOM.
   *
   * Same degradation rule as themes below: prefer, never require. A beginner
   * handed a seventeen-piece middlegame cannot start, but handing them
   * nothing is worse, so the budget reorders the pool rather than cutting it.
   * Above 1000 it returns null and this is a no-op — by then the clutter is
   * part of the exercise.
   */
  const budget = clarityBudget(rating)
  const graded =
    budget === null
      ? pool
      : [...pool].sort((a, b) => {
          const ra = readability(a)
          const rb = readability(b)
          const aIn = ra <= budget
          const bIn = rb <= budget
          if (aIn !== bIn) return aIn ? -1 : 1
          return 0
        })

  const wantedSet = new Set<string>()
  const wanted: Puzzle[] = []
  if (themes.length > 0) {
    for (const p of graded) {
      if (p.themes.some((t) => themes.includes(t))) {
        wanted.push(p)
        wantedSet.add(p.id)
      }
    }
  }
  const rest = graded.filter((p) => !wantedSet.has(p.id))

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

  /*
   * Shuffle WITHIN the clarity tiers, not across them.
   *
   * A plain shuffle would undo the sort above and hand the budget back its
   * own randomness. Splitting first keeps two puzzles at the same tier
   * genuinely random — nobody should get the same five every morning — while
   * a readable one still outranks an unreadable one.
   */
  const tier = (xs: Puzzle[]) => {
    if (budget === null) return shuffle(xs)
    const clear = xs.filter((p) => readability(p) <= budget)
    const cluttered = xs.filter((p) => readability(p) > budget)
    return [...shuffle(clear), ...shuffle(cluttered)]
  }

  return [...tier(wanted), ...tier(rest)].slice(0, count)
}
