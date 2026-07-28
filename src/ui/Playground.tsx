/**
 * A board you can actually play on, that knows what the book says.
 *
 * The diagram this replaces (LineBoard) could only be stepped through. That is
 * the difference between reading a line and understanding it: the question you
 * always have at move six is "what if I play something else", and a diagram
 * answers it by refusing. So this one takes your move, plays it, and tells you
 * whether you are still in book — and if not, what the book move was and how to
 * get back.
 *
 * Three rules it is built on:
 *
 *   YOU CAN ALWAYS MOVE. Both colours are draggable by default. This is a
 *   study board, not a game: the point is to try the opponent's ideas too, and
 *   locking one side turns "what happens if they take" into a dead end.
 *
 *   LEAVING THE BOOK IS NOT AN ERROR. It is the thing you came to do. The
 *   deviation is shown as information — book said X, you played Y — with no
 *   scolding and a one-tap way back. A trainer that punishes exploration
 *   teaches you not to explore.
 *
 *   THE MOVE LIST IS THE NAVIGATION. Tapping a move jumps there, and playing a
 *   new move from a jumped-back position replaces the rest of the line, the
 *   way any analysis board works. Nothing is destroyed that you cannot get
 *   back with Reset.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import { Board } from './Board'

export interface PlaygroundProps {
  /** The book line in SAN, from the starting position. */
  book: string[]
  orientation?: 'white' | 'black'
  /** Which colours the user may move. Defaults to both — it is a playground. */
  playable?: 'white' | 'black' | 'both'
  /**
   * SAN of the move that loses, if this line has one. Marked in the move list
   * so the eye lands on it before the explanation does.
   */
  blunder?: string | undefined
  /** Shown under the controls. */
  caption?: string | undefined
  /** Start at the end of the line rather than the beginning. */
  startAtEnd?: boolean
  /** Fires whenever the shown position changes. */
  onChange?: ((state: { fen: string; ply: number; inBook: boolean }) => void) | undefined
}

/** Replay SAN moves, stopping at the first one that will not play. */
function replay(moves: string[], upTo: number): { board: Chess; ok: number } {
  const board = new Chess()
  let ok = 0
  for (let i = 0; i < upTo && i < moves.length; i++) {
    try {
      if (!board.move(moves[i]!)) break
    } catch {
      break
    }
    ok++
  }
  return { board, ok }
}

