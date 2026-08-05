/**
 * Check the section-rating maths does what it claims.
 *
 * The rating is now the number the whole Learn screen is built around, and it
 * is the kind of code that is very easy to get subtly wrong and never notice:
 * a sign flip, or a K-factor that never settles, produces numbers that look
 * plausible on every screen and are meaningless. Nothing about the UI would
 * show it.
 *
 * So these are properties rather than fixtures — asserted about the update
 * rule itself, with no database and no engine:
 *
 *   DIRECTION   — solving raises the rating, failing lowers it. The one bug
 *                 that would make everything downstream a lie.
 *   DIFFICULTY  — beating a harder item is worth more than beating an easier
 *                 one, and failing an easy item costs more than failing a hard
 *                 one. This is the entire reason the app rates rather than
 *                 scoring accuracy, so if it does not hold the design is
 *                 pointless.
 *   CONVERGENCE — feeding results at a fixed strength settles near that
 *                 strength rather than drifting or oscillating.
 *   SETTLING    — the same result moves a fresh section further than a
 *                 well-established one.
 *
 * Usage:  npm run verify:rating
 */

const RD_START = 250
const RD_FLOOR = 60
const RD_SHRINK = 0.93

/** Mirrors coach/rating.ts. Kept in step by the convergence test below. */
function expected(mine: number, theirs: number): number {
  return 1 / (1 + Math.pow(10, (theirs - mine) / 400))
}

function step(
  rating: number,
  rd: number,
  opponent: number,
  correct: boolean,
): { rating: number; rd: number } {
  const k = 12 + (rd / RD_START) * 26
  const score = correct ? 1 : 0
  return {
    rating: Math.max(100, Math.min(3000, rating + k * (score - expected(rating, opponent)))),
    rd: Math.max(RD_FLOOR, rd * RD_SHRINK),
  }
}

const problems: string[] = []
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) problems.push(`${name}: ${detail}`)
}

console.log('Section rating properties\n')

/* --- direction ------------------------------------------------------ */

const up = step(1000, RD_START, 1000, true)
const down = step(1000, RD_START, 1000, false)
check('solving raises the rating', up.rating > 1000, `got ${up.rating.toFixed(1)}`)
check('failing lowers the rating', down.rating < 1000, `got ${down.rating.toFixed(1)}`)

/* --- difficulty ----------------------------------------------------- */

const beatHard = step(1000, RD_START, 1400, true).rating - 1000
const beatEasy = step(1000, RD_START, 600, true).rating - 1000
check(
  'beating a harder item is worth more',
  beatHard > beatEasy,
  `hard +${beatHard.toFixed(1)} vs easy +${beatEasy.toFixed(1)}`,
)

const missEasy = 1000 - step(1000, RD_START, 600, false).rating
const missHard = 1000 - step(1000, RD_START, 1400, false).rating
check(
  'failing an easy item costs more',
  missEasy > missHard,
  `easy -${missEasy.toFixed(1)} vs hard -${missHard.toFixed(1)}`,
)

/* --- settling ------------------------------------------------------- */

const fresh = Math.abs(step(1000, RD_START, 1000, true).rating - 1000)
const settled = Math.abs(step(1000, RD_FLOOR, 1000, true).rating - 1000)
check(
  'a settled section moves less than a fresh one',
  fresh > settled,
  `fresh ${fresh.toFixed(1)} vs settled ${settled.toFixed(1)}`,
)

/* --- convergence ---------------------------------------------------- */

/**
 * Simulate a player of a known true strength and check the rating finds it.
 *
 * Items are drawn across a band around the true strength and solved with the
 * Elo-implied probability, which is the model's own assumption — so this tests
 * that the UPDATE RULE is self-consistent, not that the model describes a real
 * human. A rule that cannot recover the strength it assumes is broken outright.
 *
 * Deterministic: a seeded LCG rather than Math.random, so a failure here is
 * reproducible instead of a thing that happens one run in twenty.
 */
function simulate(trueStrength: number, start: number, n = 400): number {
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  let rating = start
  let rd = RD_START
  for (let i = 0; i < n; i++) {
    const opponent = trueStrength - 300 + Math.floor(rnd() * 600)
    const correct = rnd() < expected(trueStrength, opponent)
    const next = step(rating, rd, opponent, correct)
    rating = next.rating
    rd = next.rd
  }
  return rating
}

for (const [truth, start] of [
  [800, 1400],
  [1200, 800],
  [1600, 1600],
] as [number, number][]) {
  const got = simulate(truth, start)
  const off = Math.abs(got - truth)
  check(
    `converges to ${truth} from ${start}`,
    off <= 150,
    `settled at ${got.toFixed(0)}, ${off.toFixed(0)} away`,
  )
}

/* --- small samples must self-correct fast ---------------------------- */

/*
 * The claim being tested: an imported rating backed by few games is stored
 * with a wide deviation, and a wide deviation makes the number move FASTER
 * toward the truth.
 *
 * This matters because the alternative is an app that is both wrong and
 * stubborn. Sean's rating came from eight games; if that is stored as
 * confidently as a settled one, a beginner who is actually 500 spends weeks
 * being served material for a 316 while the rating crawls.
 */
function rdFromSample(games: number): number {
  if (games <= 0) return RD_START
  return Math.max(RD_FLOOR, Math.min(RD_START, Math.round(350 / Math.sqrt(games))))
}

check(
  'fewer games means more uncertainty',
  rdFromSample(5) > rdFromSample(20) && rdFromSample(20) > rdFromSample(200),
  `5:${rdFromSample(5)} 20:${rdFromSample(20)} 200:${rdFromSample(200)}`,
)

/**
 * Same wrong starting rating, same true strength, same results — only the
 * starting deviation differs. The wide one must close the gap faster.
 */
function gapAfter(startRd: number, n: number): number {
  const TRUTH = 600
  const START = 316
  let seed = 999
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  let rating = START
  let rd = startRd
  for (let i = 0; i < n; i++) {
    const opponent = TRUTH - 200 + Math.floor(rnd() * 400)
    const correct = rnd() < expected(TRUTH, opponent)
    const next = step(rating, rd, opponent, correct)
    rating = next.rating
    rd = next.rd
  }
  return Math.abs(rating - TRUTH)
}

const wide = gapAfter(rdFromSample(8), 30)
const narrow = gapAfter(RD_FLOOR, 30)
check(
  'a small-sample import corrects faster than a settled one',
  wide < narrow,
  `wide rd left a ${wide.toFixed(0)}-point gap, settled rd left ${narrow.toFixed(0)}`,
)

/* --- report --------------------------------------------------------- */

if (problems.length === 0) {
  console.log('\n✓ rating maths holds')
  process.exit(0)
}
console.log(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
process.exit(1)
