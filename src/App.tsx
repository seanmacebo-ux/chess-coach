/**
 * App shell.
 *
 * Two surfaces: the Daily screen (the front door) and Play. Everything else
 * is reached from a session rather than browsed to.
 *
 * The important wiring here is what happens when a game ENDS: it gets saved,
 * analysed, and its mistakes written to the log. Without that step the
 * weakness profile stays empty forever and the whole adaptive layer is
 * decoration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

import { Board } from './ui/Board'
import { Daily } from './ui/screens/Daily'
import { PuzzleRunner } from './ui/screens/PuzzleRunner'
import { History } from './ui/screens/History'
import { Learn } from './ui/screens/Learn'
import { PlayoutRunner } from './ui/screens/PlayoutRunner'
import { type EndgamePosition } from './coach/endgames'
import {
  getSectionRatings,
  overallVerdict,
  SECTION_IDS,
  SECTION_NAME,
  type SectionId,
  type SectionRating,
} from './coach/rating'
import { RatingChip, RatingExplainer } from './ui/learn/RatingChip'
import { ScanRunner, buildScanQuestions, type ScanQuestion } from './ui/screens/ScanRunner'
import { ThreatRunner, buildThreatQuestions, type ThreatQuestion } from './ui/screens/ThreatRunner'
import {
  CandidateRunner,
  buildCandidateQuestions,
  type CandidateQuestion,
} from './ui/screens/CandidateRunner'
import { Settings, type ColourMode } from './ui/screens/Settings'
import { syncInBackground } from './data/sync'
import { markSessionComplete } from './coach/profile'
import type { DailySession } from './coach/session'
import { applyUci, colourOf, statusOf, toDests } from './chess/game'
import { createOpponent, type Opponent } from './engine/opponent'
import { STYLES, type Style } from './engine/types'
import { analyseGame, acpl, performanceRating, type MoveAssessment } from './coach/analysis'
import { GameReview } from './ui/screens/GameReview'
import { Climb } from './ui/screens/Climb'
import { BOTS, suggestedBot, type Bot } from './engine/roster'
import { updateRatingFromGame } from './coach/profile'
import { db, getProfile } from './data/db'
import { pickPuzzles, type Puzzle } from './data/puzzles'
import { loadPrefs } from './data/settings'
import { loosePieces } from './coach/exercises'
import { applyTheme, loadTheme, resolveTheme, saveTheme, type ThemeChoice } from './theme/theme'

type Tab =
  | 'daily'
  | 'play'
  | 'puzzles'
  | 'scan'
  | 'threat'
  | 'candidates'
  | 'endgames'
  | 'history'
  | 'learn'
  | 'settings'

const COLOUR_KEY = 'cc.colour'

function loadColourMode(): ColourMode {
  const v = localStorage.getItem(COLOUR_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}
type EngineState = 'boot' | 'ready' | 'thinking' | 'error'
type ReviewState = { phase: 'idle' } | { phase: 'running'; done: number; total: number } | {
  phase: 'done'
  acpl: number
  perf: number
  blunders: number
  /**
   * Every move you played, with what the engine wanted instead.
   *
   * This used to be dropped on the floor. `analyseGame` already returned the
   * played move, the better move, what it cost and why for every ply — all of
   * it was written to IndexedDB for the weakness profile and NONE of it was
   * ever shown back, so the entire post-game review was "you averaged 87
   * centipawns and logged 3 blunders". A number and a count is a score, not
   * coaching: it tells you that you were bad without telling you where, and
   * there is nothing you can do differently next game as a result.
   */
  moves: MoveAssessment[]
}

