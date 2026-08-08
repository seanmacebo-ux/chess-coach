/**
 * Turning moves into arrows.
 *
 * Sean: "rather than words teach me the moves and show me the arrows." He is
 * describing the difference between notation and chess. "It is Nf3" makes a
 * beginner translate — find the knight, work out which one, find f3. An arrow
 * from g1 to f3 IS the move, in the language the board already speaks.
 *
 * So every surface that used to say a move now also draws it:
 *
 *   green  — the move being taught: a hint, the book move after a wrong try,
 *            the next step of a breakdown before you tap it
 *   blue   — a follow-up in the same idea, when a sequence is being shown
 *
 * Everything here parses SAN against a real position rather than trusting the
 * caller to hand over squares, for the same reason the verifiers exist: the
 * text layer of this app is not allowed to assert moves the board rejects.
 * A SAN that fails to parse draws nothing instead of drawing nonsense.
 */

import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'

/** The arrow for one SAN move in a position, or nothing if it is not legal. */
export function sanArrow(fen: string, san: string, brush: 'green' | 'blue' = 'green'): DrawShape[] {
  try {
    const board = new Chess(fen)
    const m = board.move(san)
    if (!m) return []
    return [{ orig: m.from as Key, dest: m.to as Key, brush }]
  } catch {
    return []
  }
}

/** An arrow straight from UCI squares — for engine moves already validated. */
export function uciArrow(uci: string, brush: 'green' | 'blue' = 'green'): DrawShape[] {
  if (uci.length < 4) return []
  return [{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush }]
}
