/**
 * The bots learning to be honest about their rating.
 *
 * WHAT WAS ALREADY KNOWN. `scripts/calibrate.ts` exists to answer one
 * question — does a bot labelled 1400 actually shed centipawns like a 1400?
 * It was run on 2026-07-26 and the answer was no, at every single band:
 *
 *     band   target ACPL   measured   ratio
 *      800       150          70.4     0.47
 *     1000       120          90.5     0.75
 *     1200        95          59.9     0.63
 *     1400        75          42.8     0.57
 *     1600        60          33.2     0.55
 *     1800        48          31.9     0.66
 *     2000        38          17.6     0.46
 *     2200        30          12.8     0.43
 *
 * Every bot plays stronger than its label. That report was written to
 * calibration/ and never acted on, because the harness is deliberately
 * report-only: "a handful of games is noise, and silently auto-tuning
 * strength from noise is exactly the failure mode worth avoiding."
 *
 * WHY THIS FILE EXISTS. That harness measures bots against other bots, in a
 * script somebody has to remember to run. Nothing in the app has ever
 * measured anything about itself. So the labels stay wrong, and every number
 * downstream inherits the error: if "Bud 350" really plays like 900, then a
 * rating earned against it is not a rating, and the improvement tracking on
 * the Learn screen is measuring against a moving stick.
 *
 * This module closes that loop using games actually played, and it costs
 * nothing extra to run. See `botLosses` — the numbers were already computed
 * and thrown away.
 *
 * THE ONE RULE THIS MUST NOT BREAK. calibrate.ts states it: the bots
 * learning to be honest is deliberately separate from the app learning you,
 * "because a bot that gets easier when you lose destroys the training value
 * of the whole app." So nothing here reads the RESULT of a game. It reads
 * only the bot's own move quality against a deeper search. Lose ten in a row
 * and this changes nothing; the bots move only toward their stated label,
 * never toward your comfort.
 *
 * It is also deliberately slow to act: no correction at all until a band has
 * a real sample, the correction is bounded, and it moves by exponential
 * average rather than jumping to the latest reading.
 */

import { BANDS, nearestBand, type Band } from './types'
import type { MoveAssessment } from '../coach/analysis'

const KEY = 'cc.calib'

/** Below this many observed bot moves in a band, report but never correct. */
export const MIN_MOVES = 60

/** How far a correction may ever move a band, in either direction. */
const MAX_FACTOR = 2.5
const MIN_FACTOR = 0.6

/** Weight of the newest game against everything before it. */
const EMA = 0.25

/**
 * A single ply's loss above this is treated as noise rather than signal.
 * Mate scores and search instability produce huge one-off swings that would
 * otherwise dominate an average built from a few hundred moves.
 */
const LOSS_CAP = 600

export interface BandObservation {
  moves: number
  sumLoss: number
  games: number
  /** Learned multiplier on the band's temperature. 1 = untouched. */
  factor: number
}

export type Calibration = Partial<Record<Band, BandObservation>>

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Calibration
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function save(c: Calibration): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage blocked — calibration just will not accumulate */
  }
}

/**
 * The bot's centipawn losses in a game, derived from the analysis that was
 * already run on YOUR moves. No extra searches.
 *
 * The trick is that consecutive assessments bracket the bot's reply.
 * `cpPlayed` on your move at ply p is the engine's valuation, from your point
 * of view, of the position where the bot is to move — and that valuation
 * already assumes the bot answers with its best move. `cpBest` on your next
 * assessment is the valuation of the position the bot actually left you.
 *
 * If the bot played its best move those two numbers agree (minimax: a node's
 * value is the value of its best child). If the bot erred, the position it
 * left you is better for you than the parent said it would be, and the
 * difference IS the bot's loss.
 *
 *     botLoss = cpBest(next) - cpPlayed(this)
 *
 * Both sides are already from your point of view, so no sign flip. Pairs are
 * only used when the plies are exactly two apart — anything else means the
 * game ended or a move is missing from the assessments.
 */
export function botLosses(assessments: MoveAssessment[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < assessments.length; i++) {
    const here = assessments[i]!
    const next = assessments[i + 1]!
    if (next.ply !== here.ply + 2) continue
    const loss = next.cpBest - here.cpPlayed
    // Negative means the search disagreed with itself across depths rather
    // than the bot finding something better than best play — floor at zero.
    if (!Number.isFinite(loss)) continue
    out.push(Math.min(LOSS_CAP, Math.max(0, loss)))
  }
  return out
}

/**
 * Fold one game's worth of bot moves into what we know about that band.
 * Returns the updated observation, or null when the game said nothing.
 */
export function recordBotGame(elo: number, assessments: MoveAssessment[]): BandObservation | null {
  const losses = botLosses(assessments)
  if (losses.length === 0) return null

  const band = nearestBand(elo)
  const cal = loadCalibration()
  const prev = cal[band] ?? { moves: 0, sumLoss: 0, games: 0, factor: 1 }

  const next: BandObservation = {
    moves: prev.moves + losses.length,
    sumLoss: prev.sumLoss + losses.reduce((s, l) => s + l, 0),
    games: prev.games + 1,
    factor: prev.factor,
  }
  next.factor = nextFactor(band, next, prev.factor)

  cal[band] = next
  save(cal)
  return next
}

/** What this band has actually been measured at, or null without a sample. */
export function measuredAcpl(band: Band): number | null {
  const o = loadCalibration()[band]
  if (!o || o.moves === 0) return null
  return o.sumLoss / o.moves
}

/**
 * Where the temperature should move, given what this band measured.
 *
 * Too accurate for its label (measured below target) means the bot needs to
 * play looser, so the factor rises. The move is damped and clamped: one
 * strange game must not be able to redefine a band.
 */
function nextFactor(band: Band, o: BandObservation, current: number): number {
  if (o.moves < MIN_MOVES) return current
  const target = targetAcplFor(band)
  const measured = o.sumLoss / o.moves
  if (measured <= 0) return current
  const wanted = clamp(target / measured, MIN_FACTOR, MAX_FACTOR)
  return clamp(current + EMA * (wanted - current), MIN_FACTOR, MAX_FACTOR)
}

/**
 * The band's ACPL target. Imported lazily through a setter rather than
 * directly from policy.ts, because policy.ts imports THIS module to apply the
 * correction and a static cycle would leave one of them undefined at load.
 */
let targets: Record<Band, number> | null = null
export function registerTargets(t: Record<Band, number>): void {
  targets = t
}
function targetAcplFor(band: Band): number {
  return targets?.[band] ?? 0
}

/** The learned multiplier for a band. 1 until there is enough to say. */
export function factorFor(band: Band): number {
  const o = loadCalibration()[band]
  if (!o || o.moves < MIN_MOVES) return 1
  return clamp(o.factor, MIN_FACTOR, MAX_FACTOR)
}

/** Everything learned so far, for the panel that shows it. */
export function calibrationRows(): {
  band: Band
  target: number
  measured: number | null
  moves: number
  games: number
  factor: number
  applied: boolean
}[] {
  const cal = loadCalibration()
  return BANDS.map((band) => {
    const o = cal[band]
    return {
      band,
      target: targetAcplFor(band),
      measured: o && o.moves > 0 ? o.sumLoss / o.moves : null,
      moves: o?.moves ?? 0,
      games: o?.games ?? 0,
      factor: o?.factor ?? 1,
      applied: Boolean(o && o.moves >= MIN_MOVES),
    }
  })
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