export function Playground({
  book,
  orientation = 'white',
  playable = 'both',
  blunder,
  caption,
  startAtEnd = false,
  onChange,
}: PlaygroundProps) {
  /** The line currently on the board. Starts as the book, diverges as you play. */
  const [moves, setMoves] = useState<string[]>(book)
  const [ply, setPly] = useState(startAtEnd ? book.length : 0)

  // A new book (you switched variation) resets everything. Without this the
  // old line would linger and the move list would describe a different opening
  // from the one the header names.
  const bookKey = book.join(' ')
  useEffect(() => {
    setMoves(book)
    setPly(startAtEnd ? book.length : 0)
  }, [bookKey, startAtEnd])

  const { board, ok } = useMemo(() => replay(moves, ply), [moves, ply])

  /** How much of what is on the board still matches the book. */
  const bookPrefix = useMemo(() => {
    let i = 0
    while (i < moves.length && i < book.length && moves[i] === book[i]) i++
    return i
  }, [moves, bookKey])

  /**
   * An empty book means free analysis, not "off book from move one". The
   * concept modules use this — a board to try an idea on, with no line to be
   * measured against — and reporting every move there as a deviation would be
   * nonsense.
   */
  const hasBook = book.length > 0
  const inBook = !hasBook || ply <= bookPrefix
  /** The book move you did not play, when you have left it. */
  const missedBookMove = inBook ? null : (book[bookPrefix] ?? null)

  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>()
    for (const m of board.moves({ verbose: true })) {
      const from = m.from as Key
      const list = map.get(from) ?? []
      list.push(m.to as Key)
      map.set(from, list)
    }
    return map
  }, [board])

  const lastMove = useMemo((): [Key, Key] | undefined => {
    if (ok === 0) return undefined
    const { board: prev } = replay(moves, ok - 1)
    try {
      const m = prev.move(moves[ok - 1]!)
      return m ? [m.from as Key, m.to as Key] : undefined
    } catch {
      return undefined
    }
  }, [moves, ok])

  const fen = board.fen()

  // Report upward without making the parent a dependency of the effect — a
  // caller passing an inline arrow would otherwise re-fire this every render.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current?.({ fen, ply, inBook })
  }, [fen, ply, inBook])

  const handleMove = useCallback(
    (from: Key, to: Key) => {
      const probe = new Chess(fen)
      let san: string
      try {
        // Always promote to a queen here. This is an opening trainer; a board
        // that stops to ask which piece you want on move four is answering a
        // question nobody has.
        const m = probe.move({ from: from as Square, to: to as Square, promotion: 'q' })
        if (!m) return
        san = m.san
      } catch {
        return
      }

      setMoves((cur) => {
        const head = cur.slice(0, ply)
        // Playing the move that was already next keeps the rest of the line
        // intact, so stepping back and replaying the book does not truncate it.
        if (cur[ply] === san) return cur
        return [...head, san]
      })
      setPly((p) => p + 1)
    },
    [fen, ply],
  )

  const backToBook = useCallback(() => {
    setMoves(book)
    setPly(bookPrefix)
  }, [bookKey, bookPrefix])

  const reset = useCallback(() => {
    setMoves(book)
    setPly(0)
  }, [bookKey])

  const turn: 'white' | 'black' = board.turn() === 'w' ? 'white' : 'black'

  return (
    <div className="pg">
      <Board
        fen={fen}
        orientation={orientation}
        dests={dests}
        turn={turn}
        playable={board.isGameOver() ? null : playable}
        lastMove={lastMove}
        check={board.isCheck()}
        onMove={handleMove}
      />

      <div className="pg-bar">
        <button className="pg-nav" onClick={() => setPly(0)} disabled={ply === 0} aria-label="Start">
          ⏮
        </button>
        <button
          className="pg-nav"
          onClick={() => setPly((p) => Math.max(0, p - 1))}
          disabled={ply === 0}
          aria-label="Back"
        >
          ‹
        </button>
        <span className="pg-status">
          {ply === 0 ? (
            <span className="muted">start position — drag a piece</span>
          ) : (
            <>
              <b>
                {Math.ceil(ply / 2)}
                {ply % 2 === 1 ? '.' : '…'} {moves[ply - 1]}
              </b>
              {!inBook && <span className="pg-off"> off book</span>}
            </>
          )}
        </span>
        <button
          className="pg-nav"
          onClick={() => setPly((p) => Math.min(moves.length, p + 1))}
          disabled={ply >= moves.length}
          aria-label="Forward"
        >
          ›
        </button>
        <button
          className="pg-nav"
          onClick={() => setPly(moves.length)}
          disabled={ply >= moves.length}
          aria-label="End"
        >
          ⏭
        </button>
      </div>

      <div className="moves">
        {moves.map((san, i) => {
          const offBook = i >= bookPrefix
          return (
            <span key={`${i}-${san}`}>
              {i % 2 === 0 && <b className="movenum">{i / 2 + 1}.</b>}
              <button
                className={
                  'move' +
                  (i < ply ? ' played' : '') +
                  (i === ply - 1 ? ' current' : '') +
                  (offBook ? ' offbook' : '') +
                  (blunder && san === blunder && !offBook ? ' blunder' : '')
                }
                onClick={() => setPly(i + 1)}
              >
                {san}
                {blunder && san === blunder && !offBook ? '??' : ''}
              </button>
            </span>
          )
        })}
      </div>

      {!inBook && (
        <div className="pg-note">
          <span>
            You left the line at move {Math.ceil((bookPrefix + 1) / 2)}.{' '}
            {missedBookMove ? (
              <>
                The book move was <b>{missedBookMove}</b>.
              </>
            ) : (
              <>The book line ends here.</>
            )}
          </span>
          <button className="chip" onClick={backToBook}>
            Back to book
          </button>
        </div>
      )}

      {board.isGameOver() && (
        <div className="pg-note">
          <span>
            {board.isCheckmate()
              ? `Checkmate — ${board.turn() === 'w' ? 'Black' : 'White'} wins.`
              : board.isStalemate()
                ? 'Stalemate.'
                : 'Game over — draw.'}
          </span>
          <button className="chip" onClick={reset}>
            Reset
          </button>
        </div>
      )}

      {caption && <div className="pg-caption">{caption}</div>}
    </div>
  )
}
