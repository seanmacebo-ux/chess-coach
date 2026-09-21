/**
 * React wrapper around chessground.
 *
 * chessground owns its own DOM and mutates it imperatively — the React rule
 * here is: mount once, then push state in via `api.set()`. Re-creating it on
 * every render kills drag state mid-drag and is the classic way to make a
 * board feel broken on touch.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { loadPrefs } from '../data/settings'

export interface BoardProps {
  fen: string
  /** Which side is shown at the bottom. */
  orientation: 'white' | 'black'
  /** Legal moves, as chessground wants them: from -> [to, to, ...]. */
  dests: Map<Key, Key[]>
  /** Side to move, or null to freeze the board (game over / bot thinking). */
  turn: 'white' | 'black' | null
  /** Which colour the human is allowed to drag. */
  playable: 'white' | 'black' | 'both' | null
  lastMove?: [Key, Key] | undefined
  check?: boolean
  /**
   * Arrows and square highlights drawn ON the board — chessground's autoShapes.
   *
   * This is how the app teaches visually instead of verbally. Sean asked for
   * it in as many words: "rather than words teach me the moves and show me the
   * arrows". A hint that says "It is Nf3" makes you translate notation; an
   * arrow from g1 to f3 is the move itself. Same drawable layer lichess uses.
   */
  shapes?: DrawShape[]
  onMove: (from: Key, to: Key) => void
}

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  // Keep the latest callback without forcing a chessground rebuild.
  const onMove = useRef(props.onMove)
  onMove.current = props.onMove

  useEffect(() => {
    if (!el.current) return
    const config: Config = {
      fen: props.fen,
      orientation: props.orientation,
      /*
       * chessground's own coordinates are off, always.
       *
       * They are drawn inside the playing surface, in the corner of the rank-1
       * and a-file squares, on the assumption that a piece never covers that
       * corner. These piece sets do. On a full back rank six of the eight file
       * letters were invisible and only the empty squares showed one — the
       * result screen after a scholar's mate showed "D" and "F" and nothing
       * else, because d1 and f1 happened to be empty.
       *
       * So the labels moved to where a real board puts them: the frame. See
       * BoardCoords below and .board-coords in the stylesheet. Nothing can
       * stand on them there.
       */
      coordinates: false,
      addPieceZIndex: true,
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 180 },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (from, to) => onMove.current(from, to),
        },
      },
      draggable: { enabled: true, showGhost: true },
      // Touch: tapping a piece then a square must work as well as dragging.
      selectable: { enabled: true },
      // The user never draws; the coach does. eraseOnClick would wipe the
      // coach's arrows the moment you tap a piece to move it.
      drawable: { enabled: false, visible: true, eraseOnClick: false },
    }
    api.current = Chessground(el.current, config)
    return () => {
      api.current?.destroy()
      api.current = null
    }
    // Mount once. Everything else flows through the update effect below.
  }, [])

  useEffect(() => {
    const cg = api.current
    if (!cg) return
    cg.set({
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turn ?? undefined,
      check: props.check ?? false,
      lastMove: props.lastMove,
      movable: {
        free: false,
        color: props.playable ?? undefined,
        dests: props.dests,
        showDests: true,
      },
    })
    cg.setAutoShapes(props.shapes ?? [])
  }, [
    props.fen,
    props.orientation,
    props.turn,
    props.playable,
    props.dests,
    props.lastMove,
    props.check,
    props.shapes,
  ])

  /*
   * Read once. It is a localStorage hit, and flipping the setting mid-game
   * should not reshape the board under a drag — the rest of the app treats
   * preferences the same way.
   */
  const [showCoords] = useState(() => loadPrefs().showCoordinates)

  return (
    <div className={'board-wrap' + (showCoords ? '' : ' bare')}>
      <div ref={el} style={{ width: '100%', height: '100%' }} />
      {showCoords && <BoardCoords orientation={props.orientation} />}
    </div>
  )
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

/**
 * Rank numbers down the left edge, file letters along the bottom — in the
 * frame, not on the board.
 *
 * Two strips of eight, each cell exactly an eighth of the playing surface, so
 * every label lines up with the row or column it names however wide the board
 * is. Flipping the board reverses both, which is the whole reason this takes
 * `orientation` rather than being static markup.
 */
function BoardCoords({ orientation }: { orientation: 'white' | 'black' }) {
  const flipped = orientation === 'black'
  const ranks = useMemo(() => (flipped ? [...RANKS].reverse() : RANKS), [flipped])
  const files = useMemo(() => (flipped ? [...FILES].reverse() : FILES), [flipped])
  return (
    <div className="board-coords" aria-hidden="true">
      <div className="board-coords-ranks">
        {ranks.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>
      <div className="board-coords-files">
        {files.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
    </div>
  )
}
