/**
 * Game collections that already exist, fetched rather than re-derived.
 *
 * Sean: "there are repositories for this... can you search some for me."
 * He was right, and the checking turned up something worse than a missed
 * shortcut.
 *
 * brianerdelyi/ChessPGN is a CC0 collection whose two files are the PGN
 * companions to Tal's The Life and Games of Mikhail Tal and Fischer's My 60
 * Memorable Games. The first is the same book scripts/import-epub.ts read out
 * of Sean's EPUB — and a direct comparison says the published file is better
 * than what I extracted:
 *
 *     same length  30      mine shorter  27      mine longer  7
 *     worst gap: Spassky-Tal — identical for 67 plies, then mine STOPS.
 *                Theirs runs to 146.
 *
 * WHY MINE TRUNCATED, since the lesson generalises. The Tal book sets its
 * main line in tables and its analysis in prose — but not consistently: some
 * main-line moves appear only in a sentence ("now 35 b7! decides"). The table
 * parser reads tables, so at such a move the numbering stops matching, the
 * replay starts skipping, and it can only rejoin at a token numbered exactly
 * where it left off. Frequently that never comes, and the rest of the game is
 * dropped in silence.
 *
 * verify:pgn did not catch it because a truncated game is still a legal game.
 * It replays, it is over 20 plies, every assertion passes. The only thing
 * wrong with it is that it is not the whole game, and nothing in the repo
 * knew what the whole game was — which is exactly what an external source is
 * for.
 *
 * So the Tal games now come from here, and the Fischer book is 60 games the
 * app did not have at all. import-epub.ts stays for books with no published
 * PGN, and now reports when it suspects it has stopped early.
 *
 *   npm run fetch-pgn
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'data/pgn')

interface Source {
  /** Filename written into data/pgn. */
  out: string
  url: string
  what: string
  licence: string
}

/**
 * Only CC0 or equivalently unencumbered sources, and only game scores.
 *
 * A game score is a record of an event and nobody owns it, which is the
 * argument books/README.md has always made — but a curated COLLECTION can
 * carry a licence of its own, so the licence is named per source and checked
 * before anything is added here rather than assumed from the file type.
 */
const SOURCES: Source[] = [
  {
    out: 'tal-life-and-games.pgn',
    url: 'https://raw.githubusercontent.com/brianerdelyi/ChessPGN/main/Life%20and%20Games%20of%20Mikhail%20Tal.pgn',
    what: 'Tal, The Life and Games of Mikhail Tal — the games',
    licence: 'CC0-1.0',
  },
  {
    out: 'fischer-60-memorable.pgn',
    url: 'https://raw.githubusercontent.com/brianerdelyi/ChessPGN/main/My%20Memorable%2060.pgn',
    what: 'Fischer, My 60 Memorable Games — the games',
    licence: 'CC0-1.0',
  },
]

/**
 * Normalise to one game per block, with blank lines where PGN wants them.
 *
 * The published files put an entire game's tags and moves on a single line,
 * which is legal PGN and unreadable in a diff. Splitting on the Event tag
 * wherever it appears — not only at the start of a line — is also what makes
 * the games countable at all.
 */
function split(text: string): string[] {
  return text.split(/(?=\[Event ")/).filter((b) => b.trim())
}

function normalise(block: string): string | null {
  const game = new Chess()
  try {
    game.loadPgn(block)
  } catch {
    return null
  }
  const history = game.history()
  if (history.length < 20) return null

  const tag = (k: string) => new RegExp(`\\[${k} "([^"]*)"\\]`).exec(block)?.[1] ?? '?'
  const head = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'ECO']
    .map((k) => `[${k} "${tag(k)}"]`)
    .join('\n')

  const body: string[] = []
  for (let i = 0; i < history.length; i++) {
    if (i % 2 === 0) body.push(`${i / 2 + 1}.`)
    body.push(history[i]!)
  }
  body.push(tag('Result'))
  return `${head}\n\n${body.join(' ')}\n`
}

async function main() {
  await mkdir(OUT, { recursive: true })
  for (const src of SOURCES) {
    const res = await fetch(src.url)
    if (!res.ok) {
      console.log(`  ✗ ${src.out}: HTTP ${res.status}`)
      continue
    }
    const raw = await res.text()
    const blocks = split(raw)
    const good: string[] = []
    let bad = 0
    for (const b of blocks) {
      const n = normalise(b)
      if (n) good.push(n)
      else bad++
    }
    await writeFile(join(OUT, src.out), good.join('\n'), 'utf8')
    const plies = good.reduce((a, g) => a + (g.match(/\s\S+/g)?.length ?? 0), 0)
    console.log(
      `  ✓ ${src.out.padEnd(28)} ${String(good.length).padStart(3)} games` +
      `${bad ? `  (${bad} unusable)` : ''}  · ${src.licence} · ${src.what}`,
    )
    void plies
  }
}

void main()
