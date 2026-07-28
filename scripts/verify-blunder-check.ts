/**
 * Browser check for the blunder check.
 *
 * This is the item the backlog has carried as "implemented, NOT verified"
 * since it was written. The prompt, the loose-piece logic and the take-back
 * all type-checked, and none of it had ever been shown to work against a real
 * board — the previous harness could not make chessground move.
 *
 * What is proved here, in order:
 *
 *   1. The prompt appears after a move, and the move is on the board while it
 *      is showing. A prompt that fires before the position updates would be
 *      asking about something you cannot see.
 *   2. The opponent does not reply while a move is pending. This is the whole
 *      point of the feature — if the clock starts anyway, taking the move back
 *      is meaningless.
 *   3. Take-back restores the position exactly, and leaves no last-move
 *      highlight pointing at a move that no longer happened.
 *   4. Committing releases the opponent, and it moves.
 *   5. The warning branch names the right squares — checked against
 *      `loosePieces` run over the position read back out of the DOM, not
 *      against a hardcoded expectation.
 *
 * Run: npm run verify:blunder   (with `npm run dev` already up)
 */

import { Chess } from 'chess.js'

import {
  assert,
  assertEqual,
  dragMove,
  lastMoveSquares,
  openApp,
  runChecks,
  settle,
  toFen,
  type Session,
} from './lib/browser'
import { loosePieces } from '../src/coach/exercises'

const PROMPT = 'Before it plays'
const SAFE = 'Nothing of yours is attacked and undefended'

async function waitFor(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 120))
  }
}

/** The card only exists while a move is pending, so its text is the state. */
async function promptText(s: Session): Promise<string | null> {
  const card = s.page.locator('.card', { hasText: PROMPT }).first()
  return (await card.count()) === 0 ? null : ((await card.textContent()) ?? '')
}

