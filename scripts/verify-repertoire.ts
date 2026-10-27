/**
 * Does the repertoire tracker say true things about what you know?
 *
 * It is the answer to "it's hard to tell and to track", so the one thing it
 * must never do is flatter. A line counted as known that you cannot produce
 * is worse than no count at all: it is the app telling you you have learned
 * something you have not.
 *
 *   npm run verify:repertoire
 */

import { progress, summarise, summaryLine, dueLines, parseId } from '../src/coach/repertoire'
import type { PuzzleAttemptRow } from '../src/data/db'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

const DAY = 86_400_000
const NOW = new Date('2026-06-01T12:00:00.000Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()

let n = 0
function attempt(over: Partial<PuzzleAttemptRow> = {}): PuzzleAttemptRow {
  n++
  return {
    puzzleId: 'opening:italian:main',
    themes: 'repertoire',
    rating: 900,
    correct: true,
    ms: 0,
    tierId: null,
    at: ago(n),
    ...over,
  }
}

/* ------------------------------------------------------------- the id --- */

check('a line id survives the round trip',
      parseId('opening:italian:main')?.lineId === 'main')
/* Line ids are hand-written content and nothing stops one containing a colon;
   the opening id is the FIRST segment, so the split cannot be greedy. */
check('a line id containing a colon keeps all of it',
      parseId('opening:caro:advance:short')?.lineId === 'advance:short',
      String(parseId('opening:caro:advance:short')?.lineId))
check('a non-opening attempt is ignored', parseId('tactics-3/abc') === null)
check('a malformed id is ignored', parseId('opening:italian') === null)

/* ------------------------------------------------------------- states --- */

{
  const p = progress([attempt({ at: ago(0) })], NOW)
  const line = p.get('italian:main')!
  check('one clean run today is known, not due', line.state === 'known', line.state)
  check('and it rests', line.restDays > 0, String(line.restDays))
}

{
  /* One clean run rests a day. Two days later it wants showing again. */
  const p = progress([attempt({ at: ago(2) })], NOW)
  check('a single clean run goes stale quickly',
        p.get('italian:main')?.state === 'due', String(p.get('italian:main')?.state))
}

{
  /* Four clean runs buy three weeks, so two days later it is still known. */
  const rows = [ago(2), ago(9), ago(20), ago(40)].map((at) => attempt({ at }))
  const line = progress(rows, NOW).get('italian:main')!
  check('a line produced four times running rests much longer',
        line.state === 'known' && line.streak === 4,
        `${line.state} streak ${line.streak}`)
}

{
  /* THE ONE THAT MATTERS. A miss on the most recent run breaks the streak,
     whatever came before it — otherwise a line you have just failed still
     reads as known. */
  const rows = [
    attempt({ at: ago(0), correct: false }),
    attempt({ at: ago(5) }),
    attempt({ at: ago(9) }),
    attempt({ at: ago(14) }),
  ]
  const line = progress(rows, NOW).get('italian:main')!
  check('a miss today undoes three clean runs',
        line.state === 'learning' && line.streak === 0,
        `${line.state} streak ${line.streak}`)
  check('...but the last clean run is still on record',
        line.lastCleanAt === ago(5), String(line.lastCleanAt))
}

{
  const line = progress([attempt({ correct: false })], NOW).get('italian:main')!
  check('completed but never clean is learning, never known', line.state === 'learning')
}

/* Rows arriving out of order must not change the answer. */
{
  const rows = [attempt({ at: ago(9) }), attempt({ at: ago(0), correct: false }), attempt({ at: ago(5) })]
  check('out-of-order rows still see the newest run first',
        progress(rows, NOW).get('italian:main')?.streak === 0)
}

/* A restored backup can carry rows with no date; they must not throw. */
check('an undated row does not crash',
      progress([attempt({ at: undefined as unknown as string })], NOW).size === 1)

/* ---------------------------------------------------------- summaries --- */

{
  const rows = [
    attempt({ puzzleId: 'opening:italian:main', at: ago(0) }),
    attempt({ puzzleId: 'opening:italian:fried', at: ago(30) }),
    attempt({ puzzleId: 'opening:italian:two-knights', at: ago(1), correct: false }),
  ]
  const s = summarise('italian', ['main', 'fried', 'two-knights', 'evans'], progress(rows, NOW))
  check('the summary counts against the lines that EXIST, not the ones tried',
        s.total === 4 && s.untried === 1, JSON.stringify(s))
  check('known, due and shaky are counted apart',
        s.known === 1 && s.due === 1 && s.learning === 1, JSON.stringify(s))
  check('every line is in exactly one bucket',
        s.known + s.due + s.learning + s.untried === s.total)
  check('the line reads like a sentence',
        summaryLine(s) === '1 of 4 known · 1 due · 1 shaky', summaryLine(s))
}

check('an untouched opening says so',
      summaryLine(summarise('x', ['a', 'b'], new Map())) === '2 lines · not started',
      summaryLine(summarise('x', ['a', 'b'], new Map())))
check('an opening with no lines does not claim any',
      summaryLine(summarise('x', [], new Map())) === 'no lines yet')

/*
 * NOTHING MAY BE COUNTED AS KNOWN WITHOUT A CLEAN RUN. Stated as its own
 * check because it is the claim the whole feature rests on, and the easiest
 * one to break by accident later.
 */
{
  const rows = Array.from({ length: 12 }, () => attempt({ correct: false }))
  const s = summarise('italian', ['main'], progress(rows, NOW))
  check('twelve messy runs do not add up to knowing it', s.known === 0 && s.learning === 1)
}

/* --------------------------------------------------------------- due ---- */

{
  const rows = [
    attempt({ puzzleId: 'opening:a:1', at: ago(40) }),
    attempt({ puzzleId: 'opening:b:1', at: ago(0) }),
    attempt({ puzzleId: 'opening:c:1', at: ago(20), correct: false }),
  ]
  const due = dueLines(progress(rows, NOW))
  check('what is fresh is left alone', due.every((d) => d.openingId !== 'b'), JSON.stringify(due.map(d => d.openingId)))
  check('the longest untouched comes first', due[0]?.openingId === 'a', String(due[0]?.openingId))
}

console.log(fail === 0 ? '\n✓ it only claims what it watched happen' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
