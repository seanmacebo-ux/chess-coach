/**
 * Exercise types beyond "find the winning move".
 *
 * The 28,800 Lichess puzzles all train one skill: calculation, on positions
 * where a tactic exists. That is one kind of seeing. These are the others —
 * the questions that come up on every move of a real game, where usually
 * nothing tactical is available at all.
 *
 * Generated from arbitrary positions, so any position from any of your games
 * can become an exercise.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { getEngine } from '../engine/uci'
import { lineScore } from '../engine/types'

export type ExerciseKind = 'threat' | 'safety'

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

/* ------------------------------------------------------------------ */
/* Threat detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Flip the side to move — a "null move".
 *
 * This is how you ask "what is my opponent actually threatening?": give them
 * a free move and see what they play. Searching the real position only tells
 * you your own best move, which is why players who only ever look at their
 * own plans keep walking into things.
 *
 * Returns null when passing is illegal or meaningless: you cannot pass out of
 * check, and en passant rights don't survive a null move.
 */
export function nullMoveFen(fen: string): string | null {
  const board = new Chess(fen)
  if (board.isCheck()) return null
  if (board.isGameOver()) return null

  const parts = fen.split(' ')
  if (parts.length < 6) return null
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-' // en passant cannot carry across a pass

  const flipped = parts.join(' ')
  try {
    const test = new Chess(flipped)
    if (test.isGameOver()) return null
    return flipped
  } catch {
    return null
  }
}

export interface ThreatExercise {
  kind: 'threat'
  /** Position as the user sees it — their move. */
  fen: string
  /** What the opponent would play given a free move, in UCI. */
  threatUci: string
  threatSan: string
  /** The square the user must tap to answer. */
  answerSquare: Square
  /** How much the threat is worth, in centipawns. */
  swingCp: number
  prompt: string
}

/**
 * Build a "what are they threatening?" exercise.
 *
 * Returns null when there is no meaningful threat — a position where the
 * opponent's free move gains almost nothing is not worth asking about, and
 * serving those trains nothing but irritation.
 */
export async function buildThreatExercise(
  fen: string,
  opts: { depth?: number; minSwingCp?: number } = {},
): Promise<ThreatExercise | null> {
  const depth = opts.depth ?? 12
  const minSwing = opts.minSwingCp ?? 120

  const passed = nullMoveFen(fen)
  if (!passed) return null

  const engine = getEngine()

  // What the position is worth to the opponent right now...
  const base = await engine.analyse(fen, { depth, multipv: 1 })
  const baseLine = base.lines[0]
  if (!baseLine) return null
  // base is from the mover's POV; negate for the opponent's.
  const opponentNow = -lineScore(baseLine)

  // ...versus what it is worth if they get a free move.
  const after = await engine.analyse(passed, { depth, multipv: 1 })
  const afterLine = after.lines[0]
  if (!afterLine || !after.bestMove) return null
  const opponentIfFree = lineScore(afterLine)

  const swing = opponentIfFree - opponentNow
  if (swing < minSwing) return null

  const probe = new Chess(passed)
  let san = ''
  try {
    san =
      probe.move({
        from: after.bestMove.slice(0, 2),
        to: after.bestMove.slice(2, 4),
        promotion: after.bestMove[4],
      })?.san ?? ''
  } catch {
    return null
  }

  return {
    kind: 'threat',
    fen,
    threatUci: after.bestMove,
    threatSan: san,
    answerSquare: after.bestMove.slice(2, 4) as Square,
    swingCp: Math.round(swing),
    prompt: 'If you passed right now, what would they play? Tap the square they are going to.',
  }
}

/* ------------------------------------------------------------------ */
/* Safety scan                                                         */
/* ------------------------------------------------------------------ */

export interface SafetyExercise {
  kind: 'safety'
  fen: string
  colour: 'w' | 'b'
  /** Every square holding an attacked, undefended piece. */
  answerSquares: Square[]
  prompt: string
}

/** Attacked and undefended pieces of `colour`. No SEE — this runs per move. */
export function loosePieces(fen: string, colour: 'w' | 'b'): Square[] {
  const board = new Chess(fen)
  const enemy = colour === 'w' ? 'b' : 'w'
  const out: Square[] = []
  for (const row of board.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== colour || cell.type === 'k') continue
      const sq = cell.square as Square
      if (!board.isAttacked(sq, enemy)) continue
      if (!board.isAttacked(sq, colour)) out.push(sq)
    }
  }
  return out
}

/**
 * "Which of your pieces is hanging?"
 *
 * Deliberately the simplest exercise in the app, and probably the highest
 * value one below 1600 — undefended pieces are what make forks and pins work
 * in the first place, so this trains the root cause rather than the symptom.
 */
export function buildSafetyExercise(
  fen: string,
  colour: 'w' | 'b',
  opts: { minValue?: number } = {},
): SafetyExercise | null {
  const minValue = opts.minValue ?? 300
  const board = new Chess(fen)
  const loose = loosePieces(fen, colour).filter((sq) => {
    const piece = board.get(sq)
    return piece ? (VALUE[piece.type] ?? 0) >= minValue : false
  })
  if (loose.length === 0) return null

  return {
    kind: 'safety',
    fen,
    colour,
    answerSquares: loose,
    prompt:
      loose.length === 1
        ? 'One of your pieces is attacked and undefended. Tap it.'
        : `${loose.length} of your pieces are attacked and undefended. Tap them all.`,
  }
}

export type Exercise = ThreatExercise | SafetyExercise

/**
 * Mine a finished game for exercises. Positions from YOUR games beat generic
 * ones because you have already demonstrated you can misread them.
 */
export async function mineExercises(
  fens: string[],
  colour: 'w' | 'b',
  limit = 3,
): Promise<Exercise[]> {
  const out: Exercise[] = []

  // Safety scans are free (no engine), so take those first.
  for (const fen of fens) {
    if (out.length >= limit) break
    const ex = buildSafetyExercise(fen, colour)
    if (ex) out.push(ex)
  }

  // Threats cost two searches each — only fill the remainder.
  for (const fen of fens) {
    if (out.length >= limit) break
    const ex = await buildThreatExercise(fen)
    if (ex) out.push(ex)
  }

  return out.slice(0, limit)
}
