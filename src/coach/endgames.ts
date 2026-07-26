/**
 * Theoretical endgame positions, for the play-out runner.
 *
 * The 15 endgame tiers were marked `playout` because a Lucena served as a
 * "find the move" puzzle teaches nothing — you don't spot a Lucena, you build
 * a bridge over four moves against a defender trying to stop you. Until this
 * file existed those tiers had no content at all, so the entire endgame pillar
 * was decoration.
 *
 * Every position here declares a GOAL — win it or hold it — and every goal is
 * checked against Stockfish by scripts/verify-endgames.ts before shipping.
 * That check is not ceremony: half of endgame theory is counter-intuitive
 * ("this one is a draw because the bishop is the wrong colour"), and a
 * position where I got the theory wrong would teach Sean something false and
 * then mark him down for playing it correctly.
 *
 * `moveCap` is the other half of the design. A win has to be converted within
 * a budget, otherwise shuffling for fifty moves counts as success; a draw has
 * to be held to the cap. The caps are deliberately generous — roughly double
 * the theoretical distance-to-mate — because the skill being trained is
 * technique, not speed.
 */

export interface EndgamePosition {
  id: string
  /** Concept keys, matching the `themes` on the endgame tiers. */
  concepts: string[]
  fen: string
  /** Which side you play. The engine plays the other, at full strength. */
  youPlay: 'w' | 'b'
  /** Win it, or hold the draw. */
  goal: 'win' | 'draw'
  name: string
  /** Why this position matters — the breakdown, not just the label. */
  why: string
  /** The idea, available on request. Never shown unasked. */
  hint: string
  /** Your moves. Exceed it and the attempt is recorded as failed. */
  moveCap: number
}

/*
 * On FEN correctness: every one of these is parsed by chess.js at load time in
 * the verify script, and rejected if the side to move is already checkmated,
 * stalemated, or if the position is illegal. Then the declared goal is checked
 * against a deep search. Positions are listed in the order the ladder serves
 * them.
 */
