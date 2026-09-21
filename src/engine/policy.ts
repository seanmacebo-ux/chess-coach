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
 * WHY THE POOL IS SO WIDE AT THE BOTTOM, which is the whole story.
 *
 * The first version sampled among the engine's top 8-10 moves at every band
 * and raised the temperature to weaken play. Calibration said every band was
 * far stronger than its label — 800 shedding 70cp against a 150 target — and
 * the reason turned out to be arithmetic rather than tuning:
 * scripts/tune-bands.ts computes the expected loss of this policy in closed
 * form, and reported the target as UNREACHABLE for seven of the eight bands.
 * Even sampling UNIFORMLY over a strong engine's top ten moves is too strong,
 * because all ten are decent. No temperature fixes a pool with no bad moves
 * in it.
 *
 * So weak bands now choose from a much wider list — 800 sees twenty-eight
 * candidates — which is also the more honest description of the thing being
 * modelled: a weak player has not discarded the bad moves yet and a strong
 * one has. Temperature then decides how far down that list they reach.
 *
 * And blunderChance is cut to roughly a third across the board. The blunder
 * path plays a move the engine never shortlisted at all — a genuinely random
 * legal move — so at 0.18 the 800 bot threw a piece away every fifth or sixth
 * move while playing well above its rating in between. Strong, then abruptly
 * absurd. Sean's words were "too easy and simple", and that one shape
 * produces both halves of it. The loss should come from playing consistently
 * loose, which is what humans at that rating actually do.
 *
 * AND THE MODEL WAS WRONG THE FIRST TIME, which is why the measurement runs.
 *
 * The analytic solver's first answer was applied and calibrate.ts caught it
 * overshooting hard: band 800 was predicted at 150 and measured 246.9 in real
 * play, with 41% of its moves losing 200cp or more. Not a weak bot — a
 * useless one.
 *
 * The cause is compounding, and it is not an arithmetic bug. The model
 * evaluates independent positions from master games, where the candidate
 * moves sit close together because the position is sound. A loose bot does
 * not stay in positions like that: one sloppy move reaches a worse one, where
 * the spread between best and tenth-best is far wider, so the next sloppy
 * move costs more than the model's average. Error feeds on itself and a
 * per-position expectation cannot see it. The measured factor was about 1.6,
 * and tune-bands.ts now aims at target/1.6.
 *
 * So the shape that survived is: a WIDE pool, a MODERATE temperature and a
 * LOW blunder rate. The bot mostly plays sensible moves and now and then
 * reaches further down a long list — which is what a weak human looks like —
 * rather than alternating between engine moves and random ones.
 *
 * THE TEMPERATURES BELOW COME FROM MEASUREMENT, NOT FROM THE MODEL.
 *
 * The analytic solver takes a correction factor for compounding, and the
 * factor turned out to depend on the very setting it is correcting towards:
 * 1.6 measured at temperature 766, 1.12 at temperature 142. A looser bot
 * spends the game in worse positions, where the gap between best and
 * tenth-best is wider, so its errors compound harder. One constant cannot
 * extrapolate across that.
 *
 * So the last step is a fit to real games instead. Two calibration runs at
 * band 800 with the same pool give two points — temperature 142 measured
 * 105.4 ACPL, temperature 766 measured 246.9 — and ACPL goes as temperature
 * to the power 0.505 between them, near enough a square root. Solving that
 * for 150 gives 286, almost exactly double the current setting, and the
 * same doubling is applied across the ladder.
 *
 * CALIBRATION HONESTY: the targets are drawn from published rating-band
 * averages. scripts/calibrate.ts plays real games and is the thing that
 * decides. It has overruled this table twice already, and the numbers here
 * are its own two measurements extrapolated — which is a better guess than
 * the model made, and still a guess until it has been run again.
 *
 * That guess is no longer the last word. `bandProfile` applies whatever
 * calibration.ts has measured from games actually played, so the table below
 * is a starting point that the app corrects with use rather than a constant
 * somebody has to remember to edit. The correction is bounded, damped, needs
 * a real sample before it does anything, and — importantly — never reads the
 * RESULT of a game, only the bot's own move quality. See calibration.ts.
 */

