/**
 * Node-side Stockfish transport.
 *
 * The browser talks to the engine through a Worker (src/engine/uci.ts). Node
 * can't — the npm package exposes a different surface here: initEngine()
 * resolves an Emscripten module with `sendCommand` and a `listener` hook.
 *
 * Deliberately NOT a copy of uci.ts. Only the transport differs; the move
 * SELECTION logic is imported from src/engine/policy.ts by the harness, so
 * the calibration measures the same code the app actually ships.
 */

import { createRequire } from 'node:module'
import type { Analysis, Line, UciMove } from '../../src/engine/types'

const require_ = createRequire(import.meta.url)

type RawEngine = {
  sendCommand: (cmd: string) => void
  listener?: (line: string) => void
  print?: (line: string) => void
}

/** Re-implemented here rather than imported — uci.ts is browser-only. */
export function parseInfo(line: string): Line | null {
  const t = line.split(/\s+/)
  let depth = 0
  let multipv = 1
  let cp: number | null = null
  let mate: number | null = null
  let pv: UciMove[] = []

  for (let i = 0; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i]) || 0
        break
      case 'multipv':
        multipv = Number(t[++i]) || 1
        break
      case 'score':
        if (t[i + 1] === 'cp') {
          cp = Number(t[i + 2])
          i += 2
        } else if (t[i + 1] === 'mate') {
          mate = Number(t[i + 2])
          i += 2
        }
        break
      case 'pv':
        pv = t.slice(i + 1).filter(Boolean)
        i = t.length
        break
      default:
        break
    }
  }
  if (pv.length === 0) return null
  return { multipv, depth, cp, mate, pv }
}

export class NodeEngine {
  private engine: RawEngine | null = null
  private listeners = new Set<(l: string) => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private currentMultiPv = -1

  async init(): Promise<void> {
    if (this.engine) return
    const initEngine = require_('stockfish') as (which: string) => Promise<RawEngine>
    const eng = await initEngine('lite-single')
    eng.listener = (line: string) => {
      const text = String(line)
      for (const l of this.listeners) l(text)
    }
    this.engine = eng
    await this.expect('uci', (l) => l === 'uciok')
    await this.isReady()
  }

  private send(cmd: string): void {
    if (!this.engine) throw new Error('engine not initialised')
    this.engine.sendCommand(cmd)
  }

  private expect(
    cmd: string,
    match: (line: string) => boolean,
    onLine?: (l: string) => void,
    timeoutMs = 120_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`engine timeout (${timeoutMs}ms) on: ${cmd}`))
      }, timeoutMs)
      const listener = (line: string) => {
        onLine?.(line)
        if (match(line)) {
          cleanup()
          resolve()
        }
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.listeners.delete(listener)
      }
      this.listeners.add(listener)
      try {
        this.send(cmd)
      } catch (err) {
        cleanup()
        reject(err)
      }
    })
  }

  async isReady(): Promise<void> {
    await this.expect('isready', (l) => l === 'readyok')
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  async analyse(fen: string, opts: { depth?: number; multipv?: number } = {}): Promise<Analysis> {
    await this.init()
    const { depth = 12, multipv = 1 } = opts

    return this.run(async () => {
      // Skip the setoption round-trip when nothing changed — it costs a
      // readyok handshake per call and the harness makes tens of thousands.
      if (multipv !== this.currentMultiPv) {
        this.send(`setoption name MultiPV value ${multipv}`)
        await this.isReady()
        this.currentMultiPv = multipv
      }

      const byRank = new Map<number, Line>()
      let best: UciMove | null = null
      let maxDepth = 0

      const onLine = (line: string) => {
        if (line.startsWith('info ')) {
          const p = parseInfo(line)
          if (p) {
            byRank.set(p.multipv, p)
            if (p.depth > maxDepth) maxDepth = p.depth
          }
        } else if (line.startsWith('bestmove')) {
          const tok = line.split(/\s+/)[1]
          best = tok && tok !== '(none)' ? tok : null
        }
      }

      this.send(`position fen ${fen}`)
      await this.expect(`go depth ${depth}`, (l) => l.startsWith('bestmove'), onLine)

      const lines = [...byRank.values()].sort((a, b) => a.multipv - b.multipv)
      return { fen, depth: maxDepth, lines, bestMove: best }
    })
  }

  async newGame(): Promise<void> {
    await this.init()
    await this.run(async () => {
      this.send('ucinewgame')
      await this.isReady()
    })
  }
}