export const ENDGAMES: EndgamePosition[] = [
  /* ---------------------------------------------- tier 1: overkill mates */
  {
    id: 'ladder-2r',
    concepts: ['mate-2r', 'mate-staircase'],
    fen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Two rooks — the staircase',
    why: 'The first mate anyone should own, and the one that teaches the pattern behind all the others: you do not chase the king, you take rows away from it. One rook cuts the rank, the other cuts the next one, then they alternate. Your own king never moves.',
    hint: 'Cut the king off on a rank with one rook, then check with the other on the rank above. Repeat up the board.',
    moveCap: 20,
  },
  {
    id: 'mate-qr',
    concepts: ['mate-qr'],
    fen: '4k3/8/8/8/8/8/8/R2QK3 w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Queen and rook',
    why: 'The same staircase, but the queen covers two rows at once so it is faster. Worth doing after the two rooks because the danger changes: with a queen on the board every mate is one careless check away from stalemate.',
    hint: 'Same idea as two rooks. Take a rank away, then the next. Watch that the enemy king always has a legal move until the mate itself.',
    moveCap: 18,
  },

  /* ------------------------------------------------------ tier 2: the box */
  {
    id: 'mate-kq',
    concepts: ['mate-kq'],
    fen: '4k3/8/8/8/8/8/8/4K2Q w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'King and queen',
    why: 'The mate you will need more often than any other, because it is what every promoted pawn turns into. The queen alone cannot mate — the king does the actual work, and that is the lesson. It is also the most common stalemate in club chess.',
    hint: 'Shrink the box with the queen a knight-move away from their king, then walk your own king up. Only give check at the very end.',
    moveCap: 20,
  },
  {
    id: 'mate-kr',
    concepts: ['mate-kr'],
    fen: '4k3/8/8/8/8/8/8/4K2R w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'King and rook',
    why: 'Harder than the queen and far more instructive. The rook cannot cover both a rank and a file at once, so you have to use your king to take squares away — which is the single idea that separates people who can convert an endgame from people who cannot.',
    hint: 'Confine the king with the rook, take the opposition with your king, then check to push them back a rank. Repeat to the edge.',
    moveCap: 32,
  },

  /* ------------------------------------------------ tier 4: use your king */
  {
    id: 'opposition-win',
    concepts: ['opposition', 'king-activity'],
    fen: '8/8/8/4k3/8/4K3/4P3/8 b - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Opposition — take it',
    why: 'Kings two squares apart with the OTHER side to move: that is the opposition, and it is the whole of king-and-pawn endings in one idea. Whoever has to move first has to give ground. Here it is Black to move, so the ground is yours to take.',
    hint: 'Do not push the pawn yet. Walk the king forward and keep the opposition — the pawn follows the king, never the other way round.',
    moveCap: 24,
  },
  {
    id: 'opposition-hold',
    concepts: ['opposition', 'king-activity'],
    fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
    youPlay: 'b',
    goal: 'draw',
    name: 'Opposition — hold it',
    why: 'The same position with the move reversed, and the result flips. This is the one to sit with: nothing changed on the board, and a win became a draw. Defending it teaches the pattern harder than winning it does.',
    hint: 'Stay directly in front of the pawn and take the opposition every time the white king approaches. Step back on the file, never sideways.',
    moveCap: 30,
  },

  /* ------------------------------------------------ tier 5: king and pawn */
  {
    id: 'kp-key-squares',
    concepts: ['pawnEndgame', 'key-squares'],
    fen: '8/8/8/3k4/8/8/3PK3/8 w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Get in front of your pawn',
    why: 'A pawn on the sixth with the king in front of it wins; the same pawn with the king behind it draws. The key squares are the ones two ranks ahead of the pawn — reach any of them with your king and the pawn promotes on its own.',
    hint: 'King first. The pawn is a liability until your king has claimed the squares in front of it.',
    moveCap: 30,
  },
  {
    id: 'rook-pawn-draw',
    concepts: ['pawnEndgame', 'key-squares'],
    fen: '8/8/8/8/8/k7/P7/K7 w - - 0 1',
    youPlay: 'b',
    goal: 'draw',
    name: 'The rook-pawn exception',
    why: 'Every rule about king-and-pawn endings has one exception and this is it. A pawn on the a- or h-file has no room on one side, so the defending king cannot be pushed out of the corner. Knowing this has saved more half-points than any tactic.',
    hint: 'Get to the corner in front of the pawn and stay there. There is no square for the white king to make progress from.',
    moveCap: 30,
  },

  /* --------------------------------------------- tier 6: piece vs lone pawn */
  {
    id: 'piece-vs-pawn-stop',
    concepts: ['piece-vs-pawn'],
    fen: '8/8/8/4B3/8/1k6/p7/4K3 w - - 0 1',
    youPlay: 'w',
    goal: 'draw',
    name: 'Bishop stops the runner',
    why: 'A pawn one square from queening and a lone bishop to stop it. The bishop can only do it from a square on the same colour as the promotion square — a1 is dark, so a dark-squared bishop holds and a light-squared one is a spectator. Reading the colour before you calculate is the whole skill.',
    hint: 'Stay on the a1-h8 diagonal. The pawn cannot step onto a square you are covering, so it never queens.',
    moveCap: 24,
  },

  /* ------------------------------------------------- tier 8: rook endings I */
  {
    id: 'lucena',
    concepts: ['rookEndgame', 'lucena'],
    // White Kd8, Pd7, Re1 vs Black Kf7, Rh2. The rook on e1 is what cuts the
    // black king off the queening square; the bridge is then Re4.
    fen: '3K4/3P1k2/8/8/8/8/7r/4R3 w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Lucena — building the bridge',
    why: 'The most important winning position in rook endings, and it comes up constantly because rook endings are the most common endings there are. Your pawn is one square from queening and your own king is in its way. The bridge is how you solve that in four moves.',
    hint: 'Rook to the fourth rank first. Then walk the king out, and when the checks come, block them with the rook.',
    moveCap: 24,
  },
  {
    id: 'philidor',
    concepts: ['rookEndgame', 'philidor'],
    // Black Ke7, Rb6 vs White Ke4, Pe5, Ra1. Black's rook on the sixth is the
    // barrier the white king can never cross.
    fen: '8/4k3/1r6/4P3/4K3/8/8/R7 b - - 0 1',
    youPlay: 'b',
    goal: 'draw',
    name: 'Philidor — the third rank defence',
    why: 'The drawing half of the pair, and the one that saves you points. Sit your rook on the third rank from your side and the enemy king can never come forward. The moment the pawn advances to that rank, you drop behind and check from the back.',
    hint: 'Keep the rook on the sixth rank and just wait. When the pawn steps to the sixth, go to the first rank and check from behind.',
    moveCap: 30,
  },

  /* ------------------------------------------------ tier 9: queen vs pawn */
  {
    id: 'q-vs-centre-pawn',
    concepts: ['queenEndgame', 'q-vs-pawn'],
    fen: 'Q7/8/8/7K/8/8/3pk3/8 w - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Queen against a centre pawn',
    why: 'A pawn one square from promotion, and the queen still wins — but only by a trick. You check the king toward the pawn until it is forced to stand in front of its own pawn, which costs Black a move, and in that move your king walks closer. Repeat.',
    hint: 'Check diagonally to drive the king in front of its own pawn. Each time it blocks, bring your king one square nearer.',
    moveCap: 30,
  },
  {
    id: 'q-vs-bishop-pawn',
    concepts: ['queenEndgame', 'q-vs-pawn'],
    fen: 'Q7/8/8/7K/8/8/2p5/1k6 w - - 0 1',
    youPlay: 'w',
    goal: 'draw',
    name: 'Queen against a bishop pawn',
    why: 'The exception that makes the rule worth knowing. Against a c- or f-pawn the same driving technique fails, because when the king is forced in front of the pawn it lands in the corner and the position is stalemate. Bishop- and rook-pawns draw; everything else loses.',
    hint: 'Try the same driving method and watch it break. The stalemate resource is what saves Black.',
    moveCap: 24,
  },

  /* -------------------------------------------- tier 10: awkward bishops */
  {
    id: 'wrong-bishop',
    concepts: ['bishopEndgame', 'wrong-bishop'],
    fen: '7k/8/8/6K1/8/8/7P/5B2 w - - 0 1',
    youPlay: 'b',
    goal: 'draw',
    name: 'The wrong-coloured bishop',
    why: 'A bishop and a rook-pawn, and it is still only a draw — because the bishop does not control the square the pawn promotes on. The defending king sits in the corner and cannot be evicted. Look at the colour of h8 and the colour of the bishop before you resign.',
    hint: 'Get the king to the corner and refuse to leave. Nothing can force you out of h8.',
    moveCap: 30,
  },

  /* ----------------------------------------------- tier 11: tempo tricks */
  {
    id: 'trebuchet',
    concepts: ['trebuchet', 'pawnEndgame'],
    // White Kc6, Pb5 vs Black Ka5, Pb6. Each king simultaneously defends its
    // own pawn and attacks the other's, and the kings are two squares apart so
    // neither can improve. Found by search rather than by memory, then
    // confirmed both ways round: white to move loses, black to move loses.
    fen: '8/8/1pK5/kP6/8/8/8/8 w - - 0 1',
    youPlay: 'b',
    goal: 'win',
    name: 'The trébuchet — mutual zugzwang',
    why: 'The purest zugzwang on the board: whoever has to move loses. Each king is defending its own pawn and attacking the other one at the same time, so any king move drops a pawn. Nothing about the position decides it — only whose turn it is. Every triangulation trick in chess exists to reach a position like this with the OTHER side to move.',
    hint: 'You are not the one who has to move. Whatever White does breaks the defence of b5 — take it and escort your own pawn home.',
    moveCap: 16,
  },

  /* ------------------------------------------- tier 12: rook endings II */
  {
    id: 'rook-behind-passer',
    concepts: ['rookEndgame', 'rook-activity'],
    fen: '8/8/8/8/8/1k6/1P6/1K3R2 b - - 0 1',
    youPlay: 'w',
    goal: 'win',
    name: 'Rook and pawn, king in support',
    why: 'The practical rook ending: an extra pawn, both kings involved, and everything hinges on whether your rook is active. A passive rook defending a pawn from in front loses half the wins in this structure. Push, support, and keep the rook free.',
    hint: 'Your rook belongs behind the pawn, not in front of it. Use the king to shepherd and the rook to cut.',
    moveCap: 34,
  },
]

/** Positions matching any of these concept keys. */
export function endgamesFor(concepts: string[]): EndgamePosition[] {
  if (concepts.length === 0) return []
  const want = new Set(concepts)
  return ENDGAMES.filter((e) => e.concepts.some((c) => want.has(c)))
}

export function endgameById(id: string): EndgamePosition | undefined {
  return ENDGAMES.find((e) => e.id === id)
}

/** Concept keys that actually have a position behind them. */
export const BACKED_CONCEPTS = new Set(ENDGAMES.flatMap((e) => e.concepts))