import { Chess } from 'chess.js'
import type { Band, Line, Style, UciMove } from './types'
import { BANDS, lineScore, nearestBand } from './types'
import { factorFor, registerTargets } from './calibration'

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
 * THE BUG THIS TABLE USED TO HAVE, WHICH WAS THE WHOLE PROBLEM.
 *
 * These numbers were keyed by Band, and Band is one of eight fixed values.
 * Every opponent's rating was snapped to the nearest one with nearestBand()
 * before anything was looked up. The roster does not use those eight values
 * — it spaces eleven bots about 150 apart — so the snapping quietly collapsed
 * the ladder:
 *
 *     Bud 350, Kit 550 and Pip 800  →  all band 800, byte for byte identical
 *     Nadia 950 and Walter 1100     →  both band 1000
 *     Darius 1550 and Ren 1700      →  both band 1600
 *
 * Eleven opponents, seven strengths, and the three at the bottom were one bot
 * wearing three faces. Worse: the weakest thing in the app was an 800 aimed
 * at a player rated 316. The roster's own header notices the closed door and
 * adds Bud and Kit to open it — and they snapped straight back to 800, so the
 * fix was a rename. Sean's read of this was "the bots we are using are not
 * right", and he was describing something real and precise.
 *
 * So the table is now ANCHORS and everything between them is interpolated.
 * A 1100 bot is genuinely between the 1000 and the 1200; a 350 bot is a 350
 * bot. Bands survive only where they belong — calibration measures per band,
 * because a learned correction needs a sample to learn from and continuous
 * ratings would never accumulate one.
 *
 * The three anchors below 800 are new and are the least trustworthy numbers
 * here: everything from 800 up has been measured in self-play, and these have
 * not. They are placed on the shape the measured ones follow and will move
 * when measure-acpl has had a run at them.
 */
interface Anchor extends Omit<BandProfile, 'band'> {
  elo: number
}

const ANCHORS: Anchor[] = [
  { elo: 350, targetAcpl: 320, temperature: 620, blunderChance: 0.14, depth: 4, multipv: 32 },
  { elo: 550, targetAcpl: 225, temperature: 430, blunderChance: 0.07, depth: 5, multipv: 30 },
  { elo: 800, targetAcpl: 150, temperature: 286, blunderChance: 0.022, depth: 6, multipv: 28 },
  { elo: 1000, targetAcpl: 120, temperature: 227, blunderChance: 0.022, depth: 7, multipv: 24 },
  { elo: 1200, targetAcpl: 95, temperature: 181, blunderChance: 0.022, depth: 8, multipv: 20 },
  { elo: 1400, targetAcpl: 75, temperature: 157, blunderChance: 0.022, depth: 9, multipv: 16 },
  { elo: 1600, targetAcpl: 60, temperature: 153, blunderChance: 0.019, depth: 10, multipv: 12 },
  { elo: 1800, targetAcpl: 48, temperature: 165, blunderChance: 0.012, depth: 11, multipv: 9 },
  { elo: 2000, targetAcpl: 38, temperature: 157, blunderChance: 0.007, depth: 12, multipv: 7 },
  { elo: 2200, targetAcpl: 30, temperature: 149, blunderChance: 0.004, depth: 13, multipv: 5 },
]

/** Linear between a and b at position t in [0,1]. */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Geometric between a and b — the right shape for a scale parameter.
 *
 * Temperature and blunder chance both span more than an order of magnitude
 * across the ladder, and halfway between 0.14 and 0.004 is not 0.072: a bot
 * at the midpoint should be about as far from each end in ratio, not in
 * subtraction. Linear interpolation of blunderChance would leave a 1000-rated
 * bot blundering at nearly the rate of a 350.
 */
const glerp = (a: number, b: number, t: number) =>
  a > 0 && b > 0 ? a * Math.pow(b / a, t) : lerp(a, b, t)

/** The two anchors an Elo falls between, and how far along it sits. */
function bracket(elo: number): { lo: Anchor; hi: Anchor; t: number } {
  const first = ANCHORS[0]!
  const last = ANCHORS[ANCHORS.length - 1]!
  if (elo <= first.elo) return { lo: first, hi: first, t: 0 }
  if (elo >= last.elo) return { lo: last, hi: last, t: 0 }
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const lo = ANCHORS[i]!
    const hi = ANCHORS[i + 1]!
    if (elo <= hi.elo) return { lo, hi, t: (elo - lo.elo) / (hi.elo - lo.elo) }
  }
  return { lo: last, hi: last, t: 0 }
}

/*
 * The targets above are what each band is SUPPOSED to shed. calibration.ts
 * measures what it actually sheds in real games and hands back a multiplier;
 * registering them here rather than importing PROFILES over there keeps the
 * two modules from forming a load-time cycle.
 */
registerTargets(
  Object.fromEntries(
    BANDS.map((b) => [b, ANCHORS.find((a) => a.elo === b)?.targetAcpl ?? 0]),
  ) as Record<Band, number>,
)

/**
 * The opponent a given rating should be, at that rating and not at the
 * nearest of eight.
 */
