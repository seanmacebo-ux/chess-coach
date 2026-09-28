/**
 * The bot roster — opponents with names, faces and reputations.
 *
 * WHY THIS EXISTS. Opponents were called "Bot 1400" and "Tactical Bot 1200".
 * That is a spec, not an opponent, and it costs more than it looks: a slider
 * from 800 to 2200 makes strength feel like a settings value you are adjusting
 * rather than a person you are trying to beat. Nobody remembers the time they
 * beat Bot 1400. Chess.com understood this early — you beat Nelson, and then
 * you go after Isabel.
 *
 * Each bot is a (rating, style) pair that already existed, given an identity
 * and — the part that actually teaches — a stated WEAKNESS. Knowing that a bot
 * over-values attacking and will hang pieces on the queenside tells you how to
 * play against it, which is the beginning of playing against a person rather
 * than against a rating.
 *
 * Ratings are spaced ~150 apart so beating one and moving up is a real step
 * rather than a rounding error. The styles come from engine/types.ts and the
 * strength from the same policy the slider drives, so a named bot is exactly
 * the opponent you would have got at that rating and style — the roster adds
 * character, not a second difficulty system.
 *
 * HONEST CAVEAT, and it is a big one. The bots measure at roughly half their
 * labelled ACPL and the 1000/1200 pair is non-monotonic (see FINDINGS.md), so
 * these ratings describe what each bot is AIMED at, not what it has been
 * measured at. That is fixed by replacing the policy with Maia, not by
 * renaming anything, and until then `calibrated: false` says so on the card
 * rather than letting the name imply a precision that is not there.
 */

import type { Style } from './types'

export interface Bot {
  id: string
  name: string
  /** Rating this bot is aimed at. */
  elo: number
  style: Style
  /** One line of character — who you are sitting across from. */
  bio: string
  /** How it plays, so you can form a plan before move one. */
  plays: string
  /** Its exploitable habit. This is the coaching content. */
  weakness: string
  /** Emoji stand-in for a portrait. Cheap, and works offline. */
  face: string
  /**
   * Whether the strength has been measured rather than aimed at. False for the
   * Stockfish-policy bots (see the file header); true for the Maia bots, whose
   * rating is what the net was trained on.
   */
  calibrated: boolean
  /**
   * Which engine plays this bot. Omitted = the Stockfish policy. 'maia' = a
   * human-trained Maia net at `elo` (a real level: 1100 / 1500 / 1900), which
   * errs the way a human of that rating errs instead of throwing engine moves.
   */
  engine?: 'maia'
}

export const BOTS: Bot[] = [
  /*
   * The bottom two exist because the roster started at 800 and the player it
   * was built for is rated 316. "Weakest opponent, 484 points above you" is not
   * a difficulty setting, it is a closed door — and it was the same failure as
   * the old 1400 default: one number chosen from the wrong end of the range,
   * silently making every recommendation wrong at once.
   */
  {
    id: 'bud',
    name: 'Bud',
    elo: 350,
    style: 'human',
    face: '🌱',
    bio: 'Knows the rules. That is genuinely the whole list.',
    plays: 'Moves pieces to squares. Sometimes good squares, by accident.',
    weakness: 'Everything hangs, all the time. This is the opponent to practise scanning for loose pieces against, because there will always be one.',
    calibrated: false,
  },
  {
    id: 'kit',
    name: 'Kit',
    elo: 550,
    style: 'human',
    face: '🐈',
    bio: 'Has noticed that pieces can be defended and is trying it out.',
    plays: 'Develops a bit, castles sometimes, grabs anything left en prise.',
    weakness: 'No plan past the opening, and misses one-move threats. Attack something twice and it usually falls.',
    calibrated: false,
  },
  {
    id: 'pip',
    name: 'Pip',
    elo: 800,
    style: 'human',
    face: '🐣',
    bio: 'Just learned how the knight moves and is very pleased about it.',
    plays: 'Develops something every move, castles late, and takes whatever is offered.',
    weakness: 'Leaves pieces hanging constantly. If you scan for loose pieces every move you will win material inside fifteen moves.',
    calibrated: false,
  },
  {
    id: 'nadia',
    name: 'Nadia',
    elo: 950,
    style: 'aggressive',
    face: '🔥',
    bio: 'Brings the queen out on move three and asks questions later.',
    plays: 'Early queen sorties, every check available, and an attack whether or not one exists.',
    weakness: 'The attack has no support. Defend the first threat, chase the queen, and she has spent six moves on nothing while you developed.',
    calibrated: false,
  },
  {
    id: 'walter',
    name: 'Walter',
    elo: 1100,
    style: 'solid',
    face: '🧱',
    bio: 'Trades everything and offers you a draw with his eyes.',
    plays: 'Symmetrical, careful, and happy to swap pieces at every opportunity.',
    weakness: 'No plan of his own. If you avoid the trades and keep pieces on, he shuffles while you build.',
    calibrated: false,
  },
  {
    id: 'imani',
    name: 'Imani',
    elo: 1250,
    style: 'tactical',
    face: '⚡',
    bio: 'Sees every fork on the board, including the ones that are not there.',
    plays: 'Hunts for shots. Checks, captures and threats before anything quiet.',
    weakness: 'Over-values the tactic. She will win a pawn at the cost of her position — take the structural advantage and convert slowly.',
    calibrated: false,
  },
  {
    id: 'sofia',
    name: 'Sofia',
    elo: 1400,
    style: 'positional',
    face: '🧭',
    bio: 'Would rather have a good knight than your rook, and is often right.',
    plays: 'Outposts, open files, and squeezing you into a smaller and smaller space.',
    weakness: 'Slow to strike. Break in the centre early, before she has finished arranging things, and the squeeze never starts.',
    calibrated: false,
  },
  {
    id: 'darius',
    name: 'Darius',
    elo: 1550,
    style: 'aggressive',
    face: '🗡️',
    bio: 'Sacrifices a piece for an attack and means it this time.',
    plays: 'Pawn storms at your king, opened files, and real threats behind them.',
    weakness: 'Spends material to attack. Survive the first wave, trade queens, and you are simply a piece up in the endgame.',
    calibrated: false,
  },
  {
    id: 'ren',
    name: 'Ren',
    elo: 1700,
    style: 'solid',
    face: '🪨',
    bio: 'Has never blundered and does not intend to start now.',
    plays: 'Sound, patient, and technically clean. Punishes every loose piece.',
    weakness: 'Very little. This is the first bot where you have to actually outplay someone rather than wait for a gift.',
    calibrated: false,
  },
  {
    id: 'valentina',
    name: 'Valentina',
    elo: 1900,
    style: 'tactical',
    face: '🎯',
    bio: 'Calculates further than you and knows it.',
    plays: 'Sharp lines, long forcing sequences, and endgames that were decided ten moves ago.',
    weakness: 'None you can rely on. Beating her means genuinely playing well.',
    calibrated: false,
  },
  {
    id: 'orion',
    name: 'Orion',
    elo: 2200,
    style: 'human',
    face: '🌑',
    bio: 'The wall at the end of the ladder.',
    plays: 'Everything, well.',
    weakness: 'If you are beating Orion you have outgrown this app.',
    calibrated: false,
  },
]

