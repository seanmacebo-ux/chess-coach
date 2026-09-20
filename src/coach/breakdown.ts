/**
 * The game, broken down further — including the half we never looked at.
 *
 * Sean: "we need to break down the game more, because I think our bots are
 * too easy and simple and we're not uncovering the big part of them."
 *
 * Those are one sentence for a reason. The review analyses YOUR moves and
 * says nothing whatever about the opponent's, so the bot you just spent
 * twenty minutes with is a black box: you cannot see what it was trying to
 * do, you cannot tell an aggressive bot from a positional one after the fact,
 * and the personality picker might as well be decorative. A bot feels simple
 * when nothing ever tells you what it did.
 *
 * Two readings, neither of which needs a single extra engine search.
 *
 * BY PHASE. Every assessment already carries `phase`. Nothing aggregated it,
 * so a game where the opening was fine and the endgame fell apart read
 * exactly like one that was uniformly mediocre — same average, same counts,
 * completely different lesson.
 *
 * THE OPPONENT. Their moves are recoverable: two consecutive assessments
 * bracket the reply, so replaying yours and finding the single legal move
 * that reaches the next position names it exactly (the same trick the
 * turning points use). Once named, the move can be DESCRIBED with the very
 * features the bot's own style table is built from — so the read is in the
 * same vocabulary the bot chooses moves in, rather than a story told over
 * the top of it.
 *
 * And their errors are free: cpPlayed assumes their best answer, the next
 * cpBest is what they actually left, and the gap is theirs.
 */

import { Chess } from 'chess.js'
import type { MoveAssessment, Phase } from './analysis'
import { describeMove } from '../engine/policy'
import { winChance } from '../ui/EvalMeter'

export interface PhaseRow {
  phase: Phase
  moves: number
  /** Centipawns lost per move in this phase. */
  acpl: number
  /** Winning chances given up across the whole phase. */
  given: number
  slips: number
  /** The worst single move of the phase, if there was a real one. */
  worst: { moveNo: number; san: string; cost: number } | null
}

export function byPhase(moves: MoveAssessment[]): PhaseRow[] {
  const order: Phase[] = ['opening', 'middlegame', 'endgame']
  const out: PhaseRow[] = []
  for (const phase of order) {
    const mine = moves.filter((m) => m.phase === phase)
    if (mine.length === 0) continue
    let worst: PhaseRow['worst'] = null
    let given = 0
    for (const m of mine) {
      const cost = winChance(m.cpBest) - winChance(m.cpPlayed)
      if (cost > 0) given += cost
      if (cost >= 10 && (!worst || cost > worst.cost)) {
        worst = { moveNo: Math.floor(m.ply / 2) + 1, san: m.san, cost: Math.round(cost) }
      }
    }
    out.push({
      phase,
      moves: mine.length,
      acpl: Math.round(mine.reduce((a, m) => a + m.lossCp, 0) / mine.length),
      given: Math.round(given),
      slips: mine.filter((m) => m.severity === 'blunder' || m.severity === 'mistake').length,
      worst,
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The opponent                                                        */
/* ------------------------------------------------------------------ */

export interface OpponentRead {
  /** Their moves that were recoverable at all. */
  moves: number
  captures: number
  checks: number
  /** Moves landing within two squares of your king. */
  atYourKing: number
  quiet: number
  sacrifices: number
  /** Times they handed you 10+ points of winning chances. */
  gifts: number
  /** The biggest single thing they gave away, in points. */
  biggestGift: number
  /** One sentence, in the vocabulary their own style table is written in. */
  verdict: string
}

/**
 * Recover the opponent's move between two of yours.
 *
 * Only the assessments are needed: play yours from the position it was
 * played in, then find the one legal reply that reaches the position you
 * faced next.
 */
export function replyBetween(m: MoveAssessment, next: MoveAssessment): string | null {
  try {
    const board = new Chess(m.fen)
    if (!board.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })) {
      return null
    }
    const want = next.fen.split(' ').slice(0, 4).join(' ')
    for (const reply of board.moves({ verbose: true })) {
      const probe = new Chess(board.fen())
      probe.move({ from: reply.from, to: reply.to, promotion: reply.promotion })
      if (probe.fen().split(' ').slice(0, 4).join(' ') === want) {
        return `${reply.from}${reply.to}${reply.promotion ?? ''}`
      }
    }
    return null
  } catch {
    return null
  }
}

export function readOpponent(moves: MoveAssessment[], name = 'They'): OpponentRead | null {
  let count = 0
  let captures = 0
  let checks = 0
  let atKing = 0
  let quiet = 0
  let sacrifices = 0
  let gifts = 0
  let biggest = 0

  for (let i = 0; i < moves.length - 1; i++) {
    const m = moves[i]!
    const next = moves[i + 1]!
    if (next.ply !== m.ply + 2) continue

    const handed = winChance(next.cpBest) - winChance(m.cpPlayed)
    if (handed >= 10) {
      gifts++
      if (handed > biggest) biggest = handed
    }

    const uci = replyBetween(m, next)
    if (!uci) continue
    /*
     * Described from the position THEY moved in, which is the position after
     * your move — not m.fen, which is the position before it. Getting this
     * wrong would silently describe a different move on a different board.
     */
    let after: string
    try {
      const b = new Chess(m.fen)
      b.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })
      after = b.fen()
    } catch {
      continue
    }
    const f = describeMove(after, uci)
    if (!f) continue
    count++
    if (f.isCapture) captures++
    if (f.givesCheck) checks++
    if (f.distToEnemyKing <= 2) atKing++
    if (f.isQuiet) quiet++
    if (f.isSacrificial) sacrifices++
  }

  if (count < 6) return null

  const pct = (n: number) => n / count
  /*
   * Said in the same terms the bot chooses moves in, so the sentence can be
   * checked against the board rather than taken on trust. Ordered by what is
   * most unusual about the game rather than by a fixed priority, so two games
   * against the same bot do not produce the same line.
   */
  let verdict: string
  if (pct(atKing) >= 0.3) {
    verdict = `${name} played at your king — ${atKing} of ${count} moves landed within two squares of it.`
  } else if (pct(sacrifices) >= 0.12) {
    verdict = `${name} kept offering material — ${sacrifices} moves gave something up to keep lines open.`
  } else if (pct(captures) >= 0.38) {
    verdict = `${name} traded at every opportunity — ${captures} of ${count} moves were captures.`
  } else if (pct(quiet) >= 0.62) {
    verdict = `${name} squeezed rather than struck — ${quiet} of ${count} moves were quiet.`
  } else {
    verdict = `${name} played a balanced game: ${captures} captures, ${checks} checks, ${quiet} quiet moves.`
  }

  return {
    moves: count,
    captures,
    checks,
    atYourKing: atKing,
    quiet,
    sacrifices,
    gifts,
    biggestGift: Math.round(biggest),
    verdict,
  }
}
