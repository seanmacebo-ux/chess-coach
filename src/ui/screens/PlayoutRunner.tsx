/**
 * Endgame play-out.
 *
 * The difference between this and the puzzle runner is the whole reason it
 * exists: a puzzle has a scripted reply, so it can only ask "what is the
 * move?". Technique is not a move, it is a procedure — you win a Lucena over
 * four moves against a defender who is actively trying to stop you, and any
 * one of those moves in isolation looks unremarkable. So here the engine
 * defends at full strength and you have to actually convert.
 *
 * Two design calls worth stating:
 *
 *   The engine plays its BEST move, not a rating-limited one. A defender who
 *   blunders turns a technique drill into a free win, and the entire value of
 *   these positions is that they are exactly winnable and not one move more.
 *
 *   Holding a draw counts as success. Half of the endgame ladder is defensive
 *   — the Philidor, the wrong bishop, the rook-pawn — and marking those as
 *   failures because you didn't win would teach the opposite of the lesson.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

import { Board } from '../Board'
import { applyUci, statusOf, toDests } from '../../chess/game'
import { getEngine } from '../../engine/uci'
import { lineScore } from '../../engine/types'
import { recordTierAttempt } from '../../coach/profile'
import { db } from '../../data/db'
import type { EndgamePosition } from '../../coach/endgames'

/** Depth the defender searches at. High — this side is meant to be perfect. */
const DEFENCE_DEPTH = 18

/**
 * Same threshold the endgame verifier uses. Above this you are winning rather
 * than merely better, which matters because several holding positions are a
 * whole piece up and still dead drawn.
 */
const LOST_CP = -450

type Phase = 'playing' | 'thinking' | 'won' | 'held' | 'lost' | 'capped'

export interface PlayoutRunnerProps {
  position: EndgamePosition
  tierId?: string | null
  onDone: (result: { success: boolean }) => void
}

