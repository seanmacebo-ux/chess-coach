/**
 * Does the activity record say what actually happened?
 *
 * This is date arithmetic over rolling windows, which is the kind of code
 * that is wrong by one and looks right forever. The streak on the profile
 * had exactly this bug once — it keyed days in UTC, so anything trained in
 * the evening was filed under tomorrow and the streak reset at random.
 *
 * So the tests are mostly about boundaries: the day an attempt lands on, the
 * week a day belongs to, and what a run does when a day is missed.
 *
 *   npm run verify:history
 */

import { buildActivity, dayKey, WINDOW_DAYS } from '../src/coach/history'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

const DAY = 86_400_000
/** Fixed reference so the suite does not change behaviour at midnight. */
const NOW = new Date(2026, 8, 20, 14, 30).getTime()
const ago = (d: number, h = 12) => {
  const t = new Date(NOW - d * DAY)
  t.setHours(h, 0, 0, 0)
  return t.toISOString()
}

const game = (d: number, perf: number | null = 900) => ({ playedAt: ago(d), performanceRating: perf })
const att = (d: number, correct: boolean) => ({ at: ago(d), correct })

/* ------------------------------------------------------- day keying */

check('a day key is local, not UTC',
      dayKey(new Date(2026, 8, 20, 23, 30)) === '2026-09-20',
      dayKey(new Date(2026, 8, 20, 23, 30)))
check('late evening does not roll into tomorrow',
      dayKey(new Date(2026, 8, 20, 23, 59)) === dayKey(new Date(2026, 8, 20, 6, 0)))

/* ---------------------------------------------------------- windows */

const a = buildActivity([game(0), game(1), game(40)], [att(0, true), att(0, false), att(3, true)], [], NOW)
check(`the window is ${WINDOW_DAYS} days`, a.days.length === WINDOW_DAYS, String(a.days.length))
check('today is the last day', a.days[a.days.length - 1]!.date === dayKey(NOW))
check('totals count everything in the window', a.totalGames === 3 && a.totalPuzzles === 3,
      `${a.totalGames} games, ${a.totalPuzzles} puzzles`)

const old = buildActivity([game(200)], [att(200, true)], [], NOW)
check('anything older than the window is left out',
      old.totalGames === 0 && old.totalPuzzles === 0)

const today = a.days[a.days.length - 1]!
check('today has both the games and the puzzles on it',
      today.games === 1 && today.puzzles === 2 && today.solved === 1,
      JSON.stringify(today))

/* ------------------------------------------------------------- runs */

const streak = buildActivity([], [att(0, true), att(1, true), att(2, true), att(5, true)], [], NOW)
check('a current run counts back from today', streak.currentRun === 3, String(streak.currentRun))
check('the best run is the longest anywhere in the window', streak.bestRun === 3, String(streak.bestRun))
check('active days counts every day touched', streak.activeDays === 4, String(streak.activeDays))

/*
 * Trained yesterday but not yet today: the run is NOT broken. Without this
 * the number reads zero every morning until the first puzzle, which is both
 * wrong and the most discouraging possible moment to say it.
 */
const yest = buildActivity([], [att(1, true), att(2, true)], [], NOW)
check('a run survives until a whole day is missed', yest.currentRun === 2, String(yest.currentRun))

const broken = buildActivity([], [att(2, true), att(3, true)], [], NOW)
check('a run ends once a day is genuinely missed', broken.currentRun === 0, String(broken.currentRun))

/* ----------------------------------------------------------- weeks */

const many = buildActivity(
  [game(2, 1100), game(3, 900)],
  Array.from({ length: 20 }, (_, i) => att(i % 7, i % 4 !== 0)),
  [ago(2), ago(2), ago(3)],
  NOW,
)
check('twelve weekly points', many.weeks.length === 12, String(many.weeks.length))
const thisWeek = many.weeks[many.weeks.length - 1]!
check('the last week holds the recent work', thisWeek.puzzles === 20, String(thisWeek.puzzles))
check('accuracy is a percentage of that week', thisWeek.accuracy === 75, String(thisWeek.accuracy))
check('performance averages the games analysed', thisWeek.perf === 1000, String(thisWeek.perf))
check('mistakes are counted per game', thisWeek.mistakesPerGame === 1.5, String(thisWeek.mistakesPerGame))

/*
 * A thin week must not be allowed to claim an accuracy. Three puzzles at
 * 33% is not a dip, it is three puzzles, and drawing it as a dip on a trend
 * line is the graph lying.
 */
const thin = buildActivity([], [att(0, false), att(0, true), att(0, false)], [], NOW)
check('too few attempts means no accuracy, not a bad one',
      thin.weeks[thin.weeks.length - 1]!.accuracy === null,
      String(thin.weeks[thin.weeks.length - 1]!.accuracy))

const noGames = buildActivity([], [att(0, true)], [], NOW)
check('no games means no mistakes-per-game, not zero',
      noGames.weeks[noGames.weeks.length - 1]!.mistakesPerGame === null)
check('no analysed games means no performance point',
      buildActivity([game(0, null)], [], [], NOW).weeks[11]!.perf === null)

console.log(fail === 0 ? '\n✓ the activity record holds' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
