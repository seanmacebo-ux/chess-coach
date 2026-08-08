/**
 * A pattern, explained, one move at a time.
 *
 * The learning half of the Puzzles/Learn split. A breakdown does not test you:
 * it shows the position, names the pattern, and steps the line with the reason
 * for each move — then hands you to the Climb to go and find it yourself.
 *
 * Deliberately step-forward-only rather than a free board. The point is the
 * sequence and the reasons attached to it, and a board you can drag pieces on
 * invites you to wander off before you have read why the first move works. The
 * Playground exists for wandering; this is the explanation.
 */

import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import { Board } from './Board'
import { sanArrow } from './arrows'
import type { Breakdown } from '../content/breakdowns'

export interface BreakdownViewProps {
  breakdown: Breakdown
  /** Send them to practise the same pattern. */
  onPractise: () => void
  onBack: () => void
}

export function BreakdownView({ breakdown, onPractise, onBack }: BreakdownViewProps) {
  const [step, setStep] = useState(0)

  const { fen, lastMove } = useMemo(() => {
    const board = new Chess(breakdown.fen)
    let last: [Key, Key] | undefined
    for (let i = 0; i < step; i++) {
      const s = breakdown.steps[i]
      if (!s) break
      try {
        const m = board.move(s.san)
        if (m) last = [m.from as Key, m.to as Key]
      } catch {
        break
      }
    }
    return { fen: board.fen(), lastMove: last }
  }, [breakdown, step])

  const done = step >= breakdown.steps.length
  const current = step > 0 ? breakdown.steps[step - 1] : null
  const next = breakdown.steps[step]

  /*
   * The next move is drawn on the board BEFORE you tap it. The button already
   * said "Play Rh8+"; now the arrow says it in board language, so the step
   * through the sequence is watched on the squares rather than decoded from
   * notation. This is the difference Sean asked for.
   */
  const shapes = useMemo(() => (next ? sanArrow(fen, next.san) : []), [fen, next])

  /*
   * Takes the screen, same as the opening trainer and for the same reason:
   * rendered inline it sat inside the Learn section chrome, with the Tactics
   * rating header above the board and the whole tier ladder below the
   * explanation. During a breakdown both are noise.
   */
  return (
    <div className="trainer-screen">
      <div className="view-head">
        <button className="back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <h2 className="view-title">{breakdown.pattern}</h2>
          <div className="view-sub">
            {/*
              "step 0 of 3" reads like a broken counter, because it is one —
              zero of anything is not a step. Before the first move there is no
              step number to report, so it says what is actually true.
            */}
            {breakdown.side === 'white' ? 'White' : 'Black'} to move ·{' '}
            {step === 0
              ? `${breakdown.steps.length} moves to walk through`
              : `step ${Math.min(step, breakdown.steps.length)} of ${breakdown.steps.length}`}
          </div>
        </div>
      </div>

      <Board
        fen={fen}
        orientation={breakdown.side}
        dests={new Map()}
        turn={null}
        playable={null}
        lastMove={lastMove}
        shapes={shapes}
        onMove={() => {}}
      />

      <div className={'coach' + (done ? ' done' : '')}>
        <div className="coach-role">
          {step === 0 ? 'Before you move' : current ? current.san : 'Done'}
        </div>
        <div className="coach-text">{step === 0 ? breakdown.setup : (current?.why ?? '')}</div>
        {!done && (
          <div className="coach-actions">
            <button className="chip solid" onClick={() => setStep(step + 1)}>
              {step === 0 ? `Play ${next?.san ?? 'the move'} ▸` : `Then ${next?.san ?? ''} ▸`}
            </button>
          </div>
        )}
      </div>

      {done && (
        <div className="feature">
          <div className="feature-title">The takeaway</div>
          <p className="feature-body">{breakdown.takeaway}</p>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {/*
              The handoff. A breakdown teaches the pattern and cannot tell you
              whether you can now FIND it — that is what the Climb is for, and
              keeping the two apart is the whole point of the split.
            */}
            <button className="chip solid" onClick={onPractise}>
              Now find it yourself ▸
            </button>
            <button className="chip" onClick={() => setStep(0)}>
              Again
            </button>
          </div>
        </div>
      )}

      <p className="lede muted">
        Position {breakdown.puzzleId} from the Lichess corpus — engine-checked, so the line above
        is the real one rather than something written from memory.
      </p>
    </div>
  )
}