/**
 * The Maia bots — the honest half of the roster. Each is a neural net trained
 * on millions of real human games at that rating, so it plays the move a human
 * of that strength actually would (and blunders where they blunder), not an
 * engine move dialled down. Unlike the Stockfish bots above, the rating is
 * measured, so `calibrated` is true and beating one means what it says.
 */
export const MAIA_BOTS: Bot[] = [
  {
    id: 'maia-1100',
    name: 'Maia 1100',
    elo: 1100,
    style: 'human',
    face: '🧑',
    bio: 'Learns from beginner-club games. Plays like a real improving player.',
    plays: 'Natural developing moves, the odd hopeful attack, human-shaped mistakes.',
    weakness: 'Misses tactics and hangs pieces about as often as a 1100 human — because it learned from them. No engine quirk to exploit; just outplay it.',
    calibrated: true,
    engine: 'maia',
  },
  {
    id: 'maia-1500',
    name: 'Maia 1500',
    elo: 1500,
    style: 'human',
    face: '🧑‍🎓',
    bio: 'Trained on solid club-level play. Knows plans, still human under pressure.',
    plays: 'Sensible openings, real middlegame ideas, the occasional club-player slip.',
    weakness: 'Loosens under complications the way a 1500 does. Create problems and it will eventually make one back.',
    calibrated: true,
    engine: 'maia',
  },
  {
    id: 'maia-1900',
    name: 'Maia 1900',
    elo: 1900,
    style: 'human',
    face: '🧑‍🏫',
    bio: 'Strong club strength, learned from strong human games.',
    plays: 'Clean, purposeful chess with genuinely human judgement.',
    weakness: 'Few free gifts. Beating it means playing real chess — which is the point at this level.',
    calibrated: true,
    engine: 'maia',
  },
]

export function botById(id: string): Bot | undefined {
  return [...BOTS, ...MAIA_BOTS].find((b) => b.id === id)
}

/**
 * Who you should be playing at this rating.
 *
 * Slightly ABOVE you on purpose — the nearest bot at or above your rating,
 * falling back to the strongest below when you have outgrown the roster. A
 * coach that matches you exactly gives you a 50% score and no pressure, and
 * the whole point of the opponent is to be a test rather than a mirror.
 */
export function suggestedBot(rating: number): Bot {
  const above = BOTS.filter((b) => b.elo >= rating).sort((a, b) => a.elo - b.elo)
  return above[0] ?? BOTS[BOTS.length - 1]!
}

/** Bots within reach — beatable now, or the next real step up. */
export function botsNear(rating: number, spread = 300): Bot[] {
  return BOTS.filter((b) => Math.abs(b.elo - rating) <= spread)
}
