/**
 * When material is free, does the bot take it?
 *
 * WHY A SEPARATE SCRIPT. diag-bots already reports a punish-rate, measured
 * during self-play, and the numbers it produced were noise: 22.9% at 350,
 * 13.9% at 800, 20.2% at 1400. Two reasons, both fatal to the measurement:
 *
 *   THE EXAM WAS DIFFERENT FOR EVERY CANDIDATE. In self-play the opponent is
 *   the same band, so a 350 is handed chaotic positions full of loose pieces
 *   and a 1700 is handed clean ones. The rate confounds "how well does this
 *   bot punish" with "how badly does its opponent hang things", and those run
 *   in opposite directions down the ladder.
 *
 *   THE SAMPLE COLLAPSED AT THE TOP. Free material is rare in a strong bot's
 *   games, so exactly where the claim needed evidence there were a handful of
 *   chances and the interval swallowed the difference.
 *
 * So: one fixed exam, every band sits it. Each band plays each position once,
 * with its own depth, multipv and temperature, through the same
 * chooseMoveDetailed the app calls. Equal N, identical questions, and a
 * Wilson interval on every rate so that a difference either clears the noise
 * or is not claimed.
 *
 * WHAT MAKES A POSITION ADMISSIBLE, and this took two goes to get right. The
 * first version asked only that the reference engine's best move BE the
 * capture, and the result was a 2200 taking free material 53.8% of the time
 * — which is not a finding about the 2200, it is a broken exam. Measuring the
 * corpus said why: the median gap between best and second best was 141
 * centipawns, 32 of 80 positions had a gap under 100, and the median position
 * was already won by more than a rook. In a position you are winning by 500,
 * declining a free knight costs you almost nothing, so "did not take it" was
 * never an error and the rate was really a temperature reading.
 *
 * Three filters now, and all three are about making a miss cost something:
 *
 *   1. A capture winning 300+ net of the recapture. Mechanical, and the same
 *      shape a person sees when they look at the board for two seconds.
 *   2. The reference engine's own best move IS that capture.
 *   3. It beats the second-best move by at least CLEAR_MARGIN, and the game
 *      is still a game if you miss it. Without this an exam position can be
 *      one where everything wins.
 *
 *   npm run diag:punish                      (uses/creates the cached corpus)
 *   npm run diag:punish -- --build 120       (rebuild the corpus at 120 seats)
 *   npm run diag:punish -- --bands 350,1400
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { profileFor, chooseMoveDetailed } from '../src/engine/policy'
import { lineScore } from '../src/engine/types'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const CORPUS = 'scripts/data/punish-corpus.json'
const BUILD = process.argv.includes('--build') ? arg('build', 120) : 0
const REF_DEPTH = arg('ref-depth', 14)
/**
 * How much the capture has to beat everything else by.
 *
 * Two pawns. Below that, not taking it is a difference of opinion rather
 * than a miss, and an exam full of those measures how tightly a band ranks
 * near-equal moves — which is the thing a player cannot feel and precisely
 * what this script was written to stop reporting.
 */
const CLEAR_MARGIN = arg('margin', 200)
/**
 * And the position must still be a game if the capture is missed.
 *
 * Declining a free knight while winning by a rook is not a blunder worth
 * counting. The cap is on what the SECOND best move leaves you with, since
 * that is where missing it actually lands.
 */
const STILL_A_GAME = arg('still-a-game', 400)
const SEATS = arg('seats', 0)

const RATINGS = (() => {
  const i = process.argv.indexOf('--bands')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  return [...new Set((raw ?? '350,550,800,1100,1400,1700,2200').split(',').map(Number).filter(Number.isFinite))]
})()

const engine = new NodeEngine()
const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

/**
 * The best capture available, net of the single best recapture.
 *
 * One capture deep on purpose — a full static exchange evaluation would
 * change what counts as "free" and this has to agree with what a person sees
 * when they look at the board for two seconds.
 */
function freeMaterial(fen: string): { uci: string; net: number } | null {
  const board = new Chess(fen)
  let best: { uci: string; net: number } | null = null
  for (const m of board.moves({ verbose: true })) {
    if (!m.captured) continue
    const won = VALUE[m.captured] ?? 0
    board.move(m)
    const back = board
      .moves({ verbose: true })
      .filter((r) => r.to === m.to)
      .map((r) => VALUE[r.captured ?? 'p'] ?? 0)
    board.undo()
    const net = won - (back.length ? Math.max(...back) : 0)
    if (net >= 300 && (!best || net > best.net)) {
      best = { uci: `${m.from}${m.to}${m.promotion ?? ''}`, net }
    }
  }
  return best
}

