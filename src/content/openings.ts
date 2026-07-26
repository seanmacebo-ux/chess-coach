/**
 * Opening repertoire, with reasons.
 *
 * The brief was explicit: not a list of moves, but why this opening, what it
 * gives you, what you concede, and where the attack comes from. So every entry
 * carries all four, and the moves are almost the least important field.
 *
 * The selection rule is "openings at your level", and that is a real
 * constraint rather than a label. At 1200-1500 the sharp theoretical lines
 * punish you for forgetting move twelve — which teaches nothing, because the
 * mistake was memory rather than chess. The openings here all produce the SAME
 * structures every game, so what you learn is the plan. The band on each entry
 * is what enforces that; nothing outside your band is ever recommended.
 *
 * Move sequences are checked by scripts/verify-openings.ts, which replays every
 * line through chess.js. A typo in a SAN token would otherwise ship as
 * confident, unplayable advice.
 */

export type Side = 'white' | 'black'

export interface Opening {
  id: string
  name: string
  side: Side
  /** What it answers, for black repertoire entries. */
  against: string | null
  /** Rating window this is genuinely the right tool for. */
  band: [number, number]
  /** The line in SAN, from the starting position. */
  line: string[]
  kind: 'repertoire' | 'trap'
  /** Why play this at all. */
  why: string
  /** What you get. */
  gives: string
  /** What you give up. Every opening concedes something. */
  concedes: string
  /** Where the pressure goes, and on which squares. */
  attack: string
  /** The middlegame plan, in order. */
  plans: string[]
  /** The thing that catches people out. */
  watchOut: string
}

