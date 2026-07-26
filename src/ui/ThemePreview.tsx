/**
 * A live example of the current board, pieces and background.
 *
 * Picking a theme from 44px swatches is guesswork — a swatch shows you two
 * colours and a hint of grain, not what a knight looks like standing on it.
 * This renders the real thing: the chosen material, the chosen set, actual
 * pieces, at the size you'll play at.
 *
 * Deliberately NOT chessground. This is a static picture — bringing in the
 * board engine would add a mount/unmount cycle and a config diff on every
 * swatch tap, for a thing that never needs to accept a move.
 */

import { boardBackground, pieceSrc, type BoardTheme, type PieceSet } from '../theme/theme'

/**
 * Italian Game after 4...Nf6 — chosen because it puts one of every piece on
 * the board, keeps both kings home, and is a position Sean will actually meet
 * (it's the white repertoire the openings module recommends at his level).
 */
const PREVIEW_FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R'

const ROLE_OF: Record<string, string> = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
}

const FILES = 'abcdefgh'

/** Expand the placement field of a FEN into 64 entries, rank 8 first. */
function squares(placement: string): (string | null)[] {
  const out: (string | null)[] = []
  for (const ch of placement) {
    if (ch === '/') continue
    if (ch >= '1' && ch <= '8') {
      for (let i = 0; i < Number(ch); i++) out.push(null)
    } else {
      const white = ch === ch.toUpperCase()
      out.push(`${white ? 'w' : 'b'}${ROLE_OF[ch.toLowerCase()] ?? 'P'}`)
    }
  }
  return out
}

export interface ThemePreviewProps {
  board: BoardTheme
  pieces: PieceSet
  /** Shown under the board. Off for the compact variant. */
  caption?: boolean
}

export function ThemePreview({ board, pieces, caption = true }: ThemePreviewProps) {
  const cells = squares(PREVIEW_FEN)

  return (
    <div>
      <div
        className="theme-preview"
        style={{ backgroundImage: boardBackground(board) }}
        role="img"
        aria-label={`${board.name} board with ${pieces.name} pieces`}
      >
        {cells.map((code, i) => {
          const col = i % 8
          const row = Math.floor(i / 8)
          // file index + rank, even = light (a1 dark, a8 light).
          const isLight = (col + (8 - row)) % 2 === 0
          return (
            <div key={i} className={'tp-sq ' + (isLight ? 'sq-light' : 'sq-dark')}>
              {col === 0 && <span className="co rank">{8 - row}</span>}
              {row === 7 && <span className="co file">{FILES[col]}</span>}
              {code && <img src={pieceSrc(pieces, code)} alt="" aria-hidden="true" />}
            </div>
          )
        })}
      </div>
      {caption && (
        <div className="small muted" style={{ marginTop: 6 }}>
          <strong style={{ color: 'var(--text)' }}>{board.name}</strong> board ·{' '}
          <strong style={{ color: 'var(--text)' }}>{pieces.name}</strong> pieces
        </div>
      )}
    </div>
  )
}
