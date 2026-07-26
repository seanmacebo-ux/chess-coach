/**
 * Sandbox the whole puzzle corpus.
 *
 * 28,800 puzzles shipped without anything ever checking them. They came from a
 * filtered scan of the 6-million-row Lichess dump, and the build script that
 * produced them never re-read its own output — so a bad row, a truncated line
 * or a mislabelled motif would sit there being served as training material.
 *
 * Two kinds of check, for two different costs:
 *
 *   STRUCTURAL — exhaustive, every single puzzle, no engine. Does the FEN load,
 *   is it legal, does the setup move apply, does every move in the solution
 *   line apply in sequence, and do the mate-in-N labels match the actual line
 *   length. These are cheap and there is no excuse for not running them on all
 *   of them.
 *
 *   SOUNDNESS — a sample per band, with the engine. Is the stored first move
 *   actually the best move? This is what catches a puzzle whose "solution" is
 *   merely good. It costs a real search per puzzle, so a full pass would take
 *   hours; a sample gives an honest error rate instead of a false all-clear.
 *
 * The run also prints the category inventory, because "what am I actually
 * being taught" is answered by the motif counts and nothing else.
 *
 * Usage:  npm run sandbox:puzzles
 *         npm run sandbox:puzzles -- --sample 80    (deeper soundness pass)
 *         npm run sandbox:puzzles -- --sample 0     (structural only, fast)
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { hydrate, type RawPuzzle, type Puzzle } from '../src/data/puzzles'

const BANDS = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200]
const PUZZLE_DIR = resolve(import.meta.dirname, '../public/puzzles')

/** Engine depth for the soundness sample. Enough to trust the top move. */
const SOUND_DEPTH = 16

/**
 * How much worse than the engine's best the stored move may be before the
 * puzzle counts as unsound.
 *
 * Not zero. Many Lichess puzzles have a second move that also wins — a mate in
 * three alongside a mate in two, or two different ways to win the same rook.
 * Those are fine as puzzles. What is NOT fine is a "solution" that throws away
 * most of the advantage, and 150 centipawns is comfortably past that line.
 */
const SOUNDNESS_TOLERANCE_CP = 150

interface Failure {
  band: number
  id: string
  kind: string
  detail: string
}

/**
 * The check chess.js will not do for you: is the side NOT to move in check?
 *
 * The en-passant field must be cleared when flipping the side to move. An ep
 * square is only meaningful for the side it can be captured BY, so a position
 * whose previous move was a double pawn push becomes an illegal FEN the moment
 * you swap the mover, chess.js throws, and a naive catch reports every one of
 * those positions as broken. That mistake flagged 148 perfectly good puzzles
 * here before this line existed — src/coach/exercises.ts nullMoveFen() had
 * already worked this out and documented it.
 */
function opponentInCheck(fen: string): boolean {
  const parts = fen.split(' ')
  if (parts.length < 4) return false
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  try {
    return new Chess(parts.join(' ')).isCheck()
  } catch {
    return true
  }
}

/* ------------------------------------------------------------------ */
/* Structural                                                          */
/* ------------------------------------------------------------------ */

