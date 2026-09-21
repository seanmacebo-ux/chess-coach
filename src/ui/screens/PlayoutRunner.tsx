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

  /*
   * Which setup the board is currently on.
   *
   * Bumped by every reset. An engine reply captures it before awaiting and
   * drops itself if it no longer matches, so a search that started against a
   * position we have since left can never apply its move to the new one.
   * React's StrictMode runs effects twice in development, which makes that
   * race happen on every single mount rather than rarely.
   *
   * It is BOTH a ref and a state value, deliberately. The ref is what the
   * async reply reads, because it has to see the newest value and not the
   * one captured when it started. The state is what the opening-reply effect
   * depends on — and that half was missing at first, which cost a second
   * bug: pressing Restart mid-drill changed the ref but no dependency, so
   * the effect never re-ran and the board froze exactly as before.
   */
  const generation = useRef(0)
  const [gen, setGen] = useState(0)

  /*
   * Put the board back to the drill's starting position.
   *
   * Both the mount effect and the Restart button go through here, because
   * they had drifted apart: the button forgot to bump the generation, so a
   * restart mid-search let the abandoned reply land on the fresh board, and
   * it forgot the hint, so restarting left the answer on screen.
   */
  const reset = useCallback(() => {
    generation.current++
    setGen(generation.current)
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

  useEffect(reset, [reset])

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
      const mine = generation.current
      setPhase('thinking')
      try {
        const analysis = await getEngine().analyse(chess.current.fen(), {
          depth: DEFENCE_DEPTH,
          multipv: 1,
        })
        // The board was reset while this search was running. Applying the
        // move now would play it on a different position — and concluding on
        // it would end a drill that has only just started.
        if (mine !== generation.current) return
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

  /*
   * THE ENGINE MOVES FIRST WHEN IT IS THE ENGINE'S TURN.
   *
   * engineReply was only ever called from onMove — after you had played — so
   * a position whose FEN has the DEFENDER to move sat there forever. You saw
   * the board, clicked your king, and nothing lit up, because it was not your
   * turn and nothing was ever going to make it your turn. Sean's words for
   * this were "wtf your learn is broken".
   *
   * Nine of the twenty endgame positions start that way, and it is not an
   * accident in the data: opposition, the trébuchet, mutual zugzwang and the
   * fortresses are ALL defined by whose turn it is. "Kings two squares apart
   * with the other side to move" is the entire lesson — you cannot express it
   * with your own side on move. So the bug landed squarely on the most
   * instructive half of the section, and left the shallow ones working.
   *
   * Guarded on the ref rather than on `phase`, because phase goes
   * 'playing' -> 'thinking' -> 'playing' during a reply and would re-trigger.
   */
  const openedFor = useRef(-1)
  useEffect(() => {
    if (phase !== 'playing') return
    // Keyed on the generation rather than on a boolean a sibling effect has
    // to remember to clear — that ordering is exactly what turns one opening
    // reply into two, and two replies means the engine plays YOUR move.
    if (openedFor.current === generation.current) return
    openedFor.current = generation.current
    if (chess.current.turn() === you || chess.current.isGameOver()) return
    void engineReply(0)
  }, [gen, phase, you, engineReply])

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

  const restart = reset

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
