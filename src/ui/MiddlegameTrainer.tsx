/**
 * Play the plan, not the moves.
 *
 * The opening trainer answers "what do I play". This answers the question that
 * comes straight after it and that the app had no answer to at all: you have
 * finished the opening, everything is developed, and now what is the game FOR.
 *
 * THE ORDER MATTERS AND IS DELIBERATE. You read the plan before you touch a
 * piece — the structure, what the opponent is trying to do, and your three
 * steps — and only then does the board become playable. That is the opposite
 * of a puzzle, on purpose. A puzzle asks you to find a move; a plan asks you to
 * hold an idea for six moves, and you cannot be asked to hold an idea you have
 * not been given yet.
 *
 * The opponent's replies are read from the stored plan rather than an engine,
 * for the same reason as the opening trainer: instant, offline, and identical
 * every run, so the position you get is the one the plan was written about. The
 * engine shows up afterwards, in play-on, where it belongs.
 *
 * A WRONG MOVE IS NOT A FAILURE. Same rule as the opening trainer — show it,
 * say what the plan wanted instead and why, take it back. A trainer that ends
 * the session on your mistake is a test, and you cannot learn a plan from a
 * test.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import { Board } from './Board'
import { sanArrow } from './arrows'
import { EngineOpponent } from '../engine/opponent'
import { getEngine } from '../engine/uci'
import { lineScore } from '../engine/types'
import { loosePieces } from '../coach/exercises'
import { recordSectionResult } from '../coach/rating'
import { recordFinishedGame, outcomeOf } from '../coach/record'
import { db } from '../data/db'
import { suggestedBot } from '../engine/roster'
import { planBase, type MiddlegamePlan } from '../content/middlegame'
import { openingById } from '../content/openings'

/** How long a wrong move stays on the board before it is taken back. */
const SHOW_WRONG_MS = 1700
/** Pause before the reply, so the move does not just appear. */
const REPLY_MS = 550
/** Shallow enough to feel instant, deep enough to spot a drop. */
const SUPPORT_DEPTH = 11
/** Below this the move was fine; nobody needs telling about 40 centipawns. */
const SUPPORT_LOSS_CP = 90

type Stage = 'brief' | 'playing' | 'wrong' | 'done' | 'playon'

export interface MiddlegameTrainerProps {
  plan: MiddlegamePlan
  /** Your rating, so the play-on bot is aimed at you. */
  rating: number
  onExit: () => void
}

