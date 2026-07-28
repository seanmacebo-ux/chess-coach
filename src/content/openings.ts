/**
 * Opening repertoire, with reasons — and with the variations you actually meet.
 *
 * The brief was explicit: not a list of moves, but why this opening, what it
 * gives you, what you concede, and where the attack comes from. So every entry
 * carries all four, and the moves are almost the least important field.
 *
 * WHY THIS FILE WAS RESTRUCTURED. Every opening used to hold exactly one line,
 * while the prose around it kept naming variations you could not see: the Fried
 * Liver in the Italian, the Advance in the Caro-Kann, the Exchange in the QGD,
 * 4...Qh4 in the Scotch. So the text described a decision tree and the board
 * showed a single path through it, which is precisely the thing that makes an
 * opening "hard to see the use cases for". Openings are not sequences. They are
 * a main road plus the handful of turnings your opponent can actually take, and
 * the whole skill is recognising which one you are on.
 *
 * So `lines` replaces `line`. Each carries a ROLE:
 *
 *   main      — what happens when nobody deviates. Learn this one first.
 *   critical  — a genuine, sound alternative. You must have an answer ready.
 *   punish    — someone played a losing move. This is how it gets refuted.
 *   sideline  — a different set-up that changes your plan but not your health.
 *
 * The selection rule is "openings at your level", and that is a real constraint
 * rather than a label. At 1200-1500 the sharp theoretical lines punish you for
 * forgetting move twelve — which teaches nothing, because the mistake was
 * memory rather than chess. The openings here all produce the SAME structures
 * every game, so what you learn is the plan.
 *
 * VERIFICATION. `npm run verify:openings` replays every line through chess.js
 * and evaluates the final position with Stockfish. The old header claimed this
 * check existed; the script did not. Every `ends` claim below is therefore
 * asserted mechanically — a line saying "mate" that is not mate fails the run,
 * and every evaluation quoted in prose came out of that script rather than out
 * of memory.
 */

export type Side = 'white' | 'black'

/** How a line relates to the main road. See the file header. */
export type LineRole = 'main' | 'critical' | 'punish' | 'sideline'

/**
 * What the line is claimed to end in. Checked by verify:openings, so it is
 * evidence rather than decoration.
 *
 * `mate`     — the final position is checkmate. Exact, from chess.js.
 * `winning`  — the engine scores the final position at least +150cp for the
 *              side named in `favours`. Anything less is not a refutation and
 *              should not be taught as one.
 * `edge`     — between +80 and +150cp. A clear advantage that is not a win.
 * `balanced` — inside ±80cp. The honest ending for most main lines, and worth
 *              stating: an opening that promises an advantage it does not have
 *              is how people learn to feel cheated by theory.
 *
 * `edge` exists because the verifier refused to let a claim through. The Fried
 * Liver was written up here as "a piece down and completely winning" — the
 * received wisdom, and repeated in a lot of books. Stockfish scores the final
 * position at +0.96, which is a big advantage and nowhere near a forced win;
 * Black holds with ...Ncb4. Rather than widen `winning` until the claim fitted,
 * the band that describes the truth got a name. That distinction is worth
 * teaching on its own: the scariest attack you meet under 1600 is worth about
 * a pawn, not the game.
 */
export type LineEnd = 'mate' | 'winning' | 'edge' | 'balanced'

export interface OpeningLine {
  id: string
  name: string
  role: LineRole
  /** The line in SAN, from the starting position. */
  moves: string[]
  /** The trigger — how you know you are in this line. */
  when: string
  /** What you do about it, and why that is the move. */
  answer: string
  /**
   * For `punish` lines: the SAN of the move that loses. Must appear in `moves`;
   * the verifier checks it does, so a renamed move cannot silently orphan it.
   */
  blunder?: string
  /** Asserted outcome, checked by the verifier. */
  ends: LineEnd
  /** Which side `ends` is claimed for. */
  favours: Side
}

