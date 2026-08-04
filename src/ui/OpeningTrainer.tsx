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
import { coachFor } from '../content/coaching'
import type { OpeningLine, Side } from '../content/openings'

/** How long a wrong move stays on the board before it is taken back. */
const SHOW_WRONG_MS = 1600
/** Pause before the opponent replies, so the move does not just appear. */
const REPLY_MS = 550

type Phase = 'yours' | 'replying' | 'wrong' | 'done'

export interface OpeningTrainerProps {
  line: OpeningLine
  /** Which side the user is training. */
  side: Side
  openingId: string
  onExit: () => void
}

export function OpeningTrainer({ line, side, openingId, onExit }: OpeningTrainerProps) {
  const chess = useRef(new Chess())
  const [ply, setPly] = useState(0)
  const [fen, setFen] = useState(() => new Chess().fen())
  const [phase, setPhase] = useState<Phase>('yours')
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  const [wrongNote, setWrongNote] = useState<string | null>(null)
  const [misses, setMisses] = useState(0)
  const [hint, setHint] = useState(false)

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
  }, [])

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

  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>()
    if (phase !== 'yours' || finished) return map
    for (const m of chess.current.moves({ verbose: true })) {
      const from = m.from as Key
      const list = map.get(from) ?? []
      list.push(m.to as Key)
      map.set(from, list)
    }
    return map
  }, [phase, fen, finished])

  const onMove = useCallback(
    (from: Key, to: Key) => {
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
    [phase, expected, ply, line, openingId, play],
  )

  const moveNo = Math.floor(ply / 2) + 1
  const yourTurn = phase === 'yours' && !finished && isYours(ply)

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
          {Math.min(ply, line.moves.length)} / {line.moves.length}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={side}
        dests={dests}
        turn={chess.current.turn() === 'w' ? 'white' : 'black'}
        playable={yourTurn ? side : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        onMove={onMove}
      />

      {phase === 'wrong' && wrongNote ? (
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
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="chip solid" onClick={reset}>
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