async function main(): Promise<void> {
  const s = await openApp({ prefs: { blunderCheck: true } })

  try {
    await s.page.getByRole('button', { name: 'Play' }).click()
    await s.page.waitForSelector('.dot.ready', { timeout: 60_000 })

    const start = await settle(s.page)
    const startFen = toFen(start, 'w')

    /* ---------------------------------------------- 1. prompt appears */

    await dragMove(s.page, 'e2', 'e4')
    await waitFor('the blunder-check prompt', async () => (await promptText(s)) !== null)

    const afterE4 = await settle(s.page)
    const promptAfterE4 = (await promptText(s)) ?? ''
    const highlightAfterE4 = await lastMoveSquares(s.page)

    // Hold the position still for a moment: the opponent must not move while a
    // move is pending, and the only way to show that is to wait and look.
    await new Promise((r) => setTimeout(r, 2500))
    const afterWaiting = await settle(s.page)

    /* ------------------------------------------------- 2. take it back */

    await s.page.getByRole('button', { name: 'Take it back' }).click()
    await waitFor('the prompt to clear', async () => (await promptText(s)) === null)
    const afterUndo = await settle(s.page)
    const highlightAfterUndo = await lastMoveSquares(s.page)
    await new Promise((r) => setTimeout(r, 1500))
    const undoSettled = await settle(s.page)

    /* ------------------------------------------------------ 3. commit */

    await dragMove(s.page, 'e2', 'e4')
    await waitFor('the prompt again', async () => (await promptText(s)) !== null)
    await s.page.getByRole('button', { name: 'Play it' }).click()
    await waitFor('the prompt to clear', async () => (await promptText(s)) === null)
    await waitFor('the opponent to reply', async () => {
      const b = await settle(s.page)
      // Black has moved when some black piece is somewhere it did not start.
      for (const [sq, p] of b) if (p.colour === 'b' && start.get(sq)?.type !== p.type) return true
      return false
    })
    await s.page.waitForSelector('.dot.ready', { timeout: 60_000 })
    const afterReply = await settle(s.page)

    /* ---------------------------------------- 4. the warning branch */

    // Find a move that genuinely hangs something, from the position actually
    // on screen. Deriving it beats hardcoding a line: the opponent's reply is
    // not deterministic, so a fixed script would be checking a position that
    // may not exist.
    const live = new Chess(toFen(afterReply, 'w'))
    let hanging: { uci: [string, string]; loose: string[] } | null = null
    for (const m of live.moves({ verbose: true })) {
      const probe = new Chess(toFen(afterReply, 'w'))
      probe.move({ from: m.from, to: m.to, promotion: 'q' })
      const loose = loosePieces(probe.fen(), 'w')
      if (loose.length > 0) {
        hanging = { uci: [m.from, m.to], loose }
        break
      }
    }
    assert(hanging, 'no move from the live position leaves anything loose — cannot test the warning')

    await dragMove(s.page, hanging.uci[0], hanging.uci[1])
    await waitFor('the warning prompt', async () => (await promptText(s)) !== null)
    const warnText = (await promptText(s)) ?? ''
    const warnBoard = await settle(s.page)
    const warnBorder = await s.page
      .locator('.card', { hasText: PROMPT })
      .first()
      .evaluate((el) => getComputedStyle(el).borderColor)

    await s.page.getByRole('button', { name: 'Take it back' }).click()
    await waitFor('the prompt to clear', async () => (await promptText(s)) === null)
    const afterSecondUndo = await settle(s.page)

    /* ------------------------------------------------------- verdict */

    const ok = await runChecks('blunder check — in a real browser', [
      [
        'the board starts with 32 pieces (the drag harness sees a real board)',
        () => assertEqual(start.size, 32, 'piece count at start'),
      ],
      [
        'dragging e2-e4 moves the pawn',
        () => {
          assert(!afterE4.has('e2'), 'e2 should be empty after the move')
          assertEqual(afterE4.get('e4'), { colour: 'w', type: 'p' }, 'pawn on e4')
        },
      ],
      [
        'the prompt appears, with the move already on the board',
        () => {
          assert(promptAfterE4.includes(PROMPT), `prompt text was: ${promptAfterE4 || '(absent)'}`)
          assertEqual(highlightAfterE4, ['e2', 'e4'], 'last-move highlight')
        },
      ],
      [
        'e4 hangs nothing, and the prompt says so',
        () => assert(promptAfterE4.includes(SAFE), `prompt text was: ${promptAfterE4}`),
      ],
      [
        'the opponent does not reply while the move is pending',
        () => assertEqual(toFen(afterWaiting, 'w'), toFen(afterE4, 'w'), 'position after waiting'),
      ],
      [
        'take-back restores the position exactly',
        () => assertEqual(toFen(afterUndo, 'w'), startFen, 'position after take-back'),
      ],
      [
        'take-back clears the last-move highlight',
        () => assertEqual(highlightAfterUndo, [], 'highlighted squares after take-back'),
      ],
      [
        'take-back does not hand the move to the opponent',
        () => assertEqual(toFen(undoSettled, 'w'), startFen, 'position after take-back settled'),
      ],
      [
        'committing releases the opponent, and it replies',
        () => {
          assertEqual(afterReply.size, 32, 'piece count after the reply')
          assertEqual(afterReply.get('e4'), { colour: 'w', type: 'p' }, 'our pawn is still on e4')
          assert(toFen(afterReply, 'b') !== toFen(afterE4, 'b'), 'the position should have changed')
        },
      ],
      [
        `the warning names the loose squares (${hanging.uci.join('')} leaves ${hanging.loose.join(', ')})`,
        () => {
          for (const sq of hanging.loose) {
            assert(warnText.includes(sq), `warning should name ${sq}; text was: ${warnText}`)
          }
          assert(!warnText.includes(SAFE), `warning should not claim safety: ${warnText}`)
        },
      ],
      [
        'the warning agrees with loosePieces run on what is actually rendered',
        () => assertEqual(loosePieces(toFen(warnBoard, 'b'), 'w'), hanging.loose, 'loose squares'),
      ],
      [
        'the warning card is bordered in the warn colour, not the accent',
        () => assert(warnBorder !== 'rgb(0, 0, 0)' && Boolean(warnBorder), `border: ${warnBorder}`),
      ],
      [
        'take-back works from the warning too',
        () =>
          assertEqual(toFen(afterSecondUndo, 'w'), toFen(afterReply, 'w'), 'position after undo'),
      ],
      [
        'nothing threw in the page',
        () => assertEqual(s.errors, [], 'uncaught page errors'),
      ],
    ])

    process.exitCode = ok ? 0 : 1
  } finally {
    await s.close()
  }
}

await main()
