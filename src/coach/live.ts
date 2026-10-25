/**
 * Your move, rated as you play it.
 *
 * WHY THIS EXISTS. The app has produced Brilliant / Great / Best / Excellent /
 * Good / Book / Inaccuracy / Mistake / Blunder / Missed win since report.ts
 * was written — and only ever AFTER the game, on the result screen and in the
 * review. During the game itself nothing said a word about the move you just
 * made. Sean asked where the brilliant moves were; the answer was that they
 * existed and he had to finish and then go looking.
 *
 * It rates the same way the review does, through coach/analysis.ts's
 * assessMove and coach/report.ts's rateMove, for a reason worth stating: a
 * live badge that disagrees with the review of the same move is worse than no
 * badge, and two implementations of "how bad was that" would disagree inside
 * a week.
 *
 * THE TRICK THAT MAKES IT FREE. Rating a move needs two searches — the
 * position before it and the position after. The first one can be started the
 * moment it becomes your turn, while you are still deciding, which is time
 * the engine would otherwise spend idle. So `prime` is called when the board
 * is handed to you, and by the time you move the expensive half is usually
 * already done.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: block the bot. The badge is queued behind
 * the opponent's reply rather than in front of it, because a game that pauses
 * to grade you is a game that stops feeling like a game. The badge arrives a
 * beat after the position does, and that is the right order.
 *
 * MEASURED, because "it costs nothing" is the sort of claim that should not
 * be made on reasoning alone. Driving six moves in a browser with the setting
 * off and then on, the opponent's reply took ~380ms against ~390ms, with one
 * move at 886ms. That outlier is the one case the design does not cover: a
 * primed search can still be in the queue when you move, and the engine has
 * no way to stop a search once it is running. Giving the UCI wrapper a stop
 * would fix it properly; half a second once in a while did not seem worth
 * destabilising the engine core for.
 */

import { getEngine } from '../engine/uci'
import { assessMove } from './analysis'
import { rateMove, type MoveRating } from './report'
import type { MoveAssessment } from './analysis'
import type { Analysis } from '../engine/types'

/**
 * Search depth for the live rating.
 *
 * Twelve rather than the review's fourteen. The review runs once over a
 * finished game and can take its time; this runs inside a game, on a phone,
 * sharing one WebAssembly worker with the opponent. Two plies is a second a
 * move here and almost never changes which label comes out — the labels turn
 * on win-probability bands tens of points wide, not on the last centipawn.
 */
export const LIVE_DEPTH = 12

/** Positions are keyed without the clocks, which do not change the position. */
const keyOf = (fen: string): string => fen.split(' ').slice(0, 4).join(' ')

export interface RatedMove {
  rating: MoveRating
  assessment: MoveAssessment
}

export class LiveRater {
  /**
   * The in-flight or finished search of a position it is your turn in.
   *
   * One at a time: by the time a second position arrives the first is either
   * used or irrelevant, and keeping a map of them would hold whole searches
   * alive for positions nobody will return to.
   */
  private primed: { key: string; search: Promise<Analysis | null> } | null = null

  /**
   * Start thinking about the position now, because the human is about to.
   *
   * Safe to call repeatedly with the same position — the second call reuses
   * the first search rather than starting another.
   */
  prime(fen: string, depth = LIVE_DEPTH): void {
    const key = keyOf(fen)
    if (this.primed?.key === key) return
    this.primed = {
      key,
      // Swallowed deliberately: a failed prime must degrade to "rate it the
      // slow way", never to an unhandled rejection in the middle of a game.
      search: getEngine()
        .analyse(fen, { depth, multipv: 3 })
        .catch(() => null),
    }
  }

  /** Throw away a primed search — the game moved on, or ended. */
  reset(): void {
    this.primed = null
  }

  /**
   * Rate the move that was just played from `fenBefore`.
   *
   * Returns null when the move cannot be replayed from that position, which
   * is the honest answer rather than a guess: it means the caller and the
   * board have drifted apart, and a label invented from a mismatch would be
   * about some other move entirely.
   */
  async rate(
    fenBefore: string,
    played: { from: string; to: string; promotion?: string; san: string },
    opts: { inBook?: boolean; depth?: number; ply?: number } = {},
  ): Promise<RatedMove | null> {
    const key = keyOf(fenBefore)
    const before =
      this.primed?.key === key ? ((await this.primed.search) ?? undefined) : undefined
    this.primed = null

    const assessment = await assessMove(fenBefore, played, {
      depth: opts.depth ?? LIVE_DEPTH,
      ply: opts.ply,
      before,
    })
    if (!assessment) return null
    return { rating: rateMove(assessment, { inBook: opts.inBook }), assessment }
  }
}
