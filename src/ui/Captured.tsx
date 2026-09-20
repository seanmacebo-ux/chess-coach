/**
 * The pieces one side has taken, in the piece set you chose.
 *
 * Uses the `.pc` rule theme.ts emits alongside the chessground one, so these
 * are literally the pieces on the board below rather than a second set of
 * icons that drifts away from them when the theme changes.
 */

import { materialFrom } from '../chess/material'

const ROLE: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

export function Captured({ fen, side }: { fen: string; side: 'white' | 'black' }) {
  const m = materialFrom(fen)
  if (!m) return null

  const taken = side === 'white' ? m.takenByWhite : m.takenByBlack
  /* The colour of the pieces shown is the colour of whoever LOST them. */
  const lostBy = side === 'white' ? 'black' : 'white'
  const edge = side === 'white' ? m.edge : -m.edge

  if (taken.length === 0 && edge <= 0) return null

  return (
    <span className="taken">
      {taken.map((t, i) => (
        <span key={`${t}${i}`} className={`pc sm ${ROLE[t]} ${lostBy}`} aria-hidden="true" />
      ))}
      {/*
        Only the side that is AHEAD shows a number. Printing "+2" on one row
        and "-2" on the other says the same thing twice and makes the player
        who is behind read their deficit in two places.
      */}
      {edge > 0 && <span className="taken-edge">+{edge}</span>}
      <span className="sr-only">
        {taken.length} captured{edge > 0 ? `, ${edge} pawns ahead` : ''}
      </span>
    </span>
  )
}
