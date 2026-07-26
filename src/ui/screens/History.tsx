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

import { useEffect, useState } from 'react'
import { db, getProfile, type GameRow, type PuzzleAttemptRow } from '../../data/db'
import { computeWeaknesses, detectPatterns, type Pattern, type Weakness } from '../../coach/profile'

interface Snapshot {
  rating: number
  streak: number
  games: GameRow[]
  attempts: PuzzleAttemptRow[]
  weaknesses: Weakness[]
  patterns: Pattern[]
  mistakeCount: number
}

function when(iso: string): string {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return d.toISOString().slice(0, 10)
}

export function History() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [profile, games, attempts, weaknesses, patterns, mistakeCount] = await Promise.all([
          getProfile(),
          db.games.orderBy('playedAt').reverse().limit(20).toArray(),
          db.puzzleAttempts.orderBy('at').reverse().limit(60).toArray(),
          computeWeaknesses(6),
          detectPatterns(),
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

  return (
    <div className="stack">
      <div className="card">
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
          {games.map((g) => (
            <div key={g.id} className="row spread hist-row">
              <span className={'pill ' + g.result}>{g.result}</span>
              <span className="small" style={{ flex: 1 }}>
                vs {g.opponentStyle} {g.opponentElo} as {g.humanColour === 'w' ? 'white' : 'black'}
              </span>
              <span className="small muted">
                {g.acpl === null ? 'not reviewed' : `${g.acpl} acpl`}
              </span>
              <span className="small muted">{when(g.playedAt)}</span>
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
