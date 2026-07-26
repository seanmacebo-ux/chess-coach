/**
 * Turning a perfect engine into a believable 1400.
 *
 * Naive weakening (`UCI_LimitStrength`) produces a bot that plays four
 * grandmaster moves then hangs a rook for no reason. Humans don't fail like
 * that — they play slightly-off moves constantly and catastrophically-off
 * moves rarely. So instead of crippling the search we run a FULL search, take
 * the top N candidates, and sample among them with a temperature calibrated to
 * the average centipawn loss real players at that rating actually produce.
 *
 * Style then re-weights that same candidate pool. Two bots at 1400 shed a
 * similar number of centipawns per move; style decides which moves they shed
 * them on. That keeps strength and personality independent, which is the whole
 * point — you can face an aggressive 1400 and a solid 1400 and lose to both
 * for completely different reasons.
 *
 * CALIBRATION HONESTY: the ACPL targets below are drawn from published
 * rating-band averages and the temperature≈ACPL mapping is a first-order
 * approximation, not a fitted model. It needs empirical tuning against real
 * played games — see `docs/calibration.md`. It will feel roughly right on day
 * one and properly right after we have data.
 */

import { Chess } from 'chess.js'
import type { Band, Line, Style, UciMove } from './types'
import { lineScore, nearestBand } from './types'

export interface BandProfile {
  band: Band
  /** Average centipawn loss we're aiming to reproduce. */
  targetAcpl: number
  /** Softmax temperature, in centipawns. Higher = looser play. */
  temperature: number
  /** Chance of ignoring the ranking entirely and picking near-uniformly. */
  blunderChance: number
  /** Search depth for candidate generation. */
  depth: number
  /** How many candidates to consider. */
  multipv: number
}

/**
 * Approximate ACPL by rating band. Weaker players don't just make more
 * mistakes, they make bigger ones, so both knobs move together.
 */
const PROFILES: Record<Band, Omit<BandProfile, 'band'>> = {
  800: { targetAcpl: 150, temperature: 150, blunderChance: 0.18, depth: 6, multipv: 10 },
  1000: { targetAcpl: 120, temperature: 120, blunderChance: 0.14, depth: 7, multipv: 10 },
  1200: { targetAcpl: 95, temperature: 95, blunderChance: 0.11, depth: 8, multipv: 9 },
  1400: { targetAcpl: 75, temperature: 75, blunderChance: 0.08, depth: 9, multipv: 8 },
  1600: { targetAcpl: 60, temperature: 60, blunderChance: 0.055, depth: 10, multipv: 8 },
  1800: { targetAcpl: 48, temperature: 48, blunderChance: 0.035, depth: 11, multipv: 7 },
  2000: { targetAcpl: 38, temperature: 38, blunderChance: 0.02, depth: 12, multipv: 6 },
  2200: { targetAcpl: 30, temperature: 30, blunderChance: 0.012, depth: 13, multipv: 5 },
}

export function bandProfile(elo: number): BandProfile {
  const band = nearestBand(elo)
  return { band, ...PROFILES[band] }
}

/* ------------------------------------------------------------------ */
/* Move features                                                       */
/* ------------------------------------------------------------------ */

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

export interface MoveFeatures {
  uci: UciMove
  isCapture: boolean
  givesCheck: boolean
  isPromotion: boolean
  capturedValue: number
  movedValue: number
  /** Chebyshev distance from the destination square to the enemy king (0-7). */
  distToEnemyKing: number
  /** Does this move get closer to the enemy king than it started? */
  approachesKing: boolean
  isPawnMove: boolean
  /** No capture, no check, no promotion. */
  isQuiet: boolean
  /** Leaving the back rank in the opening. */
  isDeveloping: boolean
  /** Queen leaving home before move 8 — the classic beginner sin. */
  isEarlyQueenSortie: boolean
  /** Heavy piece landing on a file with no friendly pawn. */
  toOpenFile: boolean
  /** Gives up material on the spot (captures less than it risks, or is a pure offer). */
  isSacrificial: boolean
}

function fileOf(sq: string): number {
  return sq.charCodeAt(0) - 97
}
function rankOf(sq: string): number {
  return Number(sq[1]) - 1
}
function chebyshev(a: string, b: string): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)))
}

function findKing(chess: Chess, color: 'w' | 'b'): string | null {
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) return sq.square
    }
  }
  return null
}

/** True if `color` has a pawn anywhere on the file containing `sq`. */
function hasFriendlyPawnOnFile(chess: Chess, sq: string, color: 'w' | 'b'): boolean {
  const f = fileOf(sq)
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'p' && cell.color === color && fileOf(cell.square) === f) {
        return true
      }
    }
  }
  return false
}

