/**
 * chess.js glue. Rules live here; the engine never validates legality and the
 * UI never reasons about it.
 */

import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

/** Legal moves in the shape chessground wants: from -> [to, ...]. */
export function toDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  for (const m of chess.moves({ verbose: true })) {
    const from = m.from as Key
    const arr = dests.get(from)
    if (arr) arr.push(m.to as Key)
    else dests.set(from, [m.to as Key])
  }
  return dests
}

export function colourOf(chess: Chess): 'white' | 'black' {
  return chess.turn() === 'w' ? 'white' : 'black'
}

/**
 * Does this from/to need a promotion choice?
 * v1 auto-queens — underpromotion is a real (if rare) need and gets a picker
 * later, but silently queening is the right default and never illegal.
 */
export function needsPromotion(chess: Chess, from: string, to: string): boolean {
  return chess
    .moves({ verbose: true })
    .some((m) => m.from === from && m.to === to && Boolean(m.promotion))
}

export interface GameStatus {
  over: boolean
  /** Human-readable result line. */
  text: string
  winner: 'white' | 'black' | 'draw' | null
}

export function statusOf(chess: Chess): GameStatus {
  if (chess.isCheckmate()) {
    // Side to move is the one that got mated.
    const winner = chess.turn() === 'w' ? 'black' : 'white'
    return { over: true, text: `Checkmate — ${winner} wins`, winner }
  }
  if (chess.isStalemate()) return { over: true, text: 'Stalemate — draw', winner: 'draw' }
  if (chess.isInsufficientMaterial()) {
    return { over: true, text: 'Insufficient material — draw', winner: 'draw' }
  }
  if (chess.isThreefoldRepetition()) {
    return { over: true, text: 'Threefold repetition — draw', winner: 'draw' }
  }
  if (chess.isDraw()) return { over: true, text: 'Draw', winner: 'draw' }
  if (chess.isCheck()) return { over: false, text: 'Check', winner: null }
  return { over: false, text: '', winner: null }
}

/** Apply a UCI move string. Returns false if it wasn't legal. */
export function applyUci(chess: Chess, uci: string): boolean {
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci.length > 4 ? uci[4] : undefined
  try {
    const res = chess.move({ from, to, promotion })
    return Boolean(res)
  } catch {
    return false
  }
}
