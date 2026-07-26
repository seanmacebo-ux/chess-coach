/**
 * v1 shell: a real game against a rating-and-style opponent, plus live theme
 * switching. This exists to prove the whole stack end to end — WASM engine,
 * policy layer, board, theming — before the daily session and the other
 * pillars are built on top of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

import { Board } from './ui/Board'
import { applyUci, colourOf, statusOf, toDests } from './chess/game'
import { createOpponent, type Opponent } from './engine/opponent'
import { STYLES, type Style } from './engine/types'
import {
  BOARD_THEMES,
  applyTheme,
  boardBackground,
  loadTheme,
  resolveTheme,
  saveTheme,
  type ThemeChoice,
} from './theme/theme'

type EngineState = 'boot' | 'ready' | 'thinking' | 'error'

export default function App() {
  const chess = useRef(new Chess())
  const [fen, setFen] = useState(chess.current.fen())
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [engineState, setEngineState] = useState<EngineState>('boot')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [elo, setElo] = useState(1400)
  const [style, setStyle] = useState<Style>('human')
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')

  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme())

  // Rebuilt whenever strength or style changes — cheap, it's just config.
  const opponent = useMemo<Opponent>(() => createOpponent({ elo, style }), [elo, style])

  const humanColour = orientation
  const status = statusOf(chess.current)
  const turn = colourOf(chess.current)
  const dests = useMemo(() => toDests(chess.current), [fen])

  /* ------------------------------------------------------------ theme */

  useEffect(() => {
    const { board, pieces } = resolveTheme(theme)
    applyTheme(board, pieces)
    saveTheme(theme)
  }, [theme])

  /* ------------------------------------------------------------ engine */

  useEffect(() => {
    let cancelled = false
    opponent
      .newGame()
      .then(() => {
        if (!cancelled) setEngineState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setEngineState('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [opponent])

  const sync = useCallback(() => {
    setFen(chess.current.fen())
    const hist = chess.current.history({ verbose: true })
    const last = hist[hist.length - 1]
    setLastMove(last ? [last.from as Key, last.to as Key] : undefined)
  }, [])

  /* Bot replies whenever it's its turn. */
  const booted = engineState !== 'boot' && engineState !== 'error'

  useEffect(() => {
    if (!booted) return
    if (statusOf(chess.current).over) return
    if (colourOf(chess.current) === humanColour) return

    let cancelled = false
    setEngineState('thinking')

    opponent
      .move(chess.current.fen())
      .then((uci) => {
        if (cancelled) return
        if (!uci) {
          setEngineState('ready')
          return
        }
        if (!applyUci(chess.current, uci)) {
          setEngineState('error')
          setErrorMsg(`engine returned an illegal move: ${uci}`)
          return
        }
        sync()
        setEngineState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setEngineState('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
    // fen drives this — every position change re-checks whose turn it is.
  }, [fen, humanColour, opponent, booted, sync])

  /* ------------------------------------------------------------ actions */

  const onMove = useCallback(
    (from: Key, to: Key) => {
      try {
        // v1 auto-queens; see needsPromotion() for where the picker lands.
        chess.current.move({ from, to, promotion: 'q' })
        sync()
      } catch {
        // Illegal drop — chessground snaps the piece back on the next set().
        setFen(chess.current.fen())
      }
    },
    [sync],
  )

  const newGame = useCallback(
    (side: 'white' | 'black') => {
      chess.current.reset()
      setOrientation(side)
      setLastMove(undefined)
      setFen(chess.current.fen())
      setErrorMsg(null)
      void opponent.newGame()
    },
    [opponent],
  )

  const undo = useCallback(() => {
    // Two plies — undo the bot's reply and your own move together.
    chess.current.undo()
    chess.current.undo()
    sync()
  }, [sync])

  /* ------------------------------------------------------------ render */

  const botThinking = engineState === 'thinking'
  const playable = status.over || botThinking ? null : humanColour

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Chess<span>Coach</span>
        </div>
        <div className="status">
          <span
            className={
              'dot ' +
              (engineState === 'thinking'
                ? 'thinking'
                : engineState === 'error'
                  ? 'error'
                  : engineState === 'ready'
                    ? 'ready'
                    : '')
            }
          />
          <span className="small muted">
            {engineState === 'boot' && 'loading engine…'}
            {engineState === 'thinking' && `${opponent.name} thinking`}
            {engineState === 'error' && 'engine error'}
            {engineState === 'ready' && (status.over ? status.text : `${turn} to move`)}
          </span>
        </div>
      </header>

      <Board
        fen={fen}
        orientation={orientation}
        dests={dests}
        turn={turn}
        playable={playable}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        onMove={onMove}
      />

      <div className="stack" style={{ marginTop: 14 }}>
        {errorMsg && (
          <div className="card small" style={{ borderColor: 'var(--danger)' }}>
            <strong>Engine error.</strong> {errorMsg}
          </div>
        )}

        {status.over && (
          <div className="card row spread">
            <strong>{status.text}</strong>
            <button className="primary" onClick={() => newGame(orientation)}>
              Play again
            </button>
          </div>
        )}

        <div className="card stack">
          <label className="field">
            Opponent strength — <strong style={{ color: 'var(--text)' }}>{elo}</strong>
            <input
              type="range"
              min={800}
              max={2200}
              step={100}
              value={elo}
              onChange={(e) => setElo(Number(e.target.value))}
            />
          </label>

          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Style
            </div>
            <div className="chips">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  className="chip"
                  aria-pressed={style === s.id}
                  title={s.blurb}
                  onClick={() => setStyle(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {STYLES.find((s) => s.id === style)?.blurb}
            </div>
          </div>
        </div>

        <div className="card row spread">
          <span className="small muted">Board</span>
          <div className="chips">
            {BOARD_THEMES.map((t) => (
              <button
                key={t.id}
                className="swatch"
                aria-pressed={theme.board === t.id}
                // Icon-only control — title alone is not an accessible name.
                aria-label={`${t.name} board`}
                title={`${t.name} board`}
                style={{ backgroundImage: boardBackground(t) }}
                onClick={() => setTheme({ ...theme, board: t.id })}
              />
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="primary" style={{ flex: 1 }} onClick={() => newGame('white')}>
            New game as white
          </button>
          <button style={{ flex: 1 }} onClick={() => newGame('black')}>
            as black
          </button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            className="ghost"
            style={{ flex: 1 }}
            onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}
          >
            Flip board
          </button>
          <button
            className="ghost"
            style={{ flex: 1 }}
            disabled={chess.current.history().length < 2 || botThinking}
            onClick={undo}
          >
            Take back
          </button>
        </div>
      </div>
    </div>
  )
}
