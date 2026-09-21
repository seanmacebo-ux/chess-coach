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
import { PositionalRunner } from './ui/screens/PositionalRunner'
import { type EndgamePosition } from './coach/endgames'
import { type PositionalPosition } from './coach/positional'
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
import { markSessionComplete, ratingStakes } from './coach/profile'
import type { DailySession } from './coach/session'
import { applyUci, colourOf, statusOf, toDests } from './chess/game'
import { createOpponent, type Opponent } from './engine/opponent'
import { STYLES, type Style } from './engine/types'
import { acpl, performanceRating, type MoveAssessment } from './coach/analysis'
import { GameReview } from './ui/screens/GameReview'
import { GameOver } from './ui/screens/GameOver'
import { Captured } from './ui/Captured'
import { openingOfPgn, type OpeningName } from './coach/eco'
import { ReviewProgress } from './ui/ReviewProgress'
import { Climb } from './ui/screens/Climb'
import { BOTS, suggestedBot, type Bot } from './engine/roster'
import { recordFinishedGame, outcomeOf } from './coach/record'
import { db, getProfile } from './data/db'
import { pickPuzzles, type Puzzle } from './data/puzzles'
import { loadPrefs } from './data/settings'
import { loosePieces } from './coach/exercises'
import { readPosition } from './coach/position'
import { applyTheme, loadTheme, resolveTheme, saveTheme, type ThemeChoice } from './theme/theme'
import { readLocal, writeLocal } from './data/local'

type Tab =
  | 'daily'
  | 'play'
  | 'puzzles'
  | 'scan'
  | 'threat'
  | 'candidates'
  | 'endgames'
  | 'positional'
  | 'history'
  | 'learn'
  | 'settings'

const COLOUR_KEY = 'cc.colour'

