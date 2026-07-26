/**
 * Puzzle categories — what a puzzle is actually teaching.
 *
 * The corpus ships 59 raw Lichess motifs, which is 59 things to learn and no
 * structure at all. "vukovicMate" and "dovetailMate" are not two separate
 * skills to a 1400 player; they are both "a mating net you should recognise".
 *
 * So motifs group into eight categories, each with a plain-language name and a
 * one-line statement of the skill behind it. That grouping is what makes the
 * training legible: you can see you are on mating patterns this week, and you
 * can see that forks and pins are the same underlying idea of hitting two
 * things at once.
 *
 * Counts behind each category come from `npm run sandbox:puzzles`, which prints
 * the full inventory. The eight categories cover all 59 motifs — `categoryOf`
 * falls back rather than dropping a puzzle, so a new Lichess motif appearing
 * in a future corpus rebuild is still shown, just less precisely.
 */

export type CategoryId =
  | 'mate'
  | 'material'
  | 'double-attack'
  | 'sacrifice'
  | 'attack'
  | 'quiet'
  | 'endgame'
  | 'pawn'

export interface Category {
  id: CategoryId
  name: string
  /** The skill, in one line. Shown above the board before you solve. */
  teaches: string
  /** Why it is worth your time at club level. */
  why: string
  motifs: string[]
}

export const CATEGORIES: Category[] = [
  {
    id: 'mate',
    name: 'Checkmate patterns',
    teaches: 'Finishing the game. Forced sequences that end in mate.',
    why: 'Nearly a third of the corpus, and the only tactic that ends the game on the spot. The named patterns repeat — once you know the shape you stop calculating and start recognising.',
    motifs: [
      'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
      'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate',
      'bodenMate', 'doubleBishopMate', 'dovetailMate', 'hookMate',
      'killBoxMate', 'vukovicMate', 'operaMate', 'pillsburysMate',
      'epauletteMate', 'morphysMate', 'cornerMate', 'swallowstailMate',
      'triangleMate', 'blindSwineMate', 'balestraMate',
    ],
  },
  {
    id: 'material',
    name: 'Free material',
    teaches: 'Spotting what is undefended, and what is trapped with nowhere to go.',
    why: 'The single biggest source of decided games below 1600. Not clever — just seeing what is already there before you play something else.',
    motifs: ['hangingPiece', 'trappedPiece', 'capturingDefender'],
  },
  {
    id: 'double-attack',
    name: 'Two things at once',
    teaches: 'Forks, pins, skewers and discoveries — one move, two targets.',
    why: 'The core mechanic of chess tactics. Every one of these works by attacking more than the opponent can defend in a single move.',
    motifs: [
      'fork', 'pin', 'skewer', 'discoveredAttack', 'discoveredCheck',
      'doubleCheck', 'xRayAttack',
    ],
  },
  {
    id: 'sacrifice',
    name: 'Give to get',
    teaches: 'Sacrifices, deflections and decoys — paying material to force a reply.',
    why: 'Where calculation actually starts. You give something up because the forced sequence afterwards is worth more, and the skill is seeing the end of that sequence before you commit.',
    motifs: ['sacrifice', 'attraction', 'deflection', 'clearance', 'interference'],
  },
  {
    id: 'attack',
    name: 'Attacking the king',
    teaches: 'Opening lines toward a king and counting whether the attack arrives.',
    why: 'Attacks are arithmetic, not enthusiasm — attackers versus defenders around the king. These teach you to count before you commit pieces.',
    motifs: ['kingsideAttack', 'queensideAttack', 'exposedKing', 'attackingF2F7'],
  },
  {
    id: 'quiet',
    name: 'Quiet and defensive',
    teaches: 'The winning move that is not a check or a capture. And how to save a lost position.',
    why: 'The hardest category, because there is nothing forcing to latch onto. Also where most players plateau — they can find checks, and nothing else.',
    motifs: ['quietMove', 'defensiveMove', 'zugzwang', 'intermezzo', 'collinearMove'],
  },
  {
    id: 'endgame',
    name: 'Endgame technique',
    teaches: 'Converting and holding with few pieces left, where every move counts double.',
    why: 'Games are decided here far more often than people expect, and it is the most learnable part of chess because the positions repeat exactly.',
    motifs: [
      'rookEndgame', 'pawnEndgame', 'queenEndgame', 'bishopEndgame',
      'knightEndgame', 'queenRookEndgame',
    ],
  },
  {
    id: 'pawn',
    name: 'Pawns and special moves',
    teaches: 'Promotion races, advanced pawns, en passant and castling tricks.',
    why: 'The rules everyone knows and nobody uses. A passed pawn on the seventh is worth more than a bishop, and en passant wins games precisely because it gets forgotten.',
    motifs: ['promotion', 'underPromotion', 'advancedPawn', 'enPassant', 'castling'],
  },
]

const BY_MOTIF = new Map<string, Category>()
for (const c of CATEGORIES) for (const m of c.motifs) BY_MOTIF.set(m, c)

export function categoryById(id: CategoryId): Category | undefined {
  return CATEGORIES.find((c) => c.id === id)
}

/**
 * The category a puzzle belongs to.
 *
 * Puzzles usually carry several motifs. Order matters here: a mate that also
 * involves a sacrifice is a MATE puzzle, because that is what you are being
 * asked to find. So the CATEGORIES order is the priority order, and the first
 * category with a matching motif wins rather than the first motif on the row.
 */
export function categoryOf(themes: string[]): Category {
  for (const c of CATEGORIES) {
    if (themes.some((t) => c.motifs.includes(t))) return c
  }
  // Never drop a puzzle for having an unrecognised motif — describe it loosely
  // rather than showing nothing.
  return {
    id: 'double-attack',
    name: 'Tactics',
    teaches: 'Find the move that wins material or the game.',
    why: 'A general tactic — look for checks, captures and threats first.',
    motifs: [],
  }
}

/** Every category present in a set of puzzles, in priority order. */
export function categoriesIn(themeLists: string[][]): Category[] {
  const seen = new Set<CategoryId>()
  const out: Category[] = []
  for (const themes of themeLists) {
    const c = categoryOf(themes)
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}
