/**
 * The wall: every level in a section, where you are on it, and what is left.
 *
 * RECONSTRUCTED — see coach/rating.ts for why these files had to be rebuilt.
 *
 * A primary element of a section page rather than a footnote under the drills,
 * because it is the answer to "what have I done and what is left". State is
 * carried on a left edge so the whole ladder reads as one vertical scan rather
 * than fifteen separate boxes competing for attention.
 *
 * Everything at or below your level is shown, and so is everything above it,
 * marked. Hiding cleared material makes the ladder feel shorter than it is and
 * removes the thing you go back to when a weakness resurfaces; hiding what is
 * coming removes half of why a ladder works at all.
 */

import type { TierStatus } from '../../coach/profile'
import type { Tier } from '../../coach/tiers'

export interface LadderProps {
  tiers: Tier[]
  byId: Map<string, TierStatus>
  rating: number
}

export function Ladder({ tiers, byId, rating }: LadderProps) {
  const cleared = tiers.filter((t) => byId.get(t.id)?.cleared).length

  return (
    <div className="wall">
      <div className="wall-head">
        <span className="wall-title">The ladder</span>
        <span className="wall-count">
          {cleared} of {tiers.length} cleared
        </span>
      </div>

      {/*
        The rules, stated where the levels live. Sean asked "how do I move on"
        — which means every number below was showing without saying what makes
        it move. Three sentences, because there are exactly three mechanics:
        clearing (solving), unlocking (rating), and rating (games).
      */}
      <p className="wall-how small muted">
        Solve a level's puzzles to clear it — each shows its target, like "15 at 90%". Levels above
        you unlock when your <b>rating</b> reaches their number, and your rating moves by playing
        games — the bots here, or your imported chess.com games. Train to clear, play to unlock.
      </p>

      <div className="wall-rows">
        {tiers.map((t) => {
          const s = byId.get(t.id)
          const state = s?.cleared
            ? 'done'
            : s?.inBand
              ? 'now'
              : t.band[0] > rating
                ? 'later'
                : 'past'
          const solved = s?.solved ?? 0

          return (
            <div key={t.id} className={`wall-row ${state}`}>
              <div className="wall-row-top">
                <span className="wall-name">{t.name}</span>
                <span className="wall-state">
                  {state === 'done'
                    ? 'cleared'
                    : state === 'now'
                      ? `${solved}/${t.clear.solved} at ${Math.round(t.clear.accuracy * 100)}%`
                      : state === 'later'
                        ? `unlocks at ${t.band[0]}`
                        : 'revisit any time'}
                </span>
              </div>
              <div className="wall-blurb">{t.blurb}</div>
              {state === 'now' && (
                <div className="wall-prog">
                  <span
                    className="wall-prog-fill"
                    style={{ width: `${Math.min(100, (solved / t.clear.solved) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
