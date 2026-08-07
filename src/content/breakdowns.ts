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
 * COVERAGE IS NOW COMPLETE — all eight categories. It shipped at four, with
 * the UI saying so rather than pretending, because a wrong explanation is worse
 * than an absent one and the whole point of a breakdown is that you trust the
 * reason. The remaining four were chosen with `scripts/find-breakdowns.ts`,
 * which searches the corpus by motif and replays each candidate, so every
 * explanation here was written against a line that had already been checked
 * rather than one being asserted from memory.
 *
 * The `categoriesWithout` helper stays. Categories can be added, and the day
 * one is, the UI should go back to admitting the gap on its own.
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
  {
    puzzleId: 'LmWls',
    category: 'material',
    pattern: 'The trapped queen',
    fen: 'r4rk1/pp3ppp/2n2n2/3p4/8/2NNPbb1/PPPBK1Pq/R2Q3R w - - 0 18',
    side: 'white',
    setup:
      'You are in check from the bishop on f3, and it is undefended. Before you take it, look at your own rook on h1: it covers the whole h-file up to their h7-pawn — and the black queen is sitting on h2, on that file. Also worth seeing before you move: Kf1 loses on the spot to Qxh1 mate.',
    steps: [
      {
        san: 'Kxf3',
        why: 'Take it — and it is not really a choice. You have exactly two legal moves here, this and Kf1, and Kf1 is mate in one to Qxh1. Nothing defends f3 either, so the forced move is also the one that wins a piece.',
      },
      {
        san: 'Qh4',
        /*
         * The original text here said the queen "has to run" and that h4 was
         * "the only square left on the file". Both were invented. Sean called
         * it, and the engine agreed: she has seven moves, including Qxh1
         * taking the rook and two CHECKS. The lesson survives — every one of
         * the seven loses her — but that is a different and much better fact,
         * so it is the one stated now.
         */
        why: 'She has seven moves and every single one loses her. Qxh1 grabs the rook but your queen on d1 guards it along the first rank, so Qxh1 comes straight back. The two checks are just captures: Qxg2+ runs into Kxg2, Qh5+ into Rxh5. h4 at least makes you spend the rook to do it.',
      },
      {
        san: 'Rxh4',
        why: 'And that is the queen — for a rook, because the bishop on g3 covers h4 and recaptures. Queen for rook, on top of the bishop you already won. That is the cost of sending her hunting with an open file behind her.',
      },
    ],
    ends: 'winsMaterial',
    takeaway:
      'A queen sitting on a file your rook owns is not attacking, she is cornered — count her escape squares before you assume she is doing damage. And check what the CHECK is really threatening: here Kf1 loses instantly, so the free piece and the only safe square happened to be the same move.',
  },
  {
    puzzleId: 'YcC3V',
    category: 'sacrifice',
    pattern: 'Deflection',
    fen: '2r5/5pkp/2r1p1p1/p1Nn4/8/P6P/2R2PP1/2R3K1 w - - 0 29',
    side: 'white',
    setup:
      'Count the c-file. Your two rooks both hit c8. Black\'s rook on c8 is defended exactly once — by the rook on c6. Two attackers against one defender is not enough on its own, but it becomes enough the moment the defender is made to leave.',
    steps: [
      {
        san: 'Nxe6+',
        why: 'The knight takes a pawn and gives check at the same time, which is what makes this work — a check has to be answered, so Black does not get to choose whether to deal with it.',
      },
      {
        san: 'Rxe6',
        why: 'The rook takes the knight and blocks the check. It is the engine\'s choice, and it is also the move that loses: the rook on c6 was the only thing defending c8, and it has just walked off the file.',
      },
      {
        san: 'Rxc8',
        why: 'Now the count is two attackers against nothing. You gave a knight, you took a pawn and a rook, and the rook on e6 cannot come back.',
      },
    ],
    ends: 'winsMaterial',
    takeaway:
      'A defender that has to move is not a defender. When a piece is doing one important job, find the check that makes it do something else.',
  },
  {
    puzzleId: '0SKnZ',
    category: 'attack',
    pattern: "Pillsbury's Mate",
    fen: '3r2k1/1p3pp1/1qpr3p/3n1B2/1P6/2P2PP1/4QRKP/4R3 w - - 6 29',
    side: 'white',
    setup:
      'Black\'s king on g8 has pawns on f7 and g7 and no luft. Count what covers its escape squares: your rook on e1 owns the e-file, and — this is the piece people miss — the bishop on f5 covers h7 from a long way off. The king already has nowhere to go. All that is left is getting a rook to the back rank.',
    steps: [
      {
        san: 'Qe8+',
        why: 'The queen, for free. It is not a blunder and it is not hope — it is a deflection: the rook on d8 is the only thing guarding e8, and this forces it to capture and stop guarding.',
      },
      {
        san: 'Rxe8',
        why: 'Forced. It is check, the king cannot move, and nothing else can block on the e-file.',
      },
      {
        san: 'Rxe8#',
        why: 'Mate. f8 is covered by the rook that just landed, g7 is blocked by Black\'s own pawn, and h7 — the one real escape — is covered by that bishop on f5 you counted at the start.',
      },
    ],
    ends: 'mate',
    takeaway:
      'Attacks are arithmetic. Count the escape squares and what covers each one BEFORE you calculate — the sacrifice is only sound because a bishop three squares away was already doing its job.',
  },
  {
    puzzleId: '0TDwx',
    category: 'endgame',
    pattern: 'Rook and king on the edge',
    fen: '6R1/5r2/p5p1/5p1k/P4K2/8/8/8 w - - 0 47',
    side: 'white',
    setup:
      'Four pawns and a rook each, and it is already over. Black\'s king is on h5 — the edge — and your king on f4 covers g4 and g5, which are the only two squares off the h-file it could use. Your rook does the rest.',
    steps: [
      {
        san: 'Rh8+',
        why: 'The rook swings to the file the king is stuck on. It cannot run to g4 or g5 because your king covers both, so the check has to be blocked.',
      },
      {
        san: 'Rh7',
        why: 'The only move — the rook interposes. It also loses the rook, which tells you the position was lost two moves ago rather than here.',
      },
      {
        san: 'Rxh7#',
        why: 'Mate. The rook covers the whole h-file, your king covers g4 and g5, and g6 is Black\'s own pawn. King and rook, nothing else needed.',
      },
    ],
    ends: 'mate',
    takeaway:
      'In rook endings the king does the cutting off and the rook does the checking. Put your king where the enemy king wants to run, then bring the rook.',
  },
]

export function breakdownFor(category: CategoryId): Breakdown | undefined {
  return BREAKDOWNS.find((b) => b.category === category)
}

/** Categories still waiting on a written explanation. Shown honestly in the UI. */
export function categoriesWithout(all: CategoryId[]): CategoryId[] {
  return all.filter((c) => !BREAKDOWNS.some((b) => b.category === c))
}
