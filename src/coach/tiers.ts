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

/**
 * How a tier is actually trained.
 *
 * `puzzle`  — find the move. Served from the Lichess corpus.
 * `playout` — convert or hold the position against the engine. Theoretical
 *             endgames are technique, not shots: a Lucena is "now win this",
 *             not "spot the tactic", and serving it as a puzzle trains
 *             nothing. This distinction is why endgame-3 was quietly broken.
 * `quiz`    — judge rather than move (which imbalance favours whom, is this
 *             a win or a draw). No engine needed.
 */
export type TierKind = 'puzzle' | 'playout' | 'quiz'

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
  kind: TierKind
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
  kind: TierKind = 'puzzle',
): Tier => ({
  id: `${pillar}-${index}`,
  pillar,
  index,
  name,
  blurb,
  band,
  themes,
  clear: { solved, accuracy },
  kind,
})

/**
 * TACTICS — ordered by what actually costs games at each level, not by how
 * clever the motif is. Hanging pieces come first because at 1200 they decide
 * more games than every other motif combined.
 */
/*
 * The clear thresholds are not uniform, and the reason is that they used to be.
 *
 * Every tier defaulted to 20 solved, which claimed that owning mate-in-one and
 * owning mate-in-two are the same amount of work. Polgár's problem book puts
 * 306 mate-in-ones against 3,412 mate-in-twos — an order of magnitude more
 * material for the tier immediately above. A ladder that asks for 20 of each
 * clears the hard tier on a rounding error and then tells you you own it.
 *
 * The numbers below weight each tier by roughly how much there is to
 * internalise, then compress that weight. Compression is the judgement call and
 * worth naming: the literal ratio would put mate-in-two at ~220 solved, which
 * at eight puzzles a day is a month on one rung with four pillars stalled
 * behind it. Repetition has diminishing returns — you do not need to see all
 * 3,412 to own the pattern — so the spread is compressed to about 4x rather
 * than 10x. That keeps the ORDER honest, which is the part the ratio was
 * actually telling us, without making the ladder unclimbable.
 *
 * The dip at tier 5 is deliberate, not an oversight. Discovered attacks are a
 * smaller body of material than mate-in-two even though they sit higher on the
 * ladder; Polgár's own counts are non-monotonic in the same way (744 mate-in-
 * threes against those 3,412 mate-in-twos). Tier 4 is simply the grind.
 *
 * Accuracy stays at 0.8 throughout. Demanding MORE accuracy as the tiers get
 * harder would gate the ladder twice on the same difficulty.
 */
export const TACTICS_TIERS: Tier[] = [
  T('tactics', 1, 'Free material', 'Spot what is hanging — yours and theirs. Mate in one.', [600, 1100], ['hangingPiece', 'mateIn1'], 20),
  T('tactics', 2, 'Forks', 'One piece, two targets. Knights especially.', [800, 1300], ['fork', 'doubleCheck'], 30),
  T('tactics', 3, 'Pins and skewers', 'Freeze a piece, or drag a big one off a small one.', [1000, 1500], ['pin', 'skewer'], 35),
  T('tactics', 4, 'Mate in two', 'Forcing sequences. Back rank first.', [1100, 1600], ['mateIn2', 'backRankMate'], 80),
  T('tactics', 5, 'Discovered attacks', 'Move one piece, unleash another.', [1300, 1700], ['discoveredAttack', 'xRayAttack'], 45),
  T('tactics', 6, 'Removing the guard', 'Deflect, decoy, or capture the defender.', [1400, 1900], ['deflection', 'attraction', 'capturingDefender', 'interference'], 60),
  T('tactics', 7, 'Mating nets', 'Mate in three and the named patterns.', [1500, 2000], ['mateIn3', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'hookMate'], 65),
  T('tactics', 8, 'Quiet moves', 'The hardest tactic is the one that is not a check.', [1700, 2200], ['quietMove', 'intermezzo', 'zugzwang', 'defensiveMove'], 70),
]

/**
 * ENDGAME — the rating-banded progression is the single most useful idea in
 * Sean's book stack, and the one thing genuinely aimed at his level. Hard
 * gates on purpose: do not study rook endings before you can mate with a
 * queen without thinking.
 */
/*
 * Rebuilt 2026-07-26 against Silman's actual rating bands after a structural
 * read of the Complete Endgame Course. The previous ladder was guessed and was
 * wrong in three ways that mattered:
 *
 *   - Lucena/Philidor was gated 1200+; Silman puts it at 1400-1599.
 *   - Queen vs pawn was gated 1600+; it belongs at 1400-1599, meaning it was
 *     LOCKED for Sean despite sitting squarely in his band.
 *   - King-and-pawn compressed three of Silman's bands into one tier, so
 *     square-of-the-pawn (a 1400 topic) was being served from 900.
 *
 * Silman's own rule is "Unified Field": you may not study band N until you own
 * every band below it. The hard gates here encode that. His 1400-1599 part is
 * roughly double any other pre-master section, which is why that band now
 * carries three tiers rather than sharing one.
 *
 * Everything theoretical is `playout` — you convert or hold it against the
 * engine. A Lucena served as a "find the move" puzzle teaches nothing, which
 * is precisely how the old endgame-3 stayed broken without anyone noticing.
 */
