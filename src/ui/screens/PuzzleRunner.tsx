/**
 * The puzzle player.
 *
 * Lichess puzzles are multi-move: you play a move, the opponent replies from
 * the stored line, you play again. So the runner tracks position within the
 * line rather than treating a puzzle as a single question.
 *
 * Two rules that make this train rather than test:
 *
 *   A wrong move is shown, not swallowed. You see the piece land, then it
 *   comes back — so you can tell WHAT you played, not just that you failed.
 *
 *   Getting it wrong once marks the puzzle failed even if you then find it.
 *   Otherwise the accuracy that gates tier progress is meaningless.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

import { Board } from '../Board'
import { toDests } from '../../chess/game'
import type { Puzzle } from '../../data/puzzles'
import { db } from '../../data/db'
import { recordTierAttempt } from '../../coach/profile'

type Phase = 'solving' | 'wrong' | 'solved' | 'shown'

export interface PuzzleRunnerProps {
  puzzles: Puzzle[]
  /** Tier these count toward, if any. */
  tierId?: string | null
  onDone: (result: { solved: number; total: number }) => void
}

export function PuzzleRunner({ puzzles, tierId = null, onDone }: PuzzleRunnerProps) {
  const [index, setIndex] = useState(0)
  const puzzle = puzzles[index]

  const chess = useRef(new Chess())
  const [fen, setFen] = useState('')
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<Phase>('solving')
  const [solvedCount, setSolvedCount] = useState(0)
  // Failing once sticks, even if the next attempt is right.
  const failedRef = useRef(false)
  const startedAt = useRef(Date.now())

  /* Load a puzzle. */
  useEffect(() => {
    if (!puzzle) return
    chess.current = new Chess(puzzle.fen)
    setFen(puzzle.fen)
    setLastMove(undefined)
    setStep(0)
    setPhase('solving')
    failedRef.current = false
    startedAt.current = Date.now()
  }, [puzzle])

  const dests = useMemo(
    () => (phase === 'solving' ? toDests(chess.current) : new Map<Key, Key[]>()),
    [fen, phase],
  )

  const finish = useCallback(
    async (correct: boolean) => {
      if (!puzzle) return
      setPhase(correct ? 'solved' : 'shown')
      if (correct) setSolvedCount((c) => c + 1)

      await db.puzzleAttempts.add({
        puzzleId: puzzle.id,
        themes: puzzle.themes.join(' '),
        rating: puzzle.rating,
        correct,
        ms: Date.now() - startedAt.current,
        tierId,
        at: new Date().toISOString(),
      })
      if (tierId) await recordTierAttempt(tierId, correct)
    },
    [puzzle, tierId],
  )

  /** Play the opponent's scripted reply, then hand back control. */
  const playReply = useCallback(
    (nextStep: number) => {
      if (!puzzle) return
      const reply = puzzle.line[nextStep]
      if (!reply) {
        void finish(!failedRef.current)
        return
      }
      window.setTimeout(() => {
        try {
          chess.current.move({
            from: reply.slice(0, 2),
            to: reply.slice(2, 4),
            promotion: reply[4],
          })
          setFen(chess.current.fen())
          setLastMove([reply.slice(0, 2) as Key, reply.slice(2, 4) as Key])
          setStep(nextStep + 1)
        } catch {
          void finish(!failedRef.current)
        }
      }, 320)
    },
    [puzzle, finish],
  )

  const onMove = useCallback(
    (from: Key, to: Key) => {
      if (!puzzle || phase !== 'solving') return
      const expected = puzzle.line[step]
      if (!expected) return

      const played = `${from}${to}`
      // Compare the first four chars — auto-queening makes the promotion
      // suffix differ from the stored line even on a correct move.
      const isRight = expected.slice(0, 4) === played

      try {
        chess.current.move({ from, to, promotion: 'q' })
      } catch {
        return
      }
      setFen(chess.current.fen())
      setLastMove([from, to])

      if (!isRight) {
        failedRef.current = true
        setPhase('wrong')
        // Show the mistake on the board before taking it back.
        window.setTimeout(() => {
          chess.current.undo()
          setFen(chess.current.fen())
          setLastMove(undefined)
          setPhase('solving')
        }, 700)
        return
      }

      const next = step + 1
      setStep(next)
      if (next >= puzzle.line.length) {
        void finish(!failedRef.current)
      } else {
        playReply(next)
      }
    },
    [puzzle, phase, step, finish, playReply],
  )

  const showSolution = useCallback(() => {
    if (!puzzle) return
    failedRef.current = true
    // Replay the whole line from the start so the user sees the idea.
    const board = new Chess(puzzle.fen)
    for (const m of puzzle.line) {
      try {
        board.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })
      } catch {
        break
      }
    }
    chess.current = board
    setFen(board.fen())
    const last = puzzle.line[puzzle.line.length - 1]
    setLastMove(last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined)
    void finish(false)
  }, [puzzle, finish])

  const next = useCallback(() => {
    if (index + 1 >= puzzles.length) {
      onDone({ solved: solvedCount, total: puzzles.length })
    } else {
      setIndex(index + 1)
    }
  }, [index, puzzles.length, solvedCount, onDone])

  if (!puzzle) {
    return <div className="card">No puzzles available.</div>
  }

  const done = phase === 'solved' || phase === 'shown'

  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">
          Puzzle {index + 1} of {puzzles.length} · rated {puzzle.rating}
        </span>
        <span className="small muted">{solvedCount} solved</span>
      </div>

      <Board
        fen={fen}
        orientation={puzzle.colour}
        dests={dests}
        turn={puzzle.colour}
        playable={phase === 'solving' ? puzzle.colour : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        onMove={onMove}
      />

      <div className={'card verdict ' + phase}>
        {phase === 'solving' && (
          <div>
            <strong>{puzzle.colour === 'white' ? 'White' : 'Black'} to play.</strong>{' '}
            <span className="muted">Find the best move.</span>
          </div>
        )}
        {phase === 'wrong' && <div>Not that one. Look again.</div>}
        {phase === 'solved' && (
          <div>
            <strong>Correct.</strong> <span className="muted">{describeThemes(puzzle.themes)}</span>
          </div>
        )}
        {phase === 'shown' && (
          <div>
            <strong>Solution shown.</strong>{' '}
            <span className="muted">
              {describeThemes(puzzle.themes)} — this one goes in your log.
            </span>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        {!done ? (
          <button className="ghost" style={{ flex: 1 }} onClick={showSolution}>
            Show me
          </button>
        ) : (
          <button className="primary" style={{ flex: 1 }} onClick={next}>
            {index + 1 >= puzzles.length ? 'Finish' : 'Next puzzle'}
          </button>
        )}
      </div>
    </div>
  )
}

/** Turn Lichess motif tags into something a human reads. */
const THEME_LABEL: Record<string, string> = {
  fork: 'a fork',
  pin: 'a pin',
  skewer: 'a skewer',
  discoveredAttack: 'a discovered attack',
  doubleCheck: 'a double check',
  deflection: 'a deflection',
  attraction: 'an attraction',
  hangingPiece: 'a hanging piece',
  backRankMate: 'a back-rank mate',
  smotheredMate: 'a smothered mate',
  quietMove: 'a quiet move',
  defensiveMove: 'a defensive move',
  capturingDefender: 'capturing the defender',
  sacrifice: 'a sacrifice',
  advancedPawn: 'an advanced pawn',
  promotion: 'a promotion',
  interference: 'an interference',
  xRayAttack: 'an x-ray',
  zugzwang: 'zugzwang',
  intermezzo: 'an in-between move',
  trappedPiece: 'a trapped piece',
  exposedKing: 'an exposed king',
  mateIn1: 'mate in one',
  mateIn2: 'mate in two',
  mateIn3: 'mate in three',
}

function describeThemes(themes: string[]): string {
  const named = themes.map((t) => THEME_LABEL[t]).filter(Boolean)
  if (named.length === 0) return ''
  return `The idea was ${named.slice(0, 2).join(' and ')}.`
}
