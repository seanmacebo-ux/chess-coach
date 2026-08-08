/**
 * Play the opening instead of watching it.
 *
 * WHY. The playground lets you drag both sides, which is right for exploring
 * and wrong for learning a line: nothing is ever asked of you, so you can step
 * through the Italian ten times and still not produce it over the board. Sean
 * said it plainly — "I need you to have me actually play this and you can talk
 * me through it".
 *
 * So this plays the opponent for you and asks for YOUR moves only. Every move
 * gets a response before the game continues:
 *
 *   Right move   — why it is the move, in one line, before the reply lands.
 *                  Being told "correct" teaches nothing; being told "that
 *                  bishop is now aiming at f7, which only the king defends" is
 *                  the reason you will find it again.
 *
 *   Wrong move   — not a failure. It says what the book plays and what your
 *                  move gives up, takes it back, and lets you try again. An
 *                  opening trainer that ends the session on a mistake is a
 *                  test, and you cannot learn a line from a test.
 *
 * NO ENGINE. Every reply is read out of the line you are training, so this
 * runs instantly and offline, and works identically on the punish lines where
 * an engine would refuse to cooperate with the losing move.
 *
 * The coaching text is per-ply and hand-written per opening — see
 * `content/coaching.ts`. Generated commentary at this level is worse than
 * none: "develops a piece" attached to every move is noise, and noise is what
 * teaches people to stop reading.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import { Board } from './Board'
import { sanArrow } from './arrows'
import { coachFor } from '../content/coaching'
import { EngineOpponent } from '../engine/opponent'
import { getEngine } from '../engine/uci'
import { lineScore } from '../engine/types'
import { loosePieces } from '../coach/exercises'
import { recordSectionResult } from '../coach/rating'
import { recordFinishedGame, outcomeOf } from '../coach/record'
import { db } from '../data/db'
import { suggestedBot } from '../engine/roster'
import type { OpeningLine, Side } from '../content/openings'

/** How long a wrong move stays on the board before it is taken back. */
const SHOW_WRONG_MS = 1600
/** Pause before the opponent replies, so the move does not just appear. */
const REPLY_MS = 550

type Phase = 'yours' | 'replying' | 'wrong' | 'done'

/**
 * `book` walks the stored line. `playon` is a real game continuing from the
 * end of it, against a bot, with the coaching switched from stored notes to
 * live support.
 *
 * This is the half that makes the opening mean anything. Knowing twelve moves
 * of the Italian and then having no idea what to do on move thirteen is the
 * complaint everybody has about opening study, and a trainer that stops
 * exactly where the difficulty starts is the reason for it.
 */
type Mode = 'book' | 'playon'

/** Shallow enough to feel instant between moves, deep enough to spot a drop. */
const SUPPORT_DEPTH = 11
/** Below this the move was fine; nobody needs telling about 40 centipawns. */
const SUPPORT_LOSS_CP = 90

export interface OpeningTrainerProps {
  line: OpeningLine
  /** Which side the user is training. */
  side: Side
  openingId: string
  /** Your rating, so the bot you play on against is aimed at you. */
  rating: number
  /** Difficulty of the line, for the rating update. Band midpoint of the opening. */
  lineRating?: number
  onExit: () => void
}