interface Seat {
  fen: string
  /** The capture. Taking it is the reference engine's own first choice. */
  uci: string
  /** Material won, net of the recapture. */
  net: number
  /** How far ahead of the second-best move it is, in centipawns. */
  margin: number
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * Find positions where a piece is there for the taking and missing it hurts.
 *
 * Random legal play, which produces loose material at a useful rate and —
 * more importantly — produces it INDEPENDENTLY of any band, so no bot is
 * examined on positions its own kind of opponent created. It also produces a
 * lot of already-decided rubbish, which is what the margin filter is for;
 * expect roughly one position in six to survive.
 */
async function build(target: number): Promise<Seat[]> {
  const seats: Seat[] = []
  const seen = new Set<string>()
  const r = rng(0xc0ffee)
  let tried = 0

  while (seats.length < target && tried < target * 400) {
    tried++
    const board = new Chess()
    const plies = 8 + Math.floor(r() * 44)
    for (let i = 0; i < plies; i++) {
      const moves = board.moves({ verbose: true })
      if (moves.length === 0) break
      board.move(moves[Math.floor(r() * moves.length)]!)
    }
    if (board.isGameOver()) continue
    const fen = board.fen()
    const key = fen.split(' ').slice(0, 4).join(' ')
    if (seen.has(key)) continue
    const free = freeMaterial(fen)
    if (!free) continue
    seen.add(key)

    const a = await engine.analyse(fen, { depth: REF_DEPTH, multipv: 2 })
    if (a.bestMove !== free.uci) continue
    const scores = a.lines.map(lineScore).sort((x, y) => y - x)
    const second = scores[1]
    // A position with only one legal move teaches nothing either.
    if (second === undefined) continue
    const margin = (scores[0] ?? 0) - second
    if (margin < CLEAR_MARGIN) continue
    if (Math.abs(second) > STILL_A_GAME) continue
    seats.push({ fen, uci: free.uci, net: free.net, margin })
    if (seats.length % 10 === 0) process.stdout.write(`\r  built ${seats.length}/${target}  `)
  }
  process.stdout.write('\r')
  return seats
}

/** Wilson score interval — honest at the small n this runs at. */
function wilson(hits: number, n: number): [number, number] {
  if (n === 0) return [0, 1]
  const z = 1.96
  const p = hits / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)]
}

async function main() {
  await engine.init()

  let seats: Seat[]
  if (BUILD > 0 || !existsSync(CORPUS)) {
    const n = BUILD > 0 ? BUILD : 120
    console.log(
      `Building the exam — ${n} positions where taking is the engine's own best\n` +
        `move, beats the second best by ${CLEAR_MARGIN}cp, and leaves a game still worth\n` +
        `playing. Roughly one position in six survives that, so this takes a while.`,
    )
    seats = await build(n)
    mkdirSync(dirname(CORPUS), { recursive: true })
    writeFileSync(CORPUS, JSON.stringify(seats, null, 1))
    console.log(`  wrote ${seats.length} to ${CORPUS}`)
  } else {
    seats = JSON.parse(readFileSync(CORPUS, 'utf8')) as Seat[]
  }
  if (SEATS > 0) seats = seats.slice(0, SEATS)

  const margins = seats.map((s) => s.margin).sort((a, b) => a - b)
  console.log(
    `\nFree material: ${seats.length} positions, every band sits the same exam.\n` +
      `A hit is playing the capture the reference engine plays. Missing it costs\n` +
      `at least ${CLEAR_MARGIN}cp — median ${margins[Math.floor(margins.length / 2)] ?? 0}cp — ` +
      `and leaves a game still worth playing.\n`,
  )

  const rows: { elo: number; hits: number; n: number; lo: number; hi: number }[] = []
  for (const elo of RATINGS) {
    const profile = profileFor(elo)
    let hits = 0
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i]!
      const a = await engine.analyse(seat.fen, { depth: profile.depth, multipv: profile.multipv })
      // Same rng per seat for every band, so a band is never luckier than
      // another one — only better or worse at seeing.
      const c = chooseMoveDetailed(seat.fen, a.lines, elo, 'human', rng(0x5eed + i * 7919))
      if ((c.uci ?? a.bestMove) === seat.uci) hits++
    }
    const [lo, hi] = wilson(hits, seats.length)
    rows.push({ elo, hits, n: seats.length, lo, hi })
    const pct = (hits / seats.length) * 100
    const bar = '#'.repeat(Math.round(pct / 4)).padEnd(25, '.')
    console.log(
      `  ${String(elo).padStart(4)}  takes it ${pct.toFixed(1).padStart(5)}%  ` +
        `[${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}]  ${bar}`,
    )
  }

  /*
   * The claim this script exists to test is NOT "the rate goes up" — any
   * monotone noise does that. It is that the ends are separated: a 350 and a
   * 2200 should not have overlapping intervals, or the difference is not
   * there to be felt.
   */
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (first && last && first !== last) {
    const separated = first.hi < last.lo
    console.log(
      `\n  ${first.elo} and ${last.elo}: ` +
        (separated
          ? `separated — ${(first.hi * 100).toFixed(0)}% ceiling against a ` +
            `${(last.lo * 100).toFixed(0)}% floor.`
          : `NOT separated — the intervals overlap, so this is not yet a ` +
            `difference anybody would feel.`),
    )
  }
  const inversions = rows
    .slice(1)
    .map((r, i) => ({ r, prev: rows[i]! }))
    .filter(({ r, prev }) => r.hits < prev.hits)
  console.log(
    inversions.length === 0
      ? '  the ladder is monotonic.'
      : `  ${inversions.length} inversion(s): ` +
          inversions.map(({ r, prev }) => `${prev.elo}>${r.elo}`).join(', '),
  )

  // Same exit as diag-bots: the WASM worker keeps the loop alive otherwise.
  process.exit(0)
}

void main()
