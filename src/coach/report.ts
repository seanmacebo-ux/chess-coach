/**
 * The game, rated and told back to you.
 *
 * Sean: "please can you also start rating the moves, I need a full game
 * review and you can highlight the moments for me like specific turnaround."
 *
 * Three things the review did not do. It had five severity levels and only
 * ever showed you the bad ones, so a game was a list of failures with no
 * shape. It never marked the moves you got RIGHT. And it never said where the
 * game actually turned — which is the one thing you remember a game by.
 *
 * EVERY LABEL HERE HAS A RULE, and the rule is checkable on the board or in
 * the engine numbers that were already computed. Nothing is awarded on feel.
 * That matters most for the flattering labels: "brilliant" is the easiest
 * word in chess to hand out dishonestly, so it is defined narrowly — a move
 * that gives material away, is still the engine's first choice, and leaves
 * you not losing. A sacrifice that works. If it does not meet all three it
 * is not called brilliant, however nice it looked.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { MoveAssessment } from './analysis'
import { winChance } from '../ui/EvalMeter'

export type MoveRating =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss'

export const RATING_LABEL: Record<MoveRating, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  miss: 'Missed win',
}

/** What each label actually means, so a badge is never just a colour. */
export const RATING_MEANING: Record<MoveRating, string> = {
  brilliant: 'You gave up material and it was still the strongest move.',
  great: 'The only move that held it — everything else was clearly worse.',
  best: 'The engine plays this too.',
  excellent: 'As good as makes no difference.',
  good: 'Sound. A little was available elsewhere.',
  book: 'Your repertoire move — this is prepared.',
  inaccuracy: 'Cost you 10 or more points of winning chances.',
  mistake: 'Cost you 20 or more.',
  blunder: 'Cost you 30 or more.',
  miss: 'A forced win was there and this was not it.',
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

function material(chess: Chess, side: 'w' | 'b'): number {
  let total = 0
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === side) total += VALUE[cell.type] ?? 0
    }
  }
  return total
}

/**
 * Did this move offer material?
 *
 * Board logic, not eval: play the move, then ask whether the opponent can
 * win material on the spot by taking — either the piece that just moved is
 * attacked by something cheaper and not defended, or it simply hangs.
 * Recaptures do not count, because taking back what was taken is a trade.
 */
