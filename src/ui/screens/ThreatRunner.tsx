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
import { Board } from '../Board'
import { db } from '../../data/db'
// Question generation lives in coach/drills.ts so it can be sandboxed from
// Node. This file keeps only rendering and scoring.
import type { ThreatQuestion } from '../../coach/drills'
export { buildThreatQuestions, type ThreatQuestion } from '../../coach/drills'

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
