/**
 * Check every breakdown is a real position with a real line.
 *
 * A breakdown is the app asserting "this move works, and here is why". The
 * explanation cannot be machine-checked, but everything around it can, and if
 * the mechanics are wrong the explanation is wrong by definition:
 *
 *   FEN LOADS       — legal position, and the side to move matches `side`.
 *   LINE REPLAYS    — every SAN plays from the previous position. A typo here
 *                     would render a board that silently stops halfway.
 *   OUTCOME HOLDS   — `mate` is exact from chess.js; `winsMaterial` is measured
 *                     by counting material before and after. Claiming a line
 *                     wins material when it does not is the failure that would
 *                     teach the wrong pattern.
 *   PROSE MOVES     — every move NAMED in the setup text or in a step's reason
 *                     must be legal in the position that text describes. Added
 *                     after two explanations in a row referred to moves that did
 *                     not exist. It cannot check that a reason is correct; it
 *                     can check that the moves being reasoned about are real.
 *
 *   PROVENANCE      — the puzzle id exists in the shipped corpus, and the FEN
 *                     matches that puzzle. This is what stops a hand-edited
 *                     position drifting away from the verified one it claims to
 *                     be.
 *
 * Usage:  npm run verify:breakdowns
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { BREAKDOWNS } from '../src/content/breakdowns'
import {
  countHoldsSomewhere,
  countingScope,
  expandTolerance,
  moveLegalSomewhere,
  movesClaimNumbers,
  namedMoves,
} from './lib/prose-moves'
import { hydrate, type RawPuzzle } from '../src/data/puzzles'

const PUZZLE_DIR = resolve(import.meta.dirname, '../public/puzzles')
const BANDS = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200]

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

function material(board: Chess, colour: 'w' | 'b'): number {
  let total = 0
  for (const row of board.board()) {
    for (const cell of row) {
      if (cell && cell.color === colour) total += VALUE[cell.type] ?? 0
    }
  }
  return total
}

/** Every puzzle in the corpus, by id. Loaded once. */
function corpus(): Map<string, string> {
  const byId = new Map<string, string>()
  for (const band of BANDS) {
    const file = resolve(PUZZLE_DIR, `band-${band}.json`)
    if (!existsSync(file)) continue
    for (const raw of JSON.parse(readFileSync(file, 'utf8')) as RawPuzzle[]) {
      const p = hydrate(raw)
      if (p) byId.set(p.id, p.fen)
    }
  }
  return byId
}

const problems: string[] = []
const fail = (where: string, detail: string) => problems.push(`${where}: ${detail}`)

const puzzles = corpus()
console.log(`Checking ${BREAKDOWNS.length} breakdowns against ${puzzles.size} corpus puzzles\n`)

for (const b of BREAKDOWNS) {
  const where = `${b.category}/${b.puzzleId}`

  /* --- provenance --------------------------------------------------- */
  const known = puzzles.get(b.puzzleId)
  if (!known) {
    fail(where, 'puzzle id is not in the shipped corpus')
  } else if (known !== b.fen) {
    fail(where, 'FEN does not match the corpus puzzle it claims to be')
  }

  /* --- position ----------------------------------------------------- */
  let board: Chess
  try {
    board = new Chess(b.fen)
  } catch (err) {
    fail(where, `FEN will not load: ${err instanceof Error ? err.message : String(err)}`)
    continue
  }
  const toMove = board.turn() === 'w' ? 'white' : 'black'
  if (toMove !== b.side) fail(where, `side says ${b.side} but the FEN has ${toMove} to move`)

  const before = material(board, board.turn())
  const solverColour = board.turn()

  /* --- line, and every claim the PROSE makes -------------------------- */
  /*
   * The prose checks exist because of two real failures in one sitting. The
   * trapped-queen breakdown told you the queen "has to run" when she had seven
   * moves, and the FIX then reasoned about "Ke1 or Ke2" in a position with two
   * legal moves. Sean caught both; the verifier passed both, because every
   * mechanical claim was true and only the reasoning was fiction.
   *
   * So the prose is now held to the board on two axes (scripts/lib/prose-moves):
   *
   *   NAMED MOVES  — any SAN in the text must be legal in the position the
   *                  text is about, for either side, or after one reply.
   *                  Explanations legitimately reason one ply deep ("Kf1
   *                  allows Qxh1 mate"), so the scope is exactly that wide.
   *
   *   COUNTS       — "seven moves", "exactly two legal moves", "the only
   *                  move" must equal a real total or a real single piece's
   *                  move count in the attached position. Kept TIGHT (no
   *                  one-ply widening) or some piece somewhere always
   *                  matches and the check goes vacuous.
   *
   * The takeaway is checked against every position in the line, because it is
   * retrospective — "here Kf1 loses instantly" refers to the start, and it is
   * read at the end.
   */
  const linePositions: string[] = [board.fen()]

  const checkProse = (text: string, fens: string[], label: string) => {
    const wide = expandTolerance(fens)
    for (const san of namedMoves(text)) {
      if (!moveLegalSomewhere(san, wide)) {
        fail(where, `${label} names "${san}", which is not a legal move there or after any reply`)
      }
    }
    const tight = fens.flatMap((f) => countingScope(f))
    for (const n of movesClaimNumbers(text)) {
      if (!countHoldsSomewhere(n, tight)) {
        fail(where, `${label} claims "${n} moves", and nothing in that position has ${n} moves`)
      }
    }
  }

  checkProse(b.setup, [board.fen()], 'setup')

  let broke = false
  for (const [i, step] of b.steps.entries()) {
    // The reason is written ABOUT the position the move is played from, so it
    // is checked before the move is applied.
    checkProse(step.why, [board.fen()], `step ${i + 1} ("${step.san}")`)
    try {
      if (!board.move(step.san)) {
        fail(where, `step ${i + 1} "${step.san}" was rejected`)
        broke = true
        break
      }
    } catch {
      fail(where, `step ${i + 1} "${step.san}" is illegal in this position`)
      broke = true
      break
    }
    linePositions.push(board.fen())
  }
  if (!broke) checkProse(b.takeaway, linePositions, 'takeaway')

  if (broke) continue

  /* --- outcome ------------------------------------------------------ */
  if (b.ends === 'mate') {
    if (!board.isCheckmate()) fail(where, 'ends says mate, but the line does not end in mate')
  } else {
    const after = material(board, solverColour)
    const theirsBefore = material(new Chess(b.fen), solverColour === 'w' ? 'b' : 'w')
    const theirsAfter = material(board, solverColour === 'w' ? 'b' : 'w')
    const swing = after - before - (theirsAfter - theirsBefore)
    if (swing < 1) {
      fail(
        where,
        `ends says winsMaterial but the swing is ${swing} — the line does not win anything`,
      )
    }
  }

  const outcome = b.ends === 'mate' ? 'mate' : 'wins material'
  console.log(`  ✓ ${where.padEnd(24)} ${b.steps.length} steps, ${outcome}`)
}

if (problems.length === 0) {
  console.log(`\n✓ all ${BREAKDOWNS.length} breakdowns are real positions with real lines`)
  process.exit(0)
}
console.log(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
for (const p of problems) console.log(`  ${p}`)
process.exit(1)
