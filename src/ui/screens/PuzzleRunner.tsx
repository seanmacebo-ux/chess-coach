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
import { briefing, type Puzzle } from '../../data/puzzles'
import { db } from '../../data/db'
import { recordTierAttempt } from '../../coach/profile'
import { explainWrongMove, tagForThemes } from '../../coach/analysis'

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
  /** The move in algebraic, once revealed. */
  const [answerSan, setAnswerSan] = useState<string | null>(null)
  /** Why the last wrong move fails, in words. */
  const [whyWrong, setWhyWrong] = useState<string | null>(null)
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
    setAnswerSan(null)
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

      const at = new Date().toISOString()
      await db.puzzleAttempts.add({
        puzzleId: puzzle.id,
        themes: puzzle.themes.join(' '),
        rating: puzzle.rating,
        correct,
        ms: Date.now() - startedAt.current,
        tierId,
        at,
      })

      // A failed puzzle is a real hole in your vision, so it goes in the same
      // log as a blunder from a real game. Without this the weakness profile
      // only ever learned from games and puzzle failures changed nothing.
      if (!correct) {
        const tag = tagForThemes(puzzle.themes)
        await db.mistakes.add({
          gameId: 0, // 0 = came from a puzzle, not a game
          source: 'puzzle',
          ply: 0,
          fen: puzzle.fen,
          san: '',
          bestSan: null,
          // Weight by puzzle difficulty: missing a 1600 tactic says more than
          // missing an 800 one. Scaled into the same centipawn units the
          // profile ranks games by.
          lossCp: Math.round(80 + puzzle.rating / 12),
          severity: 'mistake',
          tag,
          phase: puzzle.themes.some((t) => t.endsWith('Endgame')) ? 'endgame' : 'middlegame',
          at,
        })
      }

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
      const fenBefore = chess.current.fen()
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
        // Say WHY it fails, not just that it does. Computed from the position
        // before the move, board-only, so it appears instantly.
        setWhyWrong(explainWrongMove(fenBefore, played))
        setPhase('wrong')
        // Show the mistake on the board before taking it back — you need to
        // see what you played, not just be told it was wrong.
        window.setTimeout(() => {
          chess.current.undo()
          setFen(chess.current.fen())
          setLastMove(undefined)
          setPhase('solving')
        }, 1100)
        return
      }
      setWhyWrong(null)

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

    // Show the KEY MOVE, not the finished position.
    //
    // This used to replay the entire line and leave the board on the final
    // position — so "Solution shown" showed you the aftermath and never told
    // you which move was the point. Play only the move that was due, name it
    // in algebraic, and leave the rest of the line to step through.
    const board = new Chess(chess.current.fen())
    const due = puzzle.line[step]
    let san: string | null = null
    if (due) {
      try {
        san =
          board.move({
            from: due.slice(0, 2),
            to: due.slice(2, 4),
            promotion: due[4],
          })?.san ?? null
      } catch {
        san = null
      }
    }

    chess.current = board
    setFen(board.fen())
    setLastMove(due ? [due.slice(0, 2) as Key, due.slice(2, 4) as Key] : undefined)
    setAnswerSan(san)
    void finish(false)
  }, [puzzle, step, finish])

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
  const brief = briefing(puzzle)

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
            <strong>{brief.objective}.</strong>{' '}
            <span className="muted">
              {puzzle.colour === 'white' ? 'White' : 'Black'} to play —{' '}
              {brief.yourMoves === 1 ? 'one move' : `${brief.yourMoves} of your moves`}, and{' '}
              {brief.legalMoves} legal moves to choose from.
            </span>
          </div>
        )}
        {phase === 'wrong' && (
          <div>
            <strong>Not that one.</strong>{' '}
            <span className="muted">{whyWrong ?? 'Look again.'}</span>
          </div>
        )}
        {phase === 'solved' && (
          <div>
            <strong>Correct.</strong> <span className="muted">{describeThemes(puzzle.themes)}</span>
          </div>
        )}
        {phase === 'shown' && (
          <div>
            {answerSan ? (
              <>
                <strong>The move was {answerSan}.</strong>{' '}
              </>
            ) : (
              <strong>Solution shown.</strong>
            )}{' '}
            <span className="muted">
              {describeThemes(puzzle.themes)} Logged as missed.
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
