/**
 * How weak CAN a bot be?
 *
 * The bottom of the ladder was given a 320-acpl target and measured 178.8 in
 * self-play, with 350 and 550 landing on the same number inside their
 * intervals. Raising temperature did nothing, which is the signature of a
 * saturated knob rather than a mis-tuned one: at multipv 32 the softmax is
 * already nearly uniform over almost every legal move, so there is nothing
 * further down the list to reach.
 *
 * Which raises the question nobody had asked. If sampling uniformly at random
 * from every legal move sheds, say, 200 centipawns a move, then 320 is not a
 * hard target — it is a target below the floor, and a tuner aiming at it will
 * turn every knob to its stop and report failure forever.
 *
 * So this measures the two policies that bracket everything:
 *
 *   RANDOM — uniform over legal moves. Nothing weaker is possible without
 *   playing deliberately bad chess, which is not what a weak human does.
 *
 *   NAIVE — the one-ply policy the blunder path uses. Takes the biggest
 *   thing on offer, gives the check, pushes the pawn, never looks at the
 *   reply. This is what a genuine beginner's move generator looks like.
 *
 *   npm run diag:floor
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { lineScore } from '../src/engine/types'
import { naiveMove, seededRng, type Rng } from '../src/engine/policy'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const GAMES = arg('games', 8)
const MAX_PLIES = arg('max-plies', 120)
const REF_DEPTH = arg('ref-depth', 12)

const EVAL_CAP = 1000
const clamp = (cp: number) => Math.max(-EVAL_CAP, Math.min(EVAL_CAP, cp))
const engine = new NodeEngine()

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

function randomMove(fen: string, rng: Rng): string | null {
  const ms = new Chess(fen).moves({ verbose: true })
  if (ms.length === 0) return null
  const m = ms[Math.floor(rng() * ms.length)]!
  return `${m.from}${m.to}${m.promotion ?? ''}`
}

/** Same one-capture-deep test the other diagnostic uses. */
function somethingHangs(fen: string): boolean {
  const board = new Chess(fen)
  for (const m of board.moves({ verbose: true })) {
    if (!m.captured) continue
    const won = VALUE[m.captured] ?? 0
    if (won < 300) continue
    board.move(m)
    const back = board.moves({ verbose: true }).filter((r) => r.to === m.to)
      .map((r) => VALUE[r.captured ?? 'p'] ?? 0)
    board.undo()
    if (won - (back.length ? Math.max(...back) : 0) >= 300) return true
  }
  return false
}

async function lossOf(fenBefore: string, uci: string): Promise<number | null> {
  const before = await engine.analyse(fenBefore, { depth: REF_DEPTH, multipv: 1 })
  if (!before.lines[0]) return null
  const best = clamp(lineScore(before.lines[0]))
  const board = new Chess(fenBefore)
  try {
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return null
  }
  if (board.isGameOver()) return board.isCheckmate() ? 0 : null
  const after = await engine.analyse(board.fen(), { depth: REF_DEPTH, multipv: 1 })
  if (!after.lines[0]) return null
  return Math.max(0, best - clamp(-lineScore(after.lines[0])))
}

async function run(name: string, pick: (fen: string, rng: Rng) => string | null) {
  const losses: number[] = []
  let hangs = 0
  let counted = 0
  for (let g = 0; g < GAMES; g++) {
    const board = new Chess()
    const rng = seededRng(0x5eed + g * 7919)
    while (!board.isGameOver() && board.history().length < MAX_PLIES) {
      const fen = board.fen()
      const uci = pick(fen, rng)
      if (!uci) break
      const loss = await lossOf(fen, uci)
      try {
        board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      } catch {
        break
      }
      if (loss !== null) {
        losses.push(loss)
        counted++
        if (somethingHangs(board.fen())) hangs++
      }
      process.stdout.write(`    ${name}: game ${g + 1}/${GAMES}, ${losses.length} moves   \r`)
    }
  }
  const n = losses.length
  const mean = losses.reduce((a, c) => a + c, 0) / Math.max(1, n)
  const v = losses.reduce((a, c) => a + (c - mean) ** 2, 0) / Math.max(1, n - 1)
  const ci = 1.96 * Math.sqrt(v / Math.max(1, n))
  console.log(
    `  ${name.padEnd(8)} ${mean.toFixed(1).padStart(7)} ± ${ci.toFixed(0).padEnd(4)} acpl` +
      `   ${String(n).padStart(5)} moves` +
      `   something hangs after ${((hangs / Math.max(1, counted)) * 100).toFixed(1)}% of them`,
  )
}

async function main() {
  await engine.init()
  console.log(`\n  ${GAMES} games each, referee depth ${REF_DEPTH}\n`)
  await run('random', randomMove)
  await run('naive', naiveMove)
  console.log(
    '\n  Anything the ladder aims BELOW the weaker of these is unreachable,\n' +
      '  and a tuner pointed at it will turn every knob to its stop forever.\n',
  )
  process.exit(0)
}

void main()
