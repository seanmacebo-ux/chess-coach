/**
 * Candidate moves (Kotov).
 *
 * Every other drill in the app asks "what is THE move". This one asks what you
 * would even look at — and that is a different, earlier, and more commonly
 * missing skill. Kotov's whole point is that players below master strength
 * fail by calculating one line very deeply instead of noticing three lines at
 * all. You cannot find the right move if it was never on your list.
 *
 * So: pick the moves you would CONSIDER, before evaluating any of them. Scored
 * on how many of the engine's top three you had on your list, not on whether
 * you picked the single best one. Picking the best move and nothing else is a
 * partial success here, which is the correct incentive — it means you found
 * one idea and stopped looking.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '../Board'
import { db } from '../../data/db'
// Question generation lives in coach/drills.ts so it can be sandboxed from
// Node. This file keeps only rendering and scoring.
import { CANDIDATE_PICK_LIMIT, CANDIDATE_TOP_N, type CandidateQuestion } from '../../coach/drills'
export { buildCandidateQuestions, type CandidateQuestion } from '../../coach/drills'

/**
 * Show a score the way a human reads one.
 *
 * lineScore maps mates onto plus/minus 100,000 so they sort correctly, which
 * is right for ranking and useless for display — a forced mate was rendering
 * as "+996.0", which looks like a bug because it is one.
 */
const MATE_THRESHOLD = 90_000

function formatScore(cp: number): string {
  if (cp >= MATE_THRESHOLD) return 'mate'
  if (cp <= -MATE_THRESHOLD) return 'mated'
  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`
}

const TOP_N = CANDIDATE_TOP_N
const PICK_LIMIT = CANDIDATE_PICK_LIMIT

export interface CandidateRunnerProps {
  questions: CandidateQuestion[]
  onDone: (result: { found: number; possible: number }) => void
}

export function CandidateRunner({ questions, onDone }: CandidateRunnerProps) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState(false)
  const [found, setFound] = useState(0)
  const startedAt = useRef(Date.now())

  const q = questions[index]

  useEffect(() => {
    setPicked(new Set())
    setChecked(false)
    startedAt.current = Date.now()
  }, [index])

  const toggle = useCallback(
    (uci: string) => {
      if (checked) return
      setPicked((prev) => {
        const next = new Set(prev)
        if (next.has(uci)) next.delete(uci)
        else if (next.size < PICK_LIMIT) next.add(uci)
        return next
      })
    },
    [checked],
  )

  const hits = useMemo(() => {
    if (!q) return 0
    return q.options.filter((o) => o.good && picked.has(o.uci)).length
  }, [q, picked])

  const check = useCallback(async () => {
    if (!q) return
    setChecked(true)
    setFound((f) => f + hits)
    await db.puzzleAttempts.add({
      puzzleId: `cand:${q.id}`,
      themes: 'candidate-moves',
      rating: 0,
      // "Correct" here means at least two of the three were on your list —
      // one is finding an idea, two is actually looking around.
      correct: hits >= 2,
      ms: Date.now() - startedAt.current,
      tierId: null,
      at: new Date().toISOString(),
      attempts: 1,
      hintUsed: false,
      points: hits * 3,
    })
  }, [q, hits])

  const next = useCallback(() => {
    if (index + 1 >= questions.length) {
      onDone({ found, possible: questions.length * TOP_N })
    } else {
      setIndex(index + 1)
    }
  }, [index, questions.length, found, onDone])

  if (!q) {
    return (
      <div className="card">
        <strong>No positions available.</strong>{' '}
        <span className="muted">Try again in a moment.</span>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">
          Position {index + 1} of {questions.length}
        </span>
        <span className="small muted">{found} candidates found</span>
      </div>

      <div className="card cat">
        <span className="cat-name">Candidate moves</span>
        <div className="small muted">
          Which moves would you even look at? Pick up to {PICK_LIMIT} — before calculating any of
          them.
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
        <span className="small muted">
          {checked
            ? "The engine's three best are marked"
            : `${picked.size} of ${PICK_LIMIT} chosen`}
        </span>
        <div className="chips">
          {q.options.map((o) => {
            const isPicked = picked.has(o.uci)
            const cls = !checked
              ? 'chip'
              : o.good
                ? 'chip right'
                : isPicked
                  ? 'chip wrong'
                  : 'chip'
            return (
              <button
                key={o.uci}
                className={cls}
                aria-pressed={isPicked}
                onClick={() => toggle(o.uci)}
              >
                {o.san}
                {checked && o.cp !== null && (
                  <span className="small" style={{ opacity: 0.75 }}>
                    {' '}
                    {formatScore(o.cp)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className={'card verdict ' + (checked ? (hits >= 2 ? 'solved' : 'shown') : '')}>
        {!checked ? (
          <div className="muted small">
            You are not being asked for the best move. You are being asked what deserves a look —
            the mistake that costs most games is calculating one idea deeply and never noticing
            the second.
          </div>
        ) : (
          <div>
            <strong>
              {hits} of {TOP_N}.
            </strong>{' '}
            <span className="muted">
              {hits === TOP_N
                ? 'You saw all three. That is the habit.'
                : hits === 0
                  ? `None of your picks were in the top three. They were ${q.best.join(', ')}.`
                  : `The three worth looking at were ${q.best.join(', ')}.`}
            </span>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        {!checked ? (
          <button
            className="primary"
            style={{ flex: 1 }}
            disabled={picked.size === 0}
            onClick={check}
          >
            Check my list
          </button>
        ) : (
          <button className="primary" style={{ flex: 1 }} onClick={next}>
            {index + 1 >= questions.length ? 'Finish' : 'Next position'}
          </button>
        )}
      </div>
    </div>
  )
}
