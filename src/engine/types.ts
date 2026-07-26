/** Shared engine vocabulary. Everything here is UI-agnostic. */

/** A move in UCI long-algebraic form, e.g. "e2e4", "e7e8q". */
export type UciMove = string

/**
 * One principal variation from a multipv search.
 * Scores are ALWAYS from the side-to-move's point of view — positive is good
 * for whoever is on move. Flipping to white's POV is the caller's job.
 */
export interface Line {
  multipv: number
  depth: number
  /** Centipawns, side-to-move POV. null when the line is a forced mate. */
  cp: number | null
  /** Positive = side to move mates in N. Negative = gets mated in N. */
  mate: number | null
  pv: UciMove[]
}

export interface Analysis {
  fen: string
  depth: number
  /** Sorted by multipv rank — lines[0] is the engine's preference. */
  lines: Line[]
  bestMove: UciMove | null
}

export interface SearchLimits {
  depth?: number
  movetimeMs?: number
  multipv?: number
}

/**
 * Collapse a Line into a single comparable number, side-to-move POV.
 * Mates map outside normal cp range so they always dominate, but a faster
 * mate still beats a slower one and getting mated is worse the sooner it is.
 */
export const MATE_SCORE = 100_000

export function lineScore(line: Pick<Line, 'cp' | 'mate'>): number {
  if (line.mate !== null) {
    const sign = line.mate > 0 ? 1 : -1
    return sign * (MATE_SCORE - Math.abs(line.mate) * 100)
  }
  return line.cp ?? 0
}

/** Playing strength bands. These are Elo targets, not engine depth. */
export type Band = 800 | 1000 | 1200 | 1400 | 1600 | 1800 | 2000 | 2200

export const BANDS: Band[] = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200]

export function nearestBand(elo: number): Band {
  return BANDS.reduce((best, b) => (Math.abs(b - elo) < Math.abs(best - elo) ? b : best))
}

/**
 * How the opponent picks among reasonable moves. This is flavour on top of
 * strength — a 1400 aggressive bot and a 1400 solid bot shed roughly the same
 * centipawns per move, they just shed them differently.
 */
export type Style = 'human' | 'aggressive' | 'solid' | 'positional' | 'tactical'

export const STYLES: { id: Style; name: string; blurb: string }[] = [
  { id: 'human', name: 'Human', blurb: 'Plays like a typical player at this rating. No agenda.' },
  { id: 'aggressive', name: 'Aggressive', blurb: 'Hunts your king. Checks, captures, pawn storms.' },
  { id: 'solid', name: 'Solid', blurb: 'Refuses to give you anything. Trades down, keeps it safe.' },
  { id: 'positional', name: 'Positional', blurb: 'Squeezes. Space, outposts, open files, no rush.' },
  { id: 'tactical', name: 'Tactical', blurb: 'Sharp and forcing. Will sacrifice to open lines.' },
]
