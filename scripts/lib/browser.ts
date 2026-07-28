/**
 * A harness that can actually drive the board.
 *
 * The blunder check sat in the backlog as "implemented, not verified" for one
 * reason: the previous harness dispatched synthetic pointer events, and
 * chessground ignores them. It listens on real pointerdown/pointermove, and an
 * event created by `new PointerEvent(...)` arrives with `isTrusted: false` and
 * no association to the browser's input pipeline — the board never sees a
 * drag, so the position never changed and every check downstream was vacuous.
 *
 * Playwright's mouse API drives Chromium's real input pipeline, so the events
 * are indistinguishable from a hand on a trackpad. That is the whole trick.
 *
 * Two capabilities live here, and the second matters as much as the first:
 *
 *   DRIVE — move pieces the way a person does.
 *   READ  — reconstruct the position from chessground's DOM.
 *
 * Reading it back is what makes a check more than a screenshot. Without it a
 * harness can only assert "some text appeared"; with it you can assert the
 * board is in the exact position you expect, and you can decide what to play
 * next from what is actually there rather than from what you hoped the
 * opponent would do.
 */

import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright'

export type Orientation = 'white' | 'black'

export interface Prefs {
  puzzlesPerDay: number
  blunderCheck: boolean
  showCoordinates: boolean
  sound: boolean
}

export interface Session {
  browser: Browser
  page: Page
  /** Everything the page logged, in order. */
  logs: string[]
  /** Uncaught page errors — a non-empty list fails a check on its own. */
  errors: string[]
  close(): Promise<void>
}

const DEFAULT_URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/'

/**
 * Chromium ships with `prefers-reduced-motion: reduce` unset, and chessground
 * animates piece movement over 180ms. Waiting that out on every read is slow
 * and flaky; forcing reduced motion is not, and it does not change any logic
 * under test.
 */
export async function openApp(
  opts: { prefs?: Partial<Prefs>; url?: string; headless?: boolean } = {},
): Promise<Session> {
  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    executablePath: process.env.CHROMIUM_PATH,
  })
  const context = await browser.newContext({
    viewport: { width: 480, height: 900 },
    reducedMotion: 'reduce',
  })

  if (opts.prefs) {
    const prefs = opts.prefs
    // Must run before the app's first render: `blunderCheck` is read once into
    // useState, so setting it after mount would leave the game running under
    // the old value and the check would silently test nothing.
    await context.addInitScript((p: Partial<Prefs>) => {
      const base = { puzzlesPerDay: 8, blunderCheck: false, showCoordinates: true, sound: false }
      localStorage.setItem('cc.prefs', JSON.stringify({ ...base, ...p }))
    }, prefs)
  }

  const page = await context.newPage()
  const logs: string[] = []
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => logs.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e: Error) => errors.push(e.message))

  await page.goto(opts.url ?? DEFAULT_URL, { waitUntil: 'domcontentloaded' })

  return {
    browser,
    page,
    logs,
    errors,
    close: () => browser.close(),
  }
}

/* ----------------------------------------------------------- driving */

/** Pixel centre of a square, accounting for which way the board is facing. */
export async function squareCentre(
  page: Page,
  square: string,
  orientation: Orientation,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('cg-board').first().boundingBox()
  if (!box) throw new Error('no board on screen')
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1
  if (file < 0 || file > 7 || rank < 0 || rank > 7) throw new Error(`bad square: ${square}`)
  const size = box.width / 8
  const col = orientation === 'white' ? file : 7 - file
  const row = orientation === 'white' ? 7 - rank : rank
  return { x: box.x + (col + 0.5) * size, y: box.y + (row + 0.5) * size }
}

/**
 * Drag a piece, as a hand would.
 *
 * The intermediate `steps` are not decoration. chessground starts a drag on
 * the first pointermove that exceeds a small threshold; teleporting straight
 * from origin to target in one event can land as a click-select instead, which
 * behaves differently enough to matter.
 */
export async function dragMove(
  page: Page,
  from: string,
  to: string,
  orientation: Orientation = 'white',
): Promise<void> {
  const a = await squareCentre(page, from, orientation)
  const b = await squareCentre(page, to, orientation)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + (b.x - a.x) * 0.4, a.y + (b.y - a.y) * 0.4, { steps: 6 })
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
}

/* ----------------------------------------------------------- reading */

const PIECE_LETTER: Record<string, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
}

/**
 * Reconstruct the position from the DOM.
 *
 * chessground positions every piece with a `transform: translate(Xpx, Ypx)`
 * relative to the board's top-left, in units of one square. Dividing by the
 * square size recovers the file and rank, which is more robust than trying to
 * read chessground's internal state: the transform is what the user can
 * actually see, so a mismatch between state and render shows up as a failure
 * rather than being papered over.
 */
