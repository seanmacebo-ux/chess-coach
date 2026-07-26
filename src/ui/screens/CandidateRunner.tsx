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
import { Chess } from 'chess.js'

import { Board } from '../Board'
import { getEngine } from '../../engine/uci'
import { lineScore } from '../../engine/types'
import { db } from '../../data/db'
import type { Puzzle } from '../../data/puzzles'

/** How many of the engine's moves count as "the good ones". */
const TOP_N = 3
/** How many options you choose from. */
const OPTION_COUNT = 8
/** How many you are allowed to pick. */
const PICK_LIMIT = 3
const DEPTH = 12

export interface CandidateOption {
  uci: string
  san: string
  /** Score from the mover's point of view, if the engine ranked it. */
  cp: number | null
  good: boolean
}

export interface CandidateQuestion {
  id: string
  fen: string
  colour: 'w' | 'b'
  options: CandidateOption[]
  /** The engine's ranked best, in SAN. */
  best: string[]
}

/**
 * Show a score the way a human reads one.
 *
 * `lineScore` maps mates onto ±100,000 so they sort correctly, which is right
 * for ranking and useless for display — a forced mate was rendering as
 * "+996.0", which looks like a bug because it is one. Anything past the mate
 * threshold is a mate, not a number of pawns.
 */
const MATE_THRESHOLD = 90_000

function formatScore(cp: number): string {
  if (cp >= MATE_THRESHOLD) return 'mate'
  if (cp <= -MATE_THRESHOLD) return 'mated'
  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`
}

function toSan(fen: string, uci: string): string | null {
  const board = new Chess(fen)
  try {
    return (
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })?.san ?? null
    )
  } catch {
    return null
  }
}

/**
 * Build candidate questions.
 *
 * Decoys are real legal moves, not nonsense — the discrimination being trained
 * is "plausible and worth a look" versus "plausible and pointless", and a list
 * padded with obviously silly moves would train nothing.
 */
export async function buildCandidateQuestions(
  puzzles: Puzzle[],
  want: number,
  onProgress?: (done: number, total: number) => void,
): Promise<CandidateQuestion[]> {
  const out: CandidateQuestion[] = []
  const budget = Math.min(puzzles.length, want * 3)

  for (let i = 0; i < budget && out.length < want; i++) {
    const p = puzzles[i]!
    onProgress?.(i + 1, budget)

    const board = new Chess(p.fen)
    const legal = board.moves({ verbose: true })
    // Too few legal moves and "which would you consider" is not a question.
    if (legal.length < OPTION_COUNT + 1) continue

    let analysis
    try {
      analysis = await getEngine().analyse(p.fen, { depth: DEPTH, multipv: TOP_N })
    } catch {
      continue
    }
    if (analysis.lines.length < TOP_N) continue

    const ranked = analysis.lines
      .map((l) => ({ uci: l.pv[0] ?? '', cp: lineScore(l) }))
      .filter((r) => r.uci !== '')
    if (ranked.length < TOP_N) continue

    const goodUcis = new Set(ranked.slice(0, TOP_N).map((r) => r.uci))

    const decoys = legal
      .map((m) => `${m.from}${m.to}${m.promotion ?? ''}`)
      .filter((u) => !goodUcis.has(u))
      .slice(0, OPTION_COUNT - TOP_N)

    const options: CandidateOption[] = []
    for (const r of ranked.slice(0, TOP_N)) {
      const san = toSan(p.fen, r.uci)
      if (san) options.push({ uci: r.uci, san, cp: r.cp, good: true })
    }
    for (const u of decoys) {
      const san = toSan(p.fen, u)
      if (san) options.push({ uci: u, san, cp: null, good: false })
    }
    if (options.filter((o) => o.good).length < TOP_N) continue

    // Sort alphabetically so the good ones are not clustered at the front.
    options.sort((a, b) => a.san.localeCompare(b.san))

    out.push({
      id: p.id,
      fen: p.fen,
      colour: p.colour === 'white' ? 'w' : 'b',
      options,
      best: ranked.slice(0, TOP_N).map((r) => toSan(p.fen, r.uci) ?? r.uci),
    })
  }

  return out
}

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
