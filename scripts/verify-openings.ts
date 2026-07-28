/**
 * Check that every opening line is legal, and that it ends where it claims to.
 *
 * The openings file used to carry a header saying "move sequences are checked
 * by scripts/verify-openings.ts". This script did not exist. That is a worse
 * failure than having no check at all: the claim of verification was doing the
 * job of verification, so a wrong line would have shipped as confident advice
 * with a citation pointing at nothing.
 *
 * Three checks, escalating in what they can catch:
 *
 *   LEGALITY  — replay every line through chess.js. A typo in a SAN token
 *               ("Ng5" for "Nxg5") throws here rather than rendering a board
 *               that silently stops halfway through the line.
 *
 *   BLUNDER   — every `punish` line names the losing move in `blunder`, and
 *               that move must actually appear in the line. Renaming a move
 *               without updating the field would otherwise leave the UI
 *               highlighting nothing, which reads as "no mistake here".
 *
 *   OUTCOME   — the `ends` claim is asserted, not trusted. `mate` is exact
 *               from chess.js. `winning` and `balanced` are measured with
 *               Stockfish, so a line taught as a refutation has to actually
 *               be one. This is the check with teeth: prose written from
 *               memory is exactly where chess content goes wrong, and it is
 *               invisible to every other kind of test.
 *
 * Usage:  npm run verify:openings
 *         npm run verify:openings -- --depth 20
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { allLines, type OpeningLine, type Side } from '../src/content/openings'
import { lineScore } from '../src/engine/types'

const args = process.argv.slice(2)
const depthArg = args.indexOf('--depth')
/**
 * Deep enough for an opening position to settle. Openings are quiet and
 * shallow searches swing a lot in them, so this is higher than the drills use.
 */
const DEPTH = depthArg >= 0 ? Number(args[depthArg + 1]) : 18

/** At least this good for the favoured side, to call a line `winning`. */
const WINNING_CP = 150
/**
 * Inside this, a line is `balanced`.
 *
 * Deliberately generous. Main lines of sound openings sit anywhere from 0 to
 * about +0.6 for White at this depth — that IS balanced in any meaningful
 * sense, and a tighter band would fail correct theory for being theory.
 */
const BALANCED_CP = 80

interface Problem {
  where: string
  detail: string
}

const problems: Problem[] = []
const rows: string[] = []

async function main() {
  const engine = new NodeEngine()
  const entries = allLines()

  console.log(`Verifying ${entries.length} lines across ${new Set(entries.map((e) => e.opening.id)).size} openings, depth ${DEPTH}\n`)

  for (const { opening, line } of entries) {
    const where = `${opening.id}/${line.id}`

    /* --- legality ---------------------------------------------------- */
    const board = new Chess()
    let illegal: string | null = null
    for (const [i, san] of line.moves.entries()) {
      try {
        const m = board.move(san)
        if (!m) {
          illegal = `move ${i + 1} "${san}" was rejected`
          break
        }
      } catch (err) {
        illegal = `move ${i + 1} "${san}" is illegal here (${
          err instanceof Error ? err.message : String(err)
        })`
        break
      }
    }
    if (illegal) {
      problems.push({ where, detail: illegal })
      rows.push(`  ✗ ${where.padEnd(34)} ILLEGAL — ${illegal}`)
      continue
    }

    /* --- blunder field ------------------------------------------------ */
    if (line.role === 'punish' && !line.blunder) {
      problems.push({ where, detail: 'punish line has no `blunder` move named' })
    }
    if (line.blunder && !line.moves.includes(line.blunder)) {
      problems.push({
        where,
        detail: `blunder "${line.blunder}" does not appear in the line`,
      })
    }

    /* --- outcome ------------------------------------------------------ */
    const verdict = await outcomeOf(engine, board, line, where)
    rows.push(verdict.row)
    if (verdict.problem) problems.push({ where, detail: verdict.problem })
  }

  console.log(rows.join('\n'))

  if (problems.length === 0) {
    console.log(`\n✓ all ${entries.length} lines legal, and every ends-claim holds at depth ${DEPTH}`)
    process.exit(0)
  }
  console.log(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
  for (const p of problems) console.log(`  ${p.where}: ${p.detail}`)
  process.exit(1)
}

/**
 * Score the final position and compare with the `ends` claim.
 *
 * Everything is normalised to centipawns from the FAVOURED side's point of
 * view, so the comparison reads the same whichever colour the line is for.
 */
async function outcomeOf(
  engine: NodeEngine,
  board: Chess,
  line: OpeningLine,
  where: string,
): Promise<{ row: string; problem: string | null }> {
  const label = `${where.padEnd(34)} ${line.role.padEnd(9)}`

  if (board.isCheckmate()) {
    // Mate is exact — never ask the engine about it. The mated side is the
    // side to move, so the line favours the other one.
    const mated: Side = board.turn() === 'w' ? 'white' : 'black'
    const winner: Side = mated === 'white' ? 'black' : 'white'
    if (line.ends !== 'mate') {
      return {
        row: `  ✗ ${label} ends in MATE but claims "${line.ends}"`,
        problem: `line is checkmate but ends is "${line.ends}"`,
      }
    }
    if (line.favours !== winner) {
      return {
        row: `  ✗ ${label} mate favours ${winner}, claims ${line.favours}`,
        problem: `mate favours ${winner} but favours says ${line.favours}`,
      }
    }
    return { row: `  ✓ ${label} mate for ${winner}`, problem: null }
  }

  if (line.ends === 'mate') {
    return {
      row: `  ✗ ${label} claims mate, position is not mate`,
      problem: 'ends is "mate" but the final position is not checkmate',
    }
  }

  const fen = board.fen()
  const analysis = await engine.analyse(fen, { depth: DEPTH, multipv: 1 })
  const best = analysis.lines[0]
  if (!best) {
    return {
      row: `  ✗ ${label} engine returned no line`,
      problem: 'engine returned no line for the final position',
    }
  }

  // lineScore is from the side-to-move's point of view.
  const stm: Side = board.turn() === 'w' ? 'white' : 'black'
  const raw = lineScore(best)
  const cp = stm === line.favours ? raw : -raw

  const shown = `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)} for ${line.favours}`

  if (line.ends === 'winning') {
    if (cp < WINNING_CP) {
      return {
        row: `  ✗ ${label} claims winning, engine says ${shown}`,
        problem: `ends is "winning" but the engine scores ${shown} (needs ≥ +${(WINNING_CP / 100).toFixed(2)})`,
      }
    }
    return { row: `  ✓ ${label} winning — ${shown}`, problem: null }
  }

  if (line.ends === 'edge') {
    if (cp <= BALANCED_CP || cp >= WINNING_CP) {
      return {
        row: `  ✗ ${label} claims edge, engine says ${shown}`,
        problem: `ends is "edge" but the engine scores ${shown} (band is +${(BALANCED_CP / 100).toFixed(2)} to +${(WINNING_CP / 100).toFixed(2)})`,
      }
    }
    return { row: `  ✓ ${label} edge — ${shown}`, problem: null }
  }

  // balanced
  if (Math.abs(cp) > BALANCED_CP) {
    return {
      row: `  ✗ ${label} claims balanced, engine says ${shown}`,
      problem: `ends is "balanced" but the engine scores ${shown} (band is ±${(BALANCED_CP / 100).toFixed(2)})`,
    }
  }
  return { row: `  ✓ ${label} balanced — ${shown}`, problem: null }
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
