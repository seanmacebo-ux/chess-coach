/**
 * Does the Climb's number mean what the card says it means?
 *
 * The mode exists to produce one figure — "you got to 640" — and that figure
 * was wrong in two directions at once, both flattering. Nothing could catch
 * it: the arithmetic lived inside a React callback where no test could reach
 * it. So it lives in Climb.tsx as a pure function now and this checks it.
 *
 *   npm run verify:climb
 */

import { advance, newRun, runOver, type RunState } from '../src/ui/screens/Climb'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/* ---------------------------------------------- a best must be earned --- */

const fresh = newRun(800)
check('a new run has no best yet', fresh.best === 0, String(fresh.best))
check('...but it does know where to start', fresh.difficulty === 800)

/*
 * THE ONE THAT WAS WRONG. Solve a puzzle at 800 and your best is 800 — the
 * level you beat. It used to record 840, the level you were being moved TO,
 * so every solve credited a rung you had not yet stood on.
 */
const afterOne = advance(fresh, true)
check('solving at 800 records a best of 800, not 840', afterOne.best === 800, String(afterOne.best))
check('and the next puzzle is harder', afterOne.difficulty === 840, String(afterOne.difficulty))
check('solved counts up', afterOne.solved === 1)
check('streak counts up', afterOne.streak === 1)
check('no miss recorded', afterOne.missed === 0)

/* A miss must not raise the best, and must not pretend it was a solve. */
const afterMiss = advance(afterOne, false)
check('a miss leaves the best alone', afterMiss.best === 800, String(afterMiss.best))
check('a miss steps down by less than a solve steps up',
      afterOne.difficulty - afterMiss.difficulty === 30,
      String(afterOne.difficulty - afterMiss.difficulty))
check('a miss breaks the streak', afterMiss.streak === 0)
check('a miss counts', afterMiss.missed === 1)

/* Missing everything from the start must never produce a best. */
let bad = newRun(800)
for (let i = 0; i < 3; i++) bad = advance(bad, false)
check('a run with no solves has no best', bad.best === 0, String(bad.best))
check('three misses ends the run', runOver(bad))
check('two misses does not', !runOver(advance(advance(newRun(800), false), false)))

/* The best is the HIGHEST solved, not the last. */
let mixed = newRun(600)
mixed = advance(mixed, true)   // solved 600, now 640
mixed = advance(mixed, true)   // solved 640, now 680
mixed = advance(mixed, false)  // missed,     now 650
mixed = advance(mixed, true)   // solved 650, now 690
check('the best is the hardest one solved, not the most recent',
      mixed.best === 650, String(mixed.best))
check('solves and misses both counted', mixed.solved === 3 && mixed.missed === 1,
      `${mixed.solved}/${mixed.missed}`)

/* Difficulty must not walk off the bottom of the scale. */
let floored: RunState = newRun(120)
for (let i = 0; i < 10; i++) floored = advance(floored, false)
check('difficulty never goes below 100', floored.difficulty >= 100, String(floored.difficulty))

console.log(fail === 0 ? '\n✓ the climb number means what the card says' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
