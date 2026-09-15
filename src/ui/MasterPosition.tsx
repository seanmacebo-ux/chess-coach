/**
 * One position a day, from a game somebody actually played.
 *
 * Sean: "I want it chess-like, and graphics instead of lacklustre themes."
 * The most chess-like graphic there is is a board with a real position on it,
 * and this one is not decoration — it is the day's hardest single decision,
 * taken from the 366 master games in data/pgn.
 *
 * WHAT MAKES IT ONTO THIS SCREEN. Nothing is here because it is famous.
 * Every position was mined by scripts/mine-sacrifices.ts under the rule
 * src/coach/report.ts uses to award "Brilliant": material was offered, the
 * engine still calls it the best move, it does not lose, and no other move
 * comes close. So the promise the card makes — there is something to give up
 * here, and it works — is one the engine has already checked at depth 14.
 *
 * You play the move. A reveal button exists, but it is the second option:
 * being shown Rxh3+ teaches nothing that finding Rxh3+ teaches.
 */

import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'
import { Board } from './Board'
import { SACRIFICES, type Sacrifice } from '../content/sacrifices'

/** Legal moves in chessground's shape. */
function destsOf(chess: Chess): Map<Key, Key[]> {
  const out = new Map<Key, Key[]>()
  for (const m of chess.moves({ verbose: true })) {
    const from = m.from as Key
    out.set(from, [...(out.get(from) ?? []), m.to as Key])
  }
  return out
}

/**
 * The same position all day, a different one tomorrow.
 *
 * Keyed on the local date rather than a random pick: a card that reshuffles
 * every time the screen re-renders is not a puzzle, it is a slot machine, and
 * you could never come back to the one you failed.
 */
export function positionForDay(now = new Date()): Sacrifice | null {
  if (SACRIFICES.length === 0) return null
  const key = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000,
  )
  return SACRIFICES[((key % SACRIFICES.length) + SACRIFICES.length) % SACRIFICES.length] ?? null
}

/** Mate scores come back from the engine as six figures; say so in words. */
function verdict(cp: number): string {
  if (cp >= 90_000) return 'it is mate'
  if (cp <= -90_000) return 'everything else is mate'
  if (cp >= 300) return `it wins — ${(cp / 100).toFixed(1)} pawns`
  if (cp >= 80) return 'it keeps the advantage'
  return 'it holds — and nothing else does'
}

export function MasterPosition({ onOpenBoard }: { onOpenBoard?: () => void }) {
  const pos = useMemo(() => positionForDay(), [])
  const [state, setState] = useState<'ask' | 'wrong' | 'got' | 'shown'>('ask')
  const [tried, setTried] = useState<string | null>(null)

  const setup = useMemo(() => {
    if (!pos) return null
    try {
      const chess = new Chess(pos.fen)
      return { chess, dests: destsOf(chess) }
    } catch {
      return null
    }
  }, [pos])

  if (!pos || !setup) return null

  const solved = state === 'got' || state === 'shown'
  const side = pos.side === 'w' ? 'white' : 'black'

  /* The answer is only ever drawn once it is no longer the answer. */
  const shapes: DrawShape[] = solved
    ? [{
        orig: pos.uci.slice(0, 2) as Key,
        dest: pos.uci.slice(2, 4) as Key,
        brush: state === 'got' ? 'green' : 'blue',
      }]
    : []

  const shown = (() => {
    if (!solved) return { fen: pos.fen, lastMove: undefined as [Key, Key] | undefined }
    const b = new Chess(pos.fen)
    try {
      const mv = b.move({
        from: pos.uci.slice(0, 2) as Square,
        to: pos.uci.slice(2, 4) as Square,
        promotion: pos.uci[4] ?? 'q',
      })
      return mv
        ? { fen: b.fen(), lastMove: [mv.from, mv.to] as [Key, Key] }
        : { fen: pos.fen, lastMove: undefined }
    } catch {
      return { fen: pos.fen, lastMove: undefined }
    }
  })()

  const tryMove = (from: Key, to: Key) => {
    if (solved) return
    const probe = new Chess(pos.fen)
    let mv
    try {
      mv = probe.move({ from: from as Square, to: to as Square, promotion: 'q' })
    } catch {
      return
    }
    if (!mv) return
    const played = `${mv.from}${mv.to}${mv.promotion ?? ''}`
    if (played === pos.uci) {
      setState('got')
    } else {
      setTried(mv.san)
      setState('wrong')
    }
  }

  return (
    <div className="master">
      <div className="row spread" style={{ alignItems: 'baseline' }}>
        <div className="day-kicker">From the masters</div>
        <div className="small muted">{pos.year !== '????' ? pos.year : ''}</div>
      </div>

      <div className="master-board">
        <Board
          fen={solved ? shown.fen : pos.fen}
          orientation={side}
          dests={solved ? new Map() : setup.dests}
          turn={solved ? null : side}
          playable={solved ? null : side}
          lastMove={shown.lastMove}
          shapes={shapes}
          onMove={tryMove}
        />
      </div>

      <div className="master-say">
        <div className="master-who">
          {pos.white} – {pos.black}
          {pos.event ? <span className="muted"> · {pos.event}</span> : null}
        </div>

        {state === 'ask' && (
          <p className="small">
            <strong>{side === 'white' ? 'White' : 'Black'} to play move {pos.moveNo}.</strong>{' '}
            Something here is worth giving up. Play the move on the board.
          </p>
        )}
        {state === 'wrong' && (
          <p className="small">
            <strong>{tried} is not it.</strong> The move gives material away and is still the
            only move that works. Try again, or see it.
          </p>
        )}
        {state === 'got' && (
          <p className="small">
            <strong>{pos.san} — that is the move.</strong> Material goes, and {verdict(pos.cp)}.
          </p>
        )}
        {state === 'shown' && (
          <p className="small">
            <strong>{pos.san}.</strong> Material goes, and {verdict(pos.cp)}. Every other move
            in the position is worse by {Math.min(99, Math.round(pos.margin / 100))} pawns or more.
          </p>
        )}

        <div className="row" style={{ gap: 8 }}>
          {!solved && (
            <button className="chip" onClick={() => setState('shown')}>
              Show me
            </button>
          )}
          {onOpenBoard && (
            <button className="chip" onClick={onOpenBoard}>
              More positions
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
