/**
 * Can a beginner READ the puzzle they are given?
 *
 * Difficulty rating and legibility are different things and the corpus only
 * carries one of them. Measured, the easiest band in the set — 600, already
 * 250 points above the player this app was built for — has a median of 17
 * pieces on the board and 29 legal moves, and 59% of its puzzles need more
 * than one move from you. Sean: "the puzzles don't seem to make sense."
 *
 * The clean ones exist. This checks that they are the ones actually served
 * to a beginner, and that nothing is hidden from a stronger player.
 *
 *   npm run verify:clarity
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import {
  clarityBudget,
  hydrate,
  pickPuzzles,
  readability,
  type Puzzle,
  type RawPuzzle,
} from '../src/data/puzzles'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/* pickPuzzles fetches over HTTP; in Node we feed it the files directly. */
const DIR = resolve(import.meta.dirname, '../public/puzzles')
const load = (band: number) =>
  (JSON.parse(readFileSync(`${DIR}/band-${band}.json`, 'utf8')) as RawPuzzle[])
    .map(hydrate)
    .filter((x): x is Puzzle => x !== null)

/*
 * pickPuzzles fetches its bands. Serving them from disk rather than
 * reimplementing the picker is the whole point: a test that copies the thing
 * it is testing only ever proves the copy is self-consistent.
 */
globalThis.fetch = (async (url: string) => {
  const band = Number(String(url).match(/band-(\d+)\.json/)?.[1])
  return {
    ok: true,
    json: async () => JSON.parse(readFileSync(`${DIR}/band-${band}.json`, 'utf8')),
  }
}) as unknown as typeof fetch

/* ------------------------------------------------- the measurement ----- */

const band600 = load(600)
const pieces = band600.map((p) => p.pieces).sort((a, b) => a - b)
const median = pieces[Math.floor(pieces.length / 2)]!
console.log(`  band 600: ${band600.length} puzzles, median ${median} pieces on the board`)
check('the piece count is actually recorded', band600.every((p) => p.pieces >= 2),
      'some puzzle reported fewer than two pieces, which is not a chess position')
check('it matches the board', band600.slice(0, 200).every((p) =>
  p.pieces === new Chess(p.fen).board().reduce((n, r) => n + r.filter(Boolean).length, 0)))

const clear = band600.filter((p) => readability(p) <= 30)
console.log(`  ${clear.length} of them are inside a beginner's budget (${(clear.length / band600.length * 100).toFixed(1)}%)`)
check('there IS a supply of readable puzzles to prefer', clear.length >= 100, String(clear.length))

/* ------------------------------------------------- the budget ---------- */

check('a beginner gets a budget', clarityBudget(400) !== null)
check('it loosens as you improve',
      (clarityBudget(400) ?? 0) < (clarityBudget(900) ?? 0),
      `${clarityBudget(400)} vs ${clarityBudget(900)}`)
check('and switches off entirely once the clutter is the exercise',
      clarityBudget(1000) === null && clarityBudget(1500) === null)

/* ------------------------------------------------- what gets served ---- */

const seeded = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const beginner = await pickPuzzles({ rating: 400, count: 20, rng: seeded(7) })
const strong = await pickPuzzles({ rating: 1500, count: 20, rng: seeded(7) })

const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / Math.max(1, xs.length)
console.log(
  `\n  served to a 400: ${mean(beginner.map((p) => p.pieces)).toFixed(1)} pieces, ` +
    `${mean(beginner.map((p) => p.solution.length)).toFixed(2)} moves`,
)
console.log(
  `  served to a 1500: ${mean(strong.map((p) => p.pieces)).toFixed(1)} pieces, ` +
    `${mean(strong.map((p) => p.solution.length)).toFixed(2)} moves`,
)

check('a beginner is served every puzzle inside the budget',
      beginner.every((p) => readability(p) <= (clarityBudget(400) ?? Infinity)),
      beginner.filter((p) => readability(p) > 30).map((p) => `${p.pieces}pc/${p.solution.length}mv`).join(' '))
check('which is far clearer than the corpus median',
      mean(beginner.map((p) => p.pieces)) < median - 3,
      `${mean(beginner.map((p) => p.pieces)).toFixed(1)} vs ${median}`)
/*
 * The share, not the mean. A mean of 1.45 could be all two-movers and a pile
 * of one-movers, or everything sitting at one and a half moves, and only one
 * of those is the thing being asked for. Two-movers are not banned on
 * purpose: the basic mates ARE two and three movers, and a six-piece mate in
 * two is far more readable than a seventeen-piece mate in one.
 */
const oneMovers = beginner.filter((p) => p.solution.length === 1).length
const corpusOneMovers = band600.filter((p) => p.solution.length === 1).length / band600.length
console.log(
  `  one-movers: ${((oneMovers / beginner.length) * 100).toFixed(0)}% served ` +
    `vs ${(corpusOneMovers * 100).toFixed(0)}% in the corpus`,
)
check('most of what a beginner gets is a single move',
      oneMovers / beginner.length > 0.5,
      `${oneMovers}/${beginner.length}`)
check('which is a real shift off the corpus, not noise',
      oneMovers / beginner.length > corpusOneMovers + 0.1,
      `${(oneMovers / beginner.length).toFixed(2)} vs ${corpusOneMovers.toFixed(2)}`)
check('a strong player is NOT filtered — the clutter is their exercise',
      mean(strong.map((p) => p.pieces)) > mean(beginner.map((p) => p.pieces)),
      `${mean(strong.map((p) => p.pieces)).toFixed(1)} vs ${mean(beginner.map((p) => p.pieces)).toFixed(1)}`)

/*
 * The rule that must not break: prefer, never require. If the budget ever
 * starts CUTTING the pool, a themed request near the floor comes back empty
 * and the screen says "no puzzles left" when thousands remain.
 */
const clearSupply = band600.filter((p) => readability(p) <= 30).length
const greedy = clearSupply + 400
const narrow = await pickPuzzles({ rating: 400, count: greedy, rng: seeded(11) })
check('the budget reorders the pool, it does not shrink it',
      narrow.length === greedy, `${narrow.length} of ${greedy} requested`)
check('asking past the readable supply still returns the cluttered ones',
      narrow.filter((p) => readability(p) > 30).length > 0,
      'the budget is cutting the pool instead of reordering it')
check('and the readable ones all came first',
      narrow.slice(0, clearSupply).every((p) => readability(p) <= 30))

/* Two draws must not be the same five puzzles every morning. */
const a = await pickPuzzles({ rating: 400, count: 10, rng: seeded(1) })
const b = await pickPuzzles({ rating: 400, count: 10, rng: seeded(2) })
check('different draws give different puzzles',
      a.map((p) => p.id).join() !== b.map((p) => p.id).join())

console.log(fail === 0 ? '\n✓ beginners get puzzles they can read' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
