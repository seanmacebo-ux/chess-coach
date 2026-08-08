/**
 * Positional play-out — find the idea, then play it.
 *
 * A positional concept is not a move you spot, it is a plan you carry out. So
 * this runner has two acts:
 *
 *   1. FIND. You have to play the thematic move yourself. Get it and the coach
 *      tells you why it is the idea; miss it and you are nudged, not marked down
 *      — understanding is the goal, not a score.
 *   2. PLAY IT OUT. The engine answers at full strength and you keep going, with
 *      the plan pinned above the board, so you feel why the square (or file, or
 *      structure) was worth playing for. Kotov by way of Nimzowitsch: the idea
 *      only becomes yours once you have had to sustain it against resistance.
 *
 * Unlike the endgame runner there is no win/draw verdict — a positional edge
 * rarely forces a result inside a few moves. Success here is simpler and
 * honest: did you find the idea, and did you play the phase out without
 * throwing it away. The soundness of every keyMove is guaranteed upstream by
 * scripts/verify-positional.ts, so the drill can trust its own answer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

import { Board } from '../Board'
import { uciArrow } from '../arrows'
import { applyUci, toDests } from '../../chess/game'
import { getEngine } from '../../engine/uci'
import { recordTierAttempt } from '../../coach/profile'
import { db } from '../../data/db'
import type { PositionalPosition } from '../../coach/positional'

/** The engine answers at full strength — a soft reply would hide the point. */
const REPLY_DEPTH = 16

type Phase = 'find' | 'thinking' | 'playing' | 'done'

export interface PositionalRunnerProps {
  position: PositionalPosition
  tierId?: string | null
  onDone: (result: { success: boolean }) => void
}

