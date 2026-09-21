/**
 * Your own mistakes, served back as the drill.
 *
 * Sean, on the tactics prescription: "I am missing tactics but never really
 * able to mimic those things for me to work on — it's always just connected
 * to weird puzzles." He is describing a real gap. The app diagnoses from HIS
 * games ("missed a tactic, N times") and then prescribes OTHER PEOPLE'S
 * positions — Lichess puzzles that share a motif tag but nothing else. The
 * connection between "you got this wrong on Tuesday" and "solve this
 * stranger's position" is a database join, and it feels like one.
 *
 * This screen closes the loop with the most direct trainer possible: the
 * exact positions from your own games where a better move existed, replayed
 * until you find it. Every mistake the review engine logs carries the
 * position (fen) and the better move (bestSan) — everything a one-move
 * puzzle needs was already in the mistakes table, unserved.
 *
 * Mechanics reused, not reinvented: this is the same PuzzleRunner the tiers
 * use, so three tries, the nudge, the engine adjudicating alternatives ("your
 * move works too") all apply. Your redo attempts land in puzzleAttempts like
 * any other puzzle, and a failed redo is filtered from future sets by fen
 * dedup rather than multiplying.
 */

import { useEffect, useState } from 'react'
import { buildRedoSet } from '../../coach/redo'
import type { Puzzle } from '../../data/puzzles'
import { PuzzleRunner } from './PuzzleRunner'

/** Enough for a session, few enough that each gets real attention. */
const SET_SIZE = 8

export interface FixMistakesProps {
  onExit: () => void
}

export function FixMistakes({ onExit }: FixMistakesProps) {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ solved: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Without the catch a rejected load left `puzzles` null forever, which on
    // screen is an indistinguishable and permanent loading state.
    void buildRedoSet(SET_SIZE)
      .then((p) => {
        if (!cancelled) setPuzzles(p)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="stack">
      <div className="secbar">
        <button className="ghost back" onClick={onExit}>
          ← Learn
        </button>
        <span className="small muted">Fix your own games</span>
      </div>

      {error ? (
        <div className="feature">
          <div className="feature-title">Could not build the drill</div>
          <p className="feature-body">
            {error}. This reads your reviewed games out of local storage — if that is blocked
            or full, Settings has a backup and a reset.
          </p>
        </div>
      ) : puzzles === null ? (
        <div className="card small muted">Pulling the positions from your games…</div>
      ) : puzzles.length === 0 ? (
        <div className="feature">
          <div className="feature-title">Nothing to fix yet</div>
          <p className="feature-body">
            This drill is built from your own reviewed games — every position where a better move
            existed comes here. Play a game, or open one in History and let the review run, and
            this fills up on its own.
          </p>
        </div>
      ) : result ? (
        <div className="feature">
          <div className="feature-title">
            {result.solved} of {result.total} of your own positions, fixed
          </div>
          <p className="feature-body">
            {result.solved === result.total
              ? 'Every one of these beat you once. Not today.'
              : 'The ones you missed stay in the pool — they will come back until they stop beating you.'}
          </p>
          <button className="primary" onClick={onExit}>
            Back to Learn
          </button>
        </div>
      ) : (
        <>
          <p className="lede">
            These {puzzles.length} positions are from <b>your games</b> — each one is a moment a
            better move existed and you played something else. Find it this time. The engine
            accepts any move as good as the one you missed.
          </p>
          <PuzzleRunner
            puzzles={puzzles}
            onDone={({ solved, total }) => setResult({ solved, total })}
          />
        </>
      )}
    </div>
  )
}