/**
 * Describe one candidate move. Returns null if the move is illegal in `fen`
 * (which can happen if the engine and the board have drifted apart).
 */
export function describeMove(fen: string, uci: UciMove): MoveFeatures | null {
  const chess = new Chess(fen)
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci.length > 4 ? uci[4] : undefined

  const legal = chess
    .moves({ verbose: true })
    .find((m) => m.from === from && m.to === to && (!promotion || m.promotion === promotion))
  if (!legal) return null

  const mover = chess.turn()
  const enemy = mover === 'w' ? 'b' : 'w'
  const enemyKing = findKing(chess, enemy)
  const moveNumber = Number(fen.split(' ')[5] ?? 1)

  const movedValue = VALUE[legal.piece] ?? 0
  const capturedValue = legal.captured ? (VALUE[legal.captured] ?? 0) : 0

  chess.move({ from, to, promotion })
  const givesCheck = chess.isCheck()
  chess.undo()

  const distBefore = enemyKing ? chebyshev(from, enemyKing) : 8
  const distAfter = enemyKing ? chebyshev(to, enemyKing) : 8

  const isCapture = Boolean(legal.captured)
  const isPromotion = Boolean(legal.promotion)
  const homeRank = mover === 'w' ? 0 : 7

  // Cheap sacrifice heuristic: we're a heavy piece moving into a square the
  // enemy attacks, taking less than we're worth. Not SEE, but it catches the
  // shape of an offer without a second engine call per candidate.
  const isSacrificial =
    movedValue >= 300 && capturedValue < movedValue - 100 && chess.isAttacked(to as never, enemy)

  return {
    uci,
    isCapture,
    givesCheck,
    isPromotion,
    capturedValue,
    movedValue,
    distToEnemyKing: distAfter,
    approachesKing: distAfter < distBefore,
    isPawnMove: legal.piece === 'p',
    isQuiet: !isCapture && !givesCheck && !isPromotion,
    isDeveloping: rankOf(from) === homeRank && legal.piece !== 'k' && moveNumber <= 12,
    isEarlyQueenSortie: legal.piece === 'q' && rankOf(from) === homeRank && moveNumber < 8,
    toOpenFile:
      (legal.piece === 'r' || legal.piece === 'q') && !hasFriendlyPawnOnFile(chess, to, mover),
    isSacrificial,
  }
}

/* ------------------------------------------------------------------ */
/* Style                                                               */
/* ------------------------------------------------------------------ */

/**
 * Multiplier applied to a candidate's sampling weight. 1.0 is neutral.
 * Kept deliberately mild — style should colour the choice, not override
 * strength. Anything past ~2x and a "tactical" 1400 starts playing like a
 * 900 who only knows how to give check.
 */
export function styleWeight(f: MoveFeatures, style: Style): number {
  let w = 1

  switch (style) {
    case 'human':
      return 1

    case 'aggressive':
      if (f.givesCheck) w *= 1.9
      if (f.isCapture) w *= 1.45
      if (f.approachesKing) w *= 1.4
      if (f.distToEnemyKing <= 2) w *= 1.25
      if (f.isQuiet) w *= 0.7
      break

    case 'solid':
      if (f.isSacrificial) w *= 0.45
      if (f.isCapture && f.capturedValue >= f.movedValue) w *= 1.3
      if (f.isQuiet) w *= 1.25
      if (f.givesCheck && !f.isCapture) w *= 0.8
      if (f.isEarlyQueenSortie) w *= 0.5
      break

    case 'positional':
      if (f.isQuiet) w *= 1.45
      if (f.toOpenFile) w *= 1.35
      if (f.isDeveloping) w *= 1.3
      if (f.isEarlyQueenSortie) w *= 0.45
      if (f.isCapture) w *= 0.85
      if (f.isSacrificial) w *= 0.7
      break

    case 'tactical':
      if (f.givesCheck) w *= 1.8
      if (f.isCapture) w *= 1.55
      if (f.isPromotion) w *= 1.6
      if (f.isSacrificial) w *= 1.4
      if (f.isQuiet) w *= 0.65
      break
  }

  return w
}

/**
 * Expected centipawn loss for a given temperature and weight set.
 * Monotonically increasing in `t` — flatter distribution, worse average move.
 */
function expectedLoss(losses: number[], styleW: number[], t: number): number {
  let num = 0
  let den = 0
  for (let i = 0; i < losses.length; i++) {
    const w = Math.exp(-(losses[i] ?? 0) / t) * (styleW[i] ?? 1)
    num += w * (losses[i] ?? 0)
    den += w
  }
  return den > 0 ? num / den : 0
}