export function isSacrifice(fen: string, uci: string): boolean {
  try {
    const before = new Chess(fen)
    const me = before.turn()
    const them = me === 'w' ? 'b' : 'w'
    const mine = material(before, me)

    const after = new Chess(fen)
    const mv = after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    if (!mv) return false

    // Giving material back immediately after taking is a trade, not an offer.
    if (mv.captured) {
      const gained = VALUE[mv.captured] ?? 0
      const risked = VALUE[mv.piece] ?? 0
      if (gained >= risked) return false
    }

    const to = mv.to as Square
    const landed = VALUE[mv.piece] ?? 0
    if (landed === 0) return false

    // Can anything cheaper take it, or is it simply undefended?
    const attacked = after.isAttacked(to, them)
    if (!attacked) return false
    const defended = after.isAttacked(to, me)
    if (!defended) return material(after, me) <= mine

    // Defended, but attacked by something worth less — still an offer.
    for (const reply of after.moves({ verbose: true })) {
      if (reply.to === to && reply.captured && (VALUE[reply.piece] ?? 0) < landed) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Was this the ONLY move — was it found rather than merely chosen?
 *
 * The missing half of the brilliancy test, and the browser showed why: with
 * "a sacrifice that is also best" as the whole rule, the Evans Gambit 4.b4
 * came back Brilliant. It offers a pawn and it is the engine's choice, so it
 * passed — and so would every gambit pawn ever pushed, which is the exact
 * inflation this module opens by warning about.
 *
 * What separates the Opera Game's Qb8+ from a routine gambit is not that the
 * material is bigger. It is that nothing else does the job: 4.b4, 4.d3 and
 * 4.O-O are all fine, while after 16.Qb8+ every other move throws the win
 * away. The multipv search already produced the alternatives and what each
 * was worth, so "the second-best move was much worse" is a fact on hand, not
 * a judgement.
 *
 * With no alternatives recorded — games analysed before they were stored —
 * this answers no. Brilliant then simply does not fire, which is the right
 * way to be wrong about it.
 */
function isOnlyMove(m: MoveAssessment): boolean {
  const others = (m.alts ?? []).filter((a) => !a.played)
  if (others.length === 0) return false
  const bestOther = Math.max(...others.map((a) => a.cp))
  return winChance(m.cpBest) - winChance(bestOther) >= ONLY_MOVE_MARGIN
}

/** Win-probability points the next-best move must trail by. */
const ONLY_MOVE_MARGIN = 10

export interface RateOptions {
  /** True when the position was in the opening tree and this was its move. */
  inBook?: boolean
}

/**
 * One move, rated.
 *
 * Order matters. A prepared move is Book before it is anything else; a missed
 * forced win is a Miss before it is merely a Mistake; and Brilliant is tested
 * only on moves that were already the engine's choice, so it can never be a
 * consolation prize for a bad one.
 */
export function rateMove(m: MoveAssessment, opts: RateOptions = {}): MoveRating {
  if (opts.inBook) return 'book'

  const drop = winChance(m.cpBest) - winChance(m.cpPlayed)

  // A forced win that was on the board and was not taken.
  if ((m.tag === 'missed-mate' || m.tag === 'missed-free-material') && drop >= 10) return 'miss'

  if (drop >= 30) return 'blunder'
  if (drop >= 20) return 'mistake'
  if (drop >= 10) return 'inaccuracy'

  const isBest = m.lossCp < 10
  if (isBest && m.cpPlayed >= -100 && isSacrifice(m.fen, m.uci) && isOnlyMove(m)) {
    return 'brilliant'
  }
  /*
   * GREAT: you found the only move, and it cost you nothing to find.
   *
   * Sean's chess.com screenshot reads "2 Great, 12 Best, 20 Excellent" and
   * this app had no Great at all, so every forced resource you spotted was
   * filed under the same word as a quiet developing move the engine also
   * happens to like. Those are not the same achievement.
   *
   * No new machinery: Brilliant already needed to know whether a move was
   * the ONLY one that worked, and that test on its own — without the
   * material sacrifice — is exactly what Great means. Which also fixes the
   * ordering: Brilliant is Great plus a sacrifice, so a sacrifice that
   * qualifies can never be demoted to Great by being tested first.
   */
  if (isBest && isOnlyMove(m)) return 'great'
  if (isBest) return 'best'
  if (drop < 2) return 'excellent'
  return 'good'
}

/* ------------------------------------------------------------------ */
/* The turning points                                                  */
/* ------------------------------------------------------------------ */

export interface Moment {
  /** The ply of the move being named — theirs for a gift, yours otherwise. */
  ply: number
  moveNo: number
  san: string
  /** Winning chances before and after, from YOUR point of view, always. */
  from: number
  to: number
  swing: number
  kind: 'yours-lost' | 'theirs-gave'
  /**
   * Only on a gift: the move you answered it with, and whether that answer
   * was the engine's. A present you hand straight back is not a turning
   * point, and the review should be able to say which it was.
   */
  reply?: string
  punished?: boolean
}

/**
 * Where the game actually turned — in both directions.
 *
 * The review only ever surfaced your mistakes, so a game you fought back in
 * read exactly like a game you lost quietly. Two things are worth a name:
 * where you threw it away, and where THEY handed you something.
 *
 * The second is free. Consecutive assessments bracket the opponent's reply —
 * the same derivation the bot calibration uses — so their errors are already
 * in the numbers without analysing their side of the game.
 *
 * WHY THERE IS NO "you won it back". There was one, and it was arithmetic
 * dressed as a compliment. cpBest is the ceiling of the position when it is
 * your turn, and cpPlayed can never beat it, so no move of yours can raise
 * the evaluation — every upward swing in a game is the opponent's doing. The
 * old rule compared your position now with your position two plies ago, which
 * measures THEIR error and then put your name on it: the same 43 points were
 * listed twice, once as their gift and once as your comeback. What is true,
 * and is kept, is that they gave something and you did or did not take it —
 * so the gift carries your answer with it.
 */
export function findMoments(moves: MoveAssessment[], minSwing = 15): Moment[] {
  const out: Moment[] = []

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!
    const before = winChance(m.cpBest)
    const after = winChance(m.cpPlayed)

    // What your own move did.
    const mine = before - after
    if (mine >= minSwing) {
      out.push({
        ply: m.ply, moveNo: Math.floor(m.ply / 2) + 1, san: m.san,
        from: before, to: after, swing: mine, kind: 'yours-lost',
      })
    }

    /*
     * What THEIR reply did. cpPlayed here is the position with them to move,
     * which already assumes their best answer; cpBest on your next assessment
     * is what they actually left you. The gap is their error.
     */
    const next = moves[i + 1]
    if (next && next.ply === m.ply + 2) {
      const handed = winChance(next.cpBest) - after
      if (handed >= minSwing) {
        out.push({
          ply: m.ply + 1,
          moveNo: Math.floor((m.ply + 1) / 2) + 1,
          san: theirMove(m, next) ?? '…',
          from: after, to: winChance(next.cpBest), swing: handed,
          kind: 'theirs-gave',
          reply: next.san,
          punished: next.lossCp < 10,
        })
      }
    }
  }

  return out.sort((a, b) => b.swing - a.swing)
}

/**
 * Name the opponent's move between two of yours.
 *
 * Their moves are never analysed — only yours are — but the two positions
 * that bracket the reply are both recorded, so the move itself is recoverable
 * exactly: play yours, then find the single legal move that reaches the
 * position you faced next. Without this a gift was labelled with YOUR next
 * move's notation, which read as though you had blundered in your own favour.
 */
function theirMove(m: MoveAssessment, next: MoveAssessment): string | null {
  try {
    const board = new Chess(m.fen)
    if (!board.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })) {
      return null
    }
    const want = next.fen.split(' ').slice(0, 4).join(' ')
    for (const reply of board.moves({ verbose: true })) {
      const probe = new Chess(board.fen())
      probe.move({ from: reply.from, to: reply.to, promotion: reply.promotion })
      if (probe.fen().split(' ').slice(0, 4).join(' ') === want) return reply.san
    }
    return null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export interface GameReport {
  ratings: Map<number, MoveRating>
  counts: Record<MoveRating, number>
  moments: Moment[]
  /** The single move the game turned on, if there was one. */
  decisive: Moment | null
}

export function buildReport(
  moves: MoveAssessment[],
  bookPlies: Set<number> = new Set(),
): GameReport {
  const ratings = new Map<number, MoveRating>()
  const counts = {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0,
    inaccuracy: 0, mistake: 0, blunder: 0, miss: 0,
  } as Record<MoveRating, number>

  for (const m of moves) {
    const r = rateMove(m, { inBook: bookPlies.has(m.ply) })
    ratings.set(m.ply, r)
    counts[r]++
  }

  const moments = findMoments(moves)
  return { ratings, counts, moments, decisive: moments[0] ?? null }
}
