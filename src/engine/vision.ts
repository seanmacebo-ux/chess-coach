/**
 * What a player at this rating does not see coming.
 *
 * WHY THIS EXISTS. Sean: "the difficulty levels don't work well." The old
 * ANCHORS table said why. From 800 to 2200 the only things that moved were
 * temperature, depth and multipv, and the one-ply share sat at 0.022 the
 * whole way: every bot above 800 was the same bot with a tighter softmax, and
 * a player cannot feel a softmax. The calibration harness agreed in the
 * bluntest possible terms — four of seven rungs were clean sweeps and 1400
 * and 1600 scored 50% against each other, i.e. were one opponent with two
 * names.
 *
 * What differs between a 400 and a 1700 is not how finely they rank moves. It
 * is WHAT THEY MISS. The 400 plays a move that looks winning and does not see
 * the knight coming back. The 1700 sees the knight.
 *
 * So this is no longer an extra error source bolted onto the side of the
 * policy — it IS the strength dial. `sightAt` is the curve, BandProfile.sight
 * is the per-band value, and depth, multipv and temperature have been demoted
 * to finding candidate moves and breaking ties. See the long note above
 * ANCHORS in policy.ts for the measurements that forced it.
 *
 * THE REFUTATION WAS ALREADY THERE. weighCandidates did this:
 *
 *     .map((l) => ({ uci: l.pv[0], score: lineScore(l) }))
 *
 * — it took the move and threw the rest of the line away. `l.pv[1]` is the
 * reply the engine expects, i.e. the refutation, already computed, for every
 * candidate, at no extra cost. So the model is: roll against whether a player
 * at this rating would SEE that reply. When they do not, the move looks fine
 * to them and they play it.
 *
 * NOT EVERY LINE HAS ONE, which is measured rather than assumed. At depth 6
 * and above every multipv line comes back with at least two moves. At depth 4
 * — which is what the 350 bot searches — only 56-82% do. Those fall back to
 * being treated as seen, which is the conservative direction: a bot that
 * cannot find its own refutation does not get to be blind to it.
 *
 * WHY IT RE-SCORES RATHER THAN RE-RANKS. A blind candidate is not demoted or
 * promoted by a fixed amount — it is lifted to just under the best move,
 * because that is what "I cannot see what is wrong with this" means. It also
 * means the model does not have to understand WHY the refutation wins. A fork,
 * a discovered attack, a back-rank mate and a plain recapture are all handled
 * by the same line of code, because the question is only ever "would they have
 * seen that move".
 */

import { Chess } from 'chess.js'
import type { UciMove } from './types'

/** A reply, described in the terms that decide whether a human spots it. */
export interface ReplyShape {
  /** It takes back on the square we just moved to. The most-seen move there is. */
  isRecapture: boolean
  givesCheck: boolean
  isCapture: boolean
  /** Knights are the classic blind spot — they do not move along a line. */
  isKnight: boolean
  /** Squares travelled, Chebyshev. Long moves are easy to miss. */
  distance: number
  /** Moving back toward its own side. Retreats are the least visible of all. */
  isBackward: boolean
}

const fileOf = (sq: string) => sq.charCodeAt(0) - 97
const rankOf = (sq: string) => Number(sq[1]) - 1

/**
 * Describe the reply, from the position our move created.
 *
 * Returns null when the move is not legal there, which happens if the engine
 * and the board have drifted apart. A null reply is treated as "seen", the
 * conservative direction.
 */
export function shapeOfReply(
  fenAfterOurMove: string,
  reply: UciMove,
  ourDestination: string,
): ReplyShape | null {
  const board = new Chess(fenAfterOurMove)
  const from = reply.slice(0, 2)
  const to = reply.slice(2, 4)
  let mv
  try {
    mv = board.move({ from, to, promotion: reply[4] })
  } catch {
    return null
  }
  if (!mv) return null

  const forward = mv.color === 'w' ? rankOf(to) - rankOf(from) : rankOf(from) - rankOf(to)
  return {
    isRecapture: Boolean(mv.captured) && to === ourDestination,
    givesCheck: mv.san.includes('+') || mv.san.includes('#'),
    isCapture: Boolean(mv.captured),
    isKnight: mv.piece === 'n',
    distance: Math.max(Math.abs(fileOf(from) - fileOf(to)), Math.abs(rankOf(from) - rankOf(to))),
    isBackward: forward < 0,
  }
}

/**
 * How reliably a player at this rating sees a given reply coming, 0..1.
 *
 * The base is what they spot in general; the modifiers are the shape of the
 * move. A recapture on the square you just touched is seen by nearly
 * everybody who has played a month — it is the first thing you check. A
 * knight arriving from three squares away is missed by most people under
 * 1200, which is why beginners lose pieces to forks and not to bishops.
 *
 * The numbers are a first fit, not a measurement. scripts/diag-bots.ts
 * reports a punish-rate and the acpl ladder; those are what move them.
 */
/**
 * The sight a rating starts from, before the shape of the move is considered.
 *
 * 350 sees about half of what is coming; 2200 sees essentially all of it.
 * Logistic rather than linear so the bottom of the ladder has room to
 * differentiate — the gap between a 350 and a 550 matters more to the person
 * playing them than the gap between 1800 and 2000.
 *
 * Exported because it is now THE strength dial rather than one of four.
 * policy.ts reads it into BandProfile, calibration can scale it, and the
 * tuner can sweep it — none of which is possible while a curve is buried
 * inside the function that uses it.
 */
export function sightAt(elo: number): number {
  return 0.42 + 0.56 / (1 + Math.exp(-(elo - 950) / 330))
}

export function seesReply(shape: ReplyShape | null, sight: number): number {
  // No reply on record (shallow search, illegal move) — treat as seen, so
  // blindness can never be an artefact of the search being too short.
  if (shape === null) return 1

  const base = Math.max(0.05, Math.min(0.995, sight))

  /*
   * THE MODIFIERS SCALE WHAT YOU MISS, NOT WHAT YOU SEE.
   *
   * The first version subtracted a constant from the sight probability — a
   * flat -0.18 for a knight. That makes a strong player's blind spot the
   * same SIZE as a beginner's, which is wrong in the way that matters: it
   * left a 1700 missing 30% of knight forks and only 2.4x better than a 350
   * at seeing them. Blind spots do not stay the same size as you improve,
   * they shrink with everything else.
   *
   * So the shape multiplies the MISS probability. A knight doubles whatever
   * you were already going to miss; a recapture on the square just touched
   * divides it by eight. The same multiplier now costs a beginner thirty
   * points of sight and a master two, which is how it actually works.
   */
  let miss = 1 - base

  if (shape.isRecapture) miss /= 8
  else if (shape.givesCheck) miss /= 2.5
  else if (shape.isCapture) miss /= 1.6

  if (shape.isKnight) miss *= 2.0
  if (shape.isBackward) miss *= 1.8
  if (shape.distance >= 4) miss *= 1.5
  else if (shape.distance >= 3) miss *= 1.2

  return Math.max(0.02, Math.min(0.995, 1 - miss))
}

/**
 * Is this candidate's refutation invisible to this player, this time?
 *
 * Stochastic on purpose. A player who ALWAYS misses knight moves is a puzzle
 * to be solved once; a player who usually misses them is an opponent.
 */
export function isBlindTo(
  fenAfterOurMove: string,
  reply: UciMove | undefined,
  ourDestination: string,
  sight: number,
  rng: () => number,
): boolean {
  if (!reply) return false
  const shape = shapeOfReply(fenAfterOurMove, reply, ourDestination)
  return rng() >= seesReply(shape, sight)
}