export interface Opening {
  id: string
  name: string
  side: Side
  /** What it answers, for black repertoire entries. */
  against: string | null
  /** Rating window this is genuinely the right tool for. */
  band: [number, number]
  /** The main road first, then the turnings. */
  lines: OpeningLine[]
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
    kind: 'repertoire',
    lines: [
      {
        id: 'italian-main',
        name: 'Giuoco Pianissimo',
        role: 'main',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
        when: 'Black mirrors you with 3...Bc5. The most common reply by a distance.',
        answer:
          'Build before you break. c3 and d3 prepare d4 without opening the position while your king is still in the middle. Castle, put a rook on e1, and only then push.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'italian-two-knights',
        name: 'Two Knights — 3...Nf6',
        role: 'critical',
        moves: [
          'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5',
          'Bb5+', 'c6', 'dxc6', 'bxc6', 'Be2',
        ],
        when: 'Black develops the knight rather than the bishop, leaving f7 defended only by the king.',
        answer:
          '4.Ng5 is the critical try and it is sound. Black should answer 4...d5, and after 5.exd5 the right move is 5...Na5 hitting your bishop. You keep a pawn for a while; Black gets activity. This is a real game, not a refutation.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'italian-fried-liver',
        name: 'Fried Liver Attack',
        role: 'punish',
        moves: [
          'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5',
          'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3',
        ],
        blunder: 'Nxd5',
        when: 'Black recaptures on d5 with the knight instead of playing 5...Na5.',
        answer:
          'Nxf7 is the point: the king is dragged to f7 and then to e6, where it stands in the open with the queen and both knights coming. Worth knowing exactly what you have here — about +1, not a forced win. Black defends with ...Ncb4 and survives with accurate play. It is the best practical try in the opening and it is not a refutation.',
        ends: 'edge',
        favours: 'white',
      },
    ],
    why: 'The fastest sound development in chess, and the best first opening anyone can own. Three moves and you have a knight and a bishop out, the centre contested, and castling available. Nothing has to be memorised because every move does an obvious job.',
    gives:
      'Immediate piece activity, a safe king by move six, and a bishop already aimed at the one weak square in the enemy camp.',
    concedes:
      'No lasting advantage. Black equalises with accurate play — but at your level that accuracy is exactly what is missing, and this is the opening that punishes its absence.',
    attack:
      'f7. It is defended by the king and nothing else, and the bishop on c4 stares straight at it down the a2-g8 diagonal. Later the attack shifts to the centre with the d3-d4 push, which opens lines toward the black king once it has castled.',
    plans: [
      'Castle, then play c3 and d4 to build the big centre.',
      'Rook to e1, taking the file the pawns are about to open.',
      'Only go Ng5 when f7 is genuinely under-defended — otherwise the knight is just misplaced.',
      'If Black locks the centre, switch the knight b1-d2-f1-g3 toward the kingside.',
    ],
    watchOut:
      'The whole opening forks on move three. Against 3...Bc5 you are in a slow manoeuvring game; against 3...Nf6 you can play Ng5 and the game turns sharp immediately. Know which one you are in before you move.',
  },
  {
    id: 'london',
    name: 'London System',
    side: 'white',
    against: null,
    band: [800, 2000],
    kind: 'repertoire',
    lines: [
      {
        id: 'london-main',
        name: 'The set-up',
        role: 'main',
        moves: [
          'd4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Be7', 'Bd3', 'O-O',
          'Nbd2', 'c5', 'c3',
        ],
        when: 'Black plays ...d5 and develops normally. Most games.',
        answer:
          'Play the same six moves in roughly any order: Bf4, e3, Nf3, Bd3, Nbd2, c3. The bishop goes outside the pawn chain BEFORE e3 locks it in — that single move order is what the London gets right and most d4 systems get wrong.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'london-qb6',
        name: '...Qb6 hitting b2',
        role: 'critical',
        moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'c5', 'c3', 'Qb6', 'Qb3'],
        when: 'Black plays ...c5 and then ...Qb6, hitting b2 while your bishop sits on f4 and cannot come back to defend it.',
        answer:
          'Qb3 offers the trade. If Black takes, you recapture toward the centre and get the half-open a-file; if the queen retreats, you have gained time for free. Decide this now — working it out at the board is how the London loses its pawn.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'london-kid',
        name: 'Against the fianchetto',
        role: 'sideline',
        moves: ['d4', 'Nf6', 'Bf4', 'g6', 'Nf3', 'Bg7', 'e3', 'O-O', 'Be2', 'd6', 'h3'],
        when: 'Black plays ...g6 and ...Bg7 instead of ...d5, aiming for a King\'s Indian shape.',
        answer:
          'Two changes and only two. Be2 rather than Bd3, because the g6 pawn has closed the b1-h7 diagonal your bishop was aiming down. And h3 early, so ...Nh5 can never hit the f4 bishop. Everything else is the same set-up.',
        ends: 'balanced',
        favours: 'white',
      },
    ],
    why: 'The lowest-theory opening that is still fully sound. You play roughly the same six moves against almost anything Black does, which means the time you would have spent on memorisation goes into understanding the middlegame instead. For someone building a repertoire while also learning tactics and endgames, that trade is the whole point.',
    gives:
      'The same structure every single game, so you accumulate real pattern knowledge. The dark-squared bishop gets outside the pawn chain before e3 locks it in — which is the one thing the London gets right that most d4 systems get wrong.',
    concedes:
      'No opening advantage at all. Black equalises comfortably with correct play, and you are playing for a middlegame rather than an edge out of the opening.',
    attack:
      'The kingside, specifically h7. The formation Bd3 plus Ne5 plus Qf3 or Qh5 creates a battery on the b1-h7 diagonal, and the knight on e5 is the piece that makes it work. If Black ever weakens with ...h6 or ...g6, that is the signal.',
    plans: [
      'Complete the setup first: Bf4, e3, Nf3, Bd3, c3, Nbd2. Do not deviate to be clever.',
      'Land a knight on e5 supported by the d-pawn and the other knight.',
      'Build the battery toward h7, then consider Qf3-h3 or a rook lift.',
      'If Black plays on the queenside, meet ...c5 with c3 and keep the centre firm.',
    ],
    watchOut:
      'The h7 attack only exists while the b1-h7 diagonal is open. The moment Black plays ...g6 your whole plan changes — that is the fianchetto line above, and the bishop belongs on e2 instead.',
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    side: 'white',
    against: null,
    band: [1300, 2000],
    kind: 'repertoire',
    lines: [
      {
        id: 'scotch-main',
        name: 'Classical — 4...Bc5',
        role: 'main',
        moves: [
          'e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6',
          'c3', 'Nge7',
        ],
        when: 'Black develops the bishop to c5, hitting your knight on d4.',
        answer:
          'Be3 supports the knight and offers the trade; c3 gives it a permanent home. Black gets a comfortable game but the position is open and every piece has a job, which is what you came for.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'scotch-mieses',
        name: 'Mieses — 4...Nf6',
        role: 'critical',
        moves: [
          'e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nxc6', 'bxc6',
          'e5', 'Qe7', 'Qe2', 'Nd5', 'c4', 'Ba6',
        ],
        when: 'Black hits e4 with the knight instead of developing the bishop.',
        answer:
          'Nxc6 first, so the recapture wrecks Black\'s queenside pawns, then e5 kicks the knight. This is the most theoretical line in the whole repertoire and the one place where knowing eight moves genuinely matters.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'scotch-steinitz',
        name: 'Steinitz — 4...Qh4',
        role: 'critical',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Qh4', 'Nb5'],
        when: 'Black throws the queen out to h4 on move four, hitting e4 and eyeing f2.',
        answer:
          'It looks like a beginner move and it is actually the critical test. Nb5 is the answer: it defends nothing and threatens Nxc7+ forking king and rook, so Black has to deal with that before collecting anything. Have this decided before you play the Scotch, not after.',
        ends: 'balanced',
        favours: 'white',
      },
    ],
    why: 'The way out of the Ruy Lopez theory wall. You open the centre on move three, which suits a player who wants pieces fighting rather than a long manoeuvring game — and it sidesteps a body of theory that would otherwise take a year to learn properly.',
    gives:
      'An open position with every piece having somewhere to go, a half-open e-file for the rook, and a lead in development that is real rather than notional.',
    concedes:
      'The central tension resolves immediately, so Black gets a clear target too. Your knight on d4 can be hit with tempo, and if you are careless the initiative evaporates by move ten.',
    attack:
      "The e-file and the f7/e6 complex. With the centre open, whichever rook reaches e1 first tends to decide the game, and Black's king often gets stuck in the middle.",
    plans: [
      'Recapture with the knight, then support it with c3 before Black can chase it.',
      "Be3 and Qd2, then choose a side to castle based on where Black's king goes.",
      'Rook to e1 or d1 depending on which file opens.',
      'Trade into an endgame if you win the bishop pair — the Scotch structures favour it.',
    ],
    watchOut:
      'Move four is the fork in the road: 4...Bc5 is a normal game, 4...Nf6 is the theory-heavy one, and 4...Qh4 is the surprise. All three are in the lines above and you need a first move for each.',
  },

  /* ================================================= BLACK vs 1.e4 */
  {
    id: 'scandinavian',
    name: 'Scandinavian Defence',
    side: 'black',
    against: '1.e4',
    band: [600, 1400],
    kind: 'repertoire',
    lines: [
      {
        id: 'scandi-main',
        name: 'Main line — 3...Qa5',
        role: 'main',
        moves: [
          'e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6',
          'Bc4', 'Bf5',
        ],
        when: 'White takes on d5 and you recapture with the queen. The standard game.',
        answer:
          'Queen to a5 where it is out of the way of the knights, then ...c6 gives it a retreat square and ...Bf5 gets the light-squared bishop OUT before ...e6 shuts it in. That bishop is the whole point of the move order.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'scandi-qd6',
        name: 'Modern — 3...Qd6',
        role: 'sideline',
        moves: [
          'e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd6', 'd4', 'Nf6', 'Nf3', 'c6',
          'Ne5', 'Nbd7',
        ],
        when: 'You want the same opening with the queen on a square nobody can hit with tempo.',
        answer:
          'Qd6 keeps the queen central and off the b4-a5 diagonal, so Bd2 and Nb5 ideas do not come with gain of time. Slightly more modern, slightly less natural to play. Pick one and stay with it.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'scandi-nc3-first',
        name: 'White declines with 2.Nc3',
        role: 'critical',
        moves: ['e4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'd4', 'Ngf6', 'Nxf6+', 'Nxf6'],
        when: 'White develops instead of capturing, hoping you have only learned the recapture lines.',
        answer:
          'Take on e4 anyway. ...Nd7 first, so that when the knights trade you recapture with a knight and never have to move the queen at all — the queen sortie was a cost you were paying, and here you simply do not pay it.',
        ends: 'balanced',
        favours: 'white',
      },
    ],
    why: 'You get to play the same first three moves against 1.e4 for the rest of your life. That is not laziness — it is the correct trade when your study time is better spent on tactics. It also forces the game onto your terms immediately, before White can choose a system.',
    gives:
      'An immediate challenge to the centre, easy natural development for every piece, and a theory load small enough to actually hold in your head.',
    concedes:
      'The queen comes out on move two and gets chased, which costs time. You are effectively a tempo down in development for the first ten moves and have to know where the queen is safe.',
    attack:
      'The c-file and the light squares. After ...c6 and ...Bf5 your bishop is outside the pawn chain and both rooks have somewhere useful to go. The break is usually ...e5 or ...c5 once you are castled.',
    plans: [
      'Get the queen to a safe square — a5 or d6 — and stop moving it.',
      'Play ...c6 and ...Bf5 to develop the light-squared bishop before ...e6 shuts it in.',
      'Then ...e6, ...Nbd7, ...Be7, castle.',
      'Only after castling, look for ...c5 or ...e5 to hit the centre.',
    ],
    watchOut:
      'Every knight and bishop move White makes may come with tempo on your queen. Before you place the queen, check what can attack it in two moves — that habit alone is worth the opening.',
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defence',
    side: 'black',
    against: '1.e4',
    band: [1200, 2200],
    kind: 'repertoire',
    lines: [
      {
        id: 'caro-classical',
        name: 'Classical — 3.Nc3',
        role: 'main',
        moves: [
          'e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6',
          'h4', 'h6',
        ],
        when: 'White develops the knight and lets you trade on e4.',
        answer:
          'Trade, then ...Bf5 immediately. This is the entire idea of the Caro-Kann over the French: the light-squared bishop gets outside the pawn chain BEFORE ...e6 locks it behind. Meet h4 with ...h6 so the bishop always has g6-h7 to retreat along.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'caro-advance',
        name: 'Advance — 3.e5',
        role: 'critical',
        moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'O-O', 'Nc6'],
        when: 'White pushes past instead of trading. This is what you will meet most often below 1800.',
        answer:
          'Get the bishop out to f5 FIRST — before ...e6, always. Then ...e6 and ...c5 hitting the base of the chain. The pawn on d4 is what holds e5 up; take it away and the whole structure comes down.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'caro-exchange',
        name: 'Exchange — 4.Bd3',
        role: 'sideline',
        moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4'],
        when: 'White trades on d5 and sets up a London-style formation against you.',
        answer:
          'Symmetrical and harmless if you develop actively. ...Nc6 and ...Bg4 pin the knight; you have no weaknesses and the same structure White does. Play for ...e6, ...Bd6 and a good game rather than hunting for an advantage that is not there.',
        ends: 'balanced',
        favours: 'white',
      },
    ],
    why: 'This is the one to graduate to, and the reason is structural. The French Defence has the same solidity but buries the light-squared bishop behind its own pawns for the whole game; the Caro-Kann challenges the centre exactly as hard while getting that bishop out to f5 first. It is the same idea with the flaw removed.',
    gives:
      'A pawn structure that does not create weaknesses, the good bishop developed outside the chain, and endgames that are reliably pleasant because your pawns are healthy.',
    concedes:
      'Space, and a middlegame where you are often reacting rather than dictating. You need patience — the position rewards it, but it rarely offers a quick knockout.',
    attack:
      'The queenside and the c-file, which is half-open the moment you play ...c6 and trade on d5. The central break is ...c5 later, timed for after you have castled, and against the Advance Variation it is the main source of counterplay.',
    plans: [
      'Trade on e4 and develop the bishop to f5 before playing ...e6.',
      'Then ...e6, ...Nd7, ...Ngf6, ...Qc7 and castle.',
      'Aim for the ...c5 break once the king is safe.',
      'In the endgame, your structure is better — trade pieces when the chance comes.',
    ],
    watchOut:
      'One rule covers all three lines above: the light-squared bishop leaves the pawn chain before you play ...e6. Get that order wrong once and you have played a worse French.',
  },

  /* ================================================= BLACK vs 1.d4 */
  {
    id: 'qgd',
    name: "Queen's Gambit Declined",
    side: 'black',
    against: '1.d4',
    // Band starts at 900, not 1100. A coverage check showed no answer to 1.d4
    // at all below 1100 — so a beginner asking "what do I play against d4"
    // got nothing. The QGD is the right answer at any strength; it is solid
    // rather than sharp, and nothing in it punishes inexperience.
    band: [900, 2200],
    kind: 'repertoire',
    lines: [
      {
        id: 'qgd-main',
        name: 'Main line — 4.Bg5',
        role: 'main',
        moves: [
          'd4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O',
          'Nf3', 'h6',
        ],
        when: 'White pins your knight with Bg5. The classical treatment.',
        answer:
          '...Be7 breaks the pin by hand, castle, and only then ...h6 to ask the bishop whether it wants to trade or retreat. Asking the question before you are castled is how you end up with a weakened kingside and no time to use it.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'qgd-exchange',
        name: 'Exchange Variation',
        role: 'critical',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'Be7', 'e3', 'c6'],
        when: 'White trades on d5, fixing the structure and aiming for a minority attack with b4-b5.',
        answer:
          'Recapture with the e-pawn — that is forced by the structure, and it opens the diagonal for your c8 bishop. White will play b4-b5 to leave you a backward c-pawn. Do not sit and defend it: play on the kingside where you have the extra central pawn.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'qgd-take',
        name: 'Grabbing the pawn and trying to hold it',
        role: 'critical',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'dxc4', 'e3', 'b5', 'a4', 'c6'],
        when: 'You take on c4 and then play ...b5 to keep the extra pawn.',
        answer:
          'Do not. This is in the book because it is the tempting move, not because it works: the engine has White close to +1.4 here. ...b5 is met by a4 immediately, the queenside opens while your king is still in the middle, and the pawn you are defending was never yours to keep. Decline the gambit — that is what the opening is called.',
        ends: 'edge',
        favours: 'white',
      },
    ],
    why: 'The most reliable answer to 1.d4 ever played, and it has been at the top level for a hundred and fifty years for one reason: it is very hard to be worse. You take a firm share of the centre on move two and every piece has an obvious square.',
    gives:
      'A solid grip on d5, clear and repeatable plans, and a position where you rarely get blown off the board. Good preparation for everything else because the structures recur across many openings.',
    concedes:
      'The c8 bishop is temporarily passive behind the e6 pawn, and freeing it is a real task rather than an afterthought. If you never solve that, you get squeezed.',
    attack:
      'The c-file, opened when you play ...dxc4 and follow with ...c5. That break is the whole strategic point of the opening — everything before it is preparation for it.',
    plans: [
      '...Nf6, ...Be7, castle, ...h6 to ask the bishop a question.',
      'Then choose: ...dxc4 followed by ...c5, or ...Nbd7 and ...c6 for the solid setup.',
      'Free the light-squared bishop via ...b6 and ...Bb7, or after ...dxc4 via ...b5.',
      'Contest the c-file with a rook once it opens.',
    ],
    watchOut:
      'The Exchange Variation is the one to prepare, because it is the most common and the least obvious. White is not simplifying to a draw — b4-b5 is a real plan with a target, and meeting it passively loses slowly.',
  },
  {
    id: 'slav',
    name: 'Slav Defence',
    side: 'black',
    against: '1.d4',
    band: [1300, 2200],
    kind: 'repertoire',
    lines: [
      {
        id: 'slav-main',
        name: 'Main line — 4...dxc4',
        role: 'main',
        moves: [
          'd4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5',
          'e3', 'e6',
        ],
        when: 'You take on c4 once White has committed the knight to c3.',
        answer:
          'Take, then get the bishop to f5 immediately — before ...e6. a4 stops ...b5 holding the pawn, so you give it back and take the good development instead. That trade is the deal the Slav offers.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'slav-exchange',
        name: 'Exchange Slav',
        role: 'sideline',
        moves: ['d4', 'd5', 'c4', 'c6', 'cxd5', 'cxd5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'Bf4', 'Bf5'],
        when: 'White trades on d5 straight away, usually playing for a draw.',
        answer:
          'Symmetrical, and genuinely drawish at the top — but at club level it is just a normal game with an open c-file. Develop ...Nc6, ...Bf5, and be the first to put a rook on c8.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'slav-early-take',
        name: 'Taking too early',
        role: 'critical',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'dxc4', 'e3', 'b5', 'a4', 'e6', 'axb5', 'cxb5'],
        when: 'You grab on c4 before White has committed, and then try to hold it with ...b5.',
        answer:
          'This is the move-order trap in the Slav. Without a knight on c3 to get in the way, a4 hits b5 straight away and the queenside opens while your king is still in the centre. Take on c4 AFTER Nc3, not before.',
        ends: 'balanced',
        favours: 'white',
      },
    ],
    why: "The Queen's Gambit Declined with its one flaw fixed. You support d5 with the c-pawn instead of the e-pawn, which leaves the diagonal open so the light-squared bishop can come out to f5 before you close it in. Same solidity, better bishop.",
    gives:
      'The good bishop developed early, a very hard structure to crack, and the option of grabbing the c4 pawn and holding it with ...b5.',
    concedes:
      'The c6 square is taken by a pawn, so the b8 knight has to go to d7 and can feel cramped. You also have less immediate central presence than the QGD.',
    attack:
      'The queenside, and the c4 pawn specifically. Taking on c4 and supporting it with ...b5 gives you real space there, and the a-file often opens for your rook.',
    plans: [
      '...Nf6 and ...dxc4 at the right moment, before White plays e3 and can recapture easily.',
      'Get the bishop to f5 or g4 before playing ...e6.',
      '...e6, ...Nbd7, ...Be7, castle.',
      'Look for ...c5 or ...e5 to break out of the slightly cramped centre.',
    ],
    watchOut:
      'Move order is the whole opening here. Taking on c4 is right after Nc3 and wrong before it, and the difference is one tempo that decides whether ...b5 holds or hangs.',
  },

  /* ================================================================ TRAPS */
  {
    id: 'scholars-mate',
    name: "Scholar's Mate — how to refuse it",
    side: 'black',
    against: '1.e4',
    band: [600, 1200],
    kind: 'trap',
    lines: [
      {
        id: 'scholars-defence',
        name: 'The correct defence',
        role: 'main',
        moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'g6', 'Qf3', 'Nf6'],
        when: 'White brings the queen to h5 with the bishop already on c4. Both are hitting f7.',
        answer:
          '...g6 attacks the queen and blocks the h5-f7 diagonal in one move. When the queen steps to f3 it is aiming at f7 down the f-FILE, so ...Nf6 blocks that file — the knight does not defend f7, it stands in the way. Blocking and defending are different jobs and this position needs blocking.',
        ends: 'balanced',
        favours: 'black',
      },
      {
        id: 'scholars-mate-line',
        name: 'What happens if you develop instead',
        role: 'punish',
        moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
        blunder: 'Nf6',
        when: 'Black answers Qh5 with the natural developing move.',
        answer:
          'Qxf7 is mate on the spot. The queen is defended by the bishop on c4, the king cannot take it and has no square. This is the position to burn in: a developing move that ignores a mate threat is not a developing move.',
        ends: 'mate',
        favours: 'white',
      },
    ],
    why: 'The single most common way a beginner loses, and the single most common way a beginner wins — which means learning it removes a whole category of games from both sides of your record. The queen and bishop both hit f7 and mate arrives on move four.',
    gives:
      "Once you know it, an early queen sortie is a gift: it wastes White's time and you develop with tempo while chasing it.",
    concedes: 'Nothing. Refusing it correctly leaves you better.',
    attack:
      'After you defend, you attack the queen. Every developing move you make comes with a threat to it, and that is how you convert their impatience into your lead.',
    plans: [
      'Meet Qh5 with ...g6 — it hits the queen and blocks the diagonal to f7 at the same time.',
      'When the queen goes to f3 it attacks f7 down the file, so ...Nf6 blocks the file. It is a block, not a defence.',
      'Then ...Bg7, castle, and use the extra tempi you gained chasing the queen.',
    ],
    watchOut:
      'The losing move is 3...Nf6, which develops but leaves f7 attacked twice and defended once. Deal with the threat first, develop second. That order is the whole lesson.',
  },
  {
    id: 'fried-liver',
    name: 'Fried Liver — surviving it',
    side: 'black',
    against: '1.e4',
    band: [800, 1500],
    kind: 'trap',
    lines: [
      {
        id: 'fried-defence',
        name: 'The correct defence — 5...Na5',
        role: 'main',
        moves: [
          'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5',
          'Bb5+', 'c6', 'dxc6', 'bxc6', 'Be2', 'h6',
        ],
        when: 'White plays 4.Ng5 going for f7, and you have to find the reply.',
        answer:
          '...d5 first — you must hit the centre, not defend f7 passively. Then on 5.exd5 the move is ...Na5, attacking the bishop that makes the whole sacrifice work. You are a pawn down for a few moves and then you are fine.',
        ends: 'balanced',
        favours: 'white',
      },
      {
        id: 'fried-punish',
        name: 'What 5...Nxd5 actually costs',
        role: 'punish',
        moves: [
          'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5',
          'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3',
        ],
        blunder: 'Nxd5',
        when: 'You recapture with the knight, which looks completely natural.',
        answer:
          'Nxf7 rips the king out. After Kxf7 Qf3+ the king has to walk to e6 to hold the pinned knight, and Nc3 brings the last piece to hit it. The engine says about +1 for White — bad, and survivable with ...Ncb4. Practically, defending this with a king on e6 against three attacking pieces is not something you want to do, which is why the answer is to avoid it on move five.',
        ends: 'edge',
        favours: 'white',
      },
    ],
    why: 'The most dangerous real attack you will meet below 1600. White sacrifices a knight on f7 and drags your king into the open on move six. It is genuinely strong, and the difference between knowing the defence and not is the whole game.',
    gives:
      'Playing ...Na5 instead of recapturing hits the bishop, wins back the pawn, and leaves you with a comfortable game while White has nothing.',
    concedes: 'A pawn temporarily, and the knight on a5 is offside for a few moves.',
    attack:
      'Once the dust settles you have the bishop pair and a lead in development. The counter-attack comes on the queenside and down the e-file.',
    plans: [
      'After 4.Ng5 play ...d5 — you must challenge the centre, not defend f7 passively.',
      'On 5.exd5, play ...Na5 hitting the bishop. Do NOT play ...Nxd5.',
      'Follow with ...h6 to kick the knight, then develop and castle.',
    ],
    watchOut:
      'Both lines above are identical for nine moves and diverge on one. 5...Na5 and 5...Nxd5 look equally natural, and only one of them survives. This is the one position in the repertoire worth memorising exactly.',
  },
  {
    id: 'legal-mate',
    name: "Legal's Mate — the pin that isn't",
    side: 'white',
    against: null,
    band: [800, 1400],
    kind: 'trap',
    lines: [
      {
        id: 'legal-mate-line',
        name: 'The mate',
        role: 'punish',
        moves: [
          'e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1',
          'Bxf7+', 'Ke7', 'Nd5#',
        ],
        blunder: 'Bxd1',
        when: 'Their bishop pins your f3 knight to the queen, your bishop is already on c4, and they take the queen when you break the pin.',
        answer:
          'Nxe5 ignores the pin, because mate is faster than the queen. If they take on d1, Bxf7+ drags the king to e7 and Nd5 is mate with three minor pieces. The queen was never the most valuable thing on the board.',
        ends: 'mate',
        favours: 'white',
      },
      {
        id: 'legal-declined',
        name: 'The same idea when e5 is defended',
        role: 'critical',
        moves: [
          'e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'Nc6', 'Nxe5', 'Nxe5',
          'Qxg4', 'Nxg4',
        ],
        when: 'Black has developed the knight to c6 instead of playing ...g6, so e5 has a defender.',
        answer:
          'This is the honest half of the trap, and the reason it is a pattern rather than a plan. One black move is different and the whole thing collapses: Nxe5 is met by Nxe5, and after Qxg4 Nxg4 you have given up a queen and a knight for a bishop and a pawn. Check that e5 is defended by nothing before you touch the knight.',
        ends: 'winning',
        favours: 'black',
      },
    ],
    why: 'The best illustration in chess of a pin being an illusion. Black pins your knight to the queen, you ignore it, give up the queen, and mate with three minor pieces. Worth knowing mostly so you never fall for the reverse.',
    gives:
      'A finish, when Black is careless. More usefully: the permanent habit of asking whether a pin is actually binding.',
    concedes:
      'Everything, if Black declines correctly — do not go hunting for this. It is a pattern to recognise, not a plan to aim for.',
    attack: 'f7 again, with the bishop, supported by knights landing on e5 and d5.',
    plans: [
      'Recognise the setup: their bishop on g4 pinning your f3 knight, your bishop already on c4.',
      'The move is Nxe5 — the pin does not hold because the mate is faster than the queen.',
      'Bxf7+ then Nd5 is the finish.',
    ],
    watchOut:
      'The second line above is the one that matters. If Black does not take the queen you are just losing, so this is a pattern you recognise when it appears, never a plan you steer toward.',
  },
]

/** Every line in the book, flattened — used by the verifier and by search. */
export function allLines(): { opening: Opening; line: OpeningLine }[] {
  return OPENINGS.flatMap((opening) => opening.lines.map((line) => ({ opening, line })))
}

/** The main line of an opening — the one to show first. */
export function mainLine(opening: Opening): OpeningLine {
  return opening.lines.find((l) => l.role === 'main') ?? opening.lines[0]!
}

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
