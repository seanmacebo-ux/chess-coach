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

  /* --- line, and the moves the PROSE names ---------------------------- */
  /*
   * The prose check exists because of a real failure. The trapped-queen
   * breakdown told you the queen "has to run" and that h4 was "the only square
   * left on the file". She had seven moves, two of them checks and one of them
   * taking the rook. Sean spotted it playing the drill; the verifier had passed
   * it, because every mechanical claim WAS true — the line replayed, the
   * material swing was real — and the reasoning was fiction.
   *
   * Then, fixing it, I wrote that "Ke1 or Ke2 walk into the same ideas". White
   * has exactly two legal moves in that position and neither is Ke1 or Ke2.
   * Twice in one sitting, in prose no mechanical check could see.
   *
   * So: any move-shaped token in `setup` or a step's `why` must be a LEGAL move
   * in the position that text is attached to. It cannot check that a reason is
   * good. It can check that the moves being reasoned about exist, which is the
   * half that was inventing itself.
   */
  const namedMoves = (text: string): string[] => {
    // SAN, loose enough to catch castling and promotions, anchored on word
    // boundaries so "h4" as a square and "Rxh4" as a move are told apart —
    // only the piece-led and pawn-capture forms are treated as moves.
    const re = /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/g
    return [...new Set(text.match(re) ?? [])]
  }

  /*
   * A named move counts as real if it is legal in the position the text is
   * about, OR for the other side in that same position, OR after any single
   * legal reply.
   *
   * That breadth is not slack, it is what the prose actually does: an
   * explanation says "Kf1 allows Qxh1 mate" — Kf1 is White's, Qxh1 is Black's
   * answer to it, and neither is playable by the side to move right now. A
   * checker that only looked at the immediate position would reject every
   * variation ever written, which is most of what a breakdown IS.
   *
   * It still catches the thing it was built for: "Ke1 or Ke2" is not legal now,
   * not legal for the other side, and not legal after any reply.
   *
   * What it CANNOT catch is a semantic claim about real moves — "h4 is the only
   * square left" names a legal move and is still false. That one needs a human,
   * or an engine, or Sean.
   */
  const reachable = (fen: string): string[] => {
    const out = [fen]
    const parts = fen.split(' ')
    const flipped = [...parts]
    flipped[1] = parts[1] === 'w' ? 'b' : 'w'
    // Flipping can produce a position chess.js rejects (side not to move in
    // check); that is fine, it just does not join the set.
    try {
      out.push(new Chess(flipped.join(' ')).fen())
    } catch {
      /* not a legal position to flip into */
    }
    for (const base of [...out]) {
      let moves: string[] = []
      try {
        moves = new Chess(base).moves()
      } catch {
        continue
      }
      for (const m of moves) {
        try {
          const b2 = new Chess(base)
          b2.move(m)
          out.push(b2.fen())
        } catch {
          /* skip */
        }
      }
    }
    return out
  }

  const checkProse = (text: string, fen: string, label: string) => {
    const named = namedMoves(text)
    if (named.length === 0) return
    const positions = reachable(fen)
    for (const san of named) {
      const legal = positions.some((f) => {
        try {
          return Boolean(new Chess(f).move(san))
        } catch {
          return false
        }
      })
      if (!legal) {
        fail(where, `${label} names "${san}", which is not a legal move there or after any reply`)
      }
    }
  }

  checkProse(b.setup, board.fen(), 'setup')

  let broke = false
  for (const [i, step] of b.steps.entries()) {
    // The reason is written ABOUT the position the move is played from, so it
    // is checked before the move is applied.
    checkProse(step.why, board.fen(), `step ${i + 1} ("${step.san}")`)
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
  }
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
