/**
 * The Climb — puzzles as a difficulty progression.
 *
 * WHY THIS EXISTS. Puzzles and Learn had become the same feature. Learn's
 * Tactics module listed eight categories, each with a Train button that called
 * `pickPuzzles` at your rating and dropped you on the Puzzles tab. So "Puzzles"
 * was a themed set, "Learn → Tactics" was a themed set, and the only difference
 * was which screen you started from. Sean put it exactly right: puzzles should
 * be about PROGRESSION OF DIFFICULTY, and learning should be about BREAKDOWNS.
 *
 * So this is the progression half, and it is deliberately not a set at all.
 *
 *   ONE PUZZLE AT A TIME, and the next one depends on the last. Solve it and
 *   the difficulty goes up; miss it and it comes down. A fixed set of eight
 *   cannot do this — by the time it knows you found them easy, it has already
 *   chosen all eight.
 *
 *   THE NUMBER IS THE POINT. A themed set ends with "5 of 8". A climb ends with
 *   "you got to 640", which is a personal best you can beat tomorrow. That is
 *   the whole reason to separate the two modes: one of them has a score and the
 *   other has a lesson, and trying to be both made it neither.
 *
 *   IT ADAPTS FASTER THAN THE RATING. Difficulty moves ±40 a puzzle here while
 *   your actual tactics rating moves by whatever K allows. That is intentional:
 *   the climb is a session-length search for your ceiling TODAY, not a revision
 *   of what you are worth. Your rating still updates underneath, from the same
 *   attempts, at its own pace.
 *
 * Deliberately NOT a streak that ends on one miss. Below 1000 a single miss is
 * usually a slip rather than a wall, and a mode that ejects you for it teaches
 * caution rather than calculation. Three misses ends the run.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { pickPuzzles, type Puzzle } from '../../data/puzzles'
import { db, getProfile } from '../../data/db'
import { getSectionRatings } from '../../coach/rating'
import { PuzzleRunner } from './PuzzleRunner'

/** How far the next puzzle moves after a solve. */
const STEP_UP = 40
/** And after a miss. Smaller, so one slip does not undo four solves. */
const STEP_DOWN = 30
/** Misses that end the run. */
const MAX_MISSES = 3
/** The corpus starts here; asking below it just returns the same easiest rows. */
const CORPUS_FLOOR = 600

interface RunState {
  difficulty: number
  best: number
  solved: number
  missed: number
  streak: number
}

export interface ClimbProps {
  onExit: () => void
}

export function Climb({ onExit }: ClimbProps) {
  const [run, setRun] = useState<RunState | null>(null)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [loading, setLoading] = useState(true)
  const [over, setOver] = useState(false)
  const seen = useRef<Set<string>>(new Set())

  /** Start from the tactics rating rather than the overall one — this is a
   *  tactics exercise and the overall number is dragged around by bot games. */
  const startingPoint = useCallback(async () => {
    const [profile, sections] = await Promise.all([getProfile(), getSectionRatings()])
    const tactics = sections.tactics
    const base = tactics && !tactics.provisional ? tactics.rating : profile.rating
    const attempts = await db.puzzleAttempts.toArray()
    seen.current = new Set(attempts.map((a) => a.puzzleId))
    return Math.round(base)
  }, [])

  const serve = useCallback(async (difficulty: number) => {
    setLoading(true)
    const picked = await pickPuzzles({
      rating: Math.max(CORPUS_FLOOR, difficulty),
      count: 1,
      exclude: seen.current,
      // Tight window: the whole point is that this puzzle is AT the difficulty
      // you have climbed to. A wide spread would hand you a 900 in the middle
      // of a 500 run and read as the mode being broken.
      spread: 60,
    })
    const next = picked[0] ?? null
    if (next) seen.current.add(next.id)
    setPuzzle(next)
    setLoading(false)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const start = await startingPoint()
      if (cancelled) return
      setRun({ difficulty: start, best: start, solved: 0, missed: 0, streak: 0 })
      await serve(start)
    })()
    return () => {
      cancelled = true
    }
  }, [startingPoint, serve])

  const onSolved = useCallback(
    async (correct: boolean) => {
      if (!run) return
      const difficulty = Math.max(
        100,
        run.difficulty + (correct ? STEP_UP : -STEP_DOWN),
      )
      const next: RunState = {
        difficulty,
        best: correct ? Math.max(run.best, difficulty) : run.best,
        solved: run.solved + (correct ? 1 : 0),
        missed: run.missed + (correct ? 0 : 1),
        streak: correct ? run.streak + 1 : 0,
      }
      setRun(next)
      if (next.missed >= MAX_MISSES) {
        setOver(true)
        return
      }
      await serve(difficulty)
    },
    [run, serve],
  )

  const restart = useCallback(async () => {
    setOver(false)
    const start = await startingPoint()
    setRun({ difficulty: start, best: start, solved: 0, missed: 0, streak: 0 })
    await serve(start)
  }, [startingPoint, serve])

  if (!run) return <div className="card">Setting up your climb…</div>

  if (over) {
    return (
      <div className="stack">
        <ClimbBar run={run} />
        <div className="feature">
          <div className="feature-title">You got to {run.best}</div>
          <p className="feature-body">
            {run.solved} solved before three misses. {' '}
            {run.best > run.difficulty + 60
              ? 'That is above where you started — the ceiling is higher than the rating says.'
              : 'Run it again tomorrow and try to beat the number.'}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="chip solid" onClick={() => void restart()}>
              Climb again
            </button>
            <button className="chip" onClick={onExit}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <ClimbBar run={run} />
      {loading || !puzzle ? (
        <div className="card">
          {loading ? 'Finding one at ' + run.difficulty + '…' : 'No puzzles left at this level.'}
        </div>
      ) : (
        <PuzzleRunner
          key={puzzle.id}
          puzzles={[puzzle]}
          tierId={null}
          onDone={({ solved }) => void onSolved(solved > 0)}
        />
      )}
    </div>
  )
}

function ClimbBar({ run }: { run: RunState }) {
  return (
    <div className="climb">
      <div className="climb-main">
        <span className="climb-num">{run.difficulty}</span>
        <span className="climb-cap">difficulty</span>
      </div>
      <div className="climb-stats">
        <span>
          <b>{run.best}</b> best
        </span>
        <span>
          <b>{run.solved}</b> solved
        </span>
        <span className={run.streak >= 3 ? 'hot' : ''}>
          <b>{run.streak}</b> streak
        </span>
        <span className="climb-lives" aria-label={`${MAX_MISSES - run.missed} lives left`}>
          {Array.from({ length: MAX_MISSES }, (_, i) => (
            <i key={i} className={i < MAX_MISSES - run.missed ? 'on' : ''} />
          ))}
        </span>
      </div>
    </div>
  )
}
