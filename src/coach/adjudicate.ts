/**
 * Is the move you played actually worse than the book move?
 *
 * RECONSTRUCTED — see coach/rating.ts for why these files had to be rebuilt.
 *
 * THE BUG THIS FIXES. A Lichess puzzle stores one solution line, and the runner
 * used to compare your move against it as a string. Anything else was wrong.
 * But plenty of puzzles have a second move that mates just as fast, or wins the
 * same piece by a different order, and marking those wrong is worse than a
 * cosmetic annoyance: the failure goes into the mistake log, which feeds the
 * weakness profile, which reorders the ladder. Being told off for finding a
 * mate in three because the book found a different mate in three teaches you to
 * distrust the app.
 *
 * So the engine is asked first. Two searches of the same position — one after
 * the book move, one after yours — and the two scores are compared from YOUR
 * point of view.
 *
 * WHY THE THRESHOLDS ARE WHERE THEY ARE. The generous direction is the
 * dangerous one: waving a real blunder through is a worse failure than marking
 * a clever move wrong, because it silently removes a mistake from the log.
 * So the tolerance is small and asymmetric.
 *
 *   Mate is judged by DISTANCE, not by score. Both moves mating means both
 *   moves solve the puzzle; a mate in four instead of a mate in two is still a
 *   forced win and is accepted, with the difference stated. But a move that
 *   throws away a mate for a merely winning position is rejected, because the
 *   puzzle's whole objective was the mate.
 *
 *   Otherwise, within 30cp is accepted. That is well inside the noise of a
 *   fixed-depth search, so anything it lets through was genuinely a coin-flip
 *   between two good moves. 50cp would start admitting moves that are a
 *   measurable half-pawn worse.
 *
 * The engine is injectable so this can be checked from Node with the same code
 * path the app runs — the same reason coach/drills.ts takes an Analyser.
 */

import { Chess } from 'chess.js'
import { getEngine } from '../engine/uci'
import { lineScore, type Analysis } from '../engine/types'

export interface Analyser {
  analyse(fen: string, opts?: { depth?: number; multipv?: number }): Promise<Analysis>
}

export interface Verdict {
  /** The played move is as good as the book move, so the puzzle is solved. */
  accepted: boolean
  /** How the two moves relate, in one sentence, either way. */
  explain: string
  /** Centipawns for the solver after the played move. Null if it was mate. */
  playedCp: number | null
  /** Centipawns for the solver after the book move. Null if it was mate. */
  bookCp: number | null
  /** Moves to mate after each, when there is one. Negative = you get mated. */
  playedMate: number | null
  bookMate: number | null
}

/** Deep enough to separate two candidate moves; shallow enough to run on a phone. */
const DEPTH = 14

/** Within this, two moves are the same move as far as a puzzle is concerned. */
const TOLERANCE_CP = 30

/** Above this, lineScore is reporting a forced mate rather than a pawn count. */
const MATE_THRESHOLD = 90_000

function playUci(fen: string, uci: string): string | null {
  const board = new Chess(fen)
  try {
    const m = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' })
    if (!m) return null
  } catch {
    return null
  }
  return board.fen()
}

/**
 * Score a position from the point of view of the side that just moved.
 *
 * Returns mate distance in moves where there is one, so a mate in two and a
 * mate in five can be told apart — lineScore flattens both onto ±100,000,
 * which sorts correctly and is useless for saying "yours is slower".
 */
async function scoreAfter(
  engine: Analyser,
  fen: string,
): Promise<{ cp: number | null; mate: number | null }> {
  const analysis = await engine.analyse(fen, { depth: DEPTH, multipv: 1 })
  const line = analysis.lines[0]
  if (!line) throw new Error('engine returned no line')

  // The analysis is from the point of view of whoever is to move in `fen`,
  // which is the opponent — so negate for the solver.
  if (line.mate !== null && line.mate !== undefined) {
    return { cp: null, mate: -line.mate }
  }
  const raw = lineScore(line)
  if (Math.abs(raw) >= MATE_THRESHOLD) {
    return { cp: null, mate: raw > 0 ? -1 : 1 }
  }
  return { cp: -raw, mate: null }
}

export async function adjudicate(
  fenBefore: string,
  bookUci: string,
  playedUci: string,
  engine?: Analyser,
): Promise<Verdict> {
  const bookFen = playUci(fenBefore, bookUci)
  const playedFen = playUci(fenBefore, playedUci)
  if (!bookFen || !playedFen) throw new Error('could not play one of the moves')

  const eng = engine ?? getEngine()
  const [book, played] = await Promise.all([
    scoreAfter(eng, bookFen),
    scoreAfter(eng, playedFen),
  ])

  const base = {
    playedCp: played.cp,
    bookCp: book.cp,
    playedMate: played.mate,
    bookMate: book.mate,
  }

  /* --- mate is judged by distance ---------------------------------- */

  const bookMates = book.mate !== null && book.mate > 0
  const playedMates = played.mate !== null && played.mate > 0

  if (bookMates && playedMates) {
    const diff = played.mate! - book.mate!
    return {
      ...base,
      accepted: true,
      explain:
        diff === 0
          ? 'Different move, same mate in the same number. Both work.'
          : diff > 0
            ? `Also forced mate — in ${played.mate}, where the book move mates in ${book.mate}. Slower, still a win.`
            : `Forced mate in ${played.mate}, faster than the book's ${book.mate}. Better than the solution.`,
    }
  }

  if (bookMates && !playedMates) {
    return {
      ...base,
      accepted: false,
      explain: `The book move forces mate in ${book.mate}. Yours does not force mate at all, and mate was the objective.`,
    }
  }

  if (!bookMates && playedMates) {
    return {
      ...base,
      accepted: true,
      explain: `Your move forces mate in ${played.mate}. The stored line does not — this is better than the solution.`,
    }
  }

  // Getting mated is never an alternative, whatever the numbers say.
  if (played.mate !== null && played.mate < 0) {
    return { ...base, accepted: false, explain: 'Your move allows a forced mate against you.' }
  }

  /* --- otherwise compare centipawns -------------------------------- */

  if (played.cp === null || book.cp === null) {
    return { ...base, accepted: false, explain: 'Could not compare the two moves.' }
  }

  const diff = played.cp - book.cp
  if (diff >= -TOLERANCE_CP) {
    return {
      ...base,
      accepted: true,
      explain:
        diff > TOLERANCE_CP
          ? `Not the stored move, and the engine prefers yours by ${Math.round(diff) / 100} pawns.`
          : 'Not the stored move, but the engine scores it the same. It solves the puzzle.',
    }
  }

  const loss = Math.round(-diff) / 100
  return {
    ...base,
    accepted: false,
    explain: `The book move comes out ${loss} pawns better. Yours is playable, but it is not the point of the position.`,
  }
}
