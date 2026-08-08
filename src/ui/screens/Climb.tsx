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
 *
 * THE RUN SURVIVES THE APP. This all lived in React state at first, which on a
 * phone meant: lock the screen, switch apps for a minute, come back — the PWA
 * has reloaded and your run is gone, back to square one at your rating. Sean:
 * "persistence in puzzles please". So the run is written to localStorage on
 * every change and picked up exactly where it was on the next open — same
 * difficulty, same solved count, same lives. When a run ends, its personal
 * best and its ending difficulty are kept: the next climb STARTS where the
 * last one ended rather than resetting to your rating, and the best-ever
 * number is the one you are actually trying to beat.
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

/** What outlives the component: the live run, the all-time best, and where
 *  the last run ended (so the next one starts there, not back at the rating). */
interface ClimbStore {
  run: RunState | null
  bestEver: number
  last: number | null
}

const STORE_KEY = 'cc.climb'

function loadStore(): ClimbStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ClimbStore>
      return {
        run: parsed.run && typeof parsed.run.difficulty === 'number' ? parsed.run : null,
        bestEver: typeof parsed.bestEver === 'number' ? parsed.bestEver : 0,
        last: typeof parsed.last === 'number' ? parsed.last : null,
      }
    }
  } catch {
    // Unreadable state is the same as no state.
  }
  return { run: null, bestEver: 0, last: null }
}

function saveStore(store: ClimbStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked — the run still works, it just will not survive.
  }
}

export interface ClimbProps {
  onExit: () => void
}

export function Climb({ onExit }: ClimbProps) {
  const [run, setRun] = useState<RunState | null>(null)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [loading, setLoading] = useState(true)
  const [over, setOver] = useState(false)
  const [bestEver, setBestEver] = useState(0)
  /** True while the game-over card is for a run that just set a new best. */
  const [newBest, setNewBest] = useState(false)
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
      // startingPoint always runs — it also loads the seen-set — but the
      // rating it returns only matters for a genuinely first-ever climb.
      const ratingBase = await startingPoint()
      if (cancelled) return
      const store = loadStore()
      setBestEver(store.bestEver)
      if (store.run && store.run.missed < MAX_MISSES) {
        // A run was in flight when the app closed. Pick it up exactly.
        setRun(store.run)
        await serve(store.run.difficulty)
        return
      }
      const start = store.last ?? ratingBase
      setRun({ difficulty: start, best: start, solved: 0, missed: 0, streak: 0 })
      await serve(start)
    })()
    return () => {
      cancelled = true
    }
  }, [startingPoint, serve])

  /** Every change to the live run goes straight to storage. */
  useEffect(() => {
    if (!run || over) return
    const store = loadStore()
    saveStore({ ...store, run })
  }, [run, over])

  const endRun = useCallback(
    (finished: RunState) => {
      const store = loadStore()
      const best = Math.max(store.bestEver, finished.best)
      setNewBest(finished.best > store.bestEver && store.bestEver > 0)
      setBestEver(best)
      saveStore({ run: null, bestEver: best, last: finished.difficulty })
      setOver(true)
    },
    [],
  )

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
        endRun(next)
        return
      }
      await serve(difficulty)
    },
    [run, serve, endRun],
  )

  const restart = useCallback(async () => {
    setOver(false)
    setNewBest(false)
    // Not startingPoint(): the whole point of persistence is that the next
    // climb begins where the last one ended, not back at the rating.
    const store = loadStore()
    const start = store.last ?? (await startingPoint())
    setRun({ difficulty: start, best: start, solved: 0, missed: 0, streak: 0 })
    await serve(start)
  }, [startingPoint, serve])

  if (!run) return <div className="card">Setting up your climb…</div>

  if (over) {
    return (
      <div className="stack">
        <ClimbBar run={run} bestEver={bestEver} />
        <div className="feature">
          <div className="feature-title">
            {newBest ? `New personal best — ${run.best}` : `You got to ${run.best}`}
          </div>
          <p className="feature-body">
            {run.solved} solved before three misses.{' '}
            {newBest
              ? 'That is the highest you have ever climbed. It is saved — next time the number to beat is yours.'
              : bestEver > run.best
                ? `Your best is still ${bestEver}. The next climb starts from ${run.difficulty}, right where this one ended.`
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
      <ClimbBar run={run} bestEver={bestEver} />
      {loading || !puzzle ? (
        <div className="card">
          {loading ? 'Finding one at ' + run.difficulty + '…' : 'No puzzles left at this level.'}
        </div>
      ) : (
        <PuzzleRunner
          key={puzzle.id}
          puzzles={[puzzle]}
          tierId={null}
          compact
          onDone={({ solved }) => void onSolved(solved > 0)}
        />
      )}
    </div>
  )
}

function ClimbBar({ run, bestEver }: { run: RunState; bestEver: number }) {
  return (
    <div className="climb">
      <div className="climb-main">
        <span className="climb-num">{run.difficulty}</span>
        <span className="climb-cap">difficulty</span>
      </div>
      {/*
        Sean's screenshot: difficulty 409, puzzle "rated 655" — an unexplained
        mismatch that reads as a bug. It is the corpus floor: the easiest
        puzzles that exist are ~600, so below that the number you are climbing
        and the number on the puzzle differ. Say so, exactly when it happens.
      */}
      {run.difficulty < CORPUS_FLOOR && (
        <span className="small muted climb-floor">
          The easiest puzzles are rated ~{CORPUS_FLOOR}, so they sit above your difficulty for
          now — solving pulls your number up to meet them.
        </span>
      )}
      <div className="climb-stats">
        <span>
          <b>{run.best}</b> best
        </span>
        {/* All-time, across every run — the number persistence exists for.
            Hidden until there has been at least one finished run. */}
        {bestEver > 0 && (
          <span>
            <b>{bestEver}</b> record
          </span>
        )}
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
