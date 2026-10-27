/**
 * What does each band actually shed, and where should sight sit?
 *
 * REPLACES tune-bands.ts, which tuned an ANALYTIC MODEL of the policy:
 * expectedAcpl() reconstructed what a softmax over a candidate list ought to
 * lose and recommended temperature from that. Two problems, and the second
 * one is why the ladder ended up with a dead zone in it.
 *
 *   It tuned the model, not the bot. Any drift between the two — and
 *   describeMove, the style weights, the book and now vision all live in that
 *   gap — went straight into the recommendation.
 *
 *   It recommended temperature, which is no longer where strength comes from.
 *   A tuner pointed at a knob that does not drive strength will keep turning
 *   it until the number moves, which is exactly how temperature ended up
 *   RISING from 1400 to 1800 and collapsing two bands into one opponent.
 *
 * So this runs the real chooseMoveDetailed, over one fixed set of positions
 * every band sits, and measures the loss against a reference search. No model
 * of the policy anywhere.
 *
 * WHY NOT JUST USE calibrate. Because calibrate plays whole games: forty
 * minutes a pass, and at six games a cell a sample too small to tune on — the
 * ladder's own history is three rounds of tuning on differences smaller than
 * the noise. A fixed position set gives the same quantity, deterministically,
 * in a couple of minutes, with as many rolls per position as you want. Tune
 * here, confirm with calibrate.
 *
 * AND DO CONFIRM, BECAUSE THIS IS NOT THE THING THE LADDER IS MADE OF.
 *
 * Hitting every acpl target is not the same as the levels being spaced right,
 * and the measurement says so plainly. With the table tuned here to within
 * 4% of target at five of eight bands, a thirty-game head-to-head gave:
 *
 *     800 vs 1000   acpl ratio 1.26x   ->  87%
 *    1000 vs 1200   acpl ratio 1.37x   ->  73%
 *    1200 vs 1400   acpl ratio 1.21x   ->  93%
 *
 * The LARGEST accuracy gap produced the LOWEST score and the smallest
 * produced the highest. Average centipawn loss is a summary of a
 * distribution, and what decides a game is the tail of it — one 400cp move
 * loses the game whatever the other thirty-nine cost. Two bots can shed the
 * same mean from very different shapes.
 *
 * So treat this script as what it is: a fast way to put a band in the right
 * NEIGHBOURHOOD before spending an hour on games. The ladder is settled by
 * `calibrate --only ladder --games 30`, and nothing here should ever be
 * described as having fixed it.
 *
 *   npm run tune-sight
 *   npm run tune-sight -- --build 80 --rolls 6
 *   npm run tune-sight -- --bands 800,1400 --sight 0.7
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { bandProfile, chooseMoveDetailed } from '../src/engine/policy'
import { lineScore, BANDS, type Band } from '../src/engine/types'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const CORPUS = 'scripts/data/tune-corpus.json'
const BUILD = process.argv.includes('--build') ? arg('build', 80) : 0
const REF_DEPTH = arg('ref-depth', 14)
/** How many times each band plays each position. The policy is stochastic. */
const ROLLS = arg('rolls', 4)
/** Override every band's sight, to sweep it without editing the anchors. */
const SIGHT = process.argv.includes('--sight') ? arg('sight', NaN) : null
/** Same, for temperature. Sweeping one knob at a time is the whole point. */
const TEMP = process.argv.includes('--temperature') ? arg('temperature', NaN) : null
const OVERRIDE =
  SIGHT === null && TEMP === null
    ? undefined
    : {
        ...(SIGHT === null ? {} : { sight: SIGHT }),
        ...(TEMP === null ? {} : { temperature: TEMP }),
      }

const RATINGS: number[] = (() => {
  const i = process.argv.indexOf('--bands')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  if (!raw) return [...BANDS]
  return raw.split(',').map(Number).filter(Number.isFinite)
})()

const engine = new NodeEngine()
const EVAL_CAP = 1000
const clamp = (cp: number) => Math.max(-EVAL_CAP, Math.min(EVAL_CAP, cp))

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * Ordinary positions, still a game.
 *
 * Random legal play reaches a huge variety cheaply, and the filters are what
 * make it usable: not over, not already decided, and past the opening so the
 * book is not what is being measured. "Already decided" matters more than it
 * looks — in a position won by a rook almost every move keeps the win, so
 * every band scores near zero loss and the ladder appears flat for a reason
 * that has nothing to do with the bands.
 */
async function build(target: number): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const r = rng(0x5ca1ab1e)
  let tried = 0

  while (out.length < target && tried < target * 200) {
    tried++
    const board = new Chess()
    const plies = 12 + Math.floor(r() * 36)
    for (let i = 0; i < plies; i++) {
      const moves = board.moves({ verbose: true })
      if (moves.length === 0) break
      board.move(moves[Math.floor(r() * moves.length)]!)
    }
    if (board.isGameOver()) continue
    const fen = board.fen()
    const key = fen.split(' ').slice(0, 4).join(' ')
    if (seen.has(key)) continue
    // A position with one or two legal moves measures nothing about choosing.
    if (board.moves().length < 6) continue
    seen.add(key)

    const a = await engine.analyse(fen, { depth: REF_DEPTH, multipv: 1 })
    const line = a.lines[0]
    if (!line) continue
    if (Math.abs(clamp(lineScore(line))) > 300) continue
    out.push(fen)
    if (out.length % 10 === 0) process.stdout.write(`\r  built ${out.length}/${target}  `)
  }
  process.stdout.write('\r')
  return out
}

