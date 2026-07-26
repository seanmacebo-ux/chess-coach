/**
 * Learn — the whole map, in one place.
 *
 * Every pillar, every tier, every way of training, and every concept card,
 * with your position on each. Deliberately shows modes that are NOT built yet,
 * marked as such: hiding them makes the app look smaller than the plan and
 * leaves Sean unable to see what's coming. An honest "not yet" beats an
 * invisible roadmap.
 */

import { useEffect, useState } from 'react'
import { PILLARS, tiersFor, type Pillar } from '../../coach/tiers'
import { tierStatuses, type TierStatus } from '../../coach/profile'
import { getProfile } from '../../data/db'
import { LESSONS, lessonsAtRating, type Lesson } from '../../content/lessons'

interface Mode {
  name: string
  what: string
  status: 'live' | 'soon'
}

/**
 * Every way the app can train you. `soon` entries are real planned work, not
 * aspiration — each one has a line in BACKLOG.md.
 */
const MODES: Mode[] = [
  { name: 'Play a game', what: 'Full game against a bot at your rating, in a style you choose.', status: 'live' },
  { name: 'Solve tactics', what: 'Find the winning move. 28,800 puzzles, sorted by idea and difficulty.', status: 'live' },
  { name: 'Daily session', what: 'One game, three puzzles, one drill — picked for you from your own mistakes.', status: 'live' },
  { name: 'Game review', what: 'Every move scored after you play, with the reason each mistake was a mistake.', status: 'live' },
  { name: 'Spot the loose piece', what: 'Which of your pieces is attacked and undefended? The root cause of most losses.', status: 'soon' },
  { name: 'Read the threat', what: 'If you passed right now, what would they play? Trains seeing their plan.', status: 'soon' },
  { name: 'Endgame play-out', what: 'Convert or hold it against the engine. The only way Lucena can actually be learned.', status: 'soon' },
  { name: 'Blunder check', what: 'Commit a move, get asked "anything hanging?" before it plays. Training wheels for real games.', status: 'soon' },
  { name: 'Candidate moves', what: 'Name your options before calculating. Scored on whether you SAW the right move.', status: 'soon' },
  { name: 'Read the position', what: 'Not a move — which imbalances favour whom. Space, structure, piece quality.', status: 'soon' },
  { name: 'Simulate a plan', what: 'Play your idea out 20 times and see what usually happens.', status: 'soon' },
  { name: 'Master games', what: 'One classic a week, cut into decision points. Guess the move before it is revealed.', status: 'soon' },
]

export function Learn() {
  const [rating, setRating] = useState(1400)
  const [statuses, setStatuses] = useState<TierStatus[]>([])
  const [open, setOpen] = useState<Pillar | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await getProfile()
      const s = await tierStatuses(p.rating)
      if (cancelled) return
      setRating(p.rating)
      setStatuses(s)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const byId = new Map(statuses.map((s) => [s.tier.id, s]))
  const yourLessons = lessonsAtRating(rating)

  return (
    <div className="stack">
      <div className="card">
        <div className="small muted">Everything the app can teach you</div>
        <div className="small" style={{ marginTop: 6 }}>
          {PILLARS.length} areas · {statuses.length} levels · {LESSONS.length} ideas ·{' '}
          {MODES.filter((m) => m.status === 'live').length} of {MODES.length} training modes live.
          At <strong>{rating}</strong> you can work on{' '}
          <strong>{statuses.filter((s) => s.inBand && !s.cleared).length}</strong> levels right now.
        </div>
      </div>

      {/* -------------------------------------------------- the pillars */}
      {PILLARS.map((p) => {
        const tiers = tiersFor(p.id)
        const mine = tiers.filter((t) => byId.get(t.id)?.inBand)
        const isOpen = open === p.id
        return (
          <div key={p.id} className="card stack">
            <button
              className="lesson-head"
              style={{ margin: 0, padding: 0, width: '100%' }}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : p.id)}
            >
              <span>
                <span className="lesson-title">{p.name}</span>
                <span className="small muted">
                  {p.blurb} — {mine.length} at your level, {tiers.length} total
                </span>
              </span>
              <span className="chev" aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </button>

            {isOpen && (
              <div className="stack">
                {tiers.map((t) => {
                  const s = byId.get(t.id)
                  const state = s?.cleared
                    ? 'done'
                    : s?.inBand
                      ? 'now'
                      : t.band[0] > rating
                        ? 'later'
                        : 'past'
                  return (
                    <div key={t.id} className={'lvl ' + state}>
                      <div className="row spread">
                        <span>
                          <strong>{t.name}</strong>{' '}
                          <span className="small muted">
                            {t.band[0]}–{t.band[1]}
                          </span>
                        </span>
                        <span className="small muted">
                          {state === 'done'
                            ? 'cleared'
                            : state === 'now'
                              ? `${s?.solved ?? 0}/${t.clear.solved}`
                              : state === 'later'
                                ? 'locked'
                                : 'below you'}
                        </span>
                      </div>
                      <div className="small muted">{t.blurb}</div>
                      {t.kind !== 'puzzle' && (
                        <div className="small" style={{ color: 'var(--warn)' }}>
                          Needs {t.kind === 'playout' ? 'play-out' : 'quiz'} mode — not built yet
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* ---------------------------------------------------- the modes */}
      <div className="card stack">
        <span className="small muted">Ways to train</span>
        {MODES.map((m) => (
          <div key={m.name} className="row spread hist-row">
            <span style={{ flex: 1 }}>
              <strong>{m.name}</strong>
              <div className="small muted">{m.what}</div>
            </span>
            <span className={'pill ' + (m.status === 'live' ? 'win' : 'draw')}>
              {m.status === 'live' ? 'live' : 'soon'}
            </span>
          </div>
        ))}
      </div>

      {/* -------------------------------------------------- the ideas */}
      <div className="card stack">
        <div className="row spread">
          <span className="small muted">Ideas at your level</span>
          <span className="small muted">
            {yourLessons.length} of {LESSONS.length}
          </span>
        </div>
        {yourLessons.map((l) => (
          <div key={l.id}>
            <button
              className="lesson-head"
              style={{ margin: 0, padding: '8px 0', width: '100%' }}
              aria-expanded={lesson?.id === l.id}
              onClick={() => setLesson(lesson?.id === l.id ? null : l)}
            >
              <span>
                <span style={{ fontWeight: 600 }}>{l.title}</span>
                <span className="small muted">{l.hook}</span>
              </span>
              <span className="chev" aria-hidden="true">
                {lesson?.id === l.id ? '−' : '+'}
              </span>
            </button>
            {lesson?.id === l.id && (
              <div className="lesson-body" style={{ padding: '0 0 12px' }}>
                <p>{l.body}</p>
                <p className="small">
                  <strong>Try this.</strong> {l.practice}
                </p>
                <p className="small muted source">{l.source}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
