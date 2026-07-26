/**
 * The Opponent contract.
 *
 * Everything that plays moves — the bot you face, both sides of a simulation,
 * and eventually Maia — implements this. Nothing above this layer talks to
 * Stockfish directly, which is what makes the Maia swap a drop-in later
 * instead of a rewrite.
 */

import { getEngine } from './uci'
import {
  bandProfile,
  chooseMove,
  seededRng,
  weighCandidates,
  type Candidate,
  type Rng,
} from './policy'
import type { Style, UciMove } from './types'

export interface Opponent {
  readonly id: string
  readonly name: string
  readonly elo: number
  readonly style: Style
  /** Clear any per-game state. */
  newGame(): Promise<void>
  /** The move to play here, or null if there is none (mate/stalemate). */
  move(fen: string): Promise<UciMove | null>
  /** What it considered and why — for the coach view. Optional. */
  explain?(fen: string): Promise<Candidate[]>
}

export interface OpponentConfig {
  elo: number
  style: Style
  name?: string
  /** Inject for reproducible simulations. */
  rng?: Rng
  /** Override the band's default search depth (simulations run shallower). */
  depth?: number
}

/** Stockfish + the human-likeness policy. The default opponent. */
export class EngineOpponent implements Opponent {
  readonly id: string
  readonly name: string
  readonly elo: number
  readonly style: Style
  private rng: Rng
  private depthOverride: number | undefined

  constructor(cfg: OpponentConfig) {
    this.elo = cfg.elo
    this.style = cfg.style
    this.id = `sf-${cfg.elo}-${cfg.style}`
    this.name =
      cfg.name ?? `${cfg.style === 'human' ? '' : capitalise(cfg.style) + ' '}Bot ${cfg.elo}`.trim()
    this.rng = cfg.rng ?? Math.random
    this.depthOverride = cfg.depth
  }

  async newGame(): Promise<void> {
    await getEngine().newGame()
  }

  async move(fen: string): Promise<UciMove | null> {
    const profile = bandProfile(this.elo)
    const analysis = await getEngine().analyse(fen, {
      depth: this.depthOverride ?? profile.depth,
      multipv: profile.multipv,
    })
    if (analysis.lines.length === 0) return analysis.bestMove
    return chooseMove(fen, analysis.lines, this.elo, this.style, this.rng)
  }

  async explain(fen: string): Promise<Candidate[]> {
    const profile = bandProfile(this.elo)
    const analysis = await getEngine().analyse(fen, {
      depth: this.depthOverride ?? profile.depth,
      multipv: profile.multipv,
    })
    return weighCandidates(fen, analysis.lines, this.elo, this.style)
  }
}

/**
 * Full-strength Stockfish. Not an opponent you play — this is the coach that
 * analyses your games and the ground truth a simulation is measured against.
 */
export class CoachEngine {
  async best(fen: string, depth = 16): Promise<UciMove | null> {
    const a = await getEngine().analyse(fen, { depth, multipv: 1 })
    return a.bestMove
  }

  async evaluate(fen: string, depth = 16, multipv = 3) {
    return getEngine().analyse(fen, { depth, multipv })
  }
}

export function createOpponent(cfg: OpponentConfig): Opponent {
  return new EngineOpponent(cfg)
}

/** Two bots for a simulation run, seeded so the run is replayable. */
export function createSimPair(elo: number, style: Style, seed: number, depth = 6) {
  return {
    white: createOpponent({ elo, style, rng: seededRng(seed), depth }),
    black: createOpponent({ elo, style, rng: seededRng(seed ^ 0x9e3779b9), depth }),
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
