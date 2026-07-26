/**
 * React wrapper around chessground.
 *
 * chessground owns its own DOM and mutates it imperatively — the React rule
 * here is: mount once, then push state in via `api.set()`. Re-creating it on
 * every render kills drag state mid-drag and is the classic way to make a
 * board feel broken on touch.
 */

import { useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
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
      // Was hardcoded true, which made the Settings toggle a control that
      // did nothing. Defaults to on, so coordinates are always there unless
      // deliberately turned off.
      coordinates: loadPrefs().showCoordinates,
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
  }, [
    props.fen,
    props.orientation,
    props.turn,
    props.playable,
    props.dests,
    props.lastMove,
    props.check,
  ])

  return (
    <div className="board-wrap">
      <div ref={el} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
