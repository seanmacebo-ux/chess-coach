/**
 * The tier ladder.
 *
 * Five pillars, eight-ish tiers each, every tier gated to a rating range and
 * bound to concrete puzzle motifs or concept keys. This is the spine that
 * solves cold-start: on day one there is no mistake history to adapt to, so
 * the ladder decides. Once games accumulate, the weakness profile REORDERS
 * the ladder rather than replacing it — you always know where you are.
 *
 * Tier content is structured from standard chess pedagogy (rating-banded
 * endgame progression, the conventional tactical motif order). The
 * organisation and wording here are ours; no book text is reproduced.
 */

export type Pillar = 'tactics' | 'endgame' | 'positional' | 'strategy' | 'opening'

export interface Tier {
  id: string
  pillar: Pillar
  index: number
  name: string
  blurb: string
  /** Rating window this tier is aimed at, inclusive. */
  band: [number, number]
  /** Lichess puzzle motifs, or concept keys for non-puzzle pillars. */
  themes: string[]
  /** What clears the tier. */
  clear: { solved: number; accuracy: number }
}

const T = (
  pillar: Pillar,
  index: number,
  name: string,
  blurb: string,
  band: [number, number],
  themes: string[],
  solved = 20,
  accuracy = 0.8,
): Tier => ({
  id: `${pillar}-${index}`,
  pillar,
  index,
  name,
  blurb,
  band,
  themes,
  clear: { solved, accuracy },
})

/**
 * TACTICS — ordered by what actually costs games at each level, not by how
 * clever the motif is. Hanging pieces come first because at 1200 they decide
 * more games than every other motif combined.
 */
export const TACTICS_TIERS: Tier[] = [
  T('tactics', 1, 'Free material', 'Spot what is hanging — yours and theirs. Mate in one.', [600, 1100], ['hangingPiece', 'mateIn1']),
  T('tactics', 2, 'Forks', 'One piece, two targets. Knights especially.', [800, 1300], ['fork', 'doubleCheck']),
  T('tactics', 3, 'Pins and skewers', 'Freeze a piece, or drag a big one off a small one.', [1000, 1500], ['pin', 'skewer']),
  T('tactics', 4, 'Mate in two', 'Forcing sequences. Back rank first.', [1100, 1600], ['mateIn2', 'backRankMate']),
  T('tactics', 5, 'Discovered attacks', 'Move one piece, unleash another.', [1300, 1700], ['discoveredAttack', 'xRayAttack']),
  T('tactics', 6, 'Removing the guard', 'Deflect, decoy, or capture the defender.', [1400, 1900], ['deflection', 'attraction', 'capturingDefender', 'interference']),
  T('tactics', 7, 'Mating nets', 'Mate in three and the named patterns.', [1500, 2000], ['mateIn3', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'hookMate']),
  T('tactics', 8, 'Quiet moves', 'The hardest tactic is the one that is not a check.', [1700, 2200], ['quietMove', 'intermezzo', 'zugzwang', 'defensiveMove']),
]

/**
 * ENDGAME — the rating-banded progression is the single most useful idea in
 * Sean's book stack, and the one thing genuinely aimed at his level. Hard
 * gates on purpose: do not study rook endings before you can mate with a
 * queen without thinking.
 */
export const ENDGAME_TIERS: Tier[] = [
  T('endgame', 1, 'Basic mates', 'K+Q and K+R against a lone king, every time, no stalemate.', [600, 1000], ['mate-kq', 'mate-kr'], 10, 0.9),
  T('endgame', 2, 'King and pawn', 'Opposition, key squares, the square of the pawn.', [900, 1300], ['pawnEndgame', 'opposition', 'key-squares'], 15, 0.85),
  T('endgame', 3, 'Rook endings I', 'Lucena and Philidor. The two you cannot skip.', [1200, 1600], ['rookEndgame', 'lucena', 'philidor'], 15, 0.85),
  T('endgame', 4, 'Minor pieces', 'Bishop versus knight, and when each is better.', [1300, 1700], ['bishopEndgame', 'knightEndgame']),
  T('endgame', 5, 'Passers and races', 'Outside passed pawns, counting a race.', [1400, 1800], ['advancedPawn', 'pawn-race']),
  T('endgame', 6, 'Rook endings II', 'Active rook, cutting the king off, building a bridge.', [1500, 1900], ['rookEndgame', 'rook-activity']),
  T('endgame', 7, 'Queen endings', 'Queen versus pawn on the seventh. Perpetual awareness.', [1600, 2000], ['queenEndgame']),
  T('endgame', 8, 'Conversion', 'Turning a small edge into a point.', [1700, 2200], ['queenRookEndgame', 'conversion']),
]

/**
 * POSITIONAL — the imbalance framework as a reading lens. These are not
 * "find the move" puzzles; they are "read the position" questions.
 */
