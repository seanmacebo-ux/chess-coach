/**
 * App shell.
 *
 * Two surfaces: the Daily screen (the front door) and Play. Everything else
 * is reached from a session rather than browsed to.
 *
 * The important wiring here is what happens when a game ENDS: it gets saved,
 * analysed, and its mistakes written to the log. Without that step the
 * weakness profile stays empty forever and the whole adaptive layer is
 * decoration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

import { Board } from './ui/Board'
import { Daily } from './ui/screens/Daily'
import { PuzzleRunner } from './ui/screens/PuzzleRunner'
import { markSessionComplete } from './coach/profile'
import type { DailySession } from './coach/session'
import { applyUci, colourOf, statusOf, toDests } from './chess/game'
import { createOpponent, type Opponent } from './engine/opponent'
import { STYLES, type Style } from './engine/types'
import { analyseGame, acpl, performanceRating } from './coach/analysis'
import { updateRatingFromGame } from './coach/profile'
import { db } from './data/db'
import {
  BOARD_THEMES,
  applyTheme,
  boardBackground,
  loadTheme,
  resolveTheme,
  saveTheme,
  type ThemeChoice,
} from './theme/theme'

type Tab = 'daily' | 'play' | 'puzzles'
type EngineState = 'boot' | 'ready' | 'thinking' | 'error'
type ReviewState = { phase: 'idle' } | { phase: 'running'; done: number; total: number } | {
  phase: 'done'
  acpl: number
  perf: number
  blunders: number
}

export default function App() {
  const [tab, setTab] = useState<Tab>('daily')
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme())

  useEffect(() => {
    const { board, pieces } = resolveTheme(theme)
    applyTheme(board, pieces)
    saveTheme(theme)
  }, [theme])

  const [seed, setSeed] = useState<{ elo: number; style: Style; colour: 'white' | 'black' }>({
    elo: 1400,
    style: 'human',
    colour: 'white',
  })
  const [session, setSession] = useState<DailySession | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const startFromDaily = useCallback((elo: number, style: Style, colour: 'white' | 'black') => {
    setSeed({ elo, style, colour })
    setTab('play')
  }, [])

  const startPuzzles = useCallback((s: DailySession) => {
    setSession(s)
    setTab('puzzles')
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Chess<span>Coach</span>
        </div>
        <div className="chips">
          {BOARD_THEMES.map((t) => (
            <button
              key={t.id}
              className="swatch"
              aria-pressed={theme.board === t.id}
              aria-label={`${t.name} board`}
              title={`${t.name} board`}
              style={{ backgroundImage: boardBackground(t) }}
              onClick={() => setTheme({ ...theme, board: t.id })}
            />
          ))}
        </div>
      </header>

      {tab === 'daily' && <Daily onStartGame={startFromDaily} onStartPuzzles={startPuzzles} />}

      {tab === 'play' && (
        <Play initialElo={seed.elo} initialStyle={seed.style} initialColour={seed.colour} />
      )}

      {tab === 'puzzles' &&
        (session && session.puzzles.length > 0 ? (
          <PuzzleRunner
            // Remount on a new session so internal progress resets cleanly.
            key={session.date + session.puzzles[0]!.id}
            puzzles={session.puzzles}
            tierId={session.drill?.id ?? null}
            onDone={({ solved, total }) => {
              void markSessionComplete()
              setResult(`${solved} of ${total} solved.`)
              setTab('daily')
            }}
          />
        ) : (
          <div className="card">
            <strong>No puzzle set loaded.</strong>{' '}
            <span className="muted">Open Today and start a session.</span>
          </div>
        ))}

      {result && (
        <div className="card row spread" style={{ borderColor: 'var(--accent)' }}>
          <span>{result}</span>
          <button className="ghost" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      <nav className="tabs">
        <button aria-current={tab === 'daily' ? 'page' : undefined} onClick={() => setTab('daily')}>
          Today
        </button>
        <button aria-current={tab === 'play' ? 'page' : undefined} onClick={() => setTab('play')}>
          Play
        </button>
      </nav>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Play(props: { initialElo: number; initialStyle: Style; initialColour: 'white' | 'black' }) {
  const chess = useRef(new Chess())
  const [fen, setFen] = useState(chess.current.fen())
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [engineState, setEngineState] = useState<EngineState>('boot')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewState>({ phase: 'idle' })

  const [elo, setElo] = useState(props.initialElo)
  const [style, setStyle] = useState<Style>(props.initialStyle)
  const [orientation, setOrientation] = useState<'white' | 'black'>(props.initialColour)

  const opponent = useMemo<Opponent>(() => createOpponent({ elo, style }), [elo, style])

  const humanColour = orientation
  const status = statusOf(chess.current)
  const turn = colourOf(chess.current)
  const dests = useMemo(() => toDests(chess.current), [fen])
  const savedRef = useRef(false)

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
  }, [fen, humanColour, opponent, booted, sync])

  /* ---------------------------------------------- save + analyse */

  /**
   * Runs once when the game ends. This is the step that makes the coach real:
   * without persisting mistakes, the profile never fills and every "adaptive"
   * feature downstream is inert.
   */
  useEffect(() => {
    const s = statusOf(chess.current)
    if (!s.over || savedRef.current || !booted) return
    savedRef.current = true

    const humanIs = humanColour === 'white' ? 'w' : 'b'
    const result: 'win' | 'loss' | 'draw' =
      s.winner === 'draw' || s.winner === null
        ? 'draw'
        : s.winner === humanColour
          ? 'win'
          : 'loss'
    const pgn = chess.current.pgn()
    const score = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5

    void (async () => {
      const playedAt = new Date().toISOString()
      const gameId = await db.games.add({
        playedAt,
        humanColour: humanIs,
        opponentElo: elo,
        opponentStyle: style,
        result,
        reason: s.text,
        pgn,
        acpl: null,
        performanceRating: null,
        analysedAt: null,
      })

      await updateRatingFromGame(elo, score as 0 | 0.5 | 1)

      try {
        setReview({ phase: 'running', done: 0, total: 1 })
        const assessments = await analyseGame(pgn, {
          colour: humanIs,
          onProgress: (done, total) => setReview({ phase: 'running', done, total }),
        })

        await db.mistakes.bulkAdd(
          assessments
            .filter((a) => a.severity !== 'best' && a.severity !== 'good')
            .map((a) => ({
              gameId,
              ply: a.ply,
              fen: a.fen,
              san: a.san,
              bestSan: a.bestSan,
              lossCp: a.lossCp,
              severity: a.severity,
              tag: a.tag,
              phase: a.phase,
              at: playedAt,
            })),
        )

        const avg = acpl(assessments)
        const perf = performanceRating(avg)
        await db.games.update(gameId, {
          acpl: avg,
          performanceRating: perf,
          analysedAt: new Date().toISOString(),
        })

        setReview({
          phase: 'done',
          acpl: avg,
          perf,
          blunders: assessments.filter((a) => a.severity === 'blunder').length,
        })
      } catch (err) {
        setErrorMsg(`analysis failed: ${err instanceof Error ? err.message : String(err)}`)
        setReview({ phase: 'idle' })
      }
    })()
  }, [fen, booted, humanColour, elo, style])

  /* ------------------------------------------------------ actions */

  const onMove = useCallback(
    (from: Key, to: Key) => {
      try {
        chess.current.move({ from, to, promotion: 'q' })
        sync()
      } catch {
        setFen(chess.current.fen())
      }
    },
    [sync],
  )

  const newGame = useCallback(
    (side: 'white' | 'black') => {
      chess.current.reset()
      savedRef.current = false
      setReview({ phase: 'idle' })
      setOrientation(side)
      setLastMove(undefined)
      setFen(chess.current.fen())
      setErrorMsg(null)
      void opponent.newGame()
    },
    [opponent],
  )

  const botThinking = engineState === 'thinking'
  const playable = status.over || botThinking ? null : humanColour

  return (
    <div className="stack">
      <div className="status" style={{ marginBottom: 2 }}>
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

      {errorMsg && (
        <div className="card small" style={{ borderColor: 'var(--danger)' }}>
          <strong>Error.</strong> {errorMsg}
        </div>
      )}

      {status.over && (
        <div className="card stack">
          <div className="row spread">
            <strong>{status.text}</strong>
            <button className="primary" onClick={() => newGame(orientation)}>
              Play again
            </button>
          </div>
          {review.phase === 'running' && (
            <div className="status">
              <span className="dot thinking" />
              <span className="small muted">
                reviewing your moves… {review.done}/{review.total}
              </span>
            </div>
          )}
          {review.phase === 'done' && (
            <div className="small">
              You averaged <strong>{review.acpl}</strong> centipawns lost per move — that's about{' '}
              <strong>{review.perf}</strong> strength.{' '}
              {review.blunders === 0
                ? 'No blunders.'
                : `${review.blunders} blunder${review.blunders === 1 ? '' : 's'} logged.`}{' '}
              <span className="muted">Tomorrow's session will target what showed up.</span>
            </div>
          )}
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

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" style={{ flex: 1 }} onClick={() => newGame('white')}>
          New game as white
        </button>
        <button style={{ flex: 1 }} onClick={() => newGame('black')}>
          as black
        </button>
      </div>
    </div>
  )
}