export default function App() {
  const [tab, setTab] = useState<Tab>('daily')
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme())

  const [colourMode, setColourMode] = useState<ColourMode>(() => loadColourMode())

  useEffect(() => {
    const { board, pieces, background } = resolveTheme(theme)
    applyTheme(board, pieces, background)
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    // 'system' removes the attribute entirely so the prefers-color-scheme
    // media query takes over; anything else is an explicit override.
    const root = document.documentElement
    if (colourMode === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', colourMode)
    localStorage.setItem(COLOUR_KEY, colourMode)
  }, [colourMode])

  // Sync when the app regains focus — covers "played on my phone, opened the
  // work machine" without polling.
  useEffect(() => {
    const onFocus = () => syncInBackground()
    window.addEventListener('focus', onFocus)
    syncInBackground()
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const [seed, setSeed] = useState<{ elo: number; style: Style; colour: 'white' | 'black' }>({
    elo: 1400,
    style: 'human',
    colour: 'white',
  })
  const [session, setSession] = useState<DailySession | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [endgame, setEndgame] = useState<EndgamePosition | null>(null)
  /**
   * A puzzle set built on demand from Learn, rather than from today's session.
   * Kept separate so training a category never overwrites the daily session —
   * you can drill forks for ten minutes and still have Today waiting.
   */
  const [drill, setDrill] = useState<{ puzzles: Puzzle[]; label: string } | null>(null)
  const [scan, setScan] = useState<ScanQuestion[] | null>(null)
  const [threat, setThreat] = useState<ThreatQuestion[] | null>(null)
  const [candidates, setCandidates] = useState<CandidateQuestion[] | null>(null)
  /** Engine-backed drills take seconds to build, so the wait is shown. */
  const [building, setBuilding] = useState<{ done: number; total: number } | null>(null)

  const trainCategory = useCallback(async (motifs: string[], label: string) => {
    const profile = await getProfile()
    const seen = new Set((await db.puzzleAttempts.toArray()).map((r) => r.puzzleId))
    const puzzles = await pickPuzzles({
      rating: profile.rating,
      themes: motifs,
      count: loadPrefs().puzzlesPerDay,
      exclude: seen,
    })
    if (puzzles.length === 0) {
      setResult(`No ${label.toLowerCase()} puzzles left at your level — try another category.`)
      return
    }
    setDrill({ puzzles, label })
    setTab('puzzles')
  }, [])

  const playEndgame = useCallback((p: EndgamePosition) => {
    setEndgame(p)
    setTab('endgames')
  }, [])

  /**
   * Build a loose-piece scan from real positions.
   *
   * Draws on the puzzle corpus purely as a supply of realistic middlegames —
   * the tactic in each puzzle is irrelevant. Asks for a wide pool because most
   * positions get rejected: anything with nothing loose, or more than three
   * loose pieces, is not a scan worth setting.
   */
  const startScan = useCallback(async () => {
    const profile = await getProfile()
    const pool = await pickPuzzles({ rating: profile.rating, count: 120 })
    const questions = buildScanQuestions(pool, Math.min(8, loadPrefs().puzzlesPerDay))
    if (questions.length === 0) {
      setResult('Could not find positions with a loose piece. Try again in a moment.')
      return
    }
    setScan(questions)
    setTab('scan')
  }, [])

  const startThreat = useCallback(async () => {
    const profile = await getProfile()
    const pool = await pickPuzzles({ rating: profile.rating, count: 160 })
    setBuilding({ done: 0, total: 1 })
    setTab('threat')
    const questions = await buildThreatQuestions(pool, 5, (done, total) =>
      setBuilding({ done, total }),
    )
    setBuilding(null)
    if (questions.length === 0) {
      setResult('Could not find a clear threat in those positions. Try again.')
      setTab('learn')
      return
    }
    setThreat(questions)
  }, [])

  const startCandidates = useCallback(async () => {
    const profile = await getProfile()
    const pool = await pickPuzzles({ rating: profile.rating, count: 40 })
    setBuilding({ done: 0, total: 1 })
    setTab('candidates')
    const questions = await buildCandidateQuestions(pool, 5, (done, total) =>
      setBuilding({ done, total }),
    )
    setBuilding(null)
    if (questions.length === 0) {
      setResult('Could not build a candidate set. Try again.')
      setTab('learn')
      return
    }
    setCandidates(questions)
  }, [])

  const startFromDaily = useCallback((elo: number, style: Style, colour: 'white' | 'black') => {
    setSeed({ elo, style, colour })
    setTab('play')
  }, [])

  const startPuzzles = useCallback((s: DailySession) => {
    setSession(s)
    setTab('puzzles')
  }, [])

  return (
    /*
      Learn runs wide. Everywhere else the 560px column is right — it is a
      phone-shaped app around a square board, and stretching a board screen to
      1100px just puts the pieces further from your eyes. But Learn is a
      browsing surface on a desk monitor with a two-column list-and-detail
      layout in it, and squeezing that into 560px is exactly why the openings
      board was unreadable.
    */
    <div className={'app' + (tab === 'learn' ? ' wide' : '')}>
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            ♞
          </span>
          <span className="word">
            Chess <b>Coach</b>
          </span>
        </div>
        {/*
          The board picker used to live here. With 18 materials it wrapped onto
          three rows and shoved the brand around on every screen — and it was a
          settings control sitting permanently on top of the board you are
          trying to play on. Settings owns theming now, and it does it better
          because it can show a live preview next to the choice.
        */}
      </header>

      {tab === 'daily' && <Daily onStartGame={startFromDaily} onStartPuzzles={startPuzzles} />}

      {tab === 'play' && (
        <Play initialElo={seed.elo} initialStyle={seed.style} initialColour={seed.colour} />
      )}

      {/*
        The Puzzles tab IS the climb now.
        It used to be a themed set, which made it indistinguishable from
        Learn -> Tactics -> Train — same picker, same runner, different door.
        A set cannot adapt: by the time it knows you found them easy it has
        already chosen all eight. The climb serves one at a time and lets the
        last answer choose the next. Explicit hand-offs — the daily session,
        or a category picked in Learn — still run as sets, because those are
        deliberate selections rather than a search for your ceiling.
      */}
      {tab === 'puzzles' &&
        (drill ? (
          <PuzzleRunner
            key={`drill-${drill.label}-${drill.puzzles[0]!.id}`}
            puzzles={drill.puzzles}
            tierId={null}
            onDone={({ solved, total, points }) => {
              setResult(`${drill.label}: ${solved} of ${total} — ${points} points.`)
              setDrill(null)
              setTab('learn')
            }}
          />
        ) : session && session.puzzles.length > 0 ? (
          <PuzzleRunner
            // Remount on a new session so internal progress resets cleanly.
            key={session.date + session.puzzles[0]!.id}
            puzzles={session.puzzles}
            tierId={session.drill?.id ?? null}
            onDone={({ solved, total, points }) => {
              void markSessionComplete()
              setResult(`${solved} of ${total} solved — ${points} points.`)
              setTab('daily')
            }}
          />
        ) : (
          <Climb onExit={() => setTab('learn')} />
        ))}

      {tab === 'scan' &&
        (scan ? (
          <ScanRunner
            key={`scan-${scan[0]?.id ?? 'none'}`}
            questions={scan}
            onDone={({ correct, total }) => {
              setResult(`Loose pieces: ${correct} of ${total} right.`)
              setScan(null)
              setTab('learn')
            }}
          />
        ) : (
          <div className="card">
            <strong>No scan loaded.</strong>{' '}
            <span className="muted">Start one from the Position module in Learn.</span>
          </div>
        ))}

      {tab === 'candidates' &&
        (building ? (
          <div className="card stack">
            <div className="status">
              <span className="dot thinking" />
              <span className="small muted">
                ranking the options… {building.done}/{building.total}
              </span>
            </div>
            <div className="small muted">
              Each position is searched three-deep so the drill knows which moves genuinely
              deserved a look, rather than just which one wins.
            </div>
          </div>
        ) : candidates ? (
          <CandidateRunner
            key={`cand-${candidates[0]?.id ?? 'none'}`}
            questions={candidates}
            onDone={({ found, possible }) => {
              setResult(`Candidates: you saw ${found} of ${possible}.`)
              setCandidates(null)
              setTab('learn')
            }}
          />
        ) : (
          <div className="card">
            <strong>No candidate set loaded.</strong>{' '}
            <span className="muted">Start one from the Tactics module in Learn.</span>
          </div>
        ))}

      {tab === 'threat' &&
        (building ? (
          <div className="card stack">
            <div className="status">
              <span className="dot thinking" />
              <span className="small muted">
                finding real threats… {building.done}/{building.total}
              </span>
            </div>
            <div className="small muted">
              Each position is searched twice — once as it stands, once giving your opponent a
              free move. That difference is the threat, and there is no shortcut to it.
            </div>
          </div>
        ) : threat ? (
          <ThreatRunner
            key={`threat-${threat[0]?.id ?? 'none'}`}
            questions={threat}
            onDone={({ correct, total }) => {
              setResult(`Threats: ${correct} of ${total} spotted.`)
              setThreat(null)
              setTab('learn')
            }}
          />
        ) : (
          <div className="card">
            <strong>No threat set loaded.</strong>{' '}
            <span className="muted">Start one from the Strategy module in Learn.</span>
          </div>
        ))}

      {/*
        No longer a browsable tab — a destination you are sent to by Learn.
        The "Endings" tab used to render the whole ENDGAMES array a third time,
        alongside the two copies inside Learn: same data, same Play button,
        three surfaces. Learn is the single home for endgames now.

        The ROUTE survives because the play-out runner has to live somewhere,
        and returning to Learn on finish is the point — going "back" to a tab
        that is no longer in the nav would be a dead end.
      */}
      {tab === 'endgames' &&
        (endgame ? (
          <PlayoutRunner
            key={endgame.id}
            position={endgame}
            onDone={({ success }) => {
              setResult(
                success
                  ? `${endgame.name} — ${endgame.goal === 'win' ? 'converted' : 'held'}.`
                  : `${endgame.name} — not this time.`,
              )
              setEndgame(null)
              setTab('learn')
            }}
          />
        ) : (
          // Only reachable by leaving the tab mid-playout and coming back.
          <div className="card row spread">
            <span className="muted">No endgame loaded.</span>
            <button className="primary" onClick={() => setTab('learn')}>
              Pick one in Learn
            </button>
          </div>
        ))}

      {/* key forces a fresh read of the database each time the tab is opened */}
      {tab === 'history' && <History key={`h-${result ?? ''}-${tab}`} />}

      {tab === 'learn' && (
        <Learn
          key={`l-${tab}`}
          onTrainCategory={trainCategory}
          onPlayEndgame={playEndgame}
          onStartScan={startScan}
          onStartThreat={startThreat}
          onStartCandidates={startCandidates}
        />
      )}

      {tab === 'settings' && (
        <Settings
          theme={theme}
          onTheme={setTheme}
          colourMode={colourMode}
          onColourMode={setColourMode}
        />
      )}

      {result && (
        <div className="card row spread" style={{ borderColor: 'var(--accent)' }}>
          <span>{result}</span>
          <button className="ghost" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      <nav className="tabs">
        {(
          [
            ['daily', '◎', 'Today'],
            ['play', '♟', 'Play'],
            // Puzzles had no front door at all — it was reachable only by
            // being handed there from Today or Learn, which is most of why it
            // read as an extension of Learn rather than its own thing. The
            // climb needs somewhere to live.
            ['puzzles', '⚡', 'Puzzles'],
            ['learn', '❖', 'Learn'],
            ['history', '◔', 'History'],
            ['settings', '⚙', 'Settings'],
          ] as [Tab, string, string][]
        ).map(([id, icon, label]) => (
          <button
            key={id}
            // Remounting on every visit is what makes History and Learn
            // re-read the database rather than showing a snapshot from
            // whenever the tab was first opened.
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <span className="ico" aria-hidden="true">
              {icon}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Your ratings, on the screen where you are choosing an opponent.
 *
 * The brief: "each game setting or each gameplay feature where it's Learn or me
 * playing needs to also give my ELO rating in that thing." Correct instinct —
 * picking a bot strength without your own number next to it is guessing, and
 * the whole reason the ratings are split by section is so you can see WHICH
 * part of your game the number is being held up by.
 *
 * The comparison line is the useful bit. "Opponent 1400" means nothing on its
 * own; "1400, which is 360 above you" is a decision.
 */
function YourRatings({
  overall,
  sections,
  opponentElo,
}: {
  overall: number
  sections: Record<SectionId, SectionRating> | null
  opponentElo: number
}) {
  const gap = opponentElo - overall
  const verdict = sections ? overallVerdict(sections) : null

  return (
    <div className="card stack">
      <div className="row spread">
        <span className="small muted">Your rating</span>
        <span className="small muted">against a {opponentElo} bot</span>
      </div>

      <div className="row spread" style={{ alignItems: 'baseline' }}>
        <span className="stat">{overall}</span>
        <span className="small muted" style={{ textAlign: 'right' }}>
          {gap === 0
            ? 'An even match on paper.'
            : gap > 0
              ? `${gap} points above you. Expect to be under pressure.`
              : `${Math.abs(gap)} points below you. You should be winning this.`}
        </span>
      </div>

      <div className="small muted">
        This one comes from games: it moves when you win or lose against a rated bot, by more when
        the result was a surprise. The five below come from training instead, one per part of the
        game, so you can see which part is holding the number down.
      </div>

      <div className="secrate-grid">
        {SECTION_IDS.map((id) => (
          <div key={id} className="secrate">
            <div className="small muted">{SECTION_NAME[id]}</div>
            <RatingChip r={sections?.[id]} />
            <RatingExplainer r={sections?.[id]} />
          </div>
        ))}
      </div>

      {verdict && <div className="small">{verdict}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Play(props: { initialElo: number; initialStyle: Style; initialColour: 'white' | 'black' }) {
  const chess = useRef(new Chess())
  const [fen, setFen] = useState(chess.current.fen())
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [engineState, setEngineState] = useState<EngineState>('boot')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewState>({ phase: 'idle' })

  const [elo, setElo] = useState(props.initialElo)
  const [style, setStyle] = useState<Style>(props.initialStyle)
  const [orientation, setOrientation] = useState<'white' | 'black'>(props.initialColour)

  const opponent = useMemo<Opponent>(() => createOpponent({ elo, style }), [elo, style])

  // Read once per game rather than per render — flipping the setting
  // mid-game would change the rules underneath you.
  const [blunderCheck] = useState(() => loadPrefs().blunderCheck)
  const [showReview, setShowReview] = useState(false)
  /** Set while a move is on the board but not yet committed. */
  const [pending, setPending] = useState<{ loose: string[] } | null>(null)

  /**
   * Your own numbers, for the panel next to the strength slider.
   *
   * Re-read when a review finishes rather than only on mount, because the game
   * you just played has by then already moved the overall rating — showing the
   * pre-game number next to a post-game result is the kind of small lie that
   * makes people stop trusting the whole display.
   */
  const [myRating, setMyRating] = useState<number | null>(null)
  const [sections, setSections] = useState<Record<SectionId, SectionRating> | null>(null)

  const humanColour = orientation
  const status = statusOf(chess.current)
  const turn = colourOf(chess.current)
  const dests = useMemo(() => toDests(chess.current), [fen])
  const savedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    opponent
      .newGame()
      .then(() => {
        if (!cancelled) setEngineState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setEngineState('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [opponent])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await getProfile()
      const s = await getSectionRatings()
      if (cancelled) return
      setMyRating(p.rating)
      setSections(s)
    })()
    return () => {
      cancelled = true
    }
  }, [review.phase])

  const sync = useCallback(() => {
    setFen(chess.current.fen())
    const hist = chess.current.history({ verbose: true })
    const last = hist[hist.length - 1]
    setLastMove(last ? [last.from as Key, last.to as Key] : undefined)
  }, [])

  const booted = engineState !== 'boot' && engineState !== 'error'

  useEffect(() => {
    if (!booted) return
    // A move awaiting confirmation is not a move yet — the engine must not
    // reply to a position you might still take back.
    if (pending) return
    if (statusOf(chess.current).over) return
    if (colourOf(chess.current) === humanColour) return

    let cancelled = false
    setEngineState('thinking')

    opponent
      .move(chess.current.fen())
      .then((uci) => {
        if (cancelled) return
        if (!uci) {
          setEngineState('ready')
          return
        }
        if (!applyUci(chess.current, uci)) {
          setEngineState('error')
          setErrorMsg(`engine returned an illegal move: ${uci}`)
          return
        }
        sync()
        setEngineState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setEngineState('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [fen, humanColour, opponent, booted, sync, pending])

  /* ---------------------------------------------- save + analyse */

  /**
   * Runs once when the game ends. This is the step that makes the coach real:
   * without persisting mistakes, the profile never fills and every "adaptive"
   * feature downstream is inert.
   */
  useEffect(() => {
    const s = statusOf(chess.current)
    if (!s.over || savedRef.current || !booted) return
    savedRef.current = true

    const humanIs = humanColour === 'white' ? 'w' : 'b'
    const result: 'win' | 'loss' | 'draw' =
      s.winner === 'draw' || s.winner === null
        ? 'draw'
        : s.winner === humanColour
          ? 'win'
          : 'loss'
    const pgn = chess.current.pgn()
    const score = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5

    void (async () => {
      const playedAt = new Date().toISOString()
      const gameId = await db.games.add({
        playedAt,
        humanColour: humanIs,
        opponentElo: elo,
        opponentStyle: style,
        result,
        reason: s.text,
        pgn,
        acpl: null,
        performanceRating: null,
        analysedAt: null,
      })

      await updateRatingFromGame(elo, score as 0 | 0.5 | 1)

      try {
        setReview({ phase: 'running', done: 0, total: 1 })
        const assessments = await analyseGame(pgn, {
          colour: humanIs,
          onProgress: (done, total) => setReview({ phase: 'running', done, total }),
        })

        await db.mistakes.bulkAdd(
          assessments
            .filter((a) => a.severity !== 'best' && a.severity !== 'good')
            .map((a) => ({
              gameId,
              ply: a.ply,
              fen: a.fen,
              san: a.san,
              bestSan: a.bestSan,
              lossCp: a.lossCp,
              severity: a.severity,
              tag: a.tag,
              phase: a.phase,
              at: playedAt,
            })),
        )

        const avg = acpl(assessments)
        const perf = performanceRating(avg)
        await db.games.update(gameId, {
          acpl: avg,
          performanceRating: perf,
          analysedAt: new Date().toISOString(),
        })

        setReview({
          phase: 'done',
          acpl: avg,
          perf,
          blunders: assessments.filter((a) => a.severity === 'blunder').length,
          moves: assessments,
        })
      } catch (err) {
        setErrorMsg(`analysis failed: ${err instanceof Error ? err.message : String(err)}`)
        setReview({ phase: 'idle' })
      }
    })()
  }, [fen, booted, humanColour, elo, style])

  /* ------------------------------------------------------ actions */

  /**
   * Blunder check (Kotov).
   *
   * The habit that actually costs games below 1600 is not failing to find a
   * clever move — it is playing a reasonable-looking move without asking what
   * it leaves hanging. So when this is on, your move goes on the board but the
   * clock does not start: you see the position it produces, get told how many
   * of your pieces are now attacked and undefended, and choose to commit or
   * take it back.
   *
   * It counts loose pieces rather than running the engine, for two reasons.
   * It is instant, so the rhythm of the game survives. And "attacked and
   * undefended" is the actual root cause — forks and pins only work because
   * something was loose first — so it trains the right check rather than
   * outsourcing the thinking to Stockfish.
   */
  const onMove = useCallback(
    (from: Key, to: Key) => {
      try {
        chess.current.move({ from, to, promotion: 'q' })
      } catch {
        setFen(chess.current.fen())
        return
      }
      sync()
      if (blunderCheck) {
        const mine = humanColour === 'white' ? 'w' : 'b'
        setPending({ loose: loosePieces(chess.current.fen(), mine) })
      }
    },
    [sync, blunderCheck, humanColour],
  )

  const commitMove = useCallback(() => setPending(null), [])

  const takeBack = useCallback(() => {
    chess.current.undo()
    setPending(null)
    sync()
  }, [sync])

  const newGame = useCallback(
    (side: 'white' | 'black') => {
      chess.current.reset()
      savedRef.current = false
      // Without this a move left unconfirmed from the previous game would
      // still be gating the engine effect, and the new game would sit frozen.
      setPending(null)
      setReview({ phase: 'idle' })
      setShowReview(false)
      setOrientation(side)
      setLastMove(undefined)
      setFen(chess.current.fen())
      setErrorMsg(null)
      void opponent.newGame()
    },
    [opponent],
  )

  const botThinking = engineState === 'thinking'
  // No further input while a move is waiting to be confirmed or taken back.
  const playable = status.over || botThinking || pending ? null : humanColour

  // The review owns the whole screen. It is a different activity from playing
  // — you are studying a finished game — and squeezing it under the board
  // would put the thing you came to look at below three cards of controls.
  if (showReview && review.phase === 'done') {
    return (
      <GameReview
        moves={review.moves}
        colour={humanColour}
        acpl={review.acpl}
        perf={review.perf}
        onClose={() => setShowReview(false)}
      />
    )
  }

  return (
    <div className="stack">
      <div className="status" style={{ marginBottom: 2 }}>
        <span
          className={
            'dot ' +
            (engineState === 'thinking'
              ? 'thinking'
              : engineState === 'error'
                ? 'error'
                : engineState === 'ready'
                  ? 'ready'
                  : '')
          }
        />
        <span className="small muted">
          {engineState === 'boot' && 'loading engine…'}
          {engineState === 'thinking' && `${opponent.name} thinking`}
          {engineState === 'error' && 'engine error'}
          {engineState === 'ready' && (status.over ? status.text : `${turn} to move`)}
        </span>
      </div>

      <Board
        fen={fen}
        orientation={orientation}
        dests={dests}
        turn={turn}
        playable={playable}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        onMove={onMove}
      />

      {pending && (
        <div
          className="card stack"
          style={{ borderColor: pending.loose.length > 0 ? 'var(--warn)' : 'var(--accent)' }}
        >
          <div>
            <strong>Before it plays — anything hanging?</strong>{' '}
            <span className="muted">
              {pending.loose.length === 0
                ? 'Nothing of yours is attacked and undefended. Looks safe.'
                : pending.loose.length === 1
                  ? `Your piece on ${pending.loose[0]} is attacked and nothing defends it.`
                  : `${pending.loose.length} of your pieces are attacked and undefended: ${pending.loose.join(', ')}.`}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" style={{ flex: 1 }} onClick={commitMove}>
              Play it
            </button>
            <button className="ghost" style={{ flex: 1 }} onClick={takeBack}>
              Take it back
            </button>
          </div>
          <div className="small muted">
            Being attacked is not always a problem — a defended piece, or one you meant to trade,
            is fine. The question is whether you had noticed.
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="card small" style={{ borderColor: 'var(--danger)' }}>
          <strong>Error.</strong> {errorMsg}
        </div>
      )}

      {status.over && (
        <div className="card stack">
          <div className="row spread">
            <strong>{status.text}</strong>
            <button className="primary" onClick={() => newGame(orientation)}>
              Play again
            </button>
          </div>
          {review.phase === 'running' && (
            <div className="status">
              <span className="dot thinking" />
              <span className="small muted">
                reviewing your moves… {review.done}/{review.total}
              </span>
            </div>
          )}
          {review.phase === 'done' && (
            <div className="stack">
              <div className="small">
                You averaged <strong>{review.acpl}</strong> centipawns lost per move — that's about{' '}
                <strong>{review.perf}</strong> strength.{' '}
                {review.blunders === 0
                  ? 'No blunders.'
                  : `${review.blunders} blunder${review.blunders === 1 ? '' : 's'} logged.`}
              </div>
              {/* The summary is the headline; the review is the coaching. Making
                  it a button rather than inlining it keeps the end-of-game card
                  short, and going in is a deliberate act — you look at your
                  mistakes when you are ready to. */}
              <button className="chip solid" onClick={() => setShowReview(true)}>
                Review my mistakes →
              </button>
            </div>
          )}
        </div>
      )}

      {myRating !== null && (
        <YourRatings overall={myRating} sections={sections} opponentElo={elo} />
      )}

      {/*
        The roster comes first, the slider second.
        "Opponent strength: 1400" makes difficulty feel like a settings value
        you are adjusting rather than a person you are trying to beat, and
        nobody remembers beating Bot 1400. Picking Sofia — who squeezes you
        positionally and is slow to strike — is a decision with a plan attached
        to it. The slider stays underneath for when you want a specific number.
      */}
      <BotRoster
        rating={myRating ?? 800}
        elo={elo}
        style={style}
        onPick={(b) => {
          setElo(b.elo)
          setStyle(b.style)
        }}
      />

      <div className="card stack">
        <label className="field">
          Opponent strength — <strong style={{ color: 'var(--text)' }}>{elo}</strong>
          <input
            type="range"
            min={300}
            max={2200}
            step={100}
            value={elo}
            onChange={(e) => setElo(Number(e.target.value))}
          />
        </label>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Style
          </div>
          <div className="chips">
            {STYLES.map((s) => (
              <button
                key={s.id}
                className="chip"
                aria-pressed={style === s.id}
                title={s.blurb}
                onClick={() => setStyle(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {STYLES.find((s) => s.id === style)?.blurb}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" style={{ flex: 1 }} onClick={() => newGame('white')}>
          New game as white
        </button>
        <button style={{ flex: 1 }} onClick={() => newGame('black')}>
          as black
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * The opponent roster.
 *
 * Each card is a (rating, style) pair the slider could already produce —
 * picking one just sets both. What it adds is an opponent with a name, a way
 * of playing and a stated weakness, which is the difference between choosing a
 * difficulty and choosing who to play.
 *
 * The weakness is the coaching content and the reason this is not just
 * decoration: "over-values the tactic, will win a pawn at the cost of her
 * position" tells you how to play the game before it starts, which is what
 * preparing for an opponent actually is.
 */
function BotRoster({
  rating,
  elo,
  style,
  onPick,
}: {
  rating: number
  elo: number
  style: Style
  onPick: (b: Bot) => void
}) {
  const suggested = suggestedBot(rating)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="card stack">
      <div className="row spread">
        <span className="small muted">Choose your opponent</span>
        <span className="small muted">{BOTS.length} bots</span>
      </div>

      <div className="bot-grid">
        {BOTS.map((b) => {
          const active = b.elo === elo && b.style === style
          const isNext = b.id === suggested.id
          return (
            <button
              key={b.id}
              className={'bot' + (active ? ' on' : '') + (isNext ? ' next' : '')}
              onClick={() => {
                onPick(b)
                setOpenId(openId === b.id ? null : b.id)
              }}
            >
              <span className="bot-face" aria-hidden="true">
                {b.face}
              </span>
              <span className="bot-id">
                <span className="bot-name">{b.name}</span>
                <span className="bot-elo">{b.elo}</span>
              </span>
              {isNext && <span className="bot-tag">next up</span>}
            </button>
          )
        })}
      </div>

      {openId && <BotCard bot={BOTS.find((b) => b.id === openId)!} />}
    </div>
  )
}

function BotCard({ bot }: { bot: Bot }) {
  return (
    <div className="bot-card">
      <div className="bot-bio">
        <b>
          {bot.face} {bot.name}, {bot.elo}
        </b>{' '}
        {bot.bio}
      </div>
      <div className="small">
        <span className="brief-key">Plays</span> {bot.plays}
      </div>
      <div className="small">
        <span className="brief-key">Weakness</span> {bot.weakness}
      </div>
      {!bot.calibrated && (
        <div className="bot-caveat">
          Aimed at {bot.elo}, not measured at it. The bots currently play stronger than their
          labels — see FINDINGS.md. Fixed by replacing the move policy, not by relabelling.
        </div>
      )}
    </div>
  )
}