function loadColourMode(): ColourMode {
  const v = readLocal(COLOUR_KEY)
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


/*
 * Tab icons, drawn.
 *
 * These were dingbat characters — ◎ ♟ ⚡ ❖ ◔ ⚙ — which render as a different
 * shape, weight and baseline on every device, and on some Android builds as
 * a tofu box. Both design directions replaced them with drawn icons for the
 * same reason: a glyph you do not control is not an icon.
 */
const TAB_ICON: Record<Tab, string> = {
  daily:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  play:
    '<path d="M12 4.2a2.9 2.9 0 0 1 1.7 5.3c1.1.8 1.8 2.1 1.9 3.6H8.4c.1-1.5.8-2.8 1.9-3.6A2.9 2.9 0 0 1 12 4.2Z"/><path d="M7.4 19.8h9.2l-1.1-4.2H8.5l-1.1 4.2Z"/>',
  puzzles: '<path d="M13.4 3.2 5.8 13.1h4.7l-1 7.7 7.7-9.9h-4.7l.9-7.7Z"/>',
  learn:
    '<path d="M12 7.1S9.9 5.2 4.6 5.2v11.9c5.3 0 7.4 1.9 7.4 1.9s2.1-1.9 7.4-1.9V5.2C14.1 5.2 12 7.1 12 7.1Z"/><path d="M12 7.1v11.9"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v5.1l3.1 1.9"/>',
  settings:
    '<path d="M3.6 7.6h9.2M17.2 7.6h3.2M3.6 16.4h3.6M11.6 16.4h8.8"/><circle cx="15" cy="7.6" r="2.2"/><circle cx="9.4" cy="16.4" r="2.2"/>',
  // Sub-screens never appear in the bar; they exist so the record is total.
  scan: '', threat: '', candidates: '', endgames: '', positional: '',
}

function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg
      className="ico"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: TAB_ICON[tab] }}
    />
  )
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
    writeLocal(COLOUR_KEY, colourMode)
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
  const [positional, setPositional] = useState<PositionalPosition | null>(null)
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

  const playPositional = useCallback((p: PositionalPosition) => {
    setPositional(p)
    setTab('positional')
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

      {tab === 'positional' &&
        (positional ? (
          <PositionalRunner
            key={positional.id}
            position={positional}
            onDone={({ success }) => {
              setResult(
                success
                  ? `${positional.name} — you found the idea.`
                  : `${positional.name} — idea shown. Replay it to own it.`,
              )
              setPositional(null)
              setTab('learn')
            }}
          />
        ) : (
          <div className="card row spread">
            <span className="muted">No position loaded.</span>
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
          onPlayPositional={playPositional}
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
            ['daily', 'Today'],
            ['play', 'Play'],
            // Puzzles had no front door at all — it was reachable only by
            // being handed there from Today or Learn, which is most of why it
            // read as an extension of Learn rather than its own thing. The
            // climb needs somewhere to live.
            ['puzzles', 'Puzzles'],
            ['learn', 'Learn'],
            ['history', 'History'],
            ['settings', 'Settings'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            // Remounting on every visit is what makes History and Learn
            // re-read the database rather than showing a snapshot from
            // whenever the tab was first opened.
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <TabIcon tab={id} />
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
        the result was a surprise. The five section ratings come from training instead, one per
        part of the game, so you can see which part is holding the number down.
      </div>

      {(() => {
        /*
         * FIVE CARDS SAYING THE SAME SENTENCE IS NOT FIVE PIECES OF
         * INFORMATION.
         *
         * Until you have trained a section its rating is the starting guess
         * and its explainer reads "Not trained yet — the number is a starting
         * guess." Printing that five times under the board, each in its own
         * box, took over half the Play screen to say one thing — and said it
         * every single time anyone opened the tab to start a game.
         *
         * RatingChip's own module comment already identified this failure on
         * the Learn index and shortened the sentence. Shortening was not the
         * fix; repeating it was the problem.
         *
         * So untrained sections collapse to one line that names them, and the
         * grid appears only for the ones that have something to report. A new
         * player sees a sentence. Someone who has trained three sections sees
         * three cards, which is three pieces of information.
         */
        const trained = SECTION_IDS.filter((id) => (sections?.[id]?.played ?? 0) > 0)
        const untrained = SECTION_IDS.filter((id) => (sections?.[id]?.played ?? 0) === 0)

        return (
          <>
            {trained.length > 0 && (
              <div className="secrate-grid">
                {trained.map((id) => (
                  <div key={id} className="secrate">
                    <div className="small muted">{SECTION_NAME[id]}</div>
                    <RatingChip r={sections?.[id]} />
                    <RatingExplainer r={sections?.[id]} />
                  </div>
                ))}
              </div>
            )}
            {untrained.length > 0 && (
              <div className="small muted">
                {untrained.length === SECTION_IDS.length
                  ? 'None of the five are trained yet, so all five are still the starting guess. Solve anything and they start moving.'
                  : `Not trained yet: ${untrained.map((id) => SECTION_NAME[id]).join(', ')}.`}
              </div>
            )}
          </>
        )
      })()}

      {/*
        The overall verdict is worth saying once there is something to
        summarise. With nothing trained it reads "Nothing measured yet. Train
        anything and these start moving", directly under a line that has just
        said the same thing in more detail — so it is held back until at
        least one section has a number behind it.
      */}
      {verdict && SECTION_IDS.some((id) => (sections?.[id]?.played ?? 0) > 0) && (
        <div className="small">{verdict}</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/*
 * The clock. Sean: "we should also have a timer now bro." Right on the
 * merits, not just the vibes: his real games are 10-minute rapid and the bot
 * games here had no clock at all, so the one pressure that decides half his
 * online games — time — was never trained. Off / 5 / 10 / 15, default 10 to
 * match chess.com rapid, flag = loss, recorded like any other result. The
 * choice applies from the next game so switching it can never change the
 * rules of the one in progress.
 */
const CLOCK_KEY = 'cc.clock'
const CLOCK_CHOICES = [0, 5, 10, 15] as const

function loadClockMin(): number {
  const raw = readLocal(CLOCK_KEY)
  // No stored choice means the default 10 — Number(null) is 0, which would
  // silently read as "No clock" for everyone who never touched the setting.
  if (raw === null) return 10
  const v = Number(raw)
  return (CLOCK_CHOICES as readonly number[]).includes(v) ? v : 10
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function Play(props: { initialElo: number; initialStyle: Style; initialColour: 'white' | 'black' }) {
  const chess = useRef(new Chess())
  const [fen, setFen] = useState(chess.current.fen())
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [engineState, setEngineState] = useState<EngineState>('boot')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewState>({ phase: 'idle' })
  /**
   * What the game did to the rating, and whether the result screen is up.
   *
   * recordFinishedGame has always returned the new rating and the delta and
   * App threw both away, so the end-of-game card could only explain what a
   * win WOULD have been worth. The number that actually moved is the one
   * anyone looks at.
   */
  const [outcomeCard, setOutcomeCard] = useState<{
    result: 'win' | 'loss' | 'draw'
    how: string
    rating: number | null
    delta: number | null
    fen: string
  } | null>(null)
  /** Ply the review should open on, when arrived at from a named moment. */
  const [reviewPly, setReviewPly] = useState<number | null>(null)
  /** What the game's opening was called, once the book has been consulted. */
  const [opening, setOpening] = useState<OpeningName | null>(null)

  /** The preference (live) and the value the CURRENT game was dealt. */
  const [clockMin, setClockMin] = useState(loadClockMin)
  const activeClockMin = useRef(clockMin)
  const remainRef = useRef({ w: clockMin * 60_000, b: clockMin * 60_000 })
  const [remain, setRemain] = useState(remainRef.current)
  const [flagged, setFlagged] = useState<'w' | 'b' | null>(null)
  const flaggedRef = useRef<'w' | 'b' | null>(null)
  /**
   * Whose clock is running, and since when.
   *
   * THE CLOCK USED TO BE SAMPLED. Every 200ms it asked whose turn it was and
   * charged the whole preceding interval to that side — which is only right
   * if the turn never changes between two ticks. The bot answers in about a
   * tenth of a second, so the turn regularly changed TWICE inside one
   * interval, and the sample landed back on the human every time. Measured
   * on a real game: the opponent's clock sat at 10:00 for the entire game,
   * frozen, while the human was charged for the engine's thinking as well as
   * their own. Over forty moves that is five to ten seconds taken from the
   * player and given to the bot, and "ran out of time. You win." was
   * unreachable code.
   *
   * Time is now charged on the EVENT that spends it — the move — rather than
   * sampled by a timer that can miss it. remainRef holds what each side had
   * when its turn began; the interval only renders what is running down.
   */
  const turnSide = useRef<'w' | 'b'>('w')
  const turnStartedAt = useRef<number>(Date.now())

  const [elo, setElo] = useState(props.initialElo)
  const [style, setStyle] = useState<Style>(props.initialStyle)
  const [orientation, setOrientation] = useState<'white' | 'black'>(props.initialColour)

  const opponent = useMemo<Opponent>(() => createOpponent({ elo, style }), [elo, style])

  // Read once per game rather than per render — flipping the setting
  // mid-game would change the rules underneath you.
  const [blunderCheck] = useState(() => loadPrefs().blunderCheck)
  /*
   * Read once per game for the same reason as the blunder check: flipping a
   * training aid on halfway through changes the rules of a game already in
   * progress.
   */
  const [liveRead] = useState(() => loadPrefs().liveRead)
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
  /** Needed alongside the rating: K scales with it, so the stakes do too. */
  const [myRd, setMyRd] = useState<number | null>(null)
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
      setMyRd(p.ratingDeviation)
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

  /*
   * The ticker. One interval, 200ms, decrementing whichever side the board
   * says is to move — including the bot while it "thinks". Everything it
   * needs lives in refs so the interval never restarts mid-game; a restart
   * would drop the milliseconds between the old tick and the new one.
   */
  useEffect(() => {
    flaggedRef.current = flagged
  }, [flagged])

  /**
   * The turn changed: bank what the side that just moved actually spent.
   *
   * Driven by the position rather than by a timer, so no amount of time can
   * be attributed to the wrong player however fast a move comes back.
   */
  useEffect(() => {
    if (!booted) return
    const now = Date.now()
    const spent = now - turnStartedAt.current
    const was = turnSide.current
    const nowTurn = chess.current.turn()
    if (nowTurn === was) {
      // Same side still to move — a re-render, not a move. Nothing is owed.
      return
    }
    if (activeClockMin.current > 0 && !flaggedRef.current) {
      remainRef.current = {
        ...remainRef.current,
        [was]: Math.max(0, remainRef.current[was] - spent),
      }
    }
    turnSide.current = nowTurn
    turnStartedAt.current = now
    setRemain(remainRef.current)
  }, [fen, booted])

  useEffect(() => {
    if (!booted) return
    const id = window.setInterval(() => {
      // Checked per tick, not when the interval starts: newGame can hand the
      // NEXT game a clock after this one ran without, and vice versa.
      if (activeClockMin.current === 0) return
      if (flaggedRef.current || statusOf(chess.current).over) return
      /*
       * Display only. The banked figure in remainRef is not touched here —
       * this renders it minus however long the side on move has been
       * thinking, which is what a running clock is.
       */
      const side = turnSide.current
      const live = Math.max(0, remainRef.current[side] - (Date.now() - turnStartedAt.current))
      setRemain({ ...remainRef.current, [side]: live })
      if (live === 0) {
        remainRef.current = { ...remainRef.current, [side]: 0 }
        setFlagged(side)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [booted])

  useEffect(() => {
    if (!booted) return
    // A move awaiting confirmation is not a move yet — the engine must not
    // reply to a position you might still take back.
    if (pending) return
    // A flag ends the game exactly like mate — no reply to a finished game.
    if (flagged) return
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
  }, [fen, humanColour, opponent, booted, sync, pending, flagged])

  /* ---------------------------------------------- save + analyse */

  /**
   * Runs once when the game ends. This is the step that makes the coach real:
   * without persisting mistakes, the profile never fills and every "adaptive"
   * feature downstream is inert.
   */
  useEffect(() => {
    const s = statusOf(chess.current)
    if ((!s.over && !flagged) || savedRef.current || !booted) return

    const humanIs = humanColour === 'white' ? 'w' : 'b'
    // A flag is an outcome the board cannot see, so it is decided here: the
    // side whose clock hit zero lost, full stop, whatever the position was.
    const outcome = flagged
      ? { result: flagged === humanIs ? ('loss' as const) : ('win' as const) }
      : outcomeOf(chess.current, humanIs)
    // statusOf and outcomeOf agree on what "over" means, so this cannot fire
    // today. It is checked before the guard is set rather than after, because
    // the alternative — marking the game saved and then bailing — would lose
    // it silently if the two ever diverge.
    if (!outcome) return
    savedRef.current = true
    const pgn = chess.current.pgn()

    void (async () => {
      /*
       * One definition of "save a game", shared with both trainers.
       *
       * This block used to be the only place a bot game was persisted, which
       * is why a game played out of the opening or middlegame trainer left no
       * History row and never moved the rating — those screens simply did not
       * have this code. It now lives in coach/record.ts and all three call it,
       * so the three cannot drift apart.
       */
      setReview({ phase: 'running', done: 0, total: 1 })
      /*
       * The result screen goes up BEFORE the analysis runs. Rating and
       * outcome are known the moment the game ends; the move ratings take
       * fifteen seconds. Waiting for both means the screen you get for
       * winning a game arrives well after the win.
       */
      setOutcomeCard({
        result: outcome.result,
        how: flagged
          ? 'time'
          : chess.current.isCheckmate()
            ? 'checkmate'
            : chess.current.isStalemate()
              ? 'stalemate'
              : chess.current.isThreefoldRepetition()
                ? 'repetition'
                : chess.current.isInsufficientMaterial()
                  ? 'insufficient material'
                  : 'agreement',
        rating: null,
        delta: null,
        fen: chess.current.fen(),
      })
      const { assessments, rating: newRating, delta } = await recordFinishedGame(
        {
          pgn,
          humanColour: humanIs,
          result: outcome.result,
          reason: flagged ? 'out of time' : s.text,
          opponentElo: elo,
          opponentStyle: style,
          source: 'play',
        },
        {
          analyse: true,
          onProgress: (done, total) => setReview({ phase: 'running', done, total }),
        },
      )

      setOutcomeCard((c) => (c ? { ...c, rating: newRating, delta } : c))
      setMyRating(newRating)
      // One fetch of a cached file, no engine time — so it lands well before
      // the move ratings do and the result screen can name the game early.
      // A cached fetch, so it fails only offline-before-first-load — in which
      // case the game keeps its name blank rather than rejecting into nothing.
      void openingOfPgn(pgn)
        .then(setOpening)
        .catch(() => setOpening(null))

      if (!assessments) {
        // The game is saved and the rating has moved — the recorder does both
        // before it touches the engine. Only the review is missing.
        setErrorMsg('Game saved, but the review could not run.')
        setReview({ phase: 'idle' })
        return
      }

      const avg = acpl(assessments)
      setReview({
        phase: 'done',
        acpl: avg,
        perf: performanceRating(avg),
        blunders: assessments.filter((a) => a.severity === 'blunder').length,
        moves: assessments,
      })
    })()
  }, [fen, booted, humanColour, elo, style, flagged])

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
      setOutcomeCard(null)
      setReviewPly(null)
      setOpening(null)
      setOrientation(side)
      setLastMove(undefined)
      setFen(chess.current.fen())
      setErrorMsg(null)
      // The new game gets the clock preference as it stands NOW.
      activeClockMin.current = clockMin
      remainRef.current = { w: clockMin * 60_000, b: clockMin * 60_000 }
      setRemain(remainRef.current)
      setFlagged(null)
      turnSide.current = 'w'
      turnStartedAt.current = Date.now()
      void opponent.newGame()
    },
    [opponent, clockMin],
  )

  const botThinking = engineState === 'thinking'
  // No further input while a move is waiting to be confirmed or taken back.
  const playable = status.over || flagged || botThinking || pending ? null : humanColour

  const humanIs = humanColour === 'white' ? 'w' : 'b'
  const botIs = humanIs === 'w' ? 'b' : 'w'
  const gameEnded = status.over || flagged !== null
  const endText = flagged
    ? flagged === humanIs
      ? 'You ran out of time — that counts as a loss.'
      : `${opponent.name} ran out of time. You win.`
    : status.text

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
        opening={opening}
        opponentName={opponent.name}
        startPly={reviewPly}
        onClose={() => {
          setShowReview(false)
          setReviewPly(null)
        }}
      />
    )
  }

  /*
   * The result gets the screen. It used to be a grey card below the board,
   * under the clocks and the move list — you finished a game and the reply
   * was an audit in the margin. Closing it puts you back on the board with
   * the final position and every control still there.
   */
  if (outcomeCard) {
    return (
      <GameOver
        result={outcomeCard.result}
        how={outcomeCard.how}
        opponentName={opponent.name}
        opponentElo={elo}
        fen={outcomeCard.fen}
        colour={humanColour}
        rating={outcomeCard.rating}
        delta={outcomeCard.delta}
        opening={opening}
        moves={review.phase === 'done' ? review.moves : null}
        analysing={review.phase === 'running' ? { done: review.done, total: review.total } : null}
        acpl={review.phase === 'done' ? review.acpl : null}
        onReview={(ply) => {
          setReviewPly(ply ?? null)
          setShowReview(true)
        }}
        onRematch={() => newGame(orientation)}
        onClose={() => setOutcomeCard(null)}
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
          {engineState === 'ready' &&
            (gameEnded
              ? endText
              : /* With clocks running, the live dot beside a name already says
                   whose turn it is, and saying it twice is the kind of small
                   redundancy that made every screen feel padded. */
                activeClockMin.current > 0
                ? null
                : `${turn} to move`)}
        </span>
      </div>

      {/* The clocks. Opponent's above the board, yours below it would split
          them around the thing you are looking at — one row reads faster. */}
      {/*
        Opponent above the board, you below it — the arrangement every chess
        player already reads, rather than both clocks stacked on one side. The
        calm register: no boxes, the figure carries it.
      */}
      {/*
        The strip is no longer gated on the clock.
        It carries the CAPTURED PIECES now, which matter in every game, and
        hiding the whole row when clocks are off meant the one fact players
        check constantly — am I up or down material — was only available by
        counting the board yourself. The clock is the part that is optional.
      */}
      <div className="side-strip">
        <span className="side-who">
          <i className={'dot-sm' + (!gameEnded && turn !== humanColour ? ' live' : '')} />
          {opponent.name}
          <Captured fen={fen} side={humanColour === 'white' ? 'black' : 'white'} />
        </span>
        {activeClockMin.current > 0 && (
          <span className={'side-clock' + (remain[botIs] < 30_000 ? ' low' : '')}>
            {fmtClock(remain[botIs])}
          </span>
        )}
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

      <div className="side-strip">
        <span className="side-who">
          <i className={'dot-sm' + (!gameEnded && turn === humanColour ? ' live' : '')} />
          You
          <Captured fen={fen} side={humanColour} />
        </span>
        {activeClockMin.current > 0 && (
          <span
            className={
              'side-clock yours' + (remain[humanIs] < 30_000 ? ' low' : '')
            }
          >
            {fmtClock(remain[humanIs])}
          </span>
        )}
      </div>

      {/*
        THE POSITION, LIVE.
        Sean: "I need to be able to understand what is happening in the game."
        This is the same board-computed read the review uses, during the game
        instead of after it — the point in time where it could actually change
        a decision. It is NOT the engine: no evaluation, no best move, nothing
        you could not work out yourself by looking properly. That distinction
        is the whole design, because a coach that hands over the answer trains
        obedience and this is meant to train the habit of looking.
      */}
      {liveRead && !gameEnded && (
        <div className="live-read">
          <div className="row spread" style={{ alignItems: 'baseline' }}>
            <span className="brief-key">What is happening</span>
            <span className="small muted">from the board, not the engine</span>
          </div>
          <ul className="read-lines">
            {readPosition(fen, humanColour === 'white' ? 'w' : 'b').lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

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

      {gameEnded && (
        <div className="card stack">
          <div className="row spread">
            <strong>{endText}</strong>
            <button className="primary" onClick={() => newGame(orientation)}>
              Play again
            </button>
          </div>
          {review.phase === 'running' && (
            <ReviewProgress done={review.done} total={review.total} />
          )}
          {review.phase === 'done' && (
            <div className="stack">
              {/*
                Why the rating did what it did. A win worth +1 reads as a
                broken app unless the reason is on screen next to it.
              */}
              <div className="small muted">
                {(() => {
                  const st = ratingStakes(myRating ?? 800, myRd ?? 250, elo)
                  const pct = Math.round(st.expected * 100)
                  return st.win <= 2
                    ? `You were expected to win this one (${pct}%), so beating it is worth about +${st.win}. Play someone nearer your own number to move it.`
                    : `Against ${elo} you were about ${pct}% to win: +${st.win} for a win, ${st.loss} for a loss.`
                })()}
              </div>
              <div className="small">
                You averaged <strong>{review.acpl}</strong> centipawns lost per move — that's about{' '}
                <strong>{review.perf}</strong> strength.{' '}
                {review.blunders === 0
                  ? 'No blunders.'
                  : `${review.blunders} blunder${review.blunders === 1 ? '' : 's'} logged.`}
              </div>
              {/*
                Two ways on, and neither is called "review my mistakes"
                any more. That label framed the only route forward as a list
                of your failures — which is also all the review used to
                contain. It now rates every move you played, so the honest
                name for it is the one chess.com uses.
              */}
              <div className="row" style={{ gap: 8 }}>
                <button className="chip solid" onClick={() => setShowReview(true)}>
                  Game review →
                </button>
                <button
                  className="chip"
                  onClick={() =>
                    setOutcomeCard({
                      result:
                        status.winner === 'draw'
                          ? 'draw'
                          : status.winner === humanColour
                            ? 'win'
                            : 'loss',
                      how: chess.current.isCheckmate() ? 'checkmate' : endText,
                      rating: myRating,
                      delta: null,
                      fen: chess.current.fen(),
                    })
                  }
                >
                  See the result
                </button>
              </div>
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
        ratingDeviation={myRd ?? 250}
        elo={elo}
        style={style}
        onPick={(b) => {
          setElo(b.elo)
          setStyle(b.style)
        }}
      />

      {/*
        THE SETUP IS ONE THING, NOT THREE BOXES.
        Strength, clock and style are the three decisions you make before a
        game and they were three stacked cards, each with its own border, as
        though they were unrelated features that happened to be adjacent. The
        calm register applies here for the same reason it applies to Today:
        this is a surface you ACT on. Checkered rules separate the decisions;
        nothing needs a box around it.
      */}
      <div className="setup">
        <div className="day-kicker">Before you start</div>
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
        <div className="rule" />

        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Clock
          </div>
          <div className="chips">
            {CLOCK_CHOICES.map((min) => (
              <button
                key={min}
                className="chip"
                aria-pressed={clockMin === min}
                onClick={() => {
                  setClockMin(min)
                  try {
                    writeLocal(CLOCK_KEY, String(min))
                  } catch {
                    /* preference just won't survive a reload */
                  }
                }}
              >
                {min === 0 ? 'No clock' : `${min} min`}
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {clockMin === activeClockMin.current
              ? 'Run out of time and the game is lost — same as online.'
              : 'Applies from the next game.'}
          </div>
        </div>

        <div className="rule" />

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
  ratingDeviation,
  elo,
  style,
  onPick,
}: {
  rating: number
  ratingDeviation: number
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
              {/*
                What the game is worth, on the bot, before you commit to it.
                Elo pays for the unexpected result, so a bot far below you is
                worth about nothing to beat and a lot to lose to — true, and
                completely invisible until it is written down.
              */}
              <span className="bot-stakes">
                {(() => {
                  const st = ratingStakes(rating, ratingDeviation, b.elo)
                  return (
                    <>
                      <i className="up">+{st.win}</i>
                      {/* A loss worth nothing is good news; painting the 0
                          red made "you cannot lose anything here" look like
                          a penalty. */}
                      <i className={st.loss < 0 ? 'down' : 'none'}>{st.loss}</i>
                    </>
                  )
                })()}
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