export function profileFor(elo: number): BandProfile {
  const { lo, hi, t } = bracket(elo)
  const base: Omit<BandProfile, 'band'> = {
    targetAcpl: Math.round(lerp(lo.targetAcpl, hi.targetAcpl, t)),
    temperature: Math.round(glerp(lo.temperature, hi.temperature, t)),
    blunderChance: glerp(lo.blunderChance, hi.blunderChance, t),
    depth: Math.round(lerp(lo.depth, hi.depth, t)),
    multipv: Math.round(lerp(lo.multipv, hi.multipv, t)),
  }
  // Calibration still works in bands, because a learned correction needs a
  // sample and continuous ratings would spread one too thin to ever act on.
  const band = nearestBand(elo)
  // Everything the app has learned about this band from games actually
  // played. 1 until a band has a real sample, so day one is unchanged.
  const factor = factorFor(band)
  return {
    band,
    ...base,
    temperature: Math.round(base.temperature * factor),
    // The blunder path is the knob with real headroom — the softmax can only
    // ever be as loose as the candidate pool — so it carries the correction
    // too, at half strength and never past a third of moves, which is the
    // point where a bot stops reading as a weak human and starts reading as
    // broken.
    blunderChance: Math.min(0.33, base.blunderChance * (1 + (factor - 1) * 0.5)),
  }
}

/**
 * Kept for the band-keyed harnesses (calibrate, tune-bands, measure-acpl),
 * which iterate BANDS and mean exactly those values. Identical to profileFor
 * at every band, because every band is an anchor.
 */
export const bandProfile = profileFor

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

    /*
     * AGGRESSIVE IS ABOUT THE KING, NOT ABOUT CAPTURING.
     *
     * Measured, not guessed: scripts/verify-style.ts found this style and
     * `tactical` choosing the same move 88% of the time, with identical
     * character (53% forcing, 47% quiet). Both tables boosted checks by ~1.85
     * and captures by ~1.5 and penalised quiet moves by ~0.68; the only
     * differences were king-proximity here and promotion/sacrifice there, and
     * promotions and sacrifices barely occur in a middlegame. Five styles,
     * two of them the same bot with two names — which is exactly what "our
     * bots are too simple" feels like from the other side of the board.
     *
     * So the two are separated by WHAT THEY WANT rather than by how hard they
     * want it. This one wants to get at the king: proximity dominates, and a
     * capture is only interesting if it happens near the king. A rook taking
     * a pawn on the queenside is not an attack.
     */
    case 'aggressive':
      if (f.distToEnemyKing <= 2) w *= 2.2
      else if (f.distToEnemyKing <= 3) w *= 1.5
      if (f.approachesKing) w *= 1.7
      if (f.givesCheck) w *= 1.5
      // Captures on their own are not the point, and the far side of the
      // board is the opposite of the point.
      if (f.isCapture && f.distToEnemyKing <= 3) w *= 1.3
      if (f.isCapture && f.distToEnemyKing >= 5) w *= 0.8
      if (f.isPawnMove && f.approachesKing) w *= 1.4
      if (f.isQuiet && f.distToEnemyKing >= 4) w *= 0.6
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

    /*
     * TACTICAL IS ABOUT COMPLICATION, ANYWHERE ON THE BOARD.
     *
     * The other half of the split above. This one will take on any square,
     * offer material, and push a pawn through — it does not care where the
     * king is, which is precisely what separates it from `aggressive`. Trading
     * heavy pieces off is the one thing it will not do, because a queenless
     * position has nothing left to calculate.
     */
    case 'tactical':
      if (f.isSacrificial) w *= 2.1
      if (f.isCapture) w *= 1.7
      if (f.isPromotion) w *= 1.9
      if (f.givesCheck) w *= 1.35
      // An even trade of big pieces kills the position it wants to live in.
      if (f.isCapture && f.movedValue >= 5 && f.capturedValue >= 5) w *= 0.6
      if (f.isQuiet) w *= 0.6
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
 * How much a move is worth to somebody who is not looking at the reply.
 *
 * Deliberately crude, because the whole point is the crudeness. Material on
 * the square is most of it; a check and a promotion read as progress; moving
 * forwards feels like doing something and retreating feels like giving up.
 * Nothing here asks what happens next, which is exactly the mistake being
 * modelled.
 */
function faceValue(m: {
  captured?: string
  promotion?: string
  san: string
  from: string
  to: string
  color: 'w' | 'b'
}): number {
  let v = m.captured ? (VALUE[m.captured] ?? 0) : 0
  if (m.promotion) v += 800
  if (m.san.includes('#')) v += 2000
  else if (m.san.includes('+')) v += 80
  const forward = (rankOf(m.to) - rankOf(m.from)) * (m.color === 'w' ? 1 : -1)
  v += forward * 12
  return v
}

