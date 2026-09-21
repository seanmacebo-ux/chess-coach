/**
 * How much does a band actually shed — and is the answer worth believing?
 *
 * THE REASON THIS EXISTS. Tuning the bands went round three times on numbers
 * that could not support it. calibrate.ts plays 4 games per band, which is
 * about 290 measured moves, and per-move loss is violently skewed: most moves
 * shed nothing and a handful shed 300cp. A mean over 290 samples of that
 * shape carries a large standard error, and nothing in the report said so —
 * so 105.4 and 98.0 read as two different answers when they are one answer
 * with noise on it. The last tuning pass DOUBLED band 800's temperature and
 * measured lower. That is not a result, it is a coin.
 *
 * So this measures the one quantity the tuning loop needs, at a sample size
 * that can settle it, and prints the confidence interval beside the number.
 * A tuner that cannot tell signal from noise will chase noise forever, and
 * this one did, three times.
 *
 * It is deliberately NOT a replacement for calibrate.ts. That also checks the
 * Elo ladder and style parity — whether the dial is a dial at all. This is
 * the fast inner loop; that is the slow outer one.
 *
 *   npm run measure-acpl -- --bands 800,1200 --games 16 [--ref-depth 14]
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { lineScore, nearestBand, type Band } from '../src/engine/types'
import { bandProfile, chooseMove } from '../src/engine/policy'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const GAMES = arg('games', 16)
const MAX_PLIES = arg('max-plies', 140)
/*
 * The referee must out-search the band it is judging. Bands to 1400 search at
 * depth 9, so 14 is a comfortable margin and roughly twice as fast as the 16
 * calibrate.ts uses for the whole ladder — which is what buys the extra games
 * that make the number mean anything.
 */
const REF_DEPTH = arg('ref-depth', 14)

const BANDS = (() => {
  const i = process.argv.indexOf('--bands')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  const parsed = (raw ?? '800,1000,1200,1400').split(',').map((b) => nearestBand(Number(b)))
  return [...new Set(parsed)]
})()

/** The same cap calibrate.ts uses — a mate is not a 99,000cp mistake. */
const EVAL_CAP = 1000
const clamp = (cp: number) => Math.max(-EVAL_CAP, Math.min(EVAL_CAP, cp))

const engine = new NodeEngine()

async function lossOf(fenBefore: string, uci: string): Promise<number | null> {
  const before = await engine.analyse(fenBefore, { depth: REF_DEPTH, multipv: 1 })
  const bestLine = before.lines[0]
  if (!bestLine) return null
  const best = clamp(lineScore(bestLine))

  const board = new Chess(fenBefore)
  try {
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return null
  }
  if (board.isGameOver()) return board.isCheckmate() ? 0 : null

  const after = await engine.analyse(board.fen(), { depth: REF_DEPTH, multipv: 1 })
  const afterLine = after.lines[0]
  if (!afterLine) return null
  return Math.max(0, best - clamp(-lineScore(afterLine)))
}

/** Deterministic per game, so the same seed replays the same game. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

async function measure(band: Band): Promise<number[]> {
  const profile = bandProfile(band)
  const losses: number[] = []

  for (let g = 0; g < GAMES; g++) {
    await engine.newGame()
    const board = new Chess()
    const rngW = seeded(0x1234 + g * 7919)
    const rngB = seeded(0x9abc + g * 104729)

    while (!board.isGameOver() && board.history().length < MAX_PLIES) {
      const fen = board.fen()
      const rng = board.turn() === 'w' ? rngW : rngB
      const a = await engine.analyse(fen, { depth: profile.depth, multipv: profile.multipv })
      const uci = chooseMove(fen, a.lines, band, 'human', rng) ?? a.bestMove
      if (!uci) break
      const loss = await lossOf(fen, uci)
      if (loss !== null) losses.push(loss)
      try {
        board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      } catch {
        break
      }
    }
    process.stdout.write(`    band ${band}: ${g + 1}/${GAMES} games, ${losses.length} moves   \r`)
  }
  return losses
}

/**
 * Mean with a 95% interval.
 *
 * The interval is the entire point. Without it, two numbers that differ by
 * noise look like a trend, and a tuning loop built on that walks in circles.
 */
function summarise(losses: number[]): { mean: number; ci: number; blunders: number } {
  const n = losses.length
  if (n === 0) return { mean: 0, ci: 0, blunders: 0 }
  const mean = losses.reduce((a, c) => a + c, 0) / n
  const variance = losses.reduce((a, c) => a + (c - mean) ** 2, 0) / Math.max(1, n - 1)
  return {
    mean,
    ci: 1.96 * Math.sqrt(variance / n),
    blunders: losses.filter((l) => l >= 200).length / n,
  }
}

async function main() {
  await engine.init()
  console.log(`\n  ${GAMES} games per band, referee depth ${REF_DEPTH}\n`)
  console.log('  band  target   measured   95% interval    moves   200cp+    verdict')

  for (const band of BANDS) {
    const losses = await measure(band)
    const { mean, ci, blunders } = summarise(losses)
    const target = bandProfile(band).targetAcpl
    const lo = mean - ci
    const hi = mean + ci
    const verdict = hi < target ? 'too strong' : lo > target ? 'too weak' : 'on target'
    console.log(
      `  ${String(band).padStart(4)}  ${String(target).padStart(6)}` +
      `   ${mean.toFixed(1).padStart(8)}` +
      `   ${lo.toFixed(0).padStart(5)} – ${hi.toFixed(0).padEnd(5)}` +
      `  ${String(losses.length).padStart(6)}` +
      `  ${(blunders * 100).toFixed(1).padStart(5)}%   ${verdict}`,
    )
  }
  console.log('')
  process.exit(0)
}

void main()