function checkStructure(band: number, raw: RawPuzzle, p: Puzzle | null): Failure[] {
  const out: Failure[] = []
  const fail = (kind: string, detail: string) => out.push({ band, id: raw.i, kind, detail })

  if (!p) {
    fail('hydrate', 'the shipped parser rejected this row')
    return out
  }

  // 1. The position the solver is shown must itself be legal.
  let board: Chess
  try {
    board = new Chess(p.fen)
  } catch (err) {
    fail('fen', err instanceof Error ? err.message : String(err))
    return out
  }
  if (opponentInCheck(p.fen)) {
    fail('fen', 'side not to move is in check — impossible position')
    return out
  }
  if (board.isGameOver()) {
    fail('fen', 'position is already over before the solver moves')
    return out
  }

  // 2. There has to be something to solve.
  if (p.solution.length === 0) {
    fail('line', 'no solver moves after the setup move')
    return out
  }

  // 3. Every move in the line must apply, in order.
  const replay = new Chess(p.fen)
  for (let i = 0; i < p.line.length; i++) {
    const uci = p.line[i]!
    try {
      const moved = replay.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      })
      if (!moved) {
        fail('line', `move ${i + 1} (${uci}) is not legal`)
        return out
      }
    } catch {
      fail('line', `move ${i + 1} (${uci}) is not legal`)
      return out
    }
  }

  // 4. The line must not end on the opponent's move — otherwise the runner
  //    waits for a solver move that does not exist.
  if (p.line.length % 2 === 0) {
    fail('line', `line has ${p.line.length} moves — ends on the opponent's reply`)
  }

  // 5. mate-in-N labels must match the line that is actually stored.
  //
  // mateIn5 is a BUCKET in the Lichess taxonomy — it means "mate in five or
  // more", and the corpus genuinely contains six- and seven-move mates carrying
  // that tag. mateIn1 through mateIn4 are exact. Treating them all as exact
  // flagged 70 correct puzzles.
  const mateTag = p.themes.find((t) => /^mateIn[1-5]$/.test(t))
  if (mateTag) {
    const claimed = Number(mateTag.slice(6))
    const actual = p.solution.length
    if (!replay.isCheckmate()) {
      fail('theme', `tagged ${mateTag} but the line does not end in mate`)
    } else if (claimed === 5 ? actual < 5 : claimed !== actual) {
      fail('theme', `tagged ${mateTag} but the solution is ${actual} move(s)`)
    }
  }

  // 6. The rating has to be in the band it shipped in, or the ladder serves
  //    the wrong difficulty while claiming otherwise.
  if (p.rating < band || p.rating >= band + 200) {
    fail('rating', `rated ${p.rating} but shipped in the ${band} band`)
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Soundness                                                           */
/* ------------------------------------------------------------------ */

async function checkSoundness(
  engine: NodeEngine,
  band: number,
  p: Puzzle,
): Promise<Failure | null> {
  const analysis = await engine.analyse(p.fen, { depth: SOUND_DEPTH, multipv: 1 })
  const best = analysis.bestMove
  const line = analysis.lines[0]
  if (!best || !line) return null // engine had nothing to say; not the puzzle's fault

  const stored = p.solution[0]!
  // First four characters — auto-queening makes the promotion suffix differ.
  if (best.slice(0, 4) === stored.slice(0, 4)) return null

  // The engine prefers a different move. That is only a problem if the stored
  // move is materially worse, so measure it rather than assuming.
  const after = new Chess(p.fen)
  try {
    after.move({ from: stored.slice(0, 2), to: stored.slice(2, 4), promotion: stored[4] })
  } catch {
    return { band, id: p.id, kind: 'sound', detail: `stored move ${stored} is illegal` }
  }

  const reply = await engine.analyse(after.fen(), { depth: SOUND_DEPTH, multipv: 1 })
  const replyLine = reply.lines[0]
  if (!replyLine) return null

  const scoreOf = (l: { cp: number | null; mate: number | null }) =>
    l.mate !== null ? Math.sign(l.mate) * (100_000 - Math.abs(l.mate)) : (l.cp ?? 0)

  const bestScore = scoreOf(line) // solver to move: higher is better for solver
  const storedScore = -scoreOf(replyLine) // opponent to move: negate for solver
  const loss = bestScore - storedScore

  if (loss > SOUNDNESS_TOLERANCE_CP) {
    return {
      band,
      id: p.id,
      kind: 'sound',
      detail: `stored ${stored} loses ${Math.round(loss)}cp vs engine's ${best}`,
    }
  }
  return null
}

/* ------------------------------------------------------------------ */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

async function main(): Promise<void> {
  const sampleSize = arg('sample', 30)

  const failures: Failure[] = []
  const motifCounts = new Map<string, number>()
  let total = 0

  console.log('SANDBOX — puzzle corpus\n')
  console.log('  band    rows   structural failures')
  console.log('  ' + '-'.repeat(44))

  const byBand = new Map<number, Puzzle[]>()

  for (const band of BANDS) {
    const file = resolve(PUZZLE_DIR, `band-${band}.json`)
    if (!existsSync(file)) {
      console.log(`  ${String(band).padEnd(7)} MISSING`)
      failures.push({ band, id: '-', kind: 'file', detail: 'band file not found' })
      continue
    }

    const rows = JSON.parse(readFileSync(file, 'utf8')) as RawPuzzle[]
    const good: Puzzle[] = []
    let bandFails = 0

    for (const raw of rows) {
      total++
      const p = hydrate(raw)
      const errs = checkStructure(band, raw, p)
      if (errs.length > 0) {
        failures.push(...errs)
        bandFails += errs.length
      } else if (p) {
        good.push(p)
        for (const t of p.themes) motifCounts.set(t, (motifCounts.get(t) ?? 0) + 1)
      }
    }

    byBand.set(band, good)
    console.log(`  ${String(band).padEnd(7)} ${String(rows.length).padEnd(6)} ${bandFails}`)
  }

  const structural = failures.length
  console.log(`\n  ${total} puzzles scanned · ${structural} structural failures\n`)

  /* ------------------------------------------------------ categories */
  console.log('CATEGORIES — what the corpus can actually teach\n')
  const sorted = [...motifCounts.entries()].sort((a, b) => b[1] - a[1])
  const width = Math.max(...sorted.map(([m]) => m.length), 4)
  for (const [motif, count] of sorted) {
    const pct = ((count / Math.max(total, 1)) * 100).toFixed(1)
    const bar = '#'.repeat(Math.max(1, Math.round((count / Math.max(total, 1)) * 60)))
    console.log(`  ${motif.padEnd(width)}  ${String(count).padStart(6)}  ${pct.padStart(5)}%  ${bar}`)
  }
  console.log(`\n  ${sorted.length} distinct motifs\n`)

  /* ------------------------------------------------------- soundness */
  if (sampleSize > 0) {
    console.log(`SOUNDNESS — engine check, ${sampleSize} sampled per band at depth ${SOUND_DEPTH}\n`)
    const engine = new NodeEngine()
    await engine.init()

    let checked = 0
    let unsound = 0
    for (const band of BANDS) {
      const pool = byBand.get(band) ?? []
      if (pool.length === 0) continue
      // Deterministic spread across the band rather than random, so two runs
      // are comparable and a regression is visible.
      const step = Math.max(1, Math.floor(pool.length / sampleSize))
      let bandUnsound = 0
      let bandChecked = 0
      for (let i = 0; i < pool.length && bandChecked < sampleSize; i += step) {
        const f = await checkSoundness(engine, band, pool[i]!)
        bandChecked++
        checked++
        if (f) {
          failures.push(f)
          bandUnsound++
          unsound++
        }
      }
      console.log(`  ${String(band).padEnd(7)} ${bandChecked} checked · ${bandUnsound} questionable`)
    }
    const rate = checked > 0 ? ((unsound / checked) * 100).toFixed(1) : '0.0'
    console.log(`\n  ${checked} checked · ${unsound} questionable · ${rate}% of the sample\n`)
  }

  /* --------------------------------------------------------- report */
  if (failures.length === 0) {
    console.log('No problems found.')
    return
  }

  console.log(`${failures.length} problems, grouped:\n`)
  const byKind = new Map<string, Failure[]>()
  for (const f of failures) {
    const list = byKind.get(f.kind) ?? []
    list.push(f)
    byKind.set(f.kind, list)
  }
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${kind} — ${list.length}`)
    for (const f of list.slice(0, 8)) {
      console.log(`    band ${f.band}  ${f.id}  ${f.detail}`)
    }
    if (list.length > 8) console.log(`    ... and ${list.length - 8} more`)
    console.log('')
  }

  // Structural failures are bugs and must fail the run. Soundness findings are
  // a quality signal on a third-party corpus — reported loudly, but a handful
  // of "the engine prefers something else" is expected and not a build break.
  if (structural > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
