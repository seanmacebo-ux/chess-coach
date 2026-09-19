/**
 * Opening names, from the dataset that already exists.
 *
 * Sean: "there are repositories for this" — and he is right. This app has
 * been carrying a 270-position opening tree I generated with the engine, and
 * has never once been able to say "that was a Najdorf", because it had no
 * names. Meanwhile lichess-org/chess-openings is 3,810 curated openings with
 * their ECO codes, released CC0 as a collection of facts, and it is one HTTP
 * request per volume.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT. It does not replace public/book/
 * tree.json. Those are two different jobs: the tree says what to PLAY in a
 * position and was built by searching moves an 800-rated opponent actually
 * meets; this says what a position IS CALLED. Naming and advice are not the
 * same thing and one cannot be derived from the other.
 *
 * Two things fall out of having names, both of which were missing:
 *
 *   THE REVIEW CAN SAY WHICH OPENING IT WAS. Every post-game screen in every
 *   other app does this and ours could not.
 *
 *   "BOOK" BECOMES A REAL MOVE RATING. src/coach/report.ts has rated moves
 *   'book' since the day it was written, and nothing ever passed it a book
 *   ply, so the rating could not fire. A prepared move was being scored as
 *   though you had found it at the board.
 *
 * Names are kept exactly as the dataset spells them, American spellings and
 * all. They are identifiers shared with lichess and every database that uses
 * ECO; rewriting "Defense" to "Defence" for house style would quietly break
 * the one thing a standard name is for.
 *
 *   npm run build:eco
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public/book/eco.json')
const SRC = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master'
const VOLUMES = ['a', 'b', 'c', 'd', 'e']

/** Local copies, so a rebuild is not hostage to the network. */
const CACHE = join(root, 'data/eco')

async function volume(v: string): Promise<string> {
  const local = join(CACHE, `${v}.tsv`)
  try {
    return await readFile(local, 'utf8')
  } catch {
    const res = await fetch(`${SRC}/${v}.tsv`)
    if (!res.ok) throw new Error(`${v}.tsv: HTTP ${res.status}`)
    const text = await res.text()
    await mkdir(CACHE, { recursive: true })
    await writeFile(local, text, 'utf8')
    return text
  }
}

/**
 * The lookup key: FEN without the clocks.
 *
 * The same as src/content/tree.ts uses, and for the same reason — two games
 * reaching one position by different move orders must land on the same entry,
 * and the halfmove and fullmove counters differ when they do. A transposition
 * into the Najdorf is a Najdorf.
 */
function keyOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

async function main() {
  const rows: [string, string, string][] = []
  const seen = new Map<string, string>()
  let lines = 0
  let bad = 0

  for (const v of VOLUMES) {
    const text = await volume(v)
    for (const line of text.split('\n').slice(1)) {
      if (!line.trim()) continue
      lines++
      const [eco, name, pgn] = line.split('\t')
      if (!eco || !name || !pgn) { bad++; continue }

      const board = new Chess()
      try {
        board.loadPgn(pgn)
      } catch {
        bad++
        continue
      }
      if (board.history().length === 0) { bad++; continue }

      const key = keyOf(board.fen())
      /*
       * Collisions are real and they are not errors: two named lines can
       * reach the same position, and the dataset lists both. The FIRST is
       * kept and the rest reported, because picking silently is how a
       * position ends up named one thing here and another thing on lichess.
       */
      if (seen.has(key)) continue
      seen.set(key, name)
      rows.push([key, eco, name])
    }
  }

  /*
   * Sorted by key so the file is diffable. Without it, a rebuild that adds
   * four openings shows up as a wholly rewritten 400KB blob in review.
   */
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(rows), 'utf8')

  const bytes = Buffer.byteLength(JSON.stringify(rows))
  console.log(`  source lines     ${lines}`)
  console.log(`  unrecognised     ${bad}`)
  console.log(`  positions named  ${rows.length}`)
  console.log(`  → ${OUT}  (${Math.round(bytes / 1024)} KB)`)
}

void main()
