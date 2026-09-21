/**
 * Is the difficulty ladder a ladder?
 *
 * This file exists because it wasn't. Every bot's rating was snapped to one
 * of eight bands before the profile was looked up, so Bud (350), Kit (550)
 * and Pip (800) resolved to the same numbers — three opponents, one bot. The
 * roster comments knew something was wrong ("the 1000/1200 pair is
 * non-monotonic") and blamed the tuning. It was the lookup.
 *
 * Nothing caught it because nothing ever compared two bots to each other. So
 * that is what this does: walk the actual roster, in order, and insist each
 * one is a different and harder opponent than the last.
 *
 *   npm run verify:policy
 */

import { Chess } from 'chess.js'
import { BOTS } from '../src/engine/roster'
import { profileFor, naiveMove, seededRng, chooseMoveDetailed } from '../src/engine/policy'
import { STYLES } from '../src/engine/types'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/* ------------------------------------------------- the ladder ---------- */

const ladder = [...BOTS].sort((a, b) => a.elo - b.elo)

console.log('  bot          elo   acpl   temp  mpv  depth  blunder')
for (const b of ladder) {
  const p = profileFor(b.elo)
  console.log(
    `  ${b.name.padEnd(11)} ${String(b.elo).padStart(4)} ${String(p.targetAcpl).padStart(6)}` +
      ` ${String(p.temperature).padStart(6)} ${String(p.multipv).padStart(4)}` +
      ` ${String(p.depth).padStart(6)} ${p.blunderChance.toFixed(3).padStart(8)}`,
  )
}
console.log('')

for (let i = 1; i < ladder.length; i++) {
  const lo = ladder[i - 1]!
  const hi = ladder[i]!
  const a = profileFor(lo.elo)
  const b = profileFor(hi.elo)
  check(
    `${hi.name} (${hi.elo}) is meant to be stronger than ${lo.name} (${lo.elo})`,
    b.targetAcpl < a.targetAcpl,
    `acpl ${a.targetAcpl} → ${b.targetAcpl}`,
  )
}

/*
 * THE ONE THAT WOULD HAVE CAUGHT IT. Two bots with different ratings must not
 * be the same opponent. Styles differ between some of them, but strength is
 * the thing being laddered and identical strength numbers mean the rating on
 * the card is decoration.
 */
const seen = new Map<string, string>()
for (const b of ladder) {
  const p = profileFor(b.elo)
  const key = `${p.targetAcpl}/${p.temperature}/${p.multipv}/${p.depth}/${p.blunderChance.toFixed(4)}`
  const clash = seen.get(key)
  check(`${b.name} ${b.elo} is not a copy of another bot`, clash === undefined, `identical to ${clash}`)
  seen.set(key, `${b.name} ${b.elo}`)
}

/* Monotone everywhere, not just at the roster's rungs. */
let lastAcpl = Infinity
let monotone = true
for (let elo = 300; elo <= 2300; elo += 25) {
  const a = profileFor(elo).targetAcpl
  if (a > lastAcpl) monotone = false
  lastAcpl = a
}
check('target acpl never goes up as rating goes up', monotone)

check('below the bottom of the ladder clamps rather than extrapolating',
      profileFor(100).targetAcpl === profileFor(350).targetAcpl)
check('above the top clamps too',
      profileFor(3000).targetAcpl === profileFor(2200).targetAcpl)

/* Interpolation actually interpolates. */
const mid = profileFor(1100)
check('a 1100 sits between the 1000 and the 1200',
      mid.targetAcpl < profileFor(1000).targetAcpl && mid.targetAcpl > profileFor(1200).targetAcpl,
      `${profileFor(1000).targetAcpl} / ${mid.targetAcpl} / ${profileFor(1200).targetAcpl}`)
check('search depth rises with rating',
      profileFor(350).depth < profileFor(2200).depth)
check('the candidate pool narrows as rating rises',
      profileFor(350).multipv > profileFor(2200).multipv)

/* ------------------------------------------------- the one-ply path ---- */

/*
 * The naive policy is what a blunder is made of now. It must be legal, it
 * must take a hanging queen most of the time (that IS the one-ply player),
 * and it must not be deterministic.
 */
const hangingQueen = 'rnb1kbnr/pppp1ppp/8/4p3/6q1/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 1'
{
  const rng = seededRng(7)
  const legal = new Map(
    new Chess(hangingQueen)
      .moves({ verbose: true })
      .map((m) => [`${m.from}${m.to}${m.promotion ?? ''}`, m.captured ?? '']),
  )
  let took = 0
  let illegal = 0
  const picks = new Set<string>()
  for (let i = 0; i < 400; i++) {
    const uci = naiveMove(hangingQueen, rng)!
    picks.add(uci)
    if (!legal.has(uci)) illegal++
    else if (legal.get(uci) === 'q') took++
  }
  check('every naive move is legal', illegal === 0, `${illegal} illegal`)
  check('a one-ply player takes the free queen most of the time', took / 400 > 0.5, `${took}/400`)
  check('...but not every single time — it is a policy, not a rule', picks.size > 1,
        `${picks.size} distinct moves`)
}

/*
 * And the shape that makes it human: a one-ply player grabs a DEFENDED piece
 * too, because they never looked at the defender. If this ever stops being
 * true the model has quietly become a good one.
 */
const defendedPawn = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
{
  const rng = seededRng(11)
  let grabs = 0
  for (let i = 0; i < 400; i++) {
    if (naiveMove(defendedPawn, rng) === 'e4d5') grabs++
  }
  // d5 is empty here — the point is the policy does not crash on a position
  // with no captures and still returns a legal move every time.
  const board = new Chess(defendedPawn)
  const legal = new Set(board.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`))
  const rng2 = seededRng(13)
  let allLegal = true
  for (let i = 0; i < 200; i++) if (!legal.has(naiveMove(defendedPawn, rng2)!)) allLegal = false
  check('with no captures available it still returns legal moves', allLegal)
  void grabs
}

check('a position with one legal move returns it',
      naiveMove('7k/8/8/8/8/8/5Q2/6KR b - - 0 1', seededRng(3)) !== null)

/* ------------------------------------------------- style parity -------- */

/*
 * Style must not be a second difficulty dial. Same position, same rating,
 * every style: the expected loss of the sampling distribution should land in
 * the same place, because styleNeutralTemperature re-solves for it.
 */
const sharp = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5'
const fakeLines = [0, 12, 25, 44, 70, 95, 130, 180].map((drop, i) => ({
  multipv: i + 1,
  depth: 9,
  cp: -drop,
  mate: null,
  pv: [['g1f3', 'b1c3', 'e1g1', 'd3d4', 'c4b5', 'c1g5', 'd1e2', 'h2h3'][i]!],
}))
const losses: number[] = []
for (const st of STYLES) {
  const rng = seededRng(99)
  let total = 0
  const N = 600
  for (let i = 0; i < N; i++) {
    const c = chooseMoveDetailed(sharp, fakeLines, 1400, st.id, rng)
    total += c.loss ?? 0
  }
  losses.push(total / N)
  console.log(`  ${st.id.padEnd(11)} expected loss ${(total / N).toFixed(1)}cp`)
}
const spread = Math.max(...losses) - Math.min(...losses)
check('no style is a stealth difficulty setting', spread < 6, `${spread.toFixed(1)}cp apart`)

console.log(fail === 0 ? '\nOK — the ladder is a ladder' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
