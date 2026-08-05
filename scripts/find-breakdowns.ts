/**
 * Find candidate positions for a breakdown, out of the shipped corpus.
 *
 * Writing a worked example from memory is how wrong chess content gets made —
 * it is exactly what put "…Nf6 gives f7 a second defender" into the openings
 * file. So a breakdown is never invented: it is a real Lichess puzzle that has
 * already passed the corpus build's quality gate, and this script is how one
 * gets chosen.
 *
 * It prints, for each candidate, the position replayed move by move in SAN
 * with what each move does — so the explanation can be written against a line
 * that has already been checked rather than one that is being asserted.
 *
 * Deliberately a research tool, not a test. Nothing here ships; the output is
 * read, an entry is written by hand, and `verify:breakdowns` is what actually
 * holds the result to account.
 *
 * Usage:  npx tsx scripts/find-breakdowns.ts <motif> [count] [--short N]
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { hydrate, type RawPuzzle } from '../src/data/puzzles'

const PUZZLE_DIR = resolve(import.meta.dirname, '../public/puzzles')
const BANDS = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200]

const args = process.argv.slice(2)
const motif = args[0]
const want = Number(args[1] ?? 4)
const shortIdx = args.indexOf('--short')
/** Shorter lines make better breakdowns — a nine-ply line is a game, not a
 *  pattern, and nobody reads nine reasons. */
const maxPlies = shortIdx >= 0 ? Number(args[shortIdx + 1]) : 5

if (!motif) {
  console.error('usage: tsx scripts/find-breakdowns.ts <motif> [count] [--short N]')
  process.exit(1)
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const material = (b: Chess, c: 'w' | 'b') =>
  b
    .board()
    .flat()
    .reduce((n, cell) => (cell && cell.color === c ? n + (VALUE[cell.type] ?? 0) : n), 0)

let found = 0
for (const band of BANDS) {
  if (found >= want) break
  const file = resolve(PUZZLE_DIR, `band-${band}.json`)
  if (!existsSync(file)) continue

  for (const raw of JSON.parse(readFileSync(file, 'utf8')) as RawPuzzle[]) {
    if (found >= want) break
    const p = hydrate(raw)
    if (!p) continue
    if (!p.themes.includes(motif)) continue
    if (p.line.length > maxPlies) continue

    const board = new Chess(p.fen)
    const side = board.turn() === 'w' ? 'white' : 'black'
    const mineBefore = material(board, board.turn())
    const theirsBefore = material(board, board.turn() === 'w' ? 'b' : 'w')
    const mover = board.turn()

    const sans: string[] = []
    let ok = true
    for (const uci of p.line) {
      try {
        const m = board.move({
          from: uci.slice(0, 2) as never,
          to: uci.slice(2, 4) as never,
          promotion: (uci[4] ?? 'q') as never,
        })
        if (!m) {
          ok = false
          break
        }
        sans.push(m.san)
      } catch {
        ok = false
        break
      }
    }
    if (!ok) continue

    const mineAfter = material(board, mover)
    const theirsAfter = material(board, mover === 'w' ? 'b' : 'w')
    const swing = mineAfter - theirsAfter - (mineBefore - theirsBefore)

    found++
    console.log(`\n=== ${p.id}  band ${band}  rating ${p.rating}  ${side} to move`)
    console.log(`fen    ${p.fen}`)
    console.log(`themes ${p.themes.join(' ')}`)
    console.log(`line   ${sans.join(' ')}`)
    console.log(
      `ends   ${board.isCheckmate() ? 'MATE' : swing > 0 ? `wins ${swing} material` : 'no swing'}`,
    )
  }
}

if (found === 0) console.log(`no candidates for "${motif}" within ${maxPlies} plies`)
