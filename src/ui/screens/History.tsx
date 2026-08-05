/**
 * History — everything the app has recorded about you, made visible.
 *
 * All of this was already being stored; none of it was shown. Training data
 * you can't see is indistinguishable from training data that isn't there, and
 * the whole premise of the app is that it learns your game — so you have to be
 * able to check that it actually is.
 *
 * Deliberately shows failures as prominently as successes. A history screen
 * that only celebrates is a scoreboard; this is supposed to be a diagnosis.
 */

import { useCallback, useEffect, useState } from 'react'
import { db, getProfile, type GameRow, type PuzzleAttemptRow } from '../../data/db'
import { analyseGame, acpl, performanceRating, type MoveAssessment } from '../../coach/analysis'
import { GameReview } from './GameReview'
import {
  balanceVerdict,
  categoryTrends,
  computeWeaknesses,
  detectPatterns,
  type CategoryTrend,
  type Pattern,
  type TrendState,
  type Weakness,
} from '../../coach/profile'

interface Snapshot {
  rating: number
  streak: number
  games: GameRow[]
  attempts: PuzzleAttemptRow[]
  weaknesses: Weakness[]
  patterns: Pattern[]
  trends: CategoryTrend[]
  verdict: string | null
  mistakeCount: number
}

/* Pill colour reuses the game-result palette: green reads as good, red as bad,
   neutral as neither, which is already learned from the games list. */
const TREND_PILL: Record<TrendState, string> = {
  gaining: 'win',
  slipping: 'loss',
  holding: 'draw',
  untested: 'draw',
  new: 'draw',
}

const TREND_WORD: Record<TrendState, string> = {
  gaining: 'up',
  slipping: 'down',
  holding: 'steady',
  untested: 'untried',
  new: 'new',
}

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return d.toISOString().slice(0, 10)
}

/**
 * Reviewing a game from the list.
 *
 * Games arrive from the chess.com import un-analysed, because importing twenty
 * of them is instant and analysing twenty is not. So the engine pass runs when
 * you ask for it, on the one game you want to look at, and the result is
 * written back so it only ever happens once per game.
 */
