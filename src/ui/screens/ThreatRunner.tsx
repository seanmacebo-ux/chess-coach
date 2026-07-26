/**
 * Read the threat.
 *
 * The question that separates players who lose to "surprise" tactics from
 * players who don't: if you passed right now, what would they play? Almost
 * everyone below 1600 calculates only their own plans, which is exactly why
 * they keep walking into things that were visible a move earlier.
 *
 * Implemented with a null move — flip the side to move and search. That is the
 * only honest way to ask the question, because searching the real position
 * tells you your OWN best move and nothing about their intention.
 *
 * Two costs handled deliberately:
 *
 *   The engine runs twice per position, so building a set is slow. Candidates
 *   are pre-filtered by whether you actually have a loose piece — a cheap
 *   board-only test that massively raises the hit rate, so the engine is not
 *   burned on quiet positions where there is no threat to find.
 *
 *   Building is visible. A drill that hangs for six seconds with no feedback
 *   reads as broken, so progress is reported while it works.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'

import { Board } from '../Board'
import { buildThreatExercise, loosePieces } from '../../coach/exercises'
import { db } from '../../data/db'
import type { Puzzle } from '../../data/puzzles'

export interface ThreatQuestion {
  id: string
  fen: string
  /** Side the user is playing — the one under threat. */
  colour: 'w' | 'b'
  /** Square the opponent's free move lands on. */
  answer: Square
  /** That move in algebraic, for the explanation. */
  san: string
  /** How much it is worth, in centipawns. */
  swingCp: number
  options: Square[]
}

/** Search depth. Low on purpose — a threat is a one-move idea. */
const DEPTH = 10
/** Only bother with positions where something is actually loose. */
const MIN_LOOSE_VALUE = 300
const OPTION_COUNT = 6

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

/**
 * Build threat questions from candidate positions.
 *
 * `onProgress` fires per position attempted, not per question produced, so the
 * bar moves even when a candidate is rejected.
 */
export async function buildThreatQuestions(
  puzzles: Puzzle[],
  want: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ThreatQuestion[]> {
  const out: ThreatQuestion[] = []

  // Cheap filter first: if nothing of yours is hanging there is usually no
  // threat worth asking about, and finding that out costs two searches.
  const candidates = puzzles.filter((p) => {
    const colour: 'w' | 'b' = p.colour === 'white' ? 'w' : 'b'
    const board = new Chess(p.fen)
    return loosePieces(p.fen, colour).some((sq) => {
      const piece = board.get(sq)
      return piece ? (VALUE[piece.type] ?? 0) >= MIN_LOOSE_VALUE : false
    })
  })

  const budget = Math.min(candidates.length, want * 4)

  for (let i = 0; i < budget && out.length < want; i++) {
    const p = candidates[i]!
    onProgress?.(i + 1, budget)

    let ex
    try {
      ex = await buildThreatExercise(p.fen, { depth: DEPTH, minSwingCp: 150 })
    } catch {
      continue
    }
    if (!ex) continue

    const board = new Chess(p.fen)
    const colour: 'w' | 'b' = p.colour === 'white' ? 'w' : 'b'

    // Decoys are squares their own pieces occupy, so the choice is "where is
    // the danger coming from" rather than "which square looks out of place".
    const theirSquares = new Set<string>()
    for (const row of board.board()) {
      for (const cell of row) {
        if (!cell || cell.color === colour) continue
        theirSquares.add(cell.square)
      }
    }
    theirSquares.delete(ex.answerSquare)

    const decoys = [...theirSquares].slice(0, OPTION_COUNT - 1) as Square[]
    const options = [ex.answerSquare, ...decoys].sort() as Square[]
    if (options.length < 3) continue

    out.push({
      id: p.id,
      fen: ex.fen,
      colour,
      answer: ex.answerSquare,
      san: ex.threatSan,
      swingCp: ex.swingCp,
      options,
    })
  }

  return out
}

export interface ThreatRunnerProps {
  questions: ThreatQuestion[]
  onDone: (result: { correct: number; total: number }) => void
}

export function ThreatRunner({ questions, onDone }: ThreatRunnerProps) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const startedAt = useRef(Date.now())

  const q = questions[index]

  useEffect(() => {
    setPicked(null)
    startedAt.current = Date.now()
  }, [index])

  const wasRight = useMemo(() => (q && picked ? picked === q.answer : false), [q, picked])

  const choose = useCallback(
    async (sq: string) => {
      if (!q || picked) return
      setPicked(sq)
      const right = sq === q.answer
      if (right) setCorrectCount((c) => c + 1)
      await db.puzzleAttempts.add({
        puzzleId: `threat:${q.id}`,
        themes: 'threat-detection',
        rating: 0,
        correct: right,
        ms: Date.now() - startedAt.current,
        tierId: null,
        at: new Date().toISOString(),
        attempts: 1,
        hintUsed: false,
        points: right ? 5 : 0,
      })
    },
    [q, picked],
  )

  const next = useCallback(() => {
    if (index + 1 >= questions.length) {
      onDone({ correct: correctCount, total: questions.length })
    } else {
      setIndex(index + 1)
    }
  }, [index, questions.length, correctCount, onDone])

  if (!q) {
    return (
      <div className="card">
        <strong>No threats found.</strong>{' '}
        <span className="muted">Try again — the positions are drawn at random.</span>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">
          Threat {index + 1} of {questions.length}
        </span>
        <span className="small muted">{correctCount} right</span>
      </div>

      <div className="card cat">
        <span className="cat-name">Read the threat</span>
        <div className="small muted">
          It is your move. If you did nothing at all, what would they play?
        </div>
      </div>

      <Board
        fen={q.fen}
        orientation={q.colour === 'w' ? 'white' : 'black'}
        dests={new Map()}
        turn={q.colour === 'w' ? 'white' : 'black'}
        playable={null}
        check={false}
        onMove={() => undefined}
      />

      <div className="card stack">
        <div className="small muted">Which square is their move landing on? One answer.</div>
        <div className="chips">
          {q.options.map((sq) => {
            const isAnswer = sq === q.answer
            const cls = !picked
              ? 'chip'
              : isAnswer
                ? 'chip right'
                : sq === picked
                  ? 'chip wrong'
                  : 'chip'
            return (
              <button
                key={sq}
                className={cls}
                aria-pressed={picked === sq}
                onClick={() => choose(sq)}
              >
                {sq}
              </button>
            )
          })}
        </div>
      </div>

      <div className={'card verdict ' + (picked ? (wasRight ? 'solved' : 'shown') : '')}>
        {!picked ? (
          <div className="muted small">
            Give them a free move in your head and look for their most annoying one. It is usually
            aimed at something of yours with no defender.
          </div>
        ) : (
          <div>
            <strong>{wasRight ? 'Yes.' : `It was ${q.answer}.`}</strong>{' '}
            <span className="muted">
              They play {q.san}, worth about {Math.max(1, Math.round(q.swingCp / 100))} pawns. That
              is the threat you have to answer before doing anything of your own.
            </span>
          </div>
        )}
      </div>

      {picked && (
        <button className="primary" onClick={next}>
          {index + 1 >= questions.length ? 'Finish' : 'Next position'}
        </button>
      )}
    </div>
  )
}