export function PlayoutRunner({ position, tierId = null, onDone }: PlayoutRunnerProps) {
  const chess = useRef(new Chess(position.fen))
  const [fen, setFen] = useState(position.fen)
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('playing')
  const [moves, setMoves] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [hintOpen, setHintOpen] = useState(false)
  const startedAt = useRef(Date.now())
  const recorded = useRef(false)

  const you = position.youPlay
  const yourColour = you === 'w' ? 'white' : 'black'

  /* -------------------------------------------------------- reset */
  useEffect(() => {
    chess.current = new Chess(position.fen)
    setFen(position.fen)
    setLastMove(undefined)
    setPhase('playing')
    setMoves(0)
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
        // Namespaced so endgame attempts never collide with Lichess puzzle
        // ids, and so History can tell the two apart.
        puzzleId: `eg:${position.id}`,
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

  /* --------------------------------------------------- conclusion */
  const conclude = useCallback(
    (next: Phase, message: string) => {
      setPhase(next)
      setNote(message)
      void record(next === 'won' || next === 'held')
    },
    [record],
  )

  /**
   * Decide the position after every ply.
   *
   * Returns true when the drill is over. Terminal chess results are exact;
   * the move cap is the only judgement call, and that one asks the engine
   * rather than guessing.
   */
  const settle = useCallback(
    async (playedByYou: number): Promise<boolean> => {
      const board = chess.current
      const s = statusOf(board)

      if (s.over) {
        if (board.isCheckmate()) {
          // The side to move is the one mated.
          const matedIsYou = board.turn() === you
          if (matedIsYou) conclude('lost', 'Checkmated. That is a loss however the drill was set.')
          else if (position.goal === 'win') conclude('won', 'Converted. That is the technique.')
          else conclude('won', 'Mate — better than the draw you needed.')
        } else if (position.goal === 'draw') {
          conclude('held', `Held it — ${s.text.toLowerCase()}. That is the half point.`)
        } else {
          conclude('capped', `${s.text} You needed the win, so this one is down as missed.`)
        }
        return true
      }

      if (playedByYou >= position.moveCap) {
        if (position.goal === 'win') {
          conclude(
            'capped',
            `Out of moves at ${position.moveCap}. The win is there — it just has to be found faster.`,
          )
          return true
        }
        // Defensive goal: you only held it if the position is not actually
        // lost. Ask the engine rather than accepting a shuffle as a draw.
        setPhase('thinking')
        try {
          const analysis = await getEngine().analyse(board.fen(), {
            depth: DEFENCE_DEPTH,
            multipv: 1,
          })
          const line = analysis.lines[0]
          const fromMover = line ? lineScore(line) : 0
          const yours = board.turn() === you ? fromMover : -fromMover
          if (yours > LOST_CP) {
            conclude('held', `Held for ${position.moveCap} moves. That is the draw.`)
          } else {
            conclude('lost', 'The position has slipped past saving. Worth replaying from the start.')
          }
        } catch {
          // Never punish for an engine failure.
          conclude('held', `Held for ${position.moveCap} moves.`)
        }
        return true
      }

      return false
    },
    [position, you, conclude],
  )

  /* -------------------------------------------------- engine move */
  const engineReply = useCallback(
    async (playedByYou: number) => {
      setPhase('thinking')
      try {
        const analysis = await getEngine().analyse(chess.current.fen(), {
          depth: DEFENCE_DEPTH,
          multipv: 1,
        })
        const best = analysis.bestMove
        if (!best || !applyUci(chess.current, best)) {
          conclude('held', 'The defence has run out of moves.')
          return
        }
        setFen(chess.current.fen())
        setLastMove([best.slice(0, 2) as Key, best.slice(2, 4) as Key])
        const over = await settle(playedByYou)
        if (!over) setPhase('playing')
      } catch (err) {
        setNote(`Engine error: ${err instanceof Error ? err.message : String(err)}`)
        setPhase('playing')
      }
    },
    [conclude, settle],
  )

  /* ---------------------------------------------------- your move */
  const onMove = useCallback(
    (from: Key, to: Key) => {
      if (phase !== 'playing') return
      try {
        chess.current.move({ from, to, promotion: 'q' })
      } catch {
        return
      }
      const played = moves + 1
      setMoves(played)
      setFen(chess.current.fen())
      setLastMove([from, to])

      void (async () => {
        const over = await settle(played)
        if (!over) await engineReply(played)
      })()
    },
    [phase, moves, settle, engineReply],
  )

  const dests = useMemo(
    () => (phase === 'playing' ? toDests(chess.current) : new Map<Key, Key[]>()),
    [fen, phase],
  )

  const restart = useCallback(() => {
    chess.current = new Chess(position.fen)
    setFen(position.fen)
    setLastMove(undefined)
    setPhase('playing')
    setMoves(0)
    setNote(null)
    startedAt.current = Date.now()
    recorded.current = false
  }, [position])

  const done = phase === 'won' || phase === 'held' || phase === 'lost' || phase === 'capped'
  const success = phase === 'won' || phase === 'held'

  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">
          {position.goal === 'win' ? 'Win this' : 'Hold this'} as{' '}
          {you === 'w' ? 'White' : 'Black'}
        </span>
        <span className="small muted">
          move {Math.min(moves, position.moveCap)} of {position.moveCap}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={yourColour}
        dests={dests}
        turn={chess.current.turn() === 'w' ? 'white' : 'black'}
        playable={phase === 'playing' ? yourColour : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        onMove={onMove}
      />

      <div className={'card verdict ' + (done ? (success ? 'solved' : 'shown') : '')}>
        {!done && (
          <div>
            <strong>{position.name}.</strong>{' '}
            <span className="muted">
              {position.goal === 'win'
                ? `Convert it inside ${position.moveCap} moves. The engine defends perfectly.`
                : `Survive ${position.moveCap} moves. The engine is trying to win.`}
            </span>
          </div>
        )}
        {done && (
          <div>
            <strong>
              {phase === 'won'
                ? 'Won it.'
                : phase === 'held'
                  ? 'Held it.'
                  : phase === 'lost'
                    ? 'Lost it.'
                    : 'Not this time.'}
            </strong>{' '}
            <span className="muted">{note}</span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ the breakdown */}
      <div className="card stack">
        <span className="small muted">Why this position matters</span>
        <div className="small">{position.why}</div>
        {!done && (
          <>
            <button className="ghost small" onClick={() => setHintOpen(!hintOpen)}>
              {hintOpen ? 'Hide the idea' : 'Show me the idea'}
            </button>
            {hintOpen && (
              <div className="small" style={{ color: 'var(--warn)' }}>
                {position.hint}
              </div>
            )}
          </>
        )}
        {done && (
          <div className="small" style={{ color: 'var(--warn)' }}>
            <strong>The idea:</strong> {position.hint}
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="ghost" style={{ flex: 1 }} onClick={restart}>
          Restart
        </button>
        <button className="primary" style={{ flex: 1 }} onClick={() => onDone({ success })}>
          {done ? 'Done' : 'Give up'}
        </button>
      </div>
    </div>
  )
}
