/**
 * Grading your move while the game is still going.
 *
 * The post-game pass costs two engine searches per move — the position before,
 * and the position after. Doing both live would put a search between your move
 * and the opponent's reply on a single-threaded engine the opponent is already
 * queued behind, and the game would stutter on every move.
 *
 * So the first search is moved into time that is currently wasted. While you
 * sit there thinking, the engine is idle; a wide multipv search of the position
 * in FRONT of you costs nothing and already contains the evaluation of your
 * move, provided your move is one the engine considered. That covers the
 * ordinary case with no added latency at all.
 *
 * WHEN YOUR MOVE IS NOT IN THE SHORTLIST, IT IS GRADED WITH A SECOND SEARCH.
 * The first version of this file tried to avoid that by reporting a bound —
 * every shortlisted move beat yours, so the loss is at least the gap to the
 * worst of them. That is true, and it was useless. The engine's twelve best
 * moves in a quiet position are all within about 30cp of each other, so the
 * bound came out around 30 and the app graded a hung bishop "Good move." A
 * number that is honest about its own imprecision is still a lie if the label
 * on it is wrong.
 *
 * The second search is the right trade precisely because it is rare. It only
 * fires when you played something outside the engine's top twelve — which is
 * to say, when the move was bad and the coach has something worth saying. A
 * beat of delay before the reply is a reasonable price for the one verdict in
 * the game you actually needed.
 *
 * The post-game review remains the authority for the ACPL number, but the two
 * share a severity scale (see `severityOf`) so they cannot contradict each
 * other's labels.
 */

import { Chess } from 'chess.js'

import { clampEval, explainWrongMove, severityOf, type Severity } from './analysis'
import { lineScore, type Analysis, type Line, type UciMove } from '../engine/types'

export interface LiveGrade {
  severity: Severity
  /** Centipawns given up, measured. */
  lossCp: number
  /** True when it took a second search — i.e. the move was off the shortlist. */
  neededSearch: boolean
  /** What the engine wanted, when it is worth showing. */
  bestSan: string | null
  bestUci: UciMove | null
  /** Board-level reason, engine-free. Null when nothing concrete can be said. */
  reason: string | null
}

export interface Shortlist {
  /** Best available evaluation, from the point of view of the side to move. */
  best: number
  /**
   * Evaluation of the move actually played, or null when it was outside the
   * engine's lines and a second search is needed to score it.
   */
  playedScore: number | null
  bestUci: UciMove | null
  bestSan: string | null
}

/**
 * Read what the idle-window search says about the move just played.
 *
 * `lines` must come from analysing `fenBefore`, so every score is already from
 * the point of view of the side about to move — you. That is what makes the
 * subtraction meaningful without a sign flip; scoring from the position AFTER
 * the move instead is the trap that reports every move as brilliant.
 */
export function readShortlist(
  fenBefore: string,
  playedUci: UciMove,
  lines: Line[],
): Shortlist | null {
  const usable = lines.filter((l) => l.pv.length > 0)
  if (usable.length === 0) return null

  const scores = usable.map((l) => clampEval(lineScore(l)))
  const best = Math.max(...scores)
  const playedIndex = usable.findIndex((l) => l.pv[0] === playedUci)

  const bestUci = (usable[scores.indexOf(best)]?.pv[0] as UciMove | undefined) ?? null
  let bestSan: string | null = null
  if (bestUci && bestUci !== playedUci) {
    const probe = new Chess(fenBefore)
    try {
      bestSan =
        probe.move({
          from: bestUci.slice(0, 2),
          to: bestUci.slice(2, 4),
          promotion: bestUci[4],
        })?.san ?? null
    } catch {
      bestSan = null
    }
  }

  return {
    best,
    playedScore: playedIndex >= 0 ? scores[playedIndex]! : null,
    bestUci,
    bestSan,
  }
}

/**
 * Score the position after an off-shortlist move.
 *
 * The negation is the same one `analyseGame` does and for the same reason: UCI
 * reports from the side to move, and after your move that is your opponent.
 * Forgetting it turns every blunder into a brilliancy.
 */
export function scoreAfterMove(after: Analysis): number | null {
  const line = after.lines[0]
  return line ? clampEval(-lineScore(line)) : null
}

/** Assemble the verdict once both evaluations are in hand. */
export function buildGrade(
  fenBefore: string,
  playedUci: UciMove,
  shortlist: Shortlist,
  playedScore: number,
  neededSearch: boolean,
): LiveGrade {
  const lossCp = Math.max(0, Math.round(shortlist.best - playedScore))
  const severity = severityOf(lossCp)
  return {
    severity,
    lossCp,
    neededSearch,
    bestSan: shortlist.bestSan,
    bestUci: shortlist.bestUci,
    // Free — this never touches the engine — but only meaningful when
    // something went wrong.
    reason:
      severity === 'best' || severity === 'good' ? null : explainWrongMove(fenBefore, playedUci),
  }
}

/**
 * The grade, in words.
 *
 * Kept out of the component so it can be asserted directly. The engine's
 * preferred move is shown only when yours was actually a mistake: after a good
 * move there is nothing to learn from it, and showing it every time turns a
 * coach into a backseat driver.
 */
export function describeGrade(grade: LiveGrade): string {
  const cost = `${grade.lossCp}cp`
  switch (grade.severity) {
    case 'best':
      return 'Best move.'
    case 'good':
      return 'Good move.'
    case 'inaccuracy':
      return `Slightly loose — ${cost}.`
    case 'mistake':
      return grade.bestSan
        ? `Mistake — ${cost}. ${grade.bestSan} was the move.`
        : `Mistake — ${cost}.`
    case 'blunder':
      return grade.bestSan
        ? `Blunder — ${cost}. ${grade.bestSan} was the move.`
        : `Blunder — ${cost}.`
  }
}

/** Severity to a CSS custom property, so the colour and the label never drift. */
export function gradeColour(severity: Severity): string {
  switch (severity) {
    case 'best':
    case 'good':
      return 'var(--accent)'
    case 'inaccuracy':
      return 'var(--warn)'
    case 'mistake':
    case 'blunder':
      return 'var(--danger)'
  }
}
