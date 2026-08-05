/**
 * The odds, as a bar.
 *
 * WHY NOT CENTIPAWNS. "+3.2" is the engine's unit and it means nothing to
 * anybody who has not been trained to read it. Nobody has an intuition for
 * whether +0.8 is worth worrying about, and the same number means completely
 * different things at move 8 and move 48. A percentage is the question people
 * actually ask — "am I winning?" — and it compresses the extremes correctly:
 * the difference between +9 and +12 is nothing, and the difference between 0
 * and +1 is enormous.
 *
 * THE CURVE. Win probability from centipawns uses the logistic fit Lichess
 * derived from millions of real games:
 *
 *     win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 *
 * It is an empirical fit rather than a theorem — it says "players in this
 * position, at this evaluation, went on to win this often". That is the honest
 * meaning of the number and it is why the label says "odds" rather than
 * anything more certain.
 *
 * A caveat worth stating in the code: this curve was fitted on strong human
 * games. At 316 the real odds of converting +3 are considerably worse than it
 * suggests, because converting requires technique the curve assumes you have.
 * It is still the right shape for comparing two moves in the same position,
 * which is all this is used for.
 */

/** Lichess's fitted constant. */
const K = 0.00368208

/** Centipawns from the mover's point of view → their winning chances, 0-100. */
export function winChance(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp))
  return 50 + 50 * (2 / (1 + Math.exp(-K * clamped)) - 1)
}

export interface EvalMeterProps {
  /** Centipawns, from the point of view of the side named by `who`. */
  cp: number
  /** Whose chances the bar is showing. */
  who?: string
  /** A second value to compare against, drawn as a ghost marker. */
  compareCp?: number | undefined
  /** Tone for the fill. */
  tone?: 'good' | 'warn' | 'danger'
  label?: string | undefined
}

export function EvalMeter({ cp, who = 'you', compareCp, tone = 'good', label }: EvalMeterProps) {
  const pct = winChance(cp)
  const comparePct = compareCp === undefined ? null : winChance(compareCp)

  return (
    <div className="meter">
      <div className="meter-top">
        <span className="meter-label">{label ?? `Odds for ${who}`}</span>
        <span className="meter-pct">{Math.round(pct)}%</span>
      </div>
      <div className={`meter-track ${tone}`}>
        <span className="meter-fill" style={{ width: `${pct}%` }} />
        {/*
          The comparison is a marker rather than a second bar. Two bars invite
          you to read them as separate facts; one bar with a line on it reads as
          "here is where you are, and here is where you could have been", which
          is the actual relationship.
        */}
        {comparePct !== null && (
          <span
            className="meter-mark"
            style={{ left: `${comparePct}%` }}
            title={`${Math.round(comparePct)}% with the better move`}
          />
        )}
      </div>
    </div>
  )
}

/**
 * How the odds moved, in words.
 *
 * Shown next to the bar because a percentage still needs a verdict attached:
 * 38% is a normal middlegame and 38% after being 71% a move ago is the story.
 */
export function oddsSwing(fromCp: number, toCp: number): string {
  const from = winChance(fromCp)
  const to = winChance(toCp)
  const drop = Math.round(from - to)
  if (drop <= 2) return 'No real change in your chances.'
  if (drop < 10) return `Your chances slipped ${drop} points.`
  if (drop < 25) return `Your chances dropped ${drop} points — that is a real concession.`
  return `Your chances collapsed ${drop} points. This is the move that decided it.`
}