export const POSITIONAL_TIERS: Tier[] = [
  T('positional', 1, 'Safety scan', 'Before anything else: what of mine is loose?', [600, 1200], ['piece-safety'], 15, 0.85),
  T('positional', 2, 'Development', 'Pieces out, king safe, centre contested.', [800, 1300], ['development', 'centre']),
  T('positional', 3, 'Open files', 'Where do the rooks belong, and why.', [1100, 1600], ['open-file', 'rook-placement']),
  T('positional', 4, 'Weak squares', 'Holes, outposts, and the knight that lives there.', [1200, 1700], ['outpost', 'weak-square']),
  T('positional', 5, 'Pawn structure', 'Isolated, doubled, backward — who does it favour.', [1300, 1800], ['pawn-structure', 'isolated-pawn', 'backward-pawn']),
  T('positional', 6, 'Good and bad bishops', 'The bishop your own pawns imprison.', [1400, 1900], ['bishop-quality', 'colour-complex']),
  T('positional', 7, 'Space', 'Space is only an advantage if you can use it.', [1500, 2000], ['space', 'manoeuvring']),
  T('positional', 8, 'Prophylaxis', 'Ask what they want. Then make it impossible.', [1600, 2200], ['prophylaxis']),
]

/**
 * STRATEGY — the "control the game" pillar. Threat-reading and simulation,
 * which is where the app does something Chess.com does not.
 */
export const STRATEGY_TIERS: Tier[] = [
  T('strategy', 1, 'Read the threat', 'If you passed right now, what would they do to you?', [800, 1400], ['threat-detection'], 15, 0.8),
  T('strategy', 2, 'Choose the plan', 'Three candidate plans. Which fits this position?', [1100, 1600], ['plan-selection']),
  T('strategy', 3, 'Attack the king', 'Counting attackers, opening lines, the sacrifice test.', [1300, 1800], ['kingsideAttack', 'attack-count']),
  T('strategy', 4, 'Defend', 'Trade the attacker, block the file, run.', [1300, 1800], ['defence', 'exposedKing']),
  T('strategy', 5, 'Simulate a break', 'Play the pawn break 20 times. See what usually happens.', [1400, 1900], ['simulation', 'pawn-break']),
  T('strategy', 6, 'Convert', 'You are winning. Now do not throw it.', [1500, 2000], ['conversion', 'simplification']),
]

/** OPENING — repertoire, not memorisation. Deliberately the shortest ladder. */
export const OPENING_TIERS: Tier[] = [
  T('opening', 1, 'Principles', 'Centre, development, king safety. Why they are rules.', [600, 1200], ['opening-principles'], 10, 0.85),
  T('opening', 2, 'Traps to survive', 'The tricks that actually get played at your level.', [800, 1400], ['opening-trap']),
  T('opening', 3, 'Your white repertoire', 'One first move. Lines against each reply.', [1000, 2200], ['repertoire-white'], 30, 0.75),
  T('opening', 4, 'Black vs 1.e4', 'One answer, learned properly.', [1000, 2200], ['repertoire-black-e4'], 30, 0.75),
  T('opening', 5, 'Black vs 1.d4', 'One answer, learned properly.', [1100, 2200], ['repertoire-black-d4'], 30, 0.75),
  T('opening', 6, 'Move orders', 'Transpositions, and refusing to be tricked by them.', [1500, 2200], ['transposition']),
]

export const ALL_TIERS: Tier[] = [
  ...TACTICS_TIERS,
  ...ENDGAME_TIERS,
  ...POSITIONAL_TIERS,
  ...STRATEGY_TIERS,
  ...OPENING_TIERS,
]

export const PILLARS: { id: Pillar; name: string; blurb: string }[] = [
  { id: 'tactics', name: 'Tactics', blurb: 'See the shot.' },
  { id: 'endgame', name: 'Endgames', blurb: 'Finish what you start.' },
  { id: 'positional', name: 'Position', blurb: 'Read the board.' },
  { id: 'strategy', name: 'Strategy', blurb: 'Control the game.' },
  { id: 'opening', name: 'Openings', blurb: 'Know your lines.' },
]

export function tiersFor(pillar: Pillar): Tier[] {
  return ALL_TIERS.filter((t) => t.pillar === pillar).sort((a, b) => a.index - b.index)
}

export function tierById(id: string): Tier | undefined {
  return ALL_TIERS.find((t) => t.id === id)
}

/** Tiers whose band window contains this rating — what you should be on now. */
export function tiersAtRating(rating: number): Tier[] {
  return ALL_TIERS.filter((t) => rating >= t.band[0] && rating <= t.band[1])
}

/**
 * Which tier trains this weakness? Turns "you keep hanging bishops" into
 * "here is the tier that fixes it".
 */
export function tiersForTheme(theme: string): Tier[] {
  return ALL_TIERS.filter((t) => t.themes.includes(theme))
}
