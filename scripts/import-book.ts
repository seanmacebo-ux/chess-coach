/**
 * Turning a book's positions into app content — deterministically.
 *
 * Sean, more than once: "where can I add the books so the app can also
 * deterministically learn from those books?" The honest answer has two halves
 * and this script is the half a machine can do.
 *
 * A PDF cannot teach the app anything. There is no path by which dropping a
 * file in a folder changes how the app plays or what it serves — the app is
 * code and structured data, and a book only becomes app behaviour when its
 * content is converted into that data. Everything in src/content/ (2,400
 * lines of openings, breakdowns, plans, endgames, lessons) got there that way.
 *
 * WHAT CONVERTS WITHOUT JUDGEMENT — this script:
 *
 *   .epd   The standard tactics/study format, one position per line:
 *            <fen> bm Nf6+; id "Polgar 1234";
 *          Position and best move are stated by the author, so importing is
 *          parsing, not interpretation.
 *
 *   .fen   Bare positions, one per line, no answer. Imported as positions to
 *          be solved; the engine supplies the answer and says how sure it is.
 *
 *   .pgn   Games or studies. Every mainline position after `--from-move` is
 *          offered, and the game's own move is treated as the intended one.
 *
 * WHAT DOES NOT — prose. Silman's imbalances, Kotov's method of candidate
 * moves: a person has to read those and encode them, and that person has
 * previously invented chess that was not on the board. Which is what the
 * verifiers in this directory exist for.
 *
 * NOTHING IS TRUSTED. Every position is parsed by chess.js and dropped if it
 * is not legal; every claimed best move is played to confirm it exists; and
 * every position is then searched, so the report says where the book and the
 * engine disagree rather than importing a typo as gospel. Books contain
 * errata, OCR mangles a rank number, and an unverified position teaches a
 * mistake with total confidence.
 *
 *   npm run import-book -- books/polgar-mates.epd --depth 14
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

import { NodeEngine } from './lib/engine-node'
import { lineScore } from '../src/engine/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ----------------------------------------------------------------- args */

/*
 * Read inside a function so the guard actually narrows.
 *
 * `const file = process.argv[2]` at module scope is `string | undefined`, and
 * `process.exit(1)` only narrows within the SAME function — main() re-widens
 * it, which is why the type checker reported five possibly-undefined
 * arguments and the read came back as a Buffer. Nothing was wrong at runtime;
 * the code was simply unprovable, and unprovable code is how the provable
 * kind hides.
 */
function requireFileArg(): string {
  const f = process.argv[2]
  if (!f || f.startsWith('--')) {
    console.error('usage: npm run import-book -- <file.epd|.fen|.pgn> [--depth 14] [--from-move 8]')
    process.exit(1)
  }
  return f
}

const file = requireFileArg()

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

const DEPTH = arg('depth', 14)
const FROM_MOVE = arg('from-move', 8)
/** How far below the engine's best a book move may sit and still be accepted. */
const AGREE_CP = arg('agree-cp', 50)

/* -------------------------------------------------------------- parsing */

export interface RawPosition {
  fen: string
  /** The move the source claims, in SAN or UCI, if it states one. */
  claimed?: string
  id?: string
}

/** One EPD line: a FEN, then `;`-separated opcodes. */
export function parseEpdLine(line: string): RawPosition | null {
  const text = line.trim()
  if (!text || text.startsWith('#')) return null

  const parts = text.split(/\s+/)
  if (parts.length < 4) return null
  // EPD carries 4 required fields; FEN's clocks are optional, so supply them.
  const fen = `${parts.slice(0, 4).join(' ')} 0 1`

  const rest = text.slice(text.indexOf(parts[3]!) + parts[3]!.length)
  const bm = /\bbm\s+([^;]+);/.exec(rest)
  const id = /\bid\s+"?([^";]+)"?;/.exec(rest)
  return {
    fen,
    // "bm Qh5+ Qf3" lists alternatives; the first is the one to check.
    ...(bm ? { claimed: bm[1]!.trim().split(/\s+/)[0]! } : {}),
    ...(id ? { id: id[1]!.trim() } : {}),
  }
}

