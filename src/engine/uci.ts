/**
 * Stockfish 18 (single-threaded WASM) behind a promise API.
 *
 * The worker is a classic Emscripten script served from public/sf/, not a
 * bundled ES worker — stockfish.js locates its .wasm sibling relative to its
 * own URL, so both files must sit in the same served directory.
 *
 * One search at a time. Calls queue rather than interleave, because UCI is a
 * stateful line protocol and two concurrent `go` commands corrupt each other.
 */

import type { Analysis, Line, SearchLimits, UciMove } from './types'

/**
 * Resolved lazily, not at module scope.
 *
 * `import.meta.env` only exists once Vite has processed the module, so a
 * top-level read of it throws the moment anything in this file is imported
 * outside the browser bundle. That mattered because `coach/exercises.ts`
 * imports from here for the engine-backed threat drill — which meant
 * `loosePieces`, pure board logic with no engine involvement at all, could not
 * be imported by a Node script to be checked. One constant made an entire
 * layer untestable.
 *
 * Computing it inside the function costs nothing: it is read once per worker
 * boot, and the worker boots once.
 */
function engineUrl(): string {
  return `${import.meta.env.BASE_URL}sf/stockfish-18-lite-single.js`
}

type Listener = (line: string) => void

export class Engine {
  private worker: Worker | null = null
  private listeners = new Set<Listener>()
  private queue: Promise<unknown> = Promise.resolve()
  private ready = false

  /** Boot the worker and complete the UCI handshake. Idempotent. */
  async init(): Promise<void> {
    if (this.ready) return
    if (!this.worker) {
      this.worker = new Worker(engineUrl())
      this.worker.onmessage = (e: MessageEvent) => {
        // Emscripten builds emit either a bare string or {data: string}.
        const raw: unknown = e.data
        const text = typeof raw === 'string' ? raw : (raw as { data?: string })?.data
        if (typeof text === 'string') {
          for (const l of this.listeners) l(text)
        }
      }
      this.worker.onerror = (e) => {
        console.error('[engine] worker error', e.message)
      }
    }
    await this.expect('uci', (l) => l === 'uciok')
    await this.isReady()
    this.ready = true
  }

  private send(cmd: string): void {
    if (!this.worker) throw new Error('engine not initialised')
    this.worker.postMessage(cmd)
  }

  /** Send a command and resolve once `match` sees the terminating line. */
  private expect(
    cmd: string,
    match: (line: string) => boolean,
    onLine?: Listener,
    timeoutMs = 60_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`engine timeout after ${timeoutMs}ms waiting on: ${cmd}`))
      }, timeoutMs)

      const listener: Listener = (line) => {
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
    await this.expect('isready', (l) => l === 'readyok', undefined, 120_000)
  }

  async setOption(name: string, value: string | number | boolean): Promise<void> {
    this.send(`setoption name ${name} value ${String(value)}`)
    await this.isReady()
  }

  /** Serialise searches — see class note on why this matters. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    // Keep the chain alive even if a search rejects.
    this.queue = next.catch(() => undefined)
    return next
  }

  async analyse(fen: string, limits: SearchLimits = {}): Promise<Analysis> {
    await this.init()
    const { depth = 12, movetimeMs, multipv = 1 } = limits

    return this.run(async () => {
      await this.setOption('MultiPV', multipv)

      const byRank = new Map<number, Line>()
      let best: UciMove | null = null
      let maxDepth = 0

      const onLine: Listener = (line) => {
        if (line.startsWith('info ')) {
          const parsed = parseInfo(line)
          // Ignore currmove-only chatter (no pv).
          if (parsed) {
            byRank.set(parsed.multipv, parsed)
            if (parsed.depth > maxDepth) maxDepth = parsed.depth
          }
        } else if (line.startsWith('bestmove')) {
          const tok = line.split(/\s+/)[1]
          best = tok && tok !== '(none)' ? tok : null
        }
      }

      const go = movetimeMs ? `go movetime ${movetimeMs}` : `go depth ${depth}`
      this.send(`position fen ${fen}`)
      await this.expect(go, (l) => l.startsWith('bestmove'), onLine, 120_000)

      const lines = [...byRank.values()].sort((a, b) => a.multipv - b.multipv)
      return { fen, depth: maxDepth, lines, bestMove: best }
    })
  }

  /** Reset between games so the transposition table can't leak across them. */
  async newGame(): Promise<void> {
    await this.init()
    await this.run(async () => {
      this.send('ucinewgame')
      await this.isReady()
    })
  }

  quit(): void {
    try {
      this.worker?.postMessage('quit')
    } catch {
      /* worker already gone */
    }
    this.worker?.terminate()
    this.worker = null
    this.listeners.clear()
    this.ready = false
  }
}

/**
 * Parse one `info` line.
 *
 * Example:
 *   info depth 14 seldepth 20 multipv 2 score cp -34 nodes 91234 pv d7d5 c2c4
 *
 * Returns null for lines with no pv (e.g. `info depth 1 currmove e2e4`).
 */
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

/** Process-wide engine. One WASM instance is plenty and it costs 7.3MB. */
let shared: Engine | null = null

export function getEngine(): Engine {
  if (!shared) shared = new Engine()
  return shared
}
