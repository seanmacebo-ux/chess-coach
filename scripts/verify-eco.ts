/**
 * Does the opening book name real positions, and name them correctly?
 *
 * 3,810 rows generated from someone else's data by a script I wrote is two
 * places a mistake can hide: their data could have a bad line in it, and my
 * replay could key it wrongly. Either way the app confidently tells you the
 * wrong opening, which is worse than saying nothing.
 *
 * So: every key is parsed as a position, a hand-written set of openings is
 * looked up by playing the moves, and transposition — the whole reason the
 * key drops the clocks — is checked with a move order that reaches the same
 * position the long way round.
 *
 *   npm run verify:eco
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'
import { nameOpening, bookPlies } from '../src/coach/eco'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/** Positions after each ply, which is what nameOpening walks. */
function walk(sans: string[]): string[] {
  const board = new Chess()
  const out: string[] = []
  for (const san of sans) {
    board.move(san)
    out.push(board.fen())
  }
  return out
}

async function main() {
  const raw = await readFile(join(root, 'public/book/eco.json'), 'utf8')
  const rows = JSON.parse(raw) as [string, string, string][]
  const eco = new Map(rows.map((r) => [r[0], [r[1], r[2]] as [string, string]]))

  /* ------------------------------------------- the file is well formed */

  let badFen = 0
  let badEco = 0
  for (const [key, code, name] of rows) {
    try {
      new Chess(`${key} 0 1`)
    } catch {
      badFen++
      if (badFen < 4) console.log(`     unloadable: ${key}`)
    }
    if (!/^[A-E]\d\d$/.test(code)) badEco++
    if (!name.trim()) badEco++
  }
  check(`all ${rows.length} keys load as positions`, badFen === 0, `${badFen} bad`)
  check('every row has an ECO code and a name', badEco === 0, `${badEco} bad`)
  check('no duplicate keys', new Set(rows.map((r) => r[0])).size === rows.length)

  /* ------------------------------------------------ known openings ---- */

  const cases: { sans: string[]; want: string; eco: string }[] = [
    { sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
      want: 'Sicilian Defense: Najdorf Variation', eco: 'B90' },
    { sans: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
      want: 'Nimzo-Indian Defense', eco: 'E20' },
    { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
      want: 'Ruy Lopez', eco: 'C60' },
    { sans: ['d4', 'd5', 'c4', 'e6'],
      want: "Queen's Gambit Declined", eco: 'D30' },
    { sans: ['e4', 'c6'], want: 'Caro-Kann Defense', eco: 'B10' },
  ]

  for (const c of cases) {
    const got = nameOpening(eco, walk(c.sans))
    check(
      `${c.want} is found`,
      got?.name === c.want && got.eco === c.eco,
      got ? `${got.eco} ${got.name}` : 'no match',
    )
  }

  /* --------------------------------------------------- transposition -- */

  /*
   * The same position by two move orders. 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 and
   * 1.c4 e6 2.Nc3 Nf6 3.d4 Bb4 are both the Nimzo-Indian, and they only come
   * out that way because the key drops the move counters — which differ.
   */
  const direct = nameOpening(eco, walk(['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4']))
  const around = nameOpening(eco, walk(['c4', 'e6', 'Nc3', 'Nf6', 'd4', 'Bb4']))
  check('a transposition reaches the same name', direct?.name === around?.name,
        `${direct?.name} vs ${around?.name}`)

  /* ------------------------------------------------------ book plies -- */

  const naj = nameOpening(eco, walk(
    ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
  ))
  const plies = bookPlies(naj)
  check('the Najdorf is book to ply 9', plies.has(9) && plies.size === 10, `${plies.size} plies`)
  check('nothing past the book is book', !plies.has(10))
  check('no opening means no book plies', bookPlies(null).size === 0)

  /*
   * A junk opening must not be named. Without this the whole suite passes on
   * a lookup that returns something for everything.
   */
  const junk = nameOpening(eco, walk(['a4', 'h5', 'a5', 'h4', 'a6', 'h3']))
  check('a nonsense line is not given a deep name', (junk?.ply ?? 0) <= 1,
        junk ? `${junk.name} at ply ${junk.ply}` : 'none')

  console.log(fail === 0 ? '\n✓ opening names hold' : `\n✗ ${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
