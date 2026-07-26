/**
 * A board you step through, for showing a line rather than playing one.
 *
 * Openings taught as a list of moves are close to useless — "1.e4 e5 2.Nf3
 * Nc6 3.Bc4" means nothing until you see the bishop pointing at f7. This
 * renders the position at any point in a line, with the move that produced it
 * highlighted, and lets you walk forward and back.
 *
 * Deliberately NOT chessground, for the same reason as ThemePreview: this is a
 * diagram, it never accepts a move, and mounting the full board engine for
 * every opening card on a scrolling page would cost a lifecycle per card for
 * nothing.
 */

import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { boardBackground, pieceSrc, resolveTheme, loadTheme } from '../theme/theme'

const ROLE_OF: Record<string, string> = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
}

const FILES = 'abcdefgh'

/** Board as 64 cells, a8 first, plus the square name for each. */
function cellsOf(board: Chess, flipped: boolean): { code: string | null; square: string }[] {
  const out: { code: string | null; square: string }[] = []
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
  for (const r of ranks) {
    for (const f of files) {
      const square = `${FILES[f]}${r}`
      const piece = board.get(square as Square)
      out.push({
        square,
        code: piece ? `${piece.color}${ROLE_OF[piece.type] ?? 'P'}` : null,
      })
    }
  }
  return out
}

export interface LineBoardProps {
  /** Moves in SAN, from the starting position. */
  line: string[]
  orientation?: 'white' | 'black'
  /** Shown under the board — usually what the position is for. */
  caption?: string
}

export function LineBoard({ line, orientation = 'white', caption }: LineBoardProps) {
  // Start at the end of the line: the finished position is the thing worth
  // seeing first, and stepping BACK to understand how it arose is the natural
  // direction. Starting at ply 0 shows an untouched opening board, which tells
  // you nothing and needs a dozen taps before it does.
  const [ply, setPly] = useState(line.length)

  const { board, lastMove } = useMemo(() => {
    const b = new Chess()
    let last: { from: string; to: string } | null = null
    for (let i = 0; i < ply && i < line.length; i++) {
      try {
        const m = b.move(line[i]!)
        if (m) last = { from: m.from, to: m.to }
      } catch {
        break
      }
    }
    return { board: b, lastMove: last }
  }, [line, ply])

  const theme = resolveTheme(loadTheme())
  const flipped = orientation === 'black'
  const cells = cellsOf(board, flipped)

  return (
    <div className="lineboard">
      <div
        className="theme-preview"
        style={{ backgroundImage: boardBackground(theme.board) }}
        role="img"
        aria-label={`Position after ${ply} half-moves`}
      >
        {cells.map((c, i) => {
          // Rank down the left edge, file along the bottom — the same
          // convention as the real board, so a diagram and a game read
          // identically. Always on: a diagram you cannot name squares on is
          // just a picture.
          const col = i % 8
          const row = Math.floor(i / 8)
          // Square shade from the square NAME, not the grid index — the grid
          // flips with orientation and the shade does not.
          const file = FILES.indexOf(c.square[0]!)
          const rank = Number(c.square[1])
          // a1 is dark and a8 is light, so file+rank EVEN is a light square.
          // Had this inverted first time: every label was drawn in the colour
          // meant for the opposite shade, which made all 16 invisible.
          const isLight = (file + rank) % 2 === 0
          return (
            <div
              key={c.square}
              className={
                'tp-sq ' +
                (isLight ? 'sq-light' : 'sq-dark') +
                (lastMove && (c.square === lastMove.from || c.square === lastMove.to) ? ' lit' : '')
              }
            >
              {col === 0 && <span className="co rank">{c.square[1]}</span>}
              {row === 7 && <span className="co file">{c.square[0]}</span>}
              {c.code && <img src={pieceSrc(theme.pieces, c.code)} alt="" aria-hidden="true" />}
            </div>
          )
        })}
      </div>

      {/* Controls. Big enough for thumbs; the move list is the real navigation. */}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="ghost chip" onClick={() => setPly(0)} disabled={ply === 0}>
          ⏮
        </button>
        <button
          className="ghost chip"
          onClick={() => setPly((p) => Math.max(0, p - 1))}
          disabled={ply === 0}
        >
          ‹
        </button>
        <span className="small muted" style={{ flex: 1, textAlign: 'center' }}>
          {ply === 0
            ? 'start'
            : `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'} ${line[ply - 1]}`}
        </span>
        <button
          className="ghost chip"
          onClick={() => setPly((p) => Math.min(line.length, p + 1))}
          disabled={ply >= line.length}
        >
          ›
        </button>
        <button
          className="ghost chip"
          onClick={() => setPly(line.length)}
          disabled={ply >= line.length}
        >
          ⏭
        </button>
      </div>

      {/* The line itself, tappable. Numbered like a scoresheet so it reads the
          way a book does. */}
      <div className="moves">
        {line.map((san, i) => (
          <span key={i}>
            {i % 2 === 0 && <b className="movenum">{i / 2 + 1}.</b>}
            <button
              className={'move' + (i < ply ? ' played' : '') + (i === ply - 1 ? ' current' : '')}
              onClick={() => setPly(i + 1)}
            >
              {san}
            </button>
          </span>
        ))}
      </div>

      {caption && (
        <div className="small muted" style={{ marginTop: 6 }}>
          {caption}
        </div>
      )}
    </div>
  )
}
