/**
 * Do the committed game scores still replay?
 *
 * data/pgn holds 366 master games lifted out of four books by
 * scripts/import-epub.ts. They are committed because they are the raw
 * material for drills and because the books they came from live on Sean's
 * machine, not in this repository — regenerating them is not a `git pull`
 * away. Committed data with nothing checking it rots quietly, and a corrupt
 * game score becomes a drill that teaches an illegal position.
 *
 * Every game is replayed on a real board, from move one to the result.
 *
 *   npm run verify:pgn
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'data/pgn')

/** Minimum length for a game to be worth keeping as training material. */
const MIN_PLIES = 20

async function main() {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.pgn')).sort()
  let games = 0
  let bad = 0
  let plies = 0

  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8')
    const blocks = text.split(/\n(?=\[Event )/).filter((b) => b.trim())
    let fileBad = 0
    let fileP = 0
    for (const b of blocks) {
      games++
      const white = /\[White "([^"]*)"\]/.exec(b)?.[1] ?? '?'
      const black = /\[Black "([^"]*)"\]/.exec(b)?.[1] ?? '?'
      const chess = new Chess()
      let ok = true
      try {
        chess.loadPgn(b)
      } catch (e) {
        console.log(`  ✗ ${f} ${white}-${black}: ${(e as Error).message}`)
        ok = false
      }
      const n = chess.history().length
      if (ok && n < MIN_PLIES) {
        console.log(`  ✗ ${f} ${white}-${black}: only ${n} plies`)
        ok = false
      }
      if (!ok) { bad++; fileBad++ } else { plies += n; fileP += n }
    }
    console.log(
      `  ${fileBad === 0 ? '✓' : '✗'} ${f.padEnd(28)} ${String(blocks.length).padStart(3)} games` +
      `  mean ${Math.round(fileP / Math.max(1, blocks.length - fileBad))} plies`,
    )
  }

  console.log(
    bad === 0
      ? `\n✓ ${games} games, ${plies} plies, every one replays`
      : `\n✗ ${bad} of ${games} games will not replay`,
  )
  process.exit(bad === 0 ? 0 : 1)
}

void main()
