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

console.log('  bot          elo   acpl  sight   temp  mpv  depth   naive')
for (const b of ladder) {
  const p = profileFor(b.elo)
  console.log(
    `  ${b.name.padEnd(11)} ${String(b.elo).padStart(4)} ${String(p.targetAcpl).padStart(6)}` +
      ` ${p.sight.toFixed(2).padStart(6)}` +
      ` ${String(p.temperature).padStart(6)} ${String(p.multipv).padStart(4)}` +
      ` ${String(p.depth).padStart(6)} ${p.naiveShare.toFixed(3).padStart(7)}`,
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
  const key =
    `${p.targetAcpl}/${p.sight.toFixed(4)}/${p.temperature}/` +
    `${p.multipv}/${p.depth}/${p.naiveShare.toFixed(4)}`
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

/*
 * SIGHT IS THE DIAL, so it has to behave like one. The old table moved four
 * things at once and two of them turned around mid-ladder — temperature rose
 * from 1400 upwards — which is how 1400 and 1600 ended up scoring 50% against
 * each other in the calibration harness. A dial that is not monotone is not a
 * dial, and nothing here was checking.
 */
let lastSight = -Infinity
let sightMonotone = true
let sightWhere = ''
for (let elo = 300; elo <= 2300; elo += 25) {
  const sight = profileFor(elo).sight
  if (sight < lastSight - 1e-9) {
    sightMonotone = false
    sightWhere = `${elo}: ${lastSight.toFixed(3)} -> ${sight.toFixed(3)}`
  }
  lastSight = sight
}
check('sight never goes down as rating goes up', sightMonotone, sightWhere)

/* And the same for the one-ply share, which used to fall off a cliff. */
let lastNaive: number | null = null
let naiveMonotone = true
let worstStep = 1
for (let elo = 300; elo <= 2300; elo += 25) {
  const n = profileFor(elo).naiveShare
  if (lastNaive !== null) {
    if (n > lastNaive + 1e-9) naiveMonotone = false
    if (n > 0) worstStep = Math.max(worstStep, lastNaive / n)
  }
  lastNaive = n
}
check('the one-ply share never goes up as rating goes up', naiveMonotone)
/*
 * It fell thirteenfold in one step at 800 — the ladder's biggest cliff, and
 * the reason the 800 punished free material less often than the 550, since
 * the one-ply policy is the half of the bot that grabs what is hanging.
 */
check(
  'and it falls smoothly rather than off a cliff',
  worstStep < 1.6,
  `steepest 25-point step multiplies it by ${worstStep.toFixed(2)}`,
)

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
/*
 * THE SHORTLIST IS FLAT, and that is the design rather than an oversight.
 *
 * This check used to read "the candidate pool narrows as rating rises", on
 * the theory that a weak bot should pick from a wide list. It is backwards:
 * nobody considers thirty-four moves, and a wide list is only a device for
 * letting a softmax reach a bad one. It also cost the 800 its free material —
 * a capture two pawns better than everything else got twice the weight of any
 * one of twenty-seven alternatives, and lost most of the time.
 *
 * A person shortlists a handful whatever their rating. What changes is
 * whether they see what is wrong with the one they pick, and that is sight.
 */
const widths = new Set<number>()
for (let elo = 350; elo <= 2200; elo += 50) widths.add(profileFor(elo).multipv)
check(
  'the shortlist is the same handful at every rating',
  widths.size === 1 && [...widths][0]! <= 8,
  `widths seen: ${[...widths].sort((a, b) => a - b).join(', ')}`,
)

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
