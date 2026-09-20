/**
 * What has been taken, and who is ahead.
 *
 * Every chess app shows this beside the clocks and this one did not, so the
 * single most-checked fact in a game — am I up or down material — was
 * available only by counting the board yourself, or by opening the review
 * after the game was over.
 *
 * READ FROM THE POSITION, not from a list of captures. The board is the
 * source of truth and it is always there: a game loaded from a FEN, a puzzle,
 * a position jumped to in a review, all work without a move history. Counting
 * captures as they happen would work in exactly one of those cases.
 *
 * PROMOTIONS are the reason this is not a subtraction. Promote a pawn and the
 * board has eight pieces where it expects nine and two queens where it
 * expects one — so a naive difference reports a pawn captured that never was.
 * Every count is clamped at zero, and the surplus queen simply shows up in
 * the material edge, which is where it belongs.
 */

import { Chess } from 'chess.js'

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** What each side starts with. */
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }

/** Heaviest first, so a tray reads queen, rook, bishop, knight, pawn. */
const ORDER = ['q', 'r', 'b', 'n', 'p'] as const

export interface Material {
  /** Black pieces that are gone, as piece letters, heaviest first. */
  takenByWhite: string[]
  takenByBlack: string[]
  /**
   * Material difference in pawns, positive when WHITE is ahead.
   *
   * Computed from what is on the board rather than from the two lists above,
   * so a promoted queen counts for its nine even though nothing was captured
   * to produce it.
   */
  edge: number
}

export function materialFrom(fen: string): Material | null {
  let board
  try {
    board = new Chess(fen)
  } catch {
    return null
  }

  const have: Record<'w' | 'b', Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  }
  for (const row of board.board()) {
    for (const cell of row) {
      if (cell) have[cell.color][cell.type] = (have[cell.color][cell.type] ?? 0) + 1
    }
  }

  const missing = (side: 'w' | 'b'): string[] => {
    /*
     * A promotion removes a pawn from the board without anyone capturing it.
     * Clamping the piece counts is only half the fix: the pawn is still one
     * short, so the tray showed the opponent taking a pawn that had in fact
     * turned into the queen sitting next to it.
     *
     * The surplus IS the receipt. Any piece a side holds beyond what it
     * started with can only have come from a pawn, so the count of surplus
     * pieces is the count of pawns to forgive.
     */
    let promoted = 0
    for (const type of ORDER) {
      if (type === 'p') continue
      promoted += Math.max(0, (have[side][type] ?? 0) - (START[type] ?? 0))
    }

    const out: string[] = []
    for (const type of ORDER) {
      const start = (START[type] ?? 0) - (type === 'p' ? promoted : 0)
      // Clamped: a promotion can leave MORE of a piece than the game started
      // with, and "minus one queen taken" is not a thing.
      const gone = Math.max(0, start - (have[side][type] ?? 0))
      for (let i = 0; i < gone; i++) out.push(type)
    }
    return out
  }

  const total = (side: 'w' | 'b') =>
    Object.entries(have[side]).reduce((a, [t, n]) => a + (PIECE_VALUE[t] ?? 0) * n, 0)

  return {
    takenByWhite: missing('b'),
    takenByBlack: missing('w'),
    edge: total('w') - total('b'),
  }
}
