/**
 * Does the blindness model behave like a person?
 *
 * The model's whole claim is that it creates a difference in KIND across the
 * ladder — not a tighter softmax but a different set of things missed. That
 * claim has three parts and each can be checked without an engine:
 *
 *   it must be MONOTONIC in rating — a 1700 cannot miss more than a 400
 *   it must be SHAPED like human vision — recaptures seen, knights missed
 *   it must never be able to produce an illegal or absent move
 *
 *   npm run verify:vision
 */

import { Chess } from 'chess.js'
import { seesReply, shapeOfReply, isBlindTo, type ReplyShape } from '../src/engine/vision'
import { weighCandidates, seededRng } from '../src/engine/policy'
import type { Line } from '../src/engine/types'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

const shape = (over: Partial<ReplyShape> = {}): ReplyShape => ({
  isRecapture: false, givesCheck: false, isCapture: false,
  isKnight: false, distance: 2, isBackward: false, ...over,
})

/* ------------------------------------------------------- monotonic ----- */

const quiet = shape()
let last = -1
let monotone = true
for (let elo = 300; elo <= 2300; elo += 50) {
  const p = seesReply(quiet, elo)
  if (p < last - 1e-9) monotone = false
  last = p
}
check('a stronger player never sees less', monotone)
check('a 350 misses a fair amount', seesReply(quiet, 350) < 0.75, seesReply(quiet, 350).toFixed(3))
check('a 2200 sees nearly everything', seesReply(quiet, 2200) > 0.9, seesReply(quiet, 2200).toFixed(3))
check('the gap at the bottom is bigger than at the top',
      seesReply(quiet, 550) - seesReply(quiet, 350) > seesReply(quiet, 2000) - seesReply(quiet, 1800),
      `${(seesReply(quiet,550)-seesReply(quiet,350)).toFixed(3)} vs ${(seesReply(quiet,2000)-seesReply(quiet,1800)).toFixed(3)}`)

/* --------------------------------------------------- shaped like sight - */

for (const elo of [350, 800, 1400, 2200]) {
  check(`${elo}: a recapture is the most visible move there is`,
        seesReply(shape({ isRecapture: true, isCapture: true }), elo) >= seesReply(quiet, elo),
        `${seesReply(shape({ isRecapture: true, isCapture: true }), elo).toFixed(2)} vs ${seesReply(quiet, elo).toFixed(2)}`)
  check(`${elo}: a knight is harder to see than a quiet move`,
        seesReply(shape({ isKnight: true }), elo) < seesReply(quiet, elo))
  check(`${elo}: a retreat is harder to see than a move forward`,
        seesReply(shape({ isBackward: true }), elo) < seesReply(quiet, elo))
  check(`${elo}: a long move is harder to see than a short one`,
        seesReply(shape({ distance: 6 }), elo) < seesReply(shape({ distance: 1 }), elo))
  check(`${elo}: a check is more visible than a quiet move`,
        seesReply(shape({ givesCheck: true }), elo) > seesReply(quiet, elo))
}

/*
 * THE ONE THAT CARRIES THE WHOLE IDEA. A beginner must miss the knight fork
 * far more often than a strong player does — that is the difference in kind
 * the ladder has been missing.
 */
const forkAt = (elo: number) => 1 - seesReply(shape({ isKnight: true, distance: 3 }), elo)
check('a 350 misses a knight fork several times as often as a 1700',
      forkAt(350) / forkAt(1700) > 3,
      `${forkAt(350).toFixed(3)} vs ${forkAt(1700).toFixed(3)} = ${(forkAt(350)/forkAt(1700)).toFixed(1)}x`)

/* ------------------------------------------ never blind without a reply - */

check('no reply on record means it counts as seen', seesReply(null, 350) === 1)
check('...at every rating', [350, 1400, 2200].every((e) => seesReply(null, e) === 1))
check('an undefined reply is never blind',
      !isBlindTo(new Chess().fen(), undefined, 'e4', 350, () => 0))

/* ---------------------------------------------- the shape reader works - */