export function MiddlegameTrainer({ plan, rating, onExit }: MiddlegameTrainerProps) {
  const base = useMemo(() => planBase(plan), [plan])
  const recorded = useRef(false)
  /** Same guard for the play-on GAME, which is a separate thing to record. */
  const gameRecorded = useRef(false)
  const chess = useRef(new Chess(base.fen))

  const [stage, setStage] = useState<Stage>('brief')
  const [ply, setPly] = useState(0)
  const [fen, setFen] = useState(base.fen)
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  const [wrongNote, setWrongNote] = useState<string | null>(null)
  const [misses, setMisses] = useState(0)
  const [hint, setHint] = useState(false)
  const [support, setSupport] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  /** What the play-on game did to your rating, once it is saved. */
  const [gameNote, setGameNote] = useState<string | null>(null)

  const bot = useMemo(() => suggestedBot(rating), [rating])
  const opponent = useMemo(
    () => new EngineOpponent({ elo: bot.elo, style: bot.style, name: bot.name }),
    [bot],
  )

  /**
   * Whoever is to move in the base position moves first, and that may or may
   * not be you — it depends on where the opening line happened to stop. Same
   * parity rule the verifier checks, derived the same way so the two cannot
   * disagree.
   */
  const startSide = base.fen.split(' ')[1] === 'w' ? 'white' : 'black'
  const youMoveFirst = startSide === plan.side
  const yourColour = plan.side === 'white' ? 'w' : 'b'
  const isYours = useCallback(
    (p: number) => (youMoveFirst ? p % 2 === 0 : p % 2 === 1),
    [youMoveFirst],
  )

  const reset = useCallback(() => {
    chess.current = new Chess(base.fen)
    setStage('brief')
    setPly(0)
    setFen(base.fen)
    setLastMove(undefined)
    setNote(null)
    setWrongNote(null)
    setMisses(0)
    setHint(false)
    setSupport(null)
    setThinking(false)
    recorded.current = false
    gameRecorded.current = false
    setGameNote(null)
    void opponent.newGame()
  }, [base.fen, opponent])

  const planKey = plan.id
  useEffect(() => {
    reset()
  }, [planKey, reset])

  const play = useCallback((san: string) => {
    try {
      const m = chess.current.move(san)
      if (!m) return null
      setFen(chess.current.fen())
      setLastMove([m.from as Key, m.to as Key])
      return m
    } catch {
      return null
    }
  }, [])

  /* If the opponent moves first, play their move once the brief is dismissed. */
  useEffect(() => {
    if (stage !== 'playing' || ply !== 0 || youMoveFirst) return
    const first = plan.moves[0]
    if (!first) return
    const t = window.setTimeout(() => {
      play(first.san)
      setPly(1)
    }, REPLY_MS)
    return () => window.clearTimeout(t)
  }, [stage, ply, youMoveFirst, plan.moves, play])

  const expected = plan.moves[ply]
  const finished = ply >= plan.moves.length

  useEffect(() => {
    if (finished && stage === 'playing') setStage('done')
  }, [finished, stage])

  /*
   * One attempt per completed plan, against the Strategy rating.
   *
   * Not per move — a six-move plan is one idea learned, and scoring it six
   * times would let Strategy outrun every other section by being longer. And
   * Strategy rather than Openings: the position comes out of an opening but
   * what is being tested is whether you can hold a scheme, which is what that
   * section is for.
   */
  useEffect(() => {
    if (!finished || recorded.current || stage === 'playon') return
    recorded.current = true
    const clean = misses === 0
    const planRating = Math.round((plan.band[0] + plan.band[1]) / 2)
    void (async () => {
      await db.puzzleAttempts.add({
        puzzleId: `plan:${plan.id}`,
        themes: 'middlegame',
        rating: planRating,
        correct: clean,
        ms: 0,
        tierId: null,
        at: new Date().toISOString(),
        attempts: misses + 1,
        hintUsed: hint,
        points: clean ? 10 : 4,
      })
      await recordSectionResult('strategy', clean, planRating)
    })()
  }, [finished, stage, misses, hint, plan.id, plan.band])

  /*
   * A play-on game is a real game, and it used to vanish — no History row, no
   * rating movement, no review. Same shared recorder the Play tab and the
   * opening trainer use, so there is one definition of what saving a game
   * means rather than three that can drift.
   */
  useEffect(() => {
    if (stage !== 'playon' || gameRecorded.current) return
    const outcome = outcomeOf(chess.current, yourColour)
    if (!outcome) return
    gameRecorded.current = true
    void recordFinishedGame({
      pgn: chess.current.pgn(),
      humanColour: yourColour,
      result: outcome.result,
      reason: outcome.reason,
      opponentElo: bot.elo,
      opponentStyle: bot.style,
      source: 'middlegame-trainer',
    }).then(({ delta }) => {
      setGameNote(
        `Saved to History. Your rating ${delta === 0 ? 'held' : delta > 0 ? `went up ${delta}` : `went down ${-delta}`}.`,
      )
    })
  }, [stage, fen, yourColour, bot])

  const playOnYourTurn =
    stage === 'playon' &&
    !thinking &&
    chess.current.turn() === yourColour &&
    !chess.current.isGameOver()

  const yourTurn = stage === 'playing' && !finished && isYours(ply)

  /** The hint, drawn instead of merely named — same rule as the opening trainer. */
  const shapes = useMemo(() => {
    if (stage !== 'playing' || !yourTurn || !expected) return []
    return hint || misses > 0 ? sanArrow(fen, expected.san) : []
  }, [stage, yourTurn, expected, hint, misses, fen])

  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>()
    if (stage === 'playon' ? !playOnYourTurn : !yourTurn) return map
    for (const m of chess.current.moves({ verbose: true })) {
      const from = m.from as Key
      const list = map.get(from) ?? []
      list.push(m.to as Key)
      map.set(from, list)
    }
    return map
  }, [fen, stage, playOnYourTurn, yourTurn])

  /** Live coaching once the stored plan runs out. Same two-pass shape as the
   *  opening trainer: instant board logic first, engine comparison appended. */
  const supportFor = useCallback(
    async (fenBefore: string, playedSan: string) => {
      const after = chess.current.fen()
      const loose = loosePieces(after, yourColour)
      const immediate =
        loose.length === 0
          ? null
          : loose.length === 1
            ? `Careful — your piece on ${loose[0]} is attacked and nothing defends it.`
            : `Careful — ${loose.length} of your pieces are attacked and undefended: ${loose.join(', ')}.`
      setSupport(immediate)

      try {
        const eng = getEngine()
        const before = await eng.analyse(fenBefore, { depth: SUPPORT_DEPTH, multipv: 1 })
        const bestLine = before.lines[0]
        if (!bestLine) return
        const bestCp = lineScore(bestLine)

        const now = await eng.analyse(after, { depth: SUPPORT_DEPTH, multipv: 1 })
        const nowLine = now.lines[0]
        if (!nowLine) return
        const yourCp = -lineScore(nowLine)
        const loss = bestCp - yourCp

        if (loss < SUPPORT_LOSS_CP) {
          setSupport(immediate ?? `${playedSan} is fine. Nothing of yours is hanging.`)
          return
        }
        const probe = new Chess(fenBefore)
        let bestSan: string | null = null
        try {
          const uci = before.bestMove
          bestSan = uci
            ? (probe.move({
                from: uci.slice(0, 2) as Square,
                to: uci.slice(2, 4) as Square,
                promotion: uci[4] ?? 'q',
              })?.san ?? null)
            : null
        } catch {
          bestSan = null
        }
        const pawns = (loss / 100).toFixed(1)
        setSupport(
          [
            immediate,
            bestSan ? `${bestSan} was stronger — ${playedSan} costs about ${pawns} pawns.` : null,
          ]
            .filter(Boolean)
            .join(' '),
        )
      } catch {
        /* engine unavailable — the loose-piece line already landed */
      }
    },
    [yourColour],
  )

  const onPlayOnMove = useCallback(
    (from: Key, to: Key) => {
      if (!playOnYourTurn) return
      const fenBefore = chess.current.fen()
      const probe = new Chess(fenBefore)
      let san: string
      try {
        const m = probe.move({ from: from as Square, to: to as Square, promotion: 'q' })
        if (!m) return
        san = m.san
      } catch {
        return
      }
      play(san)
      setThinking(true)
      void supportFor(fenBefore, san)

      if (chess.current.isGameOver()) {
        setThinking(false)
        return
      }
      void opponent
        .move(chess.current.fen())
        .then((uci) => {
          if (!uci) return
          const b = new Chess(chess.current.fen())
          try {
            const m = b.move({
              from: uci.slice(0, 2) as Square,
              to: uci.slice(2, 4) as Square,
              promotion: uci[4] ?? 'q',
            })
            if (m) play(m.san)
          } catch {
            /* an illegal engine move is not worth crashing the drill over */
          }
        })
        .finally(() => setThinking(false))
    },
    [playOnYourTurn, play, supportFor, opponent],
  )

  const onMove = useCallback(
    (from: Key, to: Key) => {
      if (stage === 'playon') {
        onPlayOnMove(from, to)
        return
      }
      if (stage !== 'playing' || !expected) return

      const probe = new Chess(chess.current.fen())
      let san: string
      try {
        const m = probe.move({ from: from as Square, to: to as Square, promotion: 'q' })
        if (!m) return
        san = m.san
      } catch {
        return
      }

      if (san !== expected.san) {
        play(san)
        setMisses((n) => n + 1)
        setWrongNote(
          `The plan calls for ${expected.san} here, not ${san}. ${expected.why ?? ''}`.trim(),
        )
        setStage('wrong')
        window.setTimeout(() => {
          chess.current.undo()
          setFen(chess.current.fen())
          setLastMove(undefined)
          setWrongNote(null)
          setHint(true)
          setStage('playing')
        }, SHOW_WRONG_MS)
        return
      }

      play(san)
      setNote(expected.why ?? null)
      setHint(false)
      const next = ply + 1
      setPly(next)

      const reply = plan.moves[next]
      if (!reply) return
      window.setTimeout(() => {
        play(reply.san)
        setPly(next + 1)
      }, REPLY_MS)
    },
    [stage, expected, ply, plan.moves, play, onPlayOnMove],
  )

  /** How many of your plan moves are behind you — the checklist state. */
  const yourMovesDone = useMemo(
    () => plan.moves.slice(0, ply).filter((_, i) => isYours(i)).length,
    [plan.moves, ply, isYours],
  )
  const yourMovesTotal = useMemo(
    () => plan.moves.filter((_, i) => isYours(i)).length,
    [plan.moves, isYours],
  )

  return (
    <div className="trainer-screen">
      <div className="trainer-head">
        <button className="chip" onClick={onExit}>
          ‹ Back to plans
        </button>
        <span className="trainer-prog">
          {stage === 'playon'
            ? `${bot.face} ${bot.name} ${bot.elo}`
            : `${yourMovesDone} / ${yourMovesTotal}`}
        </span>
      </div>

      {/*
        The brief. Full width, above the board, and it BLOCKS play until you
        dismiss it — the one screen in the app that deliberately makes you read
        before you touch anything. A plan you were not told is just a sequence
        you are being marked against.
      */}
      {stage === 'brief' ? (
        <div className="stack">
          <div className="card stack">
            <div>
              <div className="focus-title">{plan.name}</div>
              <div className="small muted">
                You are {plan.side} · reached from the{' '}
                {openingById(plan.from.openingId)?.name ?? plan.from.openingId}
              </div>
            </div>

            <div className="plan-block">
              <div className="plan-label">The structure</div>
              <p className="plan-body">{plan.structure}</p>
            </div>

            <div className="plan-block them">
              <div className="plan-label">What they want</div>
              <p className="plan-body">{plan.theirPlan}</p>
            </div>
          </div>

          <div className="card stack">
            <div className="plan-label">Your plan</div>
            <ol className="plan-steps">
              {plan.steps.map((s, i) => (
                <li key={i}>
                  <b>{s.label}</b>
                  <span className="small muted"> — {s.detail}</span>
                </li>
              ))}
            </ol>
            <button className="chip solid" onClick={() => setStage('playing')}>
              Play it ▸
            </button>
          </div>

          <Board
            fen={fen}
            orientation={plan.side}
            dests={new Map()}
            turn={null}
            playable={null}
            onMove={() => {}}
          />
        </div>
      ) : (
        <>
          <Board
            fen={fen}
            orientation={plan.side}
            dests={dests}
            turn={chess.current.turn() === 'w' ? 'white' : 'black'}
            playable={stage === 'playon' ? (playOnYourTurn ? plan.side : null) : yourTurn ? plan.side : null}
            lastMove={lastMove}
            check={chess.current.isCheck()}
            shapes={shapes}
            onMove={onMove}
          />

          {/* The plan stays on screen while you play it. Hiding it would turn
              the drill back into a memory test, which is the thing this is
              supposed to replace. */}
          {stage !== 'playon' && (
            <ol className="plan-steps compact">
              {plan.steps.map((s, i) => (
                <li key={i} className={i < Math.ceil((yourMovesDone / Math.max(1, yourMovesTotal)) * plan.steps.length) ? 'on' : ''}>
                  {s.label}
                </li>
              ))}
            </ol>
          )}

          {stage === 'playon' ? (
            <div className="coach">
              <div className="coach-role">
                {chess.current.isGameOver()
                  ? 'Game over'
                  : thinking
                    ? `${bot.name} is thinking…`
                    : 'Your move'}
              </div>
              <div className="coach-text">
                {chess.current.isGameOver()
                  ? chess.current.isCheckmate()
                    ? `Checkmate — ${chess.current.turn() === yourColour ? 'you lost this one' : 'you won'}.`
                    : 'Drawn.'
                  : (support ??
                    `The plan is done and this is a real game now. Keep going with the same idea — I will flag anything you leave hanging.`)}
                {gameNote && <div className="small muted" style={{ marginTop: 6 }}>{gameNote}</div>}
              </div>
              <div className="coach-actions">
                <span className="coach-hint">{bot.weakness}</span>
              </div>
            </div>
          ) : stage === 'wrong' && wrongNote ? (
            <div className="coach wrong">
              <div className="coach-role">Not this one</div>
              <div className="coach-text">{wrongNote}</div>
            </div>
          ) : stage === 'done' ? (
            <div className="coach done">
              <div className="coach-role">Plan complete</div>
              <div className="coach-text">{plan.takeaway}</div>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  className="chip solid"
                  onClick={() => {
                    setStage('playon')
                    setSupport(null)
                    void opponent.newGame()
                  }}
                >
                  Play on vs {bot.face} {bot.name} ▸
                </button>
                <button className="chip" onClick={reset}>
                  Again
                </button>
                <button className="chip" onClick={onExit}>
                  Back to plans
                </button>
              </div>
            </div>
          ) : (
            <div className="coach">
              <div className="coach-role">
                {yourTurn ? 'Your move — what does the plan want?' : 'They reply…'}
              </div>
              <div className="coach-text">
                {note ??
                  'Play the move the plan calls for. If you get it wrong I will tell you what it was and why.'}
              </div>
              {yourTurn && (
                <div className="coach-actions">
                  {hint || misses > 0 ? (
                    <span className="coach-hint">
                      It is <b>{expected?.san}</b>.
                    </span>
                  ) : (
                    <button className="chip" onClick={() => setHint(true)}>
                      Show me
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