/**
 * Find the temperature at which the style-weighted distribution sheds the
 * SAME expected centipawns as the unstyled one at the band temperature.
 *
 * Why this exists: calibration caught style acting as a stealth difficulty
 * setting. At 1400, "tactical" scored 88% against "human" of the same band
 * with a LOWER acpl (37.7 vs ~44.5), because boosting checks and captures
 * boosts move classes that are frequently just good. Aggressive did the same
 * at 75%. A style that quietly makes the bot stronger corrupts every
 * downstream training signal — you'd think you were beating a 1400 when you
 * were beating a 1250.
 *
 * Bisection is cheap here: no engine calls, ~24 iterations over at most a
 * dozen candidates.
 */
function styleNeutralTemperature(losses: number[], styleW: number[], t0: number): number {
  const target = expectedLoss(
    losses,
    losses.map(() => 1),
    t0,
  )
  if (!(target > 0)) return t0

  let lo = t0 / 8
  let hi = t0 * 8
  let t = t0
  for (let k = 0; k < 24; k++) {
    t = (lo + hi) / 2
    if (expectedLoss(losses, styleW, t) < target) lo = t
    else hi = t
  }
  return Math.max(5, t)
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export interface Candidate {
  uci: UciMove
  /** Centipawns worse than the engine's best move. Always >= 0. */
  loss: number
  weight: number
  features: MoveFeatures | null
}

export type Rng = () => number

/**
 * Score every candidate line, apply band temperature and style, and return
 * the weighted pool. Exported separately from `chooseMove` so the UI can show
 * "here's what it was considering and why" — useful for the coach view.
 */
export function weighCandidates(fen: string, lines: Line[], elo: number, style: Style): Candidate[] {
  if (lines.length === 0) return []

  const profile = bandProfile(elo)
  const t0 = Math.max(10, profile.temperature)

  const scored = lines
    .filter((l) => l.pv.length > 0)
    .map((l) => ({ uci: l.pv[0] as UciMove, score: lineScore(l) }))

  if (scored.length === 0) return []

  const best = Math.max(...scored.map((s) => s.score))
  const losses = scored.map((s) => Math.max(0, best - s.score))
  const features = scored.map((s) => describeMove(fen, s.uci))
  const styleW = features.map((f) => (f ? styleWeight(f, style) : 1))

  // Style decides WHICH of the equally-costly moves gets played, never how
  // costly the move is. Re-solving temperature enforces that rather than
  // assuming it — see styleNeutralTemperature.
  const t = style === 'human' ? t0 : styleNeutralTemperature(losses, styleW, t0)

  return scored.map(({ uci }, i) => {
    const loss = losses[i] ?? 0
    const weight = Math.exp(-loss / t) * (styleW[i] ?? 1)
    return { uci, loss, weight, features: features[i] ?? null }
  })
}

function sample(candidates: Candidate[], rng: Rng): Candidate | null {
  const total = candidates.reduce((s, c) => s + c.weight, 0)
  if (!(total > 0)) return candidates[0] ?? null
  let r = rng() * total
  for (const c of candidates) {
    r -= c.weight
    if (r <= 0) return c
  }
  return candidates[candidates.length - 1] ?? null
}

/**
 * Pick the move this opponent actually plays.
 *
 * `rng` is injectable so simulations are reproducible — the same seed replays
 * the same game, which is what makes "run this position 30 times" meaningful
 * rather than noise.
 */
export function chooseMove(
  fen: string,
  lines: Line[],
  elo: number,
  style: Style,
  rng: Rng = Math.random,
): UciMove | null {
  const candidates = weighCandidates(fen, lines, elo, style)
  if (candidates.length === 0) return null

  const profile = bandProfile(elo)

  // The blunder path.
  //
  // This used to sample uniformly from the multipv candidates — i.e. from the
  // engine's top eight moves, all of which are perfectly reasonable. It was a
  // no-op, and calibration proved it: at 1400 with blunderChance 0.08, only
  // 2.4% of moves shed 200cp and measured ACPL sat at ~59% of target.
  //
  // A real blunder means playing a move that was never in the engine's
  // shortlist at all — hanging the piece, missing the threat. So sample from
  // ALL legal moves, excluding the ones already under consideration.
  if (rng() < profile.blunderChance) {
    const board = new Chess(fen)
    const shortlist = new Set(candidates.map((c) => c.uci))
    const wild = board
      .moves({ verbose: true })
      .map((m) => `${m.from}${m.to}${m.promotion ?? ''}`)
      .filter((u) => !shortlist.has(u))
    if (wild.length > 0) {
      return wild[Math.floor(rng() * wild.length)] ?? null
    }
  }

  return sample(candidates, rng)?.uci ?? null
}

/**
 * Deterministic RNG (mulberry32) for reproducible simulation runs.
 * Same seed in, same game out.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