function useGameReview() {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{
    moves: MoveAssessment[]
    colour: 'white' | 'black'
    acpl: number
    perf: number
  } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  /** Kept so the side swap can re-analyse the same game. */
  const [current, setCurrent] = useState<GameRow | null>(null)
  const [swapping, setSwapping] = useState(false)

  const review = useCallback(async (g: GameRow, as?: 'w' | 'b') => {
    if (g.id === undefined) return
    const colour = as ?? g.humanColour
    if (as) setSwapping(true)
    else setBusy(g.id)
    setError(null)
    setProgress(null)
    setCurrent(g)
    try {
      const moves = await analyseGame(g.pgn, {
        colour,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const avg = acpl(moves)
      const perf = performanceRating(avg)
      // Only the player's own side is written back — the stored acpl is a
      // record of how THEY played, and overwriting it with the opponent's
      // numbers because they glanced at the other half would be a lie.
      if (colour === g.humanColour) {
        await db.games.update(g.id, {
          acpl: avg,
          performanceRating: perf,
          analysedAt: new Date().toISOString(),
        })
      }
      setOpen({ moves, colour: colour === 'w' ? 'white' : 'black', acpl: avg, perf })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setSwapping(false)
      setProgress(null)
    }
  }, [])

  const swapSide = useCallback(() => {
    if (!current || !open) return
    void review(current, open.colour === 'white' ? 'b' : 'w')
  }, [current, open, review])

  return { busy, error, open, progress, review, swapSide, swapping, close: () => setOpen(null) }
}

export function History() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const gr = useGameReview()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [profile, games, attempts, weaknesses, patterns, trends, mistakeCount] =
          await Promise.all([
            getProfile(),
            db.games.orderBy('playedAt').reverse().limit(20).toArray(),
            db.puzzleAttempts.orderBy('at').reverse().limit(60).toArray(),
            computeWeaknesses(6),
            detectPatterns(),
            categoryTrends(),
            db.mistakes.count(),
          ])
        if (cancelled) return
        setSnap({
          rating: profile.rating,
          streak: profile.streak,
          games,
          attempts,
          weaknesses,
          patterns,
          trends,
          verdict: balanceVerdict(trends),
          mistakeCount,
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="card small" style={{ borderColor: 'var(--danger)' }}>
        <strong>Could not read your history.</strong> {error}
      </div>
    )
  }

  if (!snap) {
    return (
      <div className="card">
        <div className="status">
          <span className="dot thinking" />
          <span className="small muted">reading your history…</span>
        </div>
      </div>
    )
  }

  const { games, attempts, weaknesses } = snap
  const solved = attempts.filter((a) => a.correct).length
  const analysed = games.filter((g) => g.acpl !== null)
  const avgAcpl =
    analysed.length > 0
      ? Math.round(analysed.reduce((s, g) => s + (g.acpl ?? 0), 0) / analysed.length)
      : null

  const nothingYet = games.length === 0 && attempts.length === 0

  // The review owns the screen, same as it does after a live game.
  if (gr.open) {
    return (
      <GameReview
        moves={gr.open.moves}
        colour={gr.open.colour}
        acpl={gr.open.acpl}
        perf={gr.open.perf}
        onClose={gr.close}
        onSwapSide={gr.swapSide}
        swapping={gr.swapping}
      />
    )
  }

  return (
    <div className="stack">
      <div className="card hero-strip">
        <div className="hgrid">
          <div>
            <div className="small muted">Rating</div>
            <div className="stat">{snap.rating}</div>
          </div>
          <div>
            <div className="small muted">Games</div>
            <div className="stat">{games.length}</div>
          </div>
          <div>
            <div className="small muted">Puzzles</div>
            <div className="stat">
              {solved}
              <span className="small muted" style={{ fontWeight: 400 }}>
                /{attempts.length}
              </span>
            </div>
          </div>
          <div>
            <div className="small muted">Accuracy</div>
            <div className="stat">{avgAcpl === null ? '—' : avgAcpl}</div>
          </div>
        </div>
        {avgAcpl !== null && (
          <div className="small muted" style={{ marginTop: 8 }}>
            Accuracy is centipawns lost per move — lower is better. Under 50 is strong club play.
          </div>
        )}
      </div>

      {nothingYet && (
        <div className="card">
          <strong>Nothing recorded yet.</strong>{' '}
          <span className="muted">
            Play a game or solve some puzzles and everything shows up here — every move, every
            mistake, and what it cost you.
          </span>
        </div>
      )}

      {/* ------------------------------------------ gaining vs slipping */}
      {/* Shown as soon as there is a verdict, not only once a category has
          data. On day one every category is untested and the verdict is
          "breadth first" — which is exactly the advice worth reading, and
          gating on data would hide it precisely when it applies. */}
      {(snap.verdict !== null || snap.trends.some((t) => t.state !== 'untested')) && (
        <div className="card stack">
          <span className="small muted">Where you're gaining, and what's slipping</span>
          {snap.verdict && <div className="small">{snap.verdict}</div>}

          {/*
            Untried categories get one chip each, not a full row.

            On day one all eight are untested, so this list was eight tall rows
            whose every line read "never tried" and whose every pill read
            UNTRIED — a screen taking eight scrolls to say one thing. A
            category with no data has nothing to show but its name, so its name
            is all it gets. The rows below are for the ones with a trend to
            report.
          */}
          {snap.trends.some((t) => t.state === 'untested') && (
            <div className="chips">
              {snap.trends
                .filter((t) => t.state === 'untested')
                .map((t) => (
                  <span key={t.category.id} className="cat-chip">
                    {t.category.name}
                  </span>
                ))}
            </div>
          )}

          {snap.trends
            .filter((t) => t.state !== 'untested')
            .map((t) => (
              <div key={t.category.id} className="row spread hist-row">
                <span style={{ flex: 1 }}>
                  <strong>{t.category.name}</strong>
                  <div className="small muted">
                    {t.recent === 0
                      ? `nothing for ${t.daysSince} days`
                      : `${t.recentAccuracy}% of ${t.recent} recently` +
                        (t.priorAccuracy !== null ? `, was ${t.priorAccuracy}%` : '')}
                  </div>
                </span>
                <span className={'pill ' + TREND_PILL[t.state]}>
                  {t.state === 'gaining' && t.delta !== null
                    ? `+${t.delta}`
                    : t.state === 'slipping' && t.delta !== null
                      ? `${t.delta}`
                      : TREND_WORD[t.state]}
                </span>
              </div>
            ))}
          <div className="small muted">
            Two windows: the last fortnight against the month before it. A category you have not
            touched in three weeks counts as slipping even without a wrong answer — that is how
            skills actually decay. Anything marked "new" does not have enough attempts to call
            yet.
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ patterns */}
      {snap.patterns.length > 0 && (
        <div className="card stack">
          <span className="small muted">What I'm seeing across your games</span>
          {snap.patterns.map((p) => (
            <div key={p.title} className="pattern">
              <div className="row spread">
                <strong>{p.title}</strong>
                {p.confidence === 'low' && <span className="pill draw">early</span>}
              </div>
              <div className="small muted">{p.detail}</div>
              <div className="small" style={{ marginTop: 4 }}>
                {p.action}
              </div>
            </div>
          ))}
          <div className="small muted">
            Anything marked "early" is based on a small sample — treat it as a hint, not a
            diagnosis. It firms up as you play.
          </div>
        </div>
      )}

      {/* --------------------------------------------- what you keep missing */}
      {weaknesses.length > 0 && (
        <div className="card stack">
          <div className="row spread">
            <span className="small muted">What you keep missing</span>
            <span className="small muted">{snap.mistakeCount} logged</span>
          </div>
          {weaknesses.map((w) => {
            const max = weaknesses[0]!.score || 1
            return (
              <div key={w.tag} className="weak">
                <div className="row spread">
                  <span>{w.label}</span>
                  <span className="small muted">
                    {w.count}× · {Math.round(w.totalLossCp / 100)} pawns
                  </span>
                </div>
                <div className="meter">
                  <i style={{ width: `${Math.max(6, (w.score / max) * 100)}%` }} />
                </div>
              </div>
            )
          })}
          <div className="small muted">
            Ranked by what it costs you, not how often it happens — two dropped rooks outrank ten
            small slips. Recent mistakes count for more.
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- games */}
      {games.length > 0 && (
        <div className="card stack">
          <span className="small muted">Games</span>
          {gr.error && (
            <div className="small" style={{ color: 'var(--danger)' }}>
              Review failed: {gr.error}
            </div>
          )}
          {games.map((g) => (
            <div key={g.id} className="row spread hist-row">
              <span className={'pill ' + g.result}>{g.result}</span>
              <span className="small" style={{ flex: 1 }}>
                vs {g.opponentStyle} {g.opponentElo} as {g.humanColour === 'w' ? 'white' : 'black'}
                <span className="muted"> · {when(g.playedAt)}</span>
              </span>
              {gr.busy === g.id ? (
                <span className="small muted">
                  reviewing{gr.progress ? ` ${gr.progress.done}/${gr.progress.total}` : '…'}
                </span>
              ) : (
                <button
                  className="chip"
                  disabled={gr.busy !== null}
                  onClick={() => void gr.review(g)}
                >
                  {g.acpl === null ? 'Review' : `${g.acpl} acpl`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* --------------------------------------------------------- puzzles */}
      {attempts.length > 0 && (
        <div className="card stack">
          <div className="row spread">
            <span className="small muted">Puzzles</span>
            <span className="small muted">
              {Math.round((solved / attempts.length) * 100)}% solved
            </span>
          </div>
          <div className="dots">
            {attempts
              .slice()
              .reverse()
              .map((a) => (
                <span
                  key={a.id}
                  className={'pdot ' + (a.correct ? 'ok' : 'bad')}
                  title={`${a.correct ? 'solved' : 'missed'} · rated ${a.rating} · ${a.themes}`}
                />
              ))}
          </div>
          <div className="small muted">Oldest on the left. Green solved, red missed.</div>
        </div>
      )}
    </div>
  )
}