/** Reference evals, cached — the same position recurs across every band. */
const evalCache = new Map<string, number>()
async function refEval(fen: string): Promise<number> {
  const key = fen.split(' ').slice(0, 4).join(' ')
  const hit = evalCache.get(key)
  if (hit !== undefined) return hit
  const a = await engine.analyse(fen, { depth: REF_DEPTH, multipv: 1 })
  const line = a.lines[0]
  const v = line ? clamp(lineScore(line)) : 0
  evalCache.set(key, v)
  return v
}

/** What a move cost, from the mover's point of view. */
async function lossOf(fen: string, uci: string, best: number): Promise<number | null> {
  const board = new Chess(fen)
  try {
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return null
  }
  if (board.isGameOver()) {
    return Math.max(0, best - (board.isCheckmate() ? EVAL_CAP : 0))
  }
  return Math.max(0, best - -(await refEval(board.fen())))
}

function wilsonish(xs: number[]): { mean: number; half: number } {
  if (xs.length === 0) return { mean: 0, half: 0 }
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)
  return { mean: m, half: 1.96 * Math.sqrt(v / xs.length) }
}

async function main() {
  await engine.init()

  let fens: string[]
  if (BUILD > 0 || !existsSync(CORPUS)) {
    const n = BUILD > 0 ? BUILD : 80
    console.log(`Building ${n} ordinary positions — not over, not already decided.`)
    fens = await build(n)
    mkdirSync(dirname(CORPUS), { recursive: true })
    writeFileSync(CORPUS, JSON.stringify(fens, null, 1))
    console.log(`  wrote ${fens.length} to ${CORPUS}`)
  } else {
    fens = JSON.parse(readFileSync(CORPUS, 'utf8')) as string[]
  }

  console.log(
    `\n${fens.length} positions x ${ROLLS} rolls, reference depth ${REF_DEPTH}` +
      (SIGHT === null ? '' : `, sight forced to ${SIGHT}`) +
      (TEMP === null ? '' : `, temperature forced to ${TEMP}`) +
      `\nreport only — nothing is written back to ANCHORS.\n`,
  )
  console.log('   band  target  measured            sight  temp   naive   ratio')

  const rows: { band: number; target: number; measured: number; half: number }[] = []
  for (const band of RATINGS) {
    const profile = bandProfile(band as Band)
    const sight = SIGHT ?? profile.sight
    const losses: number[] = []

    for (let i = 0; i < fens.length; i++) {
      const fen = fens[i]!
      const best = await refEval(fen)
      const a = await engine.analyse(fen, { depth: profile.depth, multipv: profile.multipv })
      for (let roll = 0; roll < ROLLS; roll++) {
        // Same seed per (position, roll) for every band, so one band is never
        // luckier than another — only better or worse at seeing.
        const c = chooseMoveDetailed(
          fen,
          a.lines,
          band,
          'human',
          rng(0xbeef + i * 7919 + roll * 104729),
          OVERRIDE,
        )
        const uci = c.uci ?? a.bestMove
        if (!uci) continue
        const loss = await lossOf(fen, uci, best)
        if (loss !== null) losses.push(loss)
      }
    }

    const { mean, half } = wilsonish(losses)
    rows.push({ band, target: profile.targetAcpl, measured: mean, half })
    const ratio = profile.targetAcpl > 0 ? mean / profile.targetAcpl : 0
    const flag = ratio < 0.8 ? '  too strong' : ratio > 1.25 ? '  too weak' : ''
    console.log(
      `   ${String(band).padStart(4)}  ${String(profile.targetAcpl).padStart(6)}  ` +
        `${mean.toFixed(1).padStart(6)} +/- ${half.toFixed(1).padStart(4)}  ` +
        `${sight.toFixed(2).padStart(5)}  ${String(TEMP ?? profile.temperature).padStart(4)}  ` +
        `${profile.naiveShare.toFixed(3)}  ` +
        `${ratio.toFixed(2).padStart(5)}${flag}`,
    )
  }

  /*
   * The ladder has to be ordered. A band measuring LESS loss than the one
   * above it is the 1400/1600 failure again, and it is the one thing worth
   * shouting about — an out-of-target band is a number to turn, an inverted
   * pair is a dial that does not work.
   */
  const inversions = rows
    .slice(1)
    .map((r, i) => ({ r, prev: rows[i]! }))
    .filter(({ r, prev }) => r.measured > prev.measured)
  console.log(
    inversions.length === 0
      ? '\n   the ladder is ordered.'
      : `\n   ${inversions.length} INVERSION(S): ` +
          inversions
            .map(({ r, prev }) => `${prev.band}(${prev.measured.toFixed(0)}) < ${r.band}(${r.measured.toFixed(0)})`)
            .join(', '),
  )
  process.exit(0)
}

void main()
