/**
 * Browser check for live move grading.
 *
 * Three things are worth proving here, and only the first is obvious:
 *
 *   1. A verdict appears after your move, and a bad move is graded badly.
 *   2. It stays off when the setting is off. A training aid that shows up
 *      uninvited is a bug.
 *   3. The verdict does NOT appear while the blunder-check prompt is up. That
 *      one is a design claim rather than a mechanism: the blunder check asks
 *      "did you notice anything hanging?", and answering it with the engine's
 *      opinion would replace the habit being trained with a lookup. It is the
 *      kind of interaction that breaks silently when someone later moves one
 *      line of code, so it gets an assertion.
 *
 * The bad move is derived, not hardcoded — the opponent's reply is random, so
 * a fixed line would be grading a position that may not have arisen.
 *
 * Run: npm run verify:live   (with `npm run dev` already up)
 */

import { Chess } from 'chess.js'

import {
  assert,
  assertEqual,
  dragMove,
  openApp,
  runChecks,
  settle,
  toFen,
  type Session,
} from './lib/browser'

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

async function waitFor(label: string, fn: () => Promise<boolean>, timeoutMs = 90_000) {
  const started = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

async function gradeCard(s: Session): Promise<{ text: string; severity: string } | null> {
  const card = s.page.locator('[data-testid="live-grade"]')
  if ((await card.count()) === 0) return null
  return {
    text: (await card.first().textContent()) ?? '',
    severity: (await card.first().getAttribute('data-severity')) ?? '',
  }
}

/**
 * The move that hands the opponent the most material.
 *
 * Deliberately a material calculation rather than an engine call: the point is
 * to hand the app a move that is unambiguously bad by any standard, so that if
 * the grade comes back "good" the failure is the app's and not a disagreement
 * about depth.
 */
function worstMove(fen: string): { from: string; to: string; gain: number } | null {
  const board = new Chess(fen)
  let worst: { from: string; to: string; gain: number } | null = null

  for (const m of board.moves({ verbose: true })) {
    const after = new Chess(fen)
    after.move({ from: m.from, to: m.to, promotion: 'q' })

    let best = 0
    for (const reply of after.moves({ verbose: true })) {
      if (!reply.captured) continue
      const won = VALUE[reply.captured] ?? 0
      const probe = new Chess(after.fen())
      probe.move({ from: reply.from, to: reply.to, promotion: 'q' })
      // If we can recapture, the trade costs them their piece back.
      const recapture = probe
        .moves({ verbose: true })
        .some((r) => r.to === reply.to && r.captured)
      const net = won - (recapture ? (VALUE[reply.piece] ?? 0) : 0)
      if (net > best) best = net
    }
    if (!worst || best > worst.gain) worst = { from: m.from, to: m.to, gain: best }
  }
  return worst
}

async function playAndGrade(s: Session, from: string, to: string): Promise<void> {
  await dragMove(s.page, from, to)
  await settle(s.page)
}

async function main(): Promise<void> {
  const checks: Array<[string, () => void]> = []

  /* ------------------------------------------- 1. on, without the prompt */

  const on = await openApp({ prefs: { liveGrading: true, blunderCheck: false } })
  let goodGrade: { text: string; severity: string } | null = null
  let badGrade: { text: string; severity: string } | null = null
  let blunderGain = 0

  try {
    await on.page.getByRole('button', { name: 'Play' }).click()
    await on.page.waitForSelector('.dot.ready', { timeout: 60_000 })
    const start = await settle(on.page)

    // Give the idle-window search time to start and finish before moving —
    // this is the path the design depends on.
    await new Promise((r) => setTimeout(r, 1200))
    await playAndGrade(on, 'e2', 'e4')
    await waitFor('a grade for e4', async () => (await gradeCard(on)) !== null)
    goodGrade = await gradeCard(on)

    // Let the opponent reply and the next idle search run.
    await waitFor('the opponent to reply', async () => {
      const b = await settle(on.page)
      for (const [sq, p] of b) if (p.colour === 'b' && start.get(sq)?.type !== p.type) return true
      return false
    })
    await on.page.waitForSelector('.dot.ready', { timeout: 60_000 })
    const live = await settle(on.page)
    await new Promise((r) => setTimeout(r, 2500))

    const worst = worstMove(toFen(live, 'w'))
    assert(worst && worst.gain >= 300, `no material-losing move available (best gain ${worst?.gain})`)
    blunderGain = worst.gain
    await playAndGrade(on, worst.from, worst.to)
    await waitFor('a grade for the blunder', async () => {
      const g = await gradeCard(on)
      return g !== null && g.severity !== goodGrade?.severity
    })
    badGrade = await gradeCard(on)

    checks.push([
      'a verdict appears after a move',
      () => assert(goodGrade, 'no grade card after e4'),
    ])
    checks.push([
      'e4 is not graded as a mistake',
      () =>
        assert(
          goodGrade && ['best', 'good', 'inaccuracy'].includes(goodGrade.severity),
          `e4 graded as ${goodGrade?.severity}: ${goodGrade?.text}`,
        ),
    ])
    checks.push([
      `dropping ${blunderGain}cp of material is graded as a mistake or blunder`,
      () =>
        assert(
          badGrade && ['mistake', 'blunder'].includes(badGrade.severity),
          `graded as ${badGrade?.severity}: ${badGrade?.text}`,
        ),
    ])
    checks.push([
      'the bad move gets a reason, not just a number',
      () => assert((badGrade?.text.length ?? 0) > 40, `verdict was: ${badGrade?.text}`),
    ])
    checks.push(['nothing threw in the page', () => assertEqual(on.errors, [], 'page errors')])
  } finally {
    await on.close()
  }

  /* --------------------------------------------------- 2. off means off */

  const off = await openApp({ prefs: { liveGrading: false, blunderCheck: false } })
  let gradeWhenOff: unknown = null
  try {
    await off.page.getByRole('button', { name: 'Play' }).click()
    await off.page.waitForSelector('.dot.ready', { timeout: 60_000 })
    await settle(off.page)
    await playAndGrade(off, 'e2', 'e4')
    // Long enough that a search would have finished if one had been started.
    await new Promise((r) => setTimeout(r, 6000))
    gradeWhenOff = await gradeCard(off)

    checks.push([
      'no verdict at all when the setting is off',
      () => assertEqual(gradeWhenOff, null, 'grade card with live grading disabled'),
    ])
  } finally {
    await off.close()
  }

  /* ------------------------- 3. it must not answer the blunder check */

  const both = await openApp({ prefs: { liveGrading: true, blunderCheck: true } })
  let gradeWhilePending: unknown = null
  let gradeAfterCommit: { text: string; severity: string } | null = null
  try {
    await both.page.getByRole('button', { name: 'Play' }).click()
    await both.page.waitForSelector('.dot.ready', { timeout: 60_000 })
    await settle(both.page)
    await new Promise((r) => setTimeout(r, 1200))

    await playAndGrade(both, 'e2', 'e4')
    await both.page.waitForSelector('.card:has-text("Before it plays")', { timeout: 30_000 })
    // Wait past the point where a verdict would have been ready.
    await new Promise((r) => setTimeout(r, 6000))
    gradeWhilePending = await gradeCard(both)

    await both.page.getByRole('button', { name: 'Play it' }).click()
    await waitFor('a grade after the commit', async () => (await gradeCard(both)) !== null)
    gradeAfterCommit = await gradeCard(both)

    checks.push([
      'the verdict is withheld while the blunder check is asking',
      () =>
        assertEqual(
          gradeWhilePending,
          null,
          'the engine answered the question the blunder check exists to make you ask',
        ),
    ])
    checks.push([
      'the verdict arrives once the move is committed',
      () => assert(gradeAfterCommit, 'no grade after clicking Play it'),
    ])
  } finally {
    await both.close()
  }

  const ok = await runChecks('live move grading', checks)
  process.exitCode = ok ? 0 : 1
}

await main()