export const OPENINGS: Opening[] = [
  /* ============================================================ WHITE */
  {
    id: 'italian',
    name: 'Italian Game',
    side: 'white',
    against: null,
    band: [600, 1700],
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    kind: 'repertoire',
    why: 'The fastest sound development in chess, and the best first opening anyone can own. Three moves and you have a knight and a bishop out, the centre contested, and castling available. Nothing has to be memorised because every move does an obvious job.',
    gives: 'Immediate piece activity, a safe king by move six, and a bishop already aimed at the one weak square in the enemy camp.',
    concedes: 'No lasting advantage. Black equalises with accurate play — but at your level that accuracy is exactly what is missing, and this is the opening that punishes its absence.',
    attack: 'f7. It is defended by the king and nothing else, and the bishop on c4 stares straight at it down the a2-g8 diagonal. Later the attack shifts to the centre with the d3-d4 push, which opens lines toward the black king once it has castled.',
    plans: [
      'Castle, then play c3 and d4 to build the big centre.',
      'Rook to e1, taking the file the pawns are about to open.',
      'Only go Ng5 when f7 is genuinely under-defended — otherwise the knight is just misplaced.',
      'If Black locks the centre, switch the knight b1-d2-f1-g3 toward the kingside.',
    ],
    watchOut: 'After 3...Nf6 the Fried Liver (4.Ng5) is a real attempt and you should know it from both sides. Learn it as the trap below rather than as a surprise.',
  },
  {
    id: 'london',
    name: 'London System',
    side: 'white',
    against: null,
    band: [800, 2000],
    line: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Be7', 'Bd3', 'O-O', 'Nbd2', 'c5', 'c3'],
    kind: 'repertoire',
    why: 'The lowest-theory opening that is still fully sound. You play roughly the same six moves against almost anything Black does, which means the time you would have spent on memorisation goes into understanding the middlegame instead. For someone building a repertoire while also learning tactics and endgames, that trade is the whole point.',
    gives: 'The same structure every single game, so you accumulate real pattern knowledge. The dark-squared bishop gets outside the pawn chain before e3 locks it in — which is the one thing the London gets right that most d4 systems get wrong.',
    concedes: 'No opening advantage at all. Black equalises comfortably with correct play, and you are playing for a middlegame rather than an edge out of the opening.',
    attack: 'The kingside, specifically h7. The formation Bd3 plus Ne5 plus Qf3 or Qh5 creates a battery on the b1-h7 diagonal, and the knight on e5 is the piece that makes it work. If Black ever weakens with ...h6 or ...g6, that is the signal.',
    plans: [
      'Complete the setup first: Bf4, e3, Nf3, Bd3, c3, Nbd2. Do not deviate to be clever.',
      'Land a knight on e5 supported by the d-pawn and the other knight.',
      'Build the battery toward h7, then consider Qf3-h3 or a rook lift.',
      'If Black plays on the queenside, meet ...c5 with c3 and keep the centre firm.',
    ],
    watchOut: '...c5 followed by ...Qb6 hits b2 while your bishop is on f4 and cannot defend it. The answer is Qb3 offering the trade, or Nc3 — decide which one you play now, not at the board.',
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    side: 'white',
    against: null,
    band: [1300, 2000],
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6', 'c3', 'Nge7'],
    kind: 'repertoire',
    why: 'The way out of the Ruy Lopez theory wall. You open the centre on move three, which suits a player who wants pieces fighting rather than a long manoeuvring game — and it sidesteps a body of theory that would otherwise take a year to learn properly.',
    gives: 'An open position with every piece having somewhere to go, a half-open e-file for the rook, and a lead in development that is real rather than notional.',
    concedes: 'The central tension resolves immediately, so Black gets a clear target too. Your knight on d4 can be hit with tempo, and if you are careless the initiative evaporates by move ten.',
    attack: 'The e-file and the f7/e6 complex. With the centre open, whichever rook reaches e1 first tends to decide the game, and Black\'s king often gets stuck in the middle.',
    plans: [
      'Recapture with the knight, then support it with c3 before Black can chase it.',
      'Be3 and Qd2, then choose a side to castle based on where Black\'s king goes.',
      'Rook to e1 or d1 depending on which file opens.',
      'Trade into an endgame if you win the bishop pair — the Scotch structures favour it.',
    ],
    watchOut: '4...Qh4 looks like a beginner move and is actually the critical test. Know that 5.Nc3 (or 5.Nb5) is the answer before you play the opening, not after.',
  },

  /* ================================================= BLACK vs 1.e4 */
  {
    id: 'scandinavian',
    name: 'Scandinavian Defence',
    side: 'black',
    against: '1.e4',
    band: [600, 1400],
    line: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5'],
    kind: 'repertoire',
    why: 'You get to play the same first three moves against 1.e4 for the rest of your life. That is not laziness — it is the correct trade when your study time is better spent on tactics. It also forces the game onto your terms immediately, before White can choose a system.',
    gives: 'An immediate challenge to the centre, easy natural development for every piece, and a theory load small enough to actually hold in your head.',
    concedes: 'The queen comes out on move two and gets chased, which costs time. You are effectively a tempo down in development for the first ten moves and have to know where the queen is safe.',
    attack: 'The c-file and the light squares. After ...c6 and ...Bf5 your bishop is outside the pawn chain and both rooks have somewhere useful to go. The break is usually ...e5 or ...c5 once you are castled.',
    plans: [
      'Get the queen to a safe square — a5 or d6 — and stop moving it.',
      'Play ...c6 and ...Bf5 to develop the light-squared bishop before ...e6 shuts it in.',
      'Then ...e6, ...Nbd7, ...Be7, castle.',
      'Only after castling, look for ...c5 or ...e5 to hit the centre.',
    ],
    watchOut: 'Every knight and bishop move White makes may come with tempo on your queen. Before you place the queen, check what can attack it in two moves — that habit alone is worth the opening.',
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defence',
    side: 'black',
    against: '1.e4',
    band: [1200, 2200],
    line: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6'],
    kind: 'repertoire',
    why: 'This is the one to graduate to, and the reason is structural. The French Defence has the same solidity but buries the light-squared bishop behind its own pawns for the whole game; the Caro-Kann challenges the centre exactly as hard while getting that bishop out to f5 first. It is the same idea with the flaw removed.',
    gives: 'A pawn structure that does not create weaknesses, the good bishop developed outside the chain, and endgames that are reliably pleasant because your pawns are healthy.',
    concedes: 'Space, and a middlegame where you are often reacting rather than dictating. You need patience — the position rewards it, but it rarely offers a quick knockout.',
    attack: 'The queenside and the c-file, which is half-open the moment you play ...c6 and trade on d5. The central break is ...c5 later, timed for after you have castled, and against the Advance Variation it is the main source of counterplay.',
    plans: [
      'Trade on e4 and develop the bishop to f5 before playing ...e6.',
      'Then ...e6, ...Nd7, ...Ngf6, ...Qc7 and castle.',
      'Aim for the ...c5 break once the king is safe.',
      'In the endgame, your structure is better — trade pieces when the chance comes.',
    ],
    watchOut: 'The Advance Variation (3.e5) is what you will meet most, and after 3...Bf5 White plays 4.Nc3 e6 5.g4 hitting your bishop. Decide now whether that bishop goes to g6 or back to d7, because working it out at the board goes badly.',
  },

  /* ================================================= BLACK vs 1.d4 */
  {
    id: 'qgd',
    name: "Queen's Gambit Declined",
    side: 'black',
    against: '1.d4',
    band: [1100, 2200],
    line: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6'],
    kind: 'repertoire',
    why: 'The most reliable answer to 1.d4 ever played, and it has been at the top level for a hundred and fifty years for one reason: it is very hard to be worse. You take a firm share of the centre on move two and every piece has an obvious square.',
    gives: 'A solid grip on d5, clear and repeatable plans, and a position where you rarely get blown off the board. Good preparation for everything else because the structures recur across many openings.',
    concedes: 'The c8 bishop is temporarily passive behind the e6 pawn, and freeing it is a real task rather than an afterthought. If you never solve that, you get squeezed.',
    attack: 'The c-file, opened when you play ...dxc4 and follow with ...c5. That break is the whole strategic point of the opening — everything before it is preparation for it.',
    plans: [
      '...Nf6, ...Be7, castle, ...h6 to ask the bishop a question.',
      'Then choose: ...dxc4 followed by ...c5, or ...Nbd7 and ...c6 for the solid setup.',
      'Free the light-squared bishop via ...b6 and ...Bb7, or after ...dxc4 via ...b5.',
      'Contest the c-file with a rook once it opens.',
    ],
    watchOut: 'The Exchange Variation (cxd5 exd5) gives White a queenside minority attack — b4-b5 aiming to leave you with a backward c-pawn. Meet it with kingside play rather than trying to hold everything.',
  },
  {
    id: 'slav',
    name: 'Slav Defence',
    side: 'black',
    against: '1.d4',
    band: [1300, 2200],
    line: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6'],
    kind: 'repertoire',
    why: 'The Queen\'s Gambit Declined with its one flaw fixed. You support d5 with the c-pawn instead of the e-pawn, which leaves the diagonal open so the light-squared bishop can come out to f5 before you close it in. Same solidity, better bishop.',
    gives: 'The good bishop developed early, a very hard structure to crack, and the option of grabbing the c4 pawn and holding it with ...b5.',
    concedes: 'The c6 square is taken by a pawn, so the b8 knight has to go to d7 and can feel cramped. You also have less immediate central presence than the QGD.',
    attack: 'The queenside, and the c4 pawn specifically. Taking on c4 and supporting it with ...b5 gives you real space there, and the a-file often opens for your rook.',
    plans: [
      '...Nf6 and ...dxc4 at the right moment, before White plays e3 and can recapture easily.',
      'Get the bishop to f5 or g4 before playing ...e6.',
      '...e6, ...Nbd7, ...Be7, castle.',
      'Look for ...c5 or ...e5 to break out of the slightly cramped centre.',
    ],
    watchOut: 'If you take on c4 too early White plays e4 with a big centre. The move order matters here more than in the QGD — take when White has committed the bishop or the a-pawn.',
  },

  /* ================================================================ TRAPS */
  {
    id: 'scholars-mate',
    name: "Scholar's Mate — how to refuse it",
    side: 'black',
    against: '1.e4',
    band: [600, 1200],
    line: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'g6', 'Qf3', 'Nf6'],
    kind: 'trap',
    why: 'The single most common way a beginner loses, and the single most common way a beginner wins — which means learning it removes a whole category of games from both sides of your record. The queen and bishop both hit f7 and mate arrives on move four.',
    gives: 'Once you know it, an early queen sortie is a gift: it wastes White\'s time and you develop with tempo while chasing it.',
    concedes: 'Nothing. Refusing it correctly leaves you better.',
    attack: 'After you defend, you attack the queen. Every developing move you make comes with a threat to it, and that is how you convert their impatience into your lead.',
    plans: [
      'Meet Qh5 with ...g6, attacking the queen and covering f7 at the same time.',
      'When the queen goes to f3, play ...Nf6 — now f7 has a second defender and the knight is developed.',
      'Then ...Bg7, castle, and use the extra tempi.',
    ],
    watchOut: 'The losing move is 3...Nf6??, which develops but ignores f7 — Qxf7 is mate. Defend the square first, develop second. That order is the lesson.',
  },
  {
    id: 'fried-liver',
    name: 'Fried Liver — surviving it',
    side: 'black',
    against: '1.e4',
    band: [800, 1500],
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5'],
    kind: 'trap',
    why: 'The most dangerous real attack you will meet below 1600. White sacrifices a knight on f7 and drags your king into the open on move six. It is genuinely strong, and the difference between knowing the defence and not is the whole game.',
    gives: 'Playing ...Na5 instead of recapturing hits the bishop, wins back the pawn, and leaves you with a comfortable game while White has nothing.',
    concedes: 'A pawn temporarily, and the knight on a5 is offside for a few moves.',
    attack: 'Once the dust settles you have the bishop pair and a lead in development. The counter-attack comes on the queenside and down the e-file.',
    plans: [
      'After 4.Ng5 play ...d5 — you must challenge the centre, not defend f7 passively.',
      'On 5.exd5, play ...Na5 hitting the bishop. Do NOT play ...Nxd5.',
      'Follow with ...h6 to kick the knight, then develop and castle.',
    ],
    watchOut: '5...Nxd5?? is the losing move — 6.Nxf7 and your king is dragged to f7 with the queen coming to f3. This is the one line in the whole repertoire worth memorising exactly.',
  },
  {
    id: 'legal-mate',
    name: "Legal's Mate — the pin that isn't",
    side: 'white',
    against: null,
    band: [800, 1400],
    line: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'],
    kind: 'trap',
    why: 'The best illustration in chess of a pin being an illusion. Black pins your knight to the queen, you ignore it, give up the queen, and mate with three minor pieces. Worth knowing mostly so you never fall for the reverse.',
    gives: 'A finish, when Black is careless. More usefully: the permanent habit of asking whether a pin is actually binding.',
    concedes: 'Everything, if Black declines correctly — do not go hunting for this. It is a pattern to recognise, not a plan to aim for.',
    attack: 'f7 again, with the bishop, supported by knights landing on e5 and d5.',
    plans: [
      'Recognise the setup: their bishop on g4 pinning your f3 knight, your bishop already on c4.',
      'The move is Nxe5 — the pin does not hold because the mate is faster than the queen.',
      'Bxf7+ then Nd5 is the finish.',
    ],
    watchOut: 'If Black plays ...Nc6 or takes the knight instead of the queen, you are just a piece down. Only play this when the exact position is on the board.',
  },
]

/**
 * Openings genuinely aimed at this rating.
 *
 * This is the enforcement of "always choose ones on my level" — nothing
 * outside the band is returned, so the app cannot recommend a Najdorf to
 * someone who is still hanging pieces.
 */
export function openingsAtRating(rating: number): Opening[] {
  return OPENINGS.filter((o) => rating >= o.band[0] && rating <= o.band[1])
}

export function openingsFor(side: Side, rating?: number): Opening[] {
  const pool = rating === undefined ? OPENINGS : openingsAtRating(rating)
  return pool.filter((o) => o.side === side)
}

export function openingById(id: string): Opening | undefined {
  return OPENINGS.find((o) => o.id === id)
}