export const ENDGAME_TIERS: Tier[] = [
  T('endgame', 1, 'Overkill mates', 'Two rooks, queen and rook, the staircase. Mechanical — no theory needed.', [600, 900], ['mate-staircase', 'mate-2r', 'mate-qr'], 10, 0.9, 'playout'),
  T('endgame', 2, 'The box', 'K+Q and K+R against a lone king. Bring your king. Never stalemate.', [600, 1000], ['mate-kq', 'mate-kr'], 10, 0.9, 'playout'),
  T('endgame', 3, 'What cannot mate', 'Two knights cannot force it. Knowing the draws saves you points.', [900, 1100], ['insufficient-material'], 8, 0.9, 'quiz'),
  T('endgame', 4, 'Use your king', 'In the endgame the king is a fighting piece. Basic opposition.', [1000, 1199], ['opposition', 'king-activity'], 12, 0.85, 'playout'),
  T('endgame', 5, 'King and pawn', 'K+P vs K in full. King in front of the pawn, and the rook-pawn exception.', [1200, 1399], ['pawnEndgame', 'key-squares'], 15, 0.85, 'playout'),
  T('endgame', 6, 'Piece vs lone pawn', 'Can the bishop, knight or rook stop the runner?', [1200, 1399], ['piece-vs-pawn'], 12, 0.85, 'playout'),
  T('endgame', 7, 'Pawn endings, properly', 'Square of the pawn, outside passers, the trébuchet.', [1400, 1599], ['pawnEndgame', 'advancedPawn', 'trebuchet'], 15, 0.85, 'playout'),
  T('endgame', 8, 'Rook endings I', 'Lucena and Philidor. The two you cannot skip.', [1400, 1599], ['rookEndgame', 'lucena', 'philidor'], 15, 0.85, 'playout'),
  T('endgame', 9, 'Queen vs pawn', 'On the seventh: bishop- and rook-pawns draw, the others lose.', [1400, 1599], ['queenEndgame', 'q-vs-pawn'], 12, 0.85, 'playout'),
  T('endgame', 10, 'Awkward bishops', 'Wrong-coloured rook-pawn is a draw. Opposite bishops save you.', [1400, 1799], ['bishopEndgame', 'wrong-bishop', 'opposite-bishops'], 12, 0.85, 'playout'),
  T('endgame', 11, 'Tempo tricks', 'Triangulation and outflanking — winning the move you need.', [1600, 1799], ['triangulation', 'outflanking'], 12, 0.85, 'playout'),
  T('endgame', 12, 'Rook endings II', 'Two connected pawns, the seventh rank, the active rook.', [1600, 1799], ['rookEndgame', 'rook-activity'], 15, 0.8, 'playout'),
  T('endgame', 13, 'Rook and pawn vs rook', 'The rook in front of its own pawn, and when Philidor fails.', [1800, 1999], ['rookEndgame', 'r-and-p'], 15, 0.8, 'playout'),
  T('endgame', 14, 'Fortresses', 'Down material and still drawing. Knowing which ones hold.', [1800, 1999], ['fortress'], 10, 0.8, 'quiz'),
  T('endgame', 15, 'Two weaknesses', 'One target is never enough. Create a second, then switch.', [2000, 2200], ['two-weaknesses', 'conversion'], 12, 0.8, 'playout'),
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

/**
 * Motifs that actually exist in the Lichess puzzle corpus.
 *
 * Tier themes come in two kinds and conflating them is a silent failure: ask
 * for `threat-detection` puzzles and the picker matches nothing, falls back to
 * rating-only, and serves random tactics while the UI claims the session is
 * targeted. Keeping the sets separate means a tier either has puzzle stock or
 * is explicitly exercise-backed — never quietly neither.
 *
 * Verified against public/puzzles/index.json (44-48 motifs present per band).
 */
export const LICHESS_MOTIFS = new Set([
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection',
  'attraction', 'clearance', 'interference', 'xRayAttack', 'zugzwang',
  'hangingPiece', 'trappedPiece', 'sacrifice', 'quietMove', 'defensiveMove',
  'capturingDefender', 'intermezzo', 'attackingF2F7', 'exposedKing',
  'kingsideAttack', 'queensideAttack', 'advancedPawn', 'promotion',
  'underPromotion', 'enPassant', 'castling', 'backRankMate', 'smotheredMate',
  'anastasiaMate', 'arabianMate', 'bodenMate', 'doubleBishopMate',
  'dovetailMate', 'hookMate', 'killBoxMate', 'vukovicMate',
  'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'rookEndgame', 'pawnEndgame', 'queenEndgame', 'bishopEndgame',
  'knightEndgame', 'queenRookEndgame',
])

/** The subset of a tier's themes that the puzzle corpus can actually serve. */
export function puzzleThemes(tier: Tier | null | undefined): string[] {
  if (!tier) return []
  return tier.themes.filter((t) => LICHESS_MOTIFS.has(t))
}

/** True when a tier has no puzzle stock and must be trained by exercises. */
export function isExerciseBacked(tier: Tier): boolean {
  return puzzleThemes(tier).length === 0
}
