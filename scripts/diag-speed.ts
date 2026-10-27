/**
 * How long does a bot take to move?
 *
 * The ladder rebuild raised the weakest bots from depth 4 to depth 8 and cut
 * their candidate list from thirty-four to six. Both are deliberate — a weak
 * human searches selectively and misses things rather than searching shallowly
 * and accurately, and at depth 4 a third of lines came back without the
 * refutation the whole model rests on — but they pull the engine cost in
 * opposite directions, and nothing was measuring which won.
 *
 * It matters most exactly where it is least obvious. Bud and Pip are what a
 * beginner plays, on a phone, and a bot that thinks for two seconds over a
 * move it is about to get wrong anyway is a worse opponent than one that
 * answers instantly.
 *
 *   npm run diag:speed
 */

import { NodeEngine } from './lib/engine-node'
import { bandProfile } from '../src/engine/policy'
import { BANDS, type Band } from '../src/engine/types'
import { readFileSync, existsSync } from 'node:fs'

const CORPUS = 'scripts/data/tune-corpus.json'
const engine = new NodeEngine()

/** A handful of ordinary positions — the same ones the tuner uses. */
function positions(): string[] {
  if (!existsSync(CORPUS)) {
    throw new Error(`no corpus at ${CORPUS} — run npm run tune-sight -- --build 70 first`)
  }
  return (JSON.parse(readFileSync(CORPUS, 'utf8')) as string[]).slice(0, 12)
}

async function main() {
  await engine.init()
  const fens = positions()
  console.log(`${fens.length} positions per band, one search each.\n`)
  console.log('   band  depth  mpv     mean      p90    slowest')

  for (const band of BANDS) {
    const p = bandProfile(band as Band)
    const times: number[] = []
    for (const fen of fens) {
      const t0 = Date.now()
      await engine.analyse(fen, { depth: p.depth, multipv: p.multipv })
      times.push(Date.now() - t0)
    }
    times.sort((a, b) => a - b)
    const mean = times.reduce((a, b) => a + b, 0) / times.length
    const p90 = times[Math.min(times.length - 1, Math.floor(times.length * 0.9))]!
    console.log(
      `   ${String(band).padStart(4)}  ${String(p.depth).padStart(5)}  ${String(p.multipv).padStart(3)}` +
        `  ${mean.toFixed(0).padStart(6)}ms  ${String(p90).padStart(5)}ms  ${String(times[times.length - 1]).padStart(6)}ms`,
    )
  }

  /*
   * Node on a desktop is not a phone. Stockfish Lite in WebAssembly on a
   * mid-range handset runs somewhere around four to eight times slower, so
   * the number that matters is mean x 8 — and if THAT is comfortable the
   * bot is comfortable everywhere.
   */
  console.log(
    '\n   These are desktop node figures. A mid-range phone runs this WASM build' +
      '\n   roughly 4-8x slower, so judge the weakest bands on mean x 8.',
  )
  process.exit(0)
}

void main()