export function OpeningTrainer({
  line,
  side,
  openingId,
  rating,
  lineRating,
  onExit,
}: OpeningTrainerProps) {
  /** Guards against recording the same completion twice on a re-render. */
  const recorded = useRef(false)
  /** Same guard for the play-on GAME, which is a separate thing to record. */
  const gameRecorded = useRef(false)
  const [mode, setMode] = useState<Mode>('book')
  const [support, setSupport] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const bot = useMemo(() => suggestedBot(rating), [rating])
  const opponent = useMemo(
    () => new EngineOpponent({ elo: bot.elo, style: bot.style, name: bot.name }),
    [bot],
  )
  const chess = useRef(new Chess())
  const [ply, setPly] = useState(0)
  const [fen, setFen] = useState(() => new Chess().fen())
  const [phase, setPhase] = useState<Phase>('yours')
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  const [wrongNote, setWrongNote] = useState<string | null>(null)
  const [misses, setMisses] = useState(0)
  const [hint, setHint] = useState(false)
  /** What the play-on game did to your rating, once it is saved. */
  const [gameNote, setGameNote] = useState<string | null>(null)

  const youMoveFirst = side === 'white'
  /** Plies you are responsible for: even for White, odd for Black. */
  const isYours = useCallback(
    (p: number) => (youMoveFirst ? p % 2 === 0 : p % 2 === 1),
    [youMoveFirst],
  )

  const reset = useCallback(() => {
    chess.current = new Chess()
    setPly(0)
    setFen(chess.current.fen())
    setPhase('yours')
    setLastMove(undefined)
    setNote(null)
    setWrongNote(null)
    setMisses(0)
    setHint(false)
    setMode('book')
    setSupport(null)
    setThinking(false)
    recorded.current = false
    gameRecorded.current = false
    setGameNote(null)
    void opponent.newGame()
  }, [opponent])

  // Switching line restarts the drill rather than continuing into a
  // different one from wherever you happened to be.
  const lineKey = line.id
  useEffect(() => {
    reset()
  }, [lineKey, reset])

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

  /* If the line starts with the opponent (you are Black), play their move. */
  useEffect(() => {
    if (ply !== 0 || youMoveFirst) return
    const first = line.moves[0]
    if (!first) return
    const t = window.setTimeout(() => {
      play(first)
      setPly(1)
    }, REPLY_MS)
    return () => window.clearTimeout(t)
  }, [ply, youMoveFirst, line.moves, play])

  const expected = line.moves[ply]
  const finished = ply >= line.moves.length

  useEffect(() => {
    if (finished && phase !== 'done') setPhase('done')
  }, [finished, phase])

  /*
   * Finishing a line is training, and it recorded nothing at all.
   *
   * The trainer shipped without touching the Openings rating or the attempt
   * log, so you could learn the Italian, play it through cleanly, and every
   * number in the app would be exactly where it started. Sean noticed
   * immediately: "when I learn something it doesn't track progress on that."
   *
   * One attempt per completed line, not per move. A twelve-move line is one
   * thing learned, and scoring it as twelve successes would let the opening
   * rating outrun every other section by simply being longer.
   *
   * Clean run only counts as correct. Getting there with three wrong turns is
   * progress worth logging and is not the same as knowing it.
   */
  useEffect(() => {
    if (!finished || recorded.current || mode !== 'book') return
    recorded.current = true
    const clean = misses === 0
    void (async () => {
      await db.puzzleAttempts.add({
        puzzleId: `opening:${openingId}:${line.id}`,
        themes: 'repertoire',
        rating: lineRating ?? rating,
        correct: clean,
        ms: 0,
        tierId: null,
        at: new Date().toISOString(),
        attempts: misses + 1,
        hintUsed: hint,
        points: clean ? 10 : 4,
      })
      await recordSectionResult('opening', clean, lineRating ?? rating)
    })()
  }, [finished, mode, misses, hint, openingId, line.id, lineRating, rating])

  const yourColour = side === 'white' ? 'w' : 'b'

  /*
   * A play-on game is a real game and used to vanish.
   *
   * You could finish a full game against a rated bot from the end of an
   * opening line and there would be no History row, no rating movement and no
   * review afterwards — the Play tab did all three and this did none of them.
   * Same class of bug as the training progress that was not being recorded,
   * and the fix is the shared recorder rather than a third copy of the logic.
   *
   * No analysis pass here on purpose: you are mid-lesson and the engine is
   * already busy giving live support. The game is in History and can be
   * reviewed from there whenever you want it.
   */
  useEffect(() => {
    if (mode !== 'playon' || gameRecorded.current) return
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
      source: 'opening-trainer',
    }).then(({ delta }) => {
      setGameNote(
        `Saved to History. Your rating ${delta === 0 ? 'held' : delta > 0 ? `went up ${delta}` : `went down ${-delta}`}.`,
      )
    })
  }, [mode, fen, yourColour, bot])

  const playOnYourTurn =
    mode === 'playon' && !thinking && chess.current.turn() === yourColour && !chess.current.isGameOver()

  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>()
    if (mode === 'book' ? phase !== 'yours' || finished : !playOnYourTurn) return map
    for (const m of chess.current.moves({ verbose: true })) {
      const from = m.from as Key
      const list = map.get(from) ?? []
      list.push(m.to as Key)
      map.set(from, list)
    }
    return map
  }, [phase, fen, finished, mode, playOnYourTurn])

  /**
   * Live coaching for a move with no book behind it.
   *
   * Two passes on purpose. The loose-piece scan is instant and pure board
   * logic, so it lands the moment you let go — which is what makes the board
   * feel responsive. The engine comparison takes a search and arrives a beat
   * later, appended rather than replacing, so the fast answer is never held
   * hostage to the slow one.
   */
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
        // `after` has the opponent to move, so negate for your point of view.
        const yourCp = -lineScore(nowLine)
        const loss = bestCp - yourCp

        if (loss < SUPPORT_LOSS_CP) {
          setSupport(immediate ?? `${playedSan} is fine. Nothing of yours is hanging.`)
          return
        }
        const bestUci = before.bestMove
        const probe = new Chess(fenBefore)
        let bestSan: string | null = null
        try {
          bestSan = bestUci
            ? (probe.move({
                from: bestUci.slice(0, 2) as Square,
                to: bestUci.slice(2, 4) as Square,
                promotion: bestUci[4] ?? 'q',
              })?.san ?? null)
            : null
        } catch {
          bestSan = null
        }
        const pawns = (loss / 100).toFixed(1)
        setSupport(
          [immediate, bestSan ? `${bestSan} was stronger — ${playedSan} costs about ${pawns} pawns.` : null]
            .filter(Boolean)
            .join(' '),
        )
      } catch {
        // Engine unavailable. The loose-piece line already landed and is the
        // more useful half anyway.
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
      if (mode === 'playon') {
        onPlayOnMove(from, to)
        return
      }
      if (phase !== 'yours' || !expected) return

      const probe = new Chess(chess.current.fen())
      let san: string
      try {
        const m = probe.move({ from: from as Square, to: to as Square, promotion: 'q' })
        if (!m) return
        san = m.san
      } catch {
        return
      }

      if (san !== expected) {
        // Show it, explain it, take it back. Never end the drill on it.
        play(san)
        setMisses((n) => n + 1)
        setWrongNote(
          `The book plays ${expected} here, not ${san}. ${coachFor(openingId, line.id, ply)?.why ?? ''}`.trim(),
        )
        setPhase('wrong')
        window.setTimeout(() => {
          chess.current.undo()
          setFen(chess.current.fen())
          setLastMove(undefined)
          setWrongNote(null)
          setHint(true)
          setPhase('yours')
        }, SHOW_WRONG_MS)
        return
      }

      play(san)
      setNote(coachFor(openingId, line.id, ply)?.why ?? null)
      setHint(false)
      const next = ply + 1
      setPly(next)

      const reply = line.moves[next]
      if (reply === undefined) {
        setPhase('done')
        return
      }
      setPhase('replying')
      window.setTimeout(() => {
        play(reply)
        setPly(next + 1)
        setNote(coachFor(openingId, line.id, next)?.why ?? null)
        setPhase(next + 1 >= line.moves.length ? 'done' : 'yours')
      }, REPLY_MS)
    },
    [phase, expected, ply, line, openingId, play, mode, onPlayOnMove],
  )

  const moveNo = Math.floor(ply / 2) + 1
  const yourTurn = phase === 'yours' && !finished && isYours(ply)

  /*
   * When the drill is telling you the move — a hint, or the retry after a
   * wrong one — it now also draws it. "It is Nf3" made you translate
   * notation; the arrow is the move itself.
   */
  const shapes = useMemo(() => {
    if (mode !== 'book' || !yourTurn || !expected) return []
    return hint || misses > 0 ? sanArrow(fen, expected) : []
  }, [mode, yourTurn, expected, hint, misses, fen])

  /*
   * Fixed overlay rather than an inline swap.
   *
   * The trainer lives inside the openings SECTION, which lives inside Learn's
   * chrome — so rendering inline left the section's rating header above the
   * board and the whole tier ladder below the coach panel. During a drill both
   * are noise, and the ladder in particular sits exactly where your eye goes
   * after a wrong move. Taking the screen is the honest representation of what
   * this is: a modal activity you enter and leave.
   */
  return (
    <div className="trainer-screen">
      <div className="trainer-head">
        <button className="chip" onClick={onExit}>
          ‹ Back to the book
        </button>
        <span className="trainer-prog">
          {mode === 'playon'
            ? `${bot.face} ${bot.name} ${bot.elo}`
            : `${Math.min(ply, line.moves.length)} / ${line.moves.length}`}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={side}
        dests={dests}
        turn={chess.current.turn() === 'w' ? 'white' : 'black'}
        playable={mode === 'playon' ? (playOnYourTurn ? side : null) : yourTurn ? side : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        shapes={shapes}
        onMove={onMove}
      />

      {mode === 'playon' ? (
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
                ? `Checkmate — ${chess.current.turn() === (side === 'white' ? 'w' : 'b') ? 'you lost this one' : 'you won'}.`
                : 'Drawn.'
              : (support ??
                `Out of the book now — this is a real game against ${bot.name}. I will flag anything you leave hanging and tell you when there was something stronger.`)}
            {gameNote && <div className="small muted" style={{ marginTop: 6 }}>{gameNote}</div>}
          </div>
          <div className="coach-actions">
            <span className="coach-hint">{bot.weakness}</span>
          </div>
        </div>
      ) : phase === 'wrong' && wrongNote ? (
        <div className="coach wrong">
          <div className="coach-role">Not this one</div>
          <div className="coach-text">{wrongNote}</div>
        </div>
      ) : phase === 'done' ? (
        <div className="coach done">
          <div className="coach-role">Line complete</div>
          <div className="coach-text">
            {misses === 0
              ? 'Straight through, no wrong turns. You know this line — play it against a bot next.'
              : `Through it with ${misses} wrong turn${misses === 1 ? '' : 's'}. Run it again — the second pass is where it sticks.`}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {/*
              The point of the whole feature. Knowing twelve moves and then
              having no idea what to do on move thirteen is the complaint
              everyone has about opening study — so the drill hands you
              straight into a real game from the position you just built,
              against a bot aimed at your rating, with the coaching still on.
            */}
            <button
              className="chip solid"
              onClick={() => {
                setMode('playon')
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
              Back to the book
            </button>
          </div>
        </div>
      ) : (
        <div className="coach">
          <div className="coach-role">
            {yourTurn ? `Your move — ${moveNo}${side === 'white' ? '.' : '…'}` : 'They reply…'}
          </div>
          <div className="coach-text">
            {note ?? 'Play the book move. If you get it wrong I will tell you what it was and why.'}
          </div>
          {yourTurn && (
            <div className="coach-actions">
              {hint || misses > 0 ? (
                <span className="coach-hint">
                  It is <b>{expected}</b>.
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
    </div>
  )
}