export function parseEpd(text: string): RawPosition[] {
  return text.split('\n').map(parseEpdLine).filter((p): p is RawPosition => p !== null)
}

/** Bare FEN per line — position only, no claimed answer. */
export function parseFenList(text: string): RawPosition[] {
  return parseEpd(text)
}

/**
 * PGN games become the positions they passed through. Openings are skipped
 * (`--from-move`): a book's value is not that it played 1.e4.
 */
export function parsePgn(text: string, fromMove: number): RawPosition[] {
  const out: RawPosition[] = []
  const games = text.split(/\n\s*\n(?=\[)/)
  for (const [gi, game] of games.entries()) {
    const chess = new Chess()
    try {
      chess.loadPgn(game)
    } catch {
      continue
    }
    const history = chess.history({ verbose: true })
    const board = new Chess()
    for (const [i, mv] of history.entries()) {
      const moveNo = Math.floor(i / 2) + 1
      if (moveNo >= fromMove) {
        out.push({ fen: board.fen(), claimed: mv.san, id: `game${gi + 1}-${moveNo}` })
      }
      board.move(mv.san)
    }
  }
  return out
}

/* ---------------------------------------------------------- verification */

export interface Verdict {
  fen: string
  id: string
  /** The move the book claims, normalised to SAN, or null if it claimed none. */
  claimed: string | null
  claimedUci: string | null
  /** What the engine plays here. */
  best: string
  bestUci: string
  /** How much worse the claimed move is than the engine's, in centipawns. */
  lossCp: number | null
  status: 'agreed' | 'disagreed' | 'no-claim' | 'illegal-position' | 'illegal-move'
  colour: 'white' | 'black'
}

/** Legality first — a mangled rank number must never reach the app. */
export function checkPosition(raw: RawPosition): { chess: Chess } | { error: string } {
  let chess: Chess
  try {
    chess = new Chess(raw.fen)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  if (chess.isGameOver()) return { error: 'position is already over' }
  if (chess.moves().length === 0) return { error: 'no legal moves' }
  return { chess }
}

async function main() {
  const text = await readFile(file, 'utf8')
  const ext = extname(file).toLowerCase()
  const raw =
    ext === '.pgn'
      ? parsePgn(text, FROM_MOVE)
      : ext === '.fen'
        ? parseFenList(text)
        : parseEpd(text)

  if (raw.length === 0) {
    console.error(`[import] no positions found in ${file} — is it ${ext} as expected?`)
    process.exit(1)
  }
  console.log(`[import] ${raw.length} positions parsed from ${basename(file)}`)

  const engine = new NodeEngine()
  await engine.init()

  const verdicts: Verdict[] = []
  for (const [i, r] of raw.entries()) {
    const id = r.id ?? `pos-${i + 1}`
    const checked = checkPosition(r)
    if ('error' in checked) {
      verdicts.push({
        fen: r.fen, id, claimed: r.claimed ?? null, claimedUci: null, best: '', bestUci: '',
        lossCp: null, status: 'illegal-position', colour: 'white',
      })
      continue
    }
    const { chess } = checked
    const colour = chess.turn() === 'w' ? ('white' as const) : ('black' as const)

    const analysis = await engine.analyse(r.fen, { depth: DEPTH, multipv: 1 })
    const bestUci = analysis.bestMove ?? ''
    const bestLine = analysis.lines[0]
    const bestCp = bestLine ? lineScore(bestLine) : 0
    let bestSan = ''
    if (bestUci) {
      const probe = new Chess(r.fen)
      try {
        bestSan = probe.move({
          from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4],
        })?.san ?? ''
      } catch {
        bestSan = ''
      }
    }

    if (!r.claimed) {
      verdicts.push({
        fen: r.fen, id, claimed: null, claimedUci: null, best: bestSan, bestUci,
        lossCp: null, status: 'no-claim', colour,
      })
      continue
    }

    // Does the claimed move even exist in this position?
    const probe = new Chess(r.fen)
    let claimedSan: string | null = null
    let claimedUci: string | null = null
    try {
      const mv = probe.move(r.claimed)
      if (mv) {
        claimedSan = mv.san
        claimedUci = `${mv.from}${mv.to}${mv.promotion ?? ''}`
      }
    } catch {
      claimedSan = null
    }
    if (!claimedSan || !claimedUci) {
      verdicts.push({
        fen: r.fen, id, claimed: r.claimed, claimedUci: null, best: bestSan, bestUci,
        lossCp: null, status: 'illegal-move', colour,
      })
      continue
    }

    // And is it as good as the book says? Negated because the eval after the
    // move is from the opponent's point of view.
    const after = await engine.analyse(probe.fen(), { depth: DEPTH, multipv: 1 })
    const afterLine = after.lines[0]
    const claimedCp = afterLine ? -lineScore(afterLine) : bestCp
    const lossCp = Math.max(0, Math.round(bestCp - claimedCp))

    verdicts.push({
      fen: r.fen, id, claimed: claimedSan, claimedUci, best: bestSan, bestUci, lossCp,
      status: lossCp <= AGREE_CP ? 'agreed' : 'disagreed',
      colour,
    })

    if ((i + 1) % 10 === 0) console.log(`  checked ${i + 1}/${raw.length}`)
  }

  const by = (s: Verdict['status']) => verdicts.filter((v) => v.status === s)
  const agreed = by('agreed')

  const outDir = join(root, 'books', 'imported')
  await mkdir(outDir, { recursive: true })
  const outFile = join(outDir, `${basename(file, ext)}.json`)
  await writeFile(
    outFile,
    JSON.stringify(
      {
        source: basename(file),
        importedAt: new Date().toISOString(),
        depth: DEPTH,
        agreeCp: AGREE_CP,
        // Only what verified is offered as content. The rest stays in the
        // report so a real disagreement can be looked at rather than lost.
        /*
         * The BOOK's move, not the engine's.
         *
         * This exported v.bestUci at first, and the sample caught it: a
         * position where the book played Rf1 and the engine preferred h4 —
         * both fine in a dead draw, so it verified — was imported as h4. That
         * is importing the engine while claiming to import the book. The
         * engine's preference is kept alongside as `engine`, for the cases
         * where they differ and it is worth knowing.
         */
        positions: agreed.map((v) => ({
          id: v.id,
          fen: v.fen,
          solution: v.claimedUci ?? v.bestUci,
          san: v.claimed ?? v.best,
          colour: v.colour,
          ...(v.claimed && v.claimed !== v.best ? { engine: v.best, lossCp: v.lossCp } : {}),
        })),
        rejected: verdicts.filter((v) => v.status !== 'agreed'),
      },
      null,
      2,
    ),
  )

  console.log('')
  console.log(`  agreed with the engine   ${agreed.length}`)
  console.log(`  book disagreed           ${by('disagreed').length}`)
  console.log(`  move not legal there     ${by('illegal-move').length}`)
  console.log(`  position not legal       ${by('illegal-position').length}`)
  console.log(`  no move claimed          ${by('no-claim').length}`)
  console.log('')
  console.log(`  written: ${outFile.replace(root + '/', '')}`)
  console.log('')
  console.log('  Only the agreed positions are offered as content. Disagreements are')
  console.log('  kept in the report — a book is usually right and an OCR slip is not,')
  console.log('  so they are worth reading before anything is thrown away.')
}

// Importable for tests; only runs the pipeline when invoked directly.
if (process.argv[1] && process.argv[1].endsWith('import-book.ts')) {
  void main()
}