/**
 * Spread over face value rather than winner-takes-all.
 *
 * At 220 a hanging queen (900) outweighs a quiet move by e^4 ≈ 55, so it is
 * taken nearly always; two captures of similar size stay a real choice. Make
 * it much smaller and the bot becomes a deterministic material-grabber, which
 * is a different and equally inhuman thing.
 */
const NAIVE_TEMPERATURE = 220

/**
 * The move a one-ply player picks here.
 *
 * Exported so the diagnostics can characterise it on its own, away from the
 * search: "what does this policy shed, and how often does it hang something"
 * is a question about this function alone.
 */
export function naiveMove(fen: string, rng: Rng): UciMove | null {
  const board = new Chess(fen)
  const moves = board.moves({ verbose: true })
  if (moves.length === 0) return null

  const weights = moves.map((m) => Math.exp(faceValue(m) / NAIVE_TEMPERATURE))
  const total = weights.reduce((a, c) => a + c, 0)
  if (!(total > 0) || !Number.isFinite(total)) {
    // A forced mate makes faceValue large enough to overflow the exponential
    // in principle; fall back rather than return null and lose the turn.
    const m = moves[Math.floor(rng() * moves.length)]!
    return `${m.from}${m.to}${m.promotion ?? ''}`
  }

  let r = rng() * total
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i] ?? 0
    if (r <= 0) {
      const m = moves[i]!
      return `${m.from}${m.to}${m.promotion ?? ''}`
    }
  }
  const m = moves[moves.length - 1]!
  return `${m.from}${m.to}${m.promotion ?? ''}`
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
  return chooseMoveDetailed(fen, lines, elo, style, rng).uci
}

/** Where a chosen move came from. Diagnostics need to tell these apart. */
export interface Choice {
  uci: UciMove | null
  /**
   * 'pool' — sampled from the engine's shortlist by the softmax.
   * 'wild' — the blunder path: a legal move the engine never shortlisted.
   * 'forced' — one legal move, or nothing to choose from.
   */
  source: 'pool' | 'wild' | 'forced'
  /** Centipawns worse than best, for pool picks. Unknown for wild ones. */
  loss: number | null
  /** How far apart best and worst candidate were — the room style had. */
  spread: number
  candidates: number
}

/**
 * chooseMove with its reasoning attached.
 *
 * Split out because "the bot played a bad move" and "the bot played an absurd
 * move" have different causes and different fixes, and from the outside they
 * are indistinguishable. The softmax reaching a loose move and the blunder
 * path firing a random one both show up as a large centipawn loss; only one
 * of them looks like a human.
 */
export function chooseMoveDetailed(
  fen: string,
  lines: Line[],
  elo: number,
  style: Style,
  rng: Rng = Math.random,
): Choice {
  const candidates = weighCandidates(fen, lines, elo, style)
  const spread =
    candidates.length > 1 ? Math.max(...candidates.map((c) => c.loss)) : 0
  const none: Choice = { uci: null, source: 'forced', loss: null, spread: 0, candidates: 0 }
  if (candidates.length === 0) return none

  const profile = bandProfile(elo)

  // The one-ply path — what used to be called the blunder path.
  //
  // FIRST VERSION sampled uniformly from the multipv candidates, i.e. from
  // the engine's top eight moves, all of which are fine. A no-op, and
  // calibration proved it: at 1400 with blunderChance 0.08, only 2.4% of
  // moves shed 200cp.
  //
  // SECOND VERSION sampled uniformly from every legal move the shortlist did
  // not contain. That produced losses — and produced them in the wrong shape.
  // A uniformly random legal move is a rook shuffling to h2 for no reason.
  // Nobody has ever played that. Human errors are not noise; they are the
  // output of a cheaper policy. A beginner looks one ply deep, takes the
  // biggest thing on offer, gives the check, pushes the pawn — and simply
  // does not see the reply. That is why their blunders look purposeful right
  // up until the refutation.
  //
  // So this now plays the move a one-ply player would pick: weighted by what
  // it wins THIS move with no thought at all for the answer. It is allowed to
  // land on a good move, because sometimes the greedy move is the right one
  // and pretending otherwise is its own kind of tell.
  if (rng() < profile.blunderChance) {
    const naive = naiveMove(fen, rng)
    if (naive) {
      return { uci: naive, source: 'wild', loss: null, spread, candidates: candidates.length }
    }
  }

  const picked = sample(candidates, rng)
  return {
    uci: picked?.uci ?? null,
    source: candidates.length === 1 ? 'forced' : 'pool',
    loss: picked?.loss ?? null,
    spread,
    candidates: candidates.length,
  }
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