export async function readBoard(
  page: Page,
  orientation: Orientation = 'white',
): Promise<Map<string, { colour: 'w' | 'b'; type: string }>> {
  const raw = await page.evaluate(() => {
    const board = document.querySelector('cg-board')
    if (!board) return null
    const rect = board.getBoundingClientRect()
    const out: { cls: string; x: number; y: number }[] = []
    for (const el of Array.from(board.querySelectorAll('piece'))) {
      const piece = el as HTMLElement
      // Dragged pieces get a clone with class "ghost"; it is a preview of a
      // move in progress, not a piece on a square.
      if (piece.classList.contains('ghost') || piece.classList.contains('fading')) continue
      const box = piece.getBoundingClientRect()
      out.push({
        cls: piece.className,
        x: box.x + box.width / 2 - rect.x,
        y: box.y + box.height / 2 - rect.y,
      })
    }
    return { size: rect.width / 8, pieces: out }
  })

  if (!raw) throw new Error('no board on screen')

  const map = new Map<string, { colour: 'w' | 'b'; type: string }>()
  for (const p of raw.pieces) {
    const col = Math.floor(p.x / raw.size)
    const row = Math.floor(p.y / raw.size)
    if (col < 0 || col > 7 || row < 0 || row > 7) continue
    const file = orientation === 'white' ? col : 7 - col
    const rank = orientation === 'white' ? 7 - row : row
    const square = String.fromCharCode(97 + file) + String(rank + 1)

    const classes = p.cls.split(/\s+/)
    const colour = classes.includes('white') ? 'w' : classes.includes('black') ? 'b' : null
    const type = classes.map((c) => PIECE_LETTER[c]).find(Boolean)
    if (!colour || !type) continue
    map.set(square, { colour, type })
  }
  return map
}

/**
 * The board as a FEN placement field, plus a side to move you supply.
 *
 * Castling and en passant are deliberately blanked: they are not recoverable
 * from the rendered position, and every use here is "what is attacked and
 * undefended", which neither affects. Claiming rights we cannot see would be
 * worse than admitting we cannot see them.
 */
export function toFen(
  board: Map<string, { colour: 'w' | 'b'; type: string }>,
  turn: 'w' | 'b',
): string {
  const rows: string[] = []
  for (let rank = 8; rank >= 1; rank--) {
    let row = ''
    let gap = 0
    for (let file = 0; file < 8; file++) {
      const sq = String.fromCharCode(97 + file) + String(rank)
      const piece = board.get(sq)
      if (!piece) {
        gap++
        continue
      }
      if (gap) {
        row += String(gap)
        gap = 0
      }
      row += piece.colour === 'w' ? piece.type.toUpperCase() : piece.type
    }
    if (gap) row += String(gap)
    rows.push(row)
  }
  return `${rows.join('/')} ${turn} - - 0 1`
}

/**
 * Read the board once it has stopped moving.
 *
 * Use this, not `readBoard`, for anything you intend to assert on. chessground
 * animates piece movement over 180ms, and a read taken during those frames
 * returns a position that is not merely stale but *impossible* — the first
 * version of this harness caught a black pawn halfway through e7-e5 and
 * recorded it on e6, then failed a later check for "moving" from e6 to e5. A
 * position that never existed is the worst possible thing for a harness to
 * report, because it looks like a real board.
 *
 * `reducedMotion` does not help: chessground's animation is its own config
 * value, not a CSS transition, so the browser-level preference never reaches
 * it. Settling on observed stability works regardless of where the movement
 * comes from.
 */
export async function settle(
  page: Page,
  orientation: Orientation = 'white',
  timeoutMs = 8_000,
): Promise<Map<string, { colour: 'w' | 'b'; type: string }>> {
  const started = Date.now()
  let previous = ''
  for (;;) {
    const animating = await page.locator('cg-board piece.anim').count()
    const board = await readBoard(page, orientation)
    const signature = toFen(board, 'w')
    if (animating === 0 && signature === previous) return board
    previous = signature
    if (Date.now() - started > timeoutMs) {
      throw new Error(`board never settled (last seen: ${signature})`)
    }
    await new Promise((r) => setTimeout(r, 90))
  }
}

/** Squares chessground is highlighting as the last move played. */
export async function lastMoveSquares(
  page: Page,
  orientation: Orientation = 'white',
): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const board = document.querySelector('cg-board')
    if (!board) return null
    const rect = board.getBoundingClientRect()
    const out: { x: number; y: number }[] = []
    for (const el of Array.from(board.querySelectorAll('square.last-move'))) {
      const box = (el as HTMLElement).getBoundingClientRect()
      out.push({ x: box.x + box.width / 2 - rect.x, y: box.y + box.height / 2 - rect.y })
    }
    return { size: rect.width / 8, squares: out }
  })
  if (!raw) throw new Error('no board on screen')

  return raw.squares
    .map((s) => {
      const col = Math.floor(s.x / raw.size)
      const row = Math.floor(s.y / raw.size)
      const file = orientation === 'white' ? col : 7 - col
      const rank = orientation === 'white' ? 7 - row : row
      return String.fromCharCode(97 + file) + String(rank + 1)
    })
    .sort()
}

/* ------------------------------------------------------------ checks */

export class CheckFailure extends Error {}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message)
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new CheckFailure(`${message}\n  expected: ${b}\n  actual:   ${a}`)
}

/** Run named checks, report every result, exit non-zero if any failed. */
export async function runChecks(
  name: string,
  checks: Array<[string, () => Promise<void> | void]>,
): Promise<boolean> {
  console.log(`\n${name}\n${'─'.repeat(name.length)}`)
  let failed = 0
  for (const [label, fn] of checks) {
    try {
      await fn()
      console.log(`  PASS  ${label}`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  FAIL  ${label}\n        ${msg.replace(/\n/g, '\n        ')}`)
    }
  }
  console.log(failed === 0 ? `\n${checks.length} checks, all passed.` : `\n${failed} FAILED.`)
  return failed === 0
}
