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
import { bookMove } from './book'

export interface Opponent {
  readonly id: string
  readonly name: string
  readonly elo: number
  readonly style: Style
  /** Clear any per-game state. */
  newGame(): Promise<void>
  /**
   * The move to play here, or null if there is none (mate/stalemate).
   *
   * `history` is the game in SAN, and it is how a bot follows its opening
   * repertoire — a repertoire is a sequence, and a FEN is a position with no
   * memory of how it was reached. Callers that do not pass it get a bot with
   * no book, which is what every bot had before engine/book.ts existed.
   */
  move(fen: string, history?: string[]): Promise<UciMove | null>
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
  /**
   * Which roster bot this is, so it can play that bot's repertoire.
   *
   * Optional, and absent means no book — a bare (elo, style) opponent is
   * still a legal opponent, and the calibration harnesses create thousands
   * of them with no identity at all.
   */
  botId?: string
}

/** Stockfish + the human-likeness policy. The default opponent. */
export class EngineOpponent implements Opponent {
  readonly id: string
  readonly name: string
  readonly elo: number
  readonly style: Style
  private rng: Rng
  private depthOverride: number | undefined
  private botId: string | undefined

  constructor(cfg: OpponentConfig) {
    this.elo = cfg.elo
    this.style = cfg.style
    this.id = `sf-${cfg.elo}-${cfg.style}`
    this.name =
      cfg.name ?? `${cfg.style === 'human' ? '' : capitalise(cfg.style) + ' '}Bot ${cfg.elo}`.trim()
    this.rng = cfg.rng ?? Math.random
    this.depthOverride = cfg.depth
    this.botId = cfg.botId
  }

  async newGame(): Promise<void> {
    await getEngine().newGame()
  }

  async move(fen: string, history: string[] = []): Promise<UciMove | null> {
    /*
     * BOOK FIRST.
     *
     * Measured before this existed: five games per style produced five
     * different first moves and not one e4 or d4 in twenty-five games, which
     * is what "the bots are generic" actually was. In the starting position
     * every legal move is within ~130cp at depth 9, so the softmax spreads
     * almost uniformly and 1.g4 is as likely as 1.e4. Centipawns cannot tell
     * "slightly worse" from "nobody plays that".
     */
    if (this.botId) {
      const from = bookMove(this.botId, colourToMove(fen), history, fen, this.rng)
      if (from) return from
    }

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

/** Side to move, straight off the FEN — no board needed. */
function colourToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
