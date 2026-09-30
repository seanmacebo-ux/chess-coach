/**
 * MaiaOpponent — a human-like bot backed by a Maia net, implementing the same
 * Opponent contract as the Stockfish bot so it's a drop-in in the Play screen.
 *
 * Maia predicts the move a real human of its rating would play, so unlike the
 * Stockfish bot it errs the way humans err (no alien engine shuffles). Strength
 * comes from the net's rating level, not from a search depth or a policy layer.
 */
import type { Opponent } from '../opponent'
import type { Style, UciMove } from '../types'
import { loadMaiaNet, type MaiaNet } from './net'
import { maiaForward, type MaiaResult } from './forward'

/** Maia rating levels that ship in public/maia (add 1100/1900 alongside 1500). */
export type MaiaLevel = 1100 | 1500 | 1900

const netCache = new Map<MaiaLevel, Promise<MaiaNet>>()

async function ungzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function loadLevel(level: MaiaLevel): Promise<MaiaNet> {
  let p = netCache.get(level)
  if (!p) {
    p = (async () => {
      const url = `${import.meta.env.BASE_URL}maia/maia-${level}.pb.gz`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`maia weights ${level}: HTTP ${resp.status}`)
      return loadMaiaNet(await ungzip(new Uint8Array(await resp.arrayBuffer())))
    })()
    // Don't let a transient failure permanently disable this level: drop the
    // rejected promise so the next call retries instead of re-throwing forever.
    p.catch(() => netCache.delete(level))
    netCache.set(level, p)
  }
  return p
}

export class MaiaOpponent implements Opponent {
  readonly id: string
  readonly name: string
  readonly elo: number
  readonly style: Style = 'human'
  private net: MaiaNet | null = null
  private rng: () => number

  constructor(level: MaiaLevel = 1500, opts: { name?: string; rng?: () => number } = {}) {
    this.elo = level
    this.id = `maia-${level}`
    this.name = opts.name ?? `Maia ${level}`
    this.rng = opts.rng ?? Math.random
  }

  private async loaded(): Promise<MaiaNet> {
    if (!this.net) this.net = await loadLevel(this.elo as MaiaLevel)
    return this.net
  }

  async newGame(): Promise<void> {
    // warm the weights so the first move isn't slow
    await this.loaded()
  }

  async move(fen: string): Promise<UciMove | null> {
    const net = await this.loaded()
    const { ranked } = maiaForward(net, fen)
    if (ranked.length === 0) return null
    // Sample proportional to Maia's policy: keeps the human-like spread of
    // choices instead of always the single top move.
    let r = this.rng()
    for (const m of ranked) {
      r -= m.p
      if (r <= 0) return m.uci
    }
    return ranked[0]!.uci
  }

  /** Full policy + WDL for a position — for the coach view / eval bar. */
  async analyse(fen: string): Promise<MaiaResult> {
    return maiaForward(await this.loaded(), fen)
  }
}
