/**
 * The daily screen. The only thing you see when you open the app.
 *
 * One session, already decided. No menu, no library, no "what shall I study
 * today" — that decision is the thing most training apps quietly outsource
 * back to the user, and it's why they go unused.
 */

import { useEffect, useState } from 'react'
import { buildDailySession, type DailySession } from '../../coach/session'
import { pickLesson, type Lesson } from '../../content/lessons'
import { tierStatuses, type TierStatus } from '../../coach/profile'
import { PILLARS } from '../../coach/tiers'
import { categoriesIn } from '../../coach/categories'
import type { Style } from '../../engine/types'

export interface DailyProps {
  onStartGame: (elo: number, style: Style, colour: 'white' | 'black') => void
  onStartPuzzles: (session: DailySession) => void
}

export function Daily({ onStartGame, onStartPuzzles }: DailyProps) {
  const [session, setSession] = useState<DailySession | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [tiers, setTiers] = useState<TierStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lessonOpen, setLessonOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await buildDailySession()
        if (cancelled) return
        setSession(s)
        setLesson(pickLesson(s.rating, s.focus?.themes ?? []))
        const t = await tierStatuses(s.rating)
        if (!cancelled) setTiers(t)
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
        <strong>Could not build today's session.</strong> {error}
      </div>
    )
  }

  if (!session) {
    return (
      <div className="card">
        <div className="status">
          <span className="dot thinking" />
          <span className="small muted">building today's session…</span>
        </div>
      </div>
    )
  }

  const inBand = tiers.filter((t) => t.inBand)
  const clearedCount = tiers.filter((t) => t.cleared).length

  return (
    <div className="stack">
      {/* ---------------------------------------------------- header */}
      {/*
        The hero, not a card. It used to be the same brown rectangle as the six
        below it, which meant the one number the whole app is about had exactly
        the same visual weight as a paragraph of copy — the "flat" complaint in
        one element.
      */}
      <div className="card hero-strip row spread">
        <div>
          <div className="small muted">Your rating</div>
          <div className="stat">{session.rating}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="small muted">Streak</div>
          <div className="stat">
            {session.streak}
            <span className="small muted" style={{ fontWeight: 400 }}>
              {' '}
              day{session.streak === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------- focus */}
      {session.coldStart ? (
        <div className="card">
          <div className="small muted" style={{ marginBottom: 4 }}>
            Today
          </div>
          <div>
            Play a few games first. Once there are three to look at, this screen starts
            targeting what you actually get wrong.
          </div>
        </div>
      ) : (
        session.focus && (
          <div className="card focus">
            <div className="small muted" style={{ marginBottom: 4 }}>
              Today is about
            </div>
            <div className="focus-title">{session.focus.label}</div>
            <div className="small muted">{session.focus.why}</div>
          </div>
        )
      )}

      {/* ---------------------------------------------------- lesson */}
      {lesson && (
        <div className="card lesson">
          <button
            className="lesson-head"
            onClick={() => setLessonOpen(!lessonOpen)}
            aria-expanded={lessonOpen}
          >
            <span>
              <span className="small muted">Idea</span>
              <span className="lesson-title">{lesson.title}</span>
              <span className="small muted">{lesson.hook}</span>
            </span>
            <span className="chev" aria-hidden="true">
              {lessonOpen ? '−' : '+'}
            </span>
          </button>
          {lessonOpen && (
            <div className="lesson-body">
              <p>{lesson.body}</p>
              <p className="small">
                <strong>Try this.</strong> {lesson.practice}
              </p>
              <p className="small muted source">{lesson.source}</p>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------- session */}
      <div className="card stack">
        <div className="small muted">Today's session — about 15 minutes</div>

        <div className="step">
          <span className="step-n">1</span>
          <div style={{ flex: 1 }}>
            <div>
              <strong>One game</strong> as {session.game.colour} vs {session.game.style} bot{' '}
              {session.game.elo}
            </div>
            <div className="small muted">{session.game.why}</div>
          </div>
        </div>

        <div className="step">
          <span className="step-n">2</span>
          <div style={{ flex: 1 }}>
            <div>
              <strong>{session.puzzles.length} puzzles</strong>
              {session.focus ? ' aimed at that leak' : ' from your current tier'}
              <span className="muted"> — three tries each</span>
            </div>
            <div className="small muted">
              {session.puzzles.length > 0
                ? `rated ${Math.min(...session.puzzles.map((p) => p.rating))}–${Math.max(
                    ...session.puzzles.map((p) => p.rating),
                  )}`
                : 'no puzzles available'}
            </div>
            {/* What today actually teaches. Naming the categories up front is
                the difference between "eight puzzles" and knowing which two
                skills the next fifteen minutes are about. */}
            {session.puzzles.length > 0 && (
              <div className="chips" style={{ marginTop: 6 }}>
                {categoriesIn(session.puzzles.map((p) => p.themes)).map((c) => (
                  <span key={c.id} className="pill draw" title={c.teaches}>
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {session.drill && (
          <div className="step">
            <span className="step-n">3</span>
            <div style={{ flex: 1 }}>
              <div>
                <strong>{session.drill.name}</strong>
              </div>
              <div className="small muted">{session.drill.blurb}</div>
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button
            className="primary"
            style={{ flex: 1 }}
            onClick={() => onStartGame(session.game.elo, session.game.style, session.game.colour)}
          >
            Start session
          </button>
          <button
            style={{ flex: 0.6 }}
            disabled={session.puzzles.length === 0}
            onClick={() => onStartPuzzles(session)}
          >
            Puzzles only
          </button>
        </div>
      </div>

      {/* ----------------------------------------------------- tiers */}
      <div className="card stack">
        <div className="row spread">
          <span className="small muted">The wall</span>
          <span className="small muted">
            {clearedCount} / {tiers.length} cleared
          </span>
        </div>
        {PILLARS.map((p) => {
          const mine = inBand.filter((t) => t.tier.pillar === p.id)
          if (mine.length === 0) return null
          return (
            /* Per-pillar tone, the same five colours the Learn cards use, so a
               colour means the same thing wherever you meet it. Without this
               the wall was five identical blocks of grey bricks and the only
               thing separating Tactics from Endgames was the word. */
            <div key={p.id} className={`wall-row tone-${p.id}`}>
              <div className="small" style={{ marginBottom: 4 }}>
                {p.name} <span className="muted">— {p.blurb}</span>
              </div>
              <div className="bricks">
                {mine.map((t) => (
                  <div
                    key={t.tier.id}
                    className={'brick' + (t.cleared ? ' done' : '')}
                    title={`${t.tier.name} — ${t.solved}/${t.tier.clear.solved}`}
                  >
                    <i style={{ width: `${Math.round(t.progress * 100)}%` }} />
                    <span>{t.tier.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