export function PositionalRunner({ position, tierId = null, onDone }: PositionalRunnerProps) {
  const chess = useRef(new Chess(position.fen))
  const [fen, setFen] = useState(position.fen)
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('find')
  const [moves, setMoves] = useState(0)
  const [misses, setMisses] = useState(0)
  const [foundIt, setFoundIt] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [hintOpen, setHintOpen] = useState(false)
  const startedAt = useRef(Date.now())
  const recorded = useRef(false)

  const you = position.youPlay
  const yourColour = you === 'w' ? 'white' : 'black'
  const keyFrom = position.keyMove.slice(0, 2)
  const keyTo = position.keyMove.slice(2, 4)

  /* -------------------------------------------------------- reset */
  useEffect(() => {
    chess.current = new Chess(position.fen)
    setFen(position.fen)
    setLastMove(undefined)
    setPhase('find')
    setMoves(0)
    setMisses(0)
    setFoundIt(false)
    setNote(null)
    setHintOpen(false)
    startedAt.current = Date.now()
    recorded.current = false
  }, [position])

  /* ------------------------------------------------------- record */
  const record = useCallback(
    async (success: boolean) => {
      if (recorded.current) return
      recorded.current = true
      await db.puzzleAttempts.add({
        // Namespaced so positional attempts never collide with puzzle or
        // endgame ids, and History can tell them apart.
        puzzleId: `pos:${position.id}`,
        themes: position.concepts.join(' '),
        rating: 0,
        correct: success,
        ms: Date.now() - startedAt.current,
        tierId,
        at: new Date().toISOString(),
      })
      if (tierId) await recordTierAttempt(tierId, success)
    },
    [position, tierId],
  )

  /* -------------------------------------------------- engine reply */
  const engineReply = useCallback(async () => {
    setPhase('thinking')
    try {
      const analysis = await getEngine().analyse(chess.current.fen(), {
        depth: REPLY_DEPTH,
        multipv: 1,
      })
      const best = analysis.bestMove
      if (best && applyUci(chess.current, best)) {
        setFen(chess.current.fen())
        setLastMove([best.slice(0, 2) as Key, best.slice(2, 4) as Key])
      }
      if (chess.current.isGameOver()) {
        setPhase('done')
        setNote('The game is over — but you carried the idea through. That is the rep.')
        void record(true)
        return
      }
      setPhase('playing')
    } catch (err) {
      setNote(`Engine error: ${err instanceof Error ? err.message : String(err)}`)
      setPhase('playing')
    }
  }, [record])

  /* ---------------------------------------------------- your move */
  const onMove = useCallback(
    (from: Key, to: Key) => {
      if (phase !== 'find' && phase !== 'playing') return

      /* Act one: you must play the thematic move. */
      if (phase === 'find') {
        const isKey = from === keyFrom && to === keyTo
        if (!isKey) {
          // A nudge, not a penalty. Let the board snap back and try again.
          setMisses((m) => m + 1)
          setNote(
            misses === 0
              ? 'Not the idea yet — this is about the square, not a capture or a check. Try the move that claims it for good.'
              : 'Still not it. Tap “Show me the idea” if you want the nudge — no shame in it.',
          )
          return
        }
        applyUci(chess.current, position.keyMove)
        setFen(chess.current.fen())
        setLastMove([keyFrom as Key, keyTo as Key])
        setFoundIt(true)
        /*
         * One line, not the essay. This used to be `position.why`, the same
         * paragraph the "Why this position matters" card renders directly
         * below — Sean screenshotted the page saying the identical text twice.
         * The coach cell confirms and points down; the why card explains.
         */
        setNote('You found it. The full story is below — now play the plan out.')
        void engineReply()
        return
      }

      /* Act two: play the plan out. */
      try {
        chess.current.move({ from, to, promotion: 'q' })
      } catch {
        return
      }
      const played = moves + 1
      setMoves(played)
      setFen(chess.current.fen())
      setLastMove([from, to])

      if (played >= position.playCap || chess.current.isGameOver()) {
        setPhase('done')
        setNote('Played out. Sit with the finished position — that is what the idea buys you.')
        void record(foundIt)
        return
      }
      void engineReply()
    },
    [phase, misses, moves, keyFrom, keyTo, position, engineReply, foundIt, record],
  )

  const reveal = useCallback(() => {
    if (phase !== 'find') return
    applyUci(chess.current, position.keyMove)
    setFen(chess.current.fen())
    setLastMove([keyFrom as Key, keyTo as Key])
    setFoundIt(false) // shown, not found — recorded as needing the hint
    setNote('There it is. The full story is below — now play the plan out.')
    void engineReply()
  }, [phase, position, keyFrom, keyTo, engineReply])

  const restart = useCallback(() => {
    chess.current = new Chess(position.fen)
    setFen(position.fen)
    setLastMove(undefined)
    setPhase('find')
    setMoves(0)
    setMisses(0)
    setFoundIt(false)
    setNote(null)
    setHintOpen(false)
    startedAt.current = Date.now()
    recorded.current = false
  }, [position])

  /*
   * "Show me the idea" now SHOWS it: the key move as an arrow on the board,
   * not a sentence to decode. The verifier upstream guarantees the move is
   * legal and sound, so the arrow can be trusted blind.
   */
  const shapes = useMemo(
    () => (phase === 'find' && hintOpen ? uciArrow(position.keyMove) : []),
    [phase, hintOpen, position.keyMove],
  )

  const dests = useMemo(
    () => (phase === 'find' || phase === 'playing' ? toDests(chess.current) : new Map<Key, Key[]>()),
    [fen, phase],
  )

  const done = phase === 'done'

  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">
          {phase === 'find' ? 'Find the idea' : phase === 'done' ? 'Idea played out' : 'Play the plan'}{' '}
          as {you === 'w' ? 'White' : 'Black'}
        </span>
        {(phase === 'playing' || phase === 'thinking' || done) && (
          <span className="small muted">
            move {Math.min(moves, position.playCap)} of {position.playCap}
          </span>
        )}
      </div>

      <Board
        fen={fen}
        orientation={yourColour}
        dests={dests}
        turn={chess.current.turn() === 'w' ? 'white' : 'black'}
        playable={phase === 'find' || phase === 'playing' ? yourColour : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        shapes={shapes}
        onMove={onMove}
      />

      {/* -------------------------------------------------- the coach */}
      {/* stack, because .verdict is a flex ROW — its two children rendered
          side by side, wedging the plan into a ten-character column. */}
      <div
        className={'card verdict stack ' + (done ? (foundIt ? 'solved' : 'shown') : foundIt ? 'solved' : '')}
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
      >
        {phase === 'find' && (
          <div>
            <strong>{position.name}.</strong>{' '}
            <span className="muted">{note ?? 'Play the move that carries the idea. The engine answers back at full strength.'}</span>
          </div>
        )}
        {foundIt && phase !== 'find' && !done && (
          <div>
            <strong>That's it — {position.keySan}.</strong> <span className="muted">{note}</span>
          </div>
        )}
        {(phase === 'thinking' || phase === 'playing') && (
          <div className="small muted" style={{ marginTop: 6 }}>
            <strong>Now:</strong> {position.plan}
            {phase === 'thinking' && ' · the engine is replying…'}
          </div>
        )}
        {done && (
          <div>
            <strong>{foundIt ? 'Idea carried through.' : 'Idea shown.'}</strong>{' '}
            <span className="muted">{note}</span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ why it matters */}
      <div className="card stack">
        <span className="small muted">Why this position matters</span>
        <div className="small">{position.why}</div>
        <span className="small muted" style={{ marginTop: 4 }}>{position.source}</span>
        {phase === 'find' && (
          <>
            <button className="ghost small" onClick={() => setHintOpen(!hintOpen)}>
              {hintOpen ? 'Hide the idea' : 'Show me the idea'}
            </button>
            {hintOpen && (
              <div className="small stack" style={{ color: 'var(--warn)' }}>
                <span>{position.hint}</span>
                <button className="ghost small" onClick={reveal}>
                  Play it for me
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="ghost" style={{ flex: 1 }} onClick={restart}>
          Restart
        </button>
        <button className="primary" style={{ flex: 1 }} onClick={() => onDone({ success: foundIt })}>
          {done ? 'Done' : 'Leave'}
        </button>
      </div>
    </div>
  )
}
