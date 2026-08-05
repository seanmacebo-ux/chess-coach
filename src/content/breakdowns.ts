/**
 * Worked examples — the "learning is about breakdowns" half.
 *
 * WHY THIS EXISTS. Learn and Puzzles had become the same feature. Learn's
 * Tactics module listed eight categories, each with a Train button that picked
 * puzzles at your rating and dropped you on the Puzzles tab. Same picker, same
 * runner, different door. Sean named the split precisely: puzzles are about
 * PROGRESSION OF DIFFICULTY, learning is about BREAKDOWNS.
 *
 * So Puzzles became the Climb — one at a time, difficulty chosen by your last
 * answer — and this is the other half. A breakdown does not test you. It shows
 * one position, names the pattern, and walks the moves with the reason for each
 * one. Then it hands you to the Climb to go and find the pattern yourself.
 *
 * POSITIONS COME FROM THE CORPUS, not from memory. Every one is a real Lichess
 * puzzle that already passed the build's quality gate and the sandbox — so the
 * position is legal, the line is the engine's, and the result is what it claims.
 * Writing my own would have meant asserting eight positions I had not checked,
 * which is exactly the class of error that put "Nf6 gives f7 a second defender"
 * into the openings file.
 *
 * COVERAGE IS PARTIAL AND SAYS SO. Four of eight categories have a breakdown.
 * The others have candidate positions picked out but the explanations are not
 * written, and a wrong explanation is worse than an absent one — the whole
 * point of a breakdown is that you trust the reason. The UI shows what is
 * missing rather than pretending.
 *
 * Checked by `npm run verify:breakdowns`: every line replays legally from its
 * FEN, and every `ends` claim is asserted.
 */

import type { CategoryId } from '../coach/categories'

export interface BreakdownStep {
  /** SAN as it appears in the line. */
  san: string
  /** Why this move, in one sentence. Shown as the move lands. */
  why: string
}

export interface Breakdown {
  /** The Lichess puzzle this is taken from — provenance, and re-checkable. */
  puzzleId: string
  category: CategoryId
  /** The name of the pattern, if it has one. */
  pattern: string
  /** Position the solver sees. */
  fen: string
  /** Who is to move. */
  side: 'white' | 'black'
  /** What to look at before the moves start. */
  setup: string
  /** The full line, solver and opponent alternating, with reasons. */
  steps: BreakdownStep[]
  /** What the line achieves. Asserted by the verifier. */
  ends: 'mate' | 'winsMaterial'
  /** The one sentence to remember. */
  takeaway: string
}

export const BREAKDOWNS: Breakdown[] = [
  {
    puzzleId: 'QVxX1',
    category: 'mate',
    pattern: "Boden's Mate",
    fen: 'r3kbnr/pp3ppp/3p4/4p1B1/4P3/8/PP1K1PPP/nN3B1R w kq - 0 11',
    side: 'white',
    setup:
      'Black\'s king is stuck on e8 and its own pieces are in the way — the bishop on f8 and the pawns on f7, g7 and h7 take away half its escape squares. White has two bishops pointing at what is left.',
    steps: [
      {
        san: 'Bb5#',
        why: 'Mate. The bishop checks along b5-c6-d7-e8, and the two bishops between them cover everything: this one takes d7, the one on g5 takes d8 and e7. f8 is blocked by Black\'s own bishop. Two bishops on crossing diagonals, no escape — this pattern is called Boden\'s Mate.',
      },
    ],
    ends: 'mate',
    takeaway:
      'Two bishops on crossing diagonals mate a king whose own pieces block its escape. Look for it whenever the enemy king still has its bishop at home.',
  },
  {
    puzzleId: '03fGd',
    category: 'double-attack',
    pattern: 'Skewer',
    fen: 'r4k2/p6R/1p3p2/1Pp3p1/P5np/1K6/2P5/2B5 w - - 0 42',
    side: 'white',
    setup:
      'Black\'s king is on f8 and the rook on a8 is behind it on the same rank. That alignment is the whole tactic — a check that hits the king must pass through, and whatever is behind it cannot stay.',
    steps: [
      {
        san: 'Rh8+',
        why: 'Check along the eighth rank. This is a skewer rather than a pin: the valuable piece is in FRONT, so it has to move and expose the one behind it.',
      },
      {
        san: 'Ke7',
        why: 'Forced to step off the rank. Every square on the eighth is now covered by the rook.',
      },
      {
        san: 'Rxa8',
        why: 'And the rook falls. A whole rook for a check, because the two pieces were on one line.',
      },
    ],
    ends: 'winsMaterial',
    takeaway:
      'King and a piece on the same line is a skewer waiting to happen. Check the king, take what is behind it.',
  },
  {
    puzzleId: '1M1PP',
    category: 'pawn',
    pattern: 'Clearance for promotion',
    fen: '8/8/8/5p2/P4Br1/6P1/R2p3P/2k2K2 b - - 1 39',
    side: 'black',
    setup:
      'Black\'s pawn on d2 is one square from queening, and the only thing stopping it is that d1 must be reached safely. Black is down material and none of that matters if the pawn gets through.',
    steps: [
      {
        san: 'Rxf4+',
        why: 'A rook for a bishop, with check. The point is not the material — it is that this drags the g3 pawn away from g3, and forces White to answer instead of dealing with d2.',
      },
      {
        san: 'gxf4',
        why: 'White takes, because the check has to be answered. The g-file pawn has now been pulled off its square.',
      },
      {
        san: 'd1=Q+',
        why: 'And the pawn queens with check. Black gave up a rook to get a queen, which is a trade anybody would take.',
      },
    ],
    ends: 'winsMaterial',
    takeaway:
      'A pawn on the seventh is worth more than the piece you spend clearing its path. Count the promotion, not the material.',
  },
  {
    puzzleId: '39y9J',
    category: 'quiet',
    pattern: 'Zugzwang',
    fen: '8/8/4p3/2k1Pp2/2Pp1Pp1/6P1/4K3/8 w - - 2 49',
    side: 'white',
    setup:
      'Look at Black\'s pawns before anything else: e6 is blocked by e5, f5 is blocked by f4, g4 is blocked by g3. Not one of them can move. That means only the king has a legal move — and that is the whole idea.',
    steps: [
      {
        san: 'Kd3',
        why: 'A quiet move. No check, no capture, nothing taken — it just attacks d4 and hands the move back. Because Black\'s pawns are frozen, the king has to move, and every square it goes to gives something up.',
      },
      {
        san: 'Kc6',
        why: 'The king steps away and stops defending d4. It had no choice: it was in zugzwang, which is the position where being obliged to move is itself the problem.',
      },
      {
        san: 'Kxd4',
        why: 'The pawn falls, and with it the position. Nothing here was forcing — the win came from taking away every useful move.',
      },
    ],
    ends: 'winsMaterial',
    takeaway:
      'When the opponent has no pawn moves left, giving them the move IS the threat. Look for quiet moves before you look for checks.',
  },
]

export function breakdownFor(category: CategoryId): Breakdown | undefined {
  return BREAKDOWNS.find((b) => b.category === category)
}

/** Categories still waiting on a written explanation. Shown honestly in the UI. */
export function categoriesWithout(all: CategoryId[]): CategoryId[] {
  return all.filter((c) => !BREAKDOWNS.some((b) => b.category === c))
}
