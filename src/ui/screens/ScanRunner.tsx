/**
 * Spot the loose piece.
 *
 * The single highest-value drill below 1600, and the one the app has been
 * promising since the Learn screen was built. Forks, pins and skewers all work
 * because something was undefended first — so this trains the cause rather
 * than the symptom, and it is the exact question the blunder check asks during
 * a real game.
 *
 * Answered with BUTTONS, not by tapping the board. Two reasons, and the second
 * is the real one:
 *
 *   A list of candidate squares makes the task "which of these is loose",
 *   which is a scan. Tapping a board makes it "find something", which is a
 *   search — a different and much slower skill, and not the one that saves you
 *   in a real game where you have thirty seconds.
 *
 *   It also means the drill is drivable and verifiable without depending on
 *   chessground's pointer handling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '../Board'
import { db } from '../../data/db'
// Question generation lives in coach/drills.ts so it can be sandboxed from
// Node. This file keeps only rendering and scoring.
import type { ScanQuestion } from '../../coach/drills'
export { buildScanQuestions, type ScanQuestion } from '../../coach/drills'

export interface ScanRunnerProps {
  questions: ScanQuestion[]
  onDone: (result: { correct: number; total: number }) => void
}

export function ScanRunner({ questions, onDone }: ScanRunnerProps) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const startedAt = useRef(Date.now())

  const q = questions[index]

  useEffect(() => {
    setPicked(new Set())
    setChecked(false)
    startedAt.current = Date.now()
  }, [index])

  const toggle = useCallback(
    (sq: string) => {
      if (checked) return
      setPicked((prev) => {
        const next = new Set(prev)
        if (next.has(sq)) next.delete(sq)
        else next.add(sq)
        return next
      })
    },
    [checked],
  )

  const wasRight = useMemo(() => {
    if (!q) return false
    if (picked.size !== q.answers.length) return false
    return q.answers.every((a) => picked.has(a))
  }, [q, picked])

  const check = useCallback(async () => {
    if (!q) return
    setChecked(true)
    if (wasRight) setCorrectCount((c) => c + 1)
    await db.puzzleAttempts.add({
      // Namespaced so scans never collide with Lichess puzzle ids.
      puzzleId: `scan:${q.id}`,
      themes: 'hangingPiece',
      rating: 0,
      correct: wasRight,
      ms: Date.now() - startedAt.current,
      tierId: null,
      at: new Date().toISOString(),
      attempts: 1,
      hintUsed: false,
      points: wasRight ? 5 : 0,
    })
  }, [q, wasRight])

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
        <strong>No positions available.</strong>{' '}
        <span className="muted">Try again once more puzzles have loaded.</span>
      </div>
    )
  }

  const you = q.colour === 'w' ? 'White' : 'Black'

  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">
          Scan {index + 1} of {questions.length}
        </span>
        <span className="small muted">{correctCount} right</span>
      </div>

      <div className="card cat">
        <span className="cat-name">Spot the loose piece</span>
        <div className="small muted">
          You are {you}. Which of your pieces are attacked and defended by nothing?
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
        <div className="small muted">
          Tap every square holding a piece that is attacked and undefended. There may be more than
          one.
        </div>
        <div className="chips">
          {q.options.map((sq) => {
            const isAnswer = q.answers.includes(sq)
            const isPicked = picked.has(sq)
            const cls = !checked
              ? 'chip'
              : isAnswer
                ? 'chip right'
                : isPicked
                  ? 'chip wrong'
                  : 'chip'
            return (
              <button key={sq} className={cls} aria-pressed={isPicked} onClick={() => toggle(sq)}>
                {sq}
              </button>
            )
          })}
        </div>
      </div>

      <div className={'card verdict ' + (checked ? (wasRight ? 'solved' : 'shown') : '')}>
        {!checked ? (
          <div className="muted small">
            Attacked is not the same as loose — a piece with a defender is usually fine. Count the
            defenders before you answer.
          </div>
        ) : wasRight ? (
          <div>
            <strong>Right.</strong>{' '}
            <span className="muted">
              {q.answers.length === 1
                ? `${q.answers[0]} was the only one hanging.`
                : `${q.answers.join(' and ')} were both hanging.`}
            </span>
          </div>
        ) : (
          <div>
            <strong>Not quite.</strong>{' '}
            <span className="muted">
              The loose {q.answers.length === 1 ? 'one was' : 'ones were'} {q.answers.join(', ')}.
              Everything else you could pick had a defender.
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
            Check
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