{
  // 1.e4 d5 2.exd5 — Black's ...Qxd5 is a recapture on the square White took.
  const b = new Chess()
  b.move('e4'); b.move('d5'); b.move('exd5')
  const s = shapeOfReply(b.fen(), 'd8d5', 'd5')
  check('a recapture on our square is read as one', s?.isRecapture === true, JSON.stringify(s))
  check('and it is a capture', s?.isCapture === true)
}
{
  const b = new Chess()
  b.move('e4'); b.move('e5')
  const s = shapeOfReply(b.fen(), 'g1f3', 'e5')
  check('a knight is read as a knight', s?.isKnight === true, JSON.stringify(s))
  check('...and it is not a recapture', s?.isRecapture === false)
}
{
  const b = new Chess()
  b.move('e4'); b.move('e5'); b.move('Nf3')
  const s = shapeOfReply(b.fen(), 'd8h4', 'f3')
  check('distance is measured', (s?.distance ?? 0) >= 3, JSON.stringify(s))
}
check('an illegal reply reads as null, not a crash',
      shapeOfReply(new Chess().fen(), 'a1a8', 'e4') === null)

/* ------------------------------------------- it never loses a candidate - */

/*
 * Blindness changes the WEIGHTS. It must never drop a move, invent one, or
 * return a weight that cannot be sampled — a bot that returns nothing stalls
 * the game, which is worse than any amount of playing badly.
 */
let structural = 0
const lines: Line[] = [0, 40, 90, 160, 320].map((drop, i) => ({
  multipv: i + 1,
  depth: 8,
  cp: -drop,
  mate: null,
  pv: [['g1f3', 'b1c3', 'd2d4', 'f1c4', 'h2h4'][i]!, ['b8c6', 'g8f6', 'd7d5', 'e7e6', 'd8h4'][i]!],
}))
for (const elo of [350, 800, 1400, 2200]) {
  for (let seed = 1; seed <= 40; seed++) {
    const cands = weighCandidates(new Chess().fen(), lines, elo, 'human', seededRng(seed))
    if (cands.length !== lines.length) {
      check(`${elo}/seed${seed}: every candidate survives`, false, `${cands.length} of ${lines.length}`)
      structural++
      break
    }
    if (!cands.every((c) => Number.isFinite(c.weight) && c.weight > 0)) {
      check(`${elo}/seed${seed}: every weight is usable`, false, cands.map((c) => c.weight).join(' '))
      structural++
      break
    }
    if (!cands.every((c) => c.loss >= 0)) {
      check(`${elo}/seed${seed}: the TRUE loss stays true`, false, cands.map((c) => c.loss).join(' '))
      structural++
      break
    }
  }
}
// Counted locally: an aggregate on the global `fail` would report this as
// broken whenever anything ELSE in the file failed.
check('every candidate survives, with a usable weight and an honest loss', structural === 0)

/* The true loss must not move when the bot goes blind — it is the measurement. */
{
  const sighted = weighCandidates(new Chess().fen(), lines, 1400, 'human')
  const blinded = weighCandidates(new Chess().fen(), lines, 350, 'human', seededRng(7))
  check('blindness changes the weights, never the reported loss',
        sighted.map((c) => c.loss).join() === blinded.map((c) => c.loss).join(),
        `${sighted.map((c) => c.loss).join()} vs ${blinded.map((c) => c.loss).join()}`)
}

/* And with no rng — the coach view — nothing is ever blind. */
{
  const pure = weighCandidates(new Chess().fen(), lines, 350, 'human')
  check('the explain view is never shown a hallucination',
        pure.every((c) => !c.blind))
}

/* A weak bot must actually end up blind sometimes, or the model does nothing. */
{
  let blindMoves = 0
  for (let seed = 1; seed <= 200; seed++) {
    const c = weighCandidates(new Chess().fen(), lines, 350, 'human', seededRng(seed))
    blindMoves += c.filter((x) => x.blind).length
  }
  const rate = blindMoves / (200 * lines.length)
  console.log(`\n  a 350 is blind to ${(rate * 100).toFixed(0)}% of refutations`)
  check('the model actually fires for a beginner', rate > 0.15, `${(rate * 100).toFixed(1)}%`)

  let strongBlind = 0
  for (let seed = 1; seed <= 200; seed++) {
    const c = weighCandidates(new Chess().fen(), lines, 2200, 'human', seededRng(seed))
    strongBlind += c.filter((x) => x.blind).length
  }
  const strongRate = strongBlind / (200 * lines.length)
  console.log(`  a 2200 is blind to ${(strongRate * 100).toFixed(0)}%`)
  check('and barely fires for a strong one', strongRate < rate / 2,
        `${(strongRate * 100).toFixed(1)}% vs ${(rate * 100).toFixed(1)}%`)
}

console.log(fail === 0 ? '\n✓ the ladder differs in what it misses, not just how finely it ranks'
                       : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
