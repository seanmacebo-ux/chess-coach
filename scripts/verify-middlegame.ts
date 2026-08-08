/**
 * Check that every middlegame plan is legal, and that the moves are any good.
 *
 * Plan-shaped prose is the easiest thing in chess to write convincingly and
 * wrongly. "Swing the queen to h3 and hit h7" reads as teaching whether or not
 * the move is playable, and a reader at 300 has no way to tell the difference.
 * So the reasons are mine to argue for, and the moves are the engine's to
 * approve.
 *
 * Three checks:
 *
 *   REACHABLE — the plan names an opening line rather than carrying a FEN, so
 *               the first thing checked is that the line still exists and still
 *               replays. This is what stops a plan drifting onto a position
 *               nobody verified when an opening is edited.
 *
 *   LEGAL     — every plan move replays from that position. Catches the typo
 *               that would otherwise render a board silently stopping halfway.
 *
 *   SOUND     — and this is the one with teeth. For each of YOUR moves, the
 *               engine searches the position BEFORE it, and the move must not
 *               lose more than BLUNDER_CP against the engine's own choice. A
 *               plan whose moves hang material is not a plan.
 *
 * Only your moves are judged. The opponent's replies exist to produce the
 * position the next step of the plan needs — they are a sparring partner, not
 * a claim about best play, and holding them to the engine's standard would
 * fail every line where the opponent is allowed to be human.
 *
 * Usage:  npm run verify:middlegame
 *         npm run verify:middlegame -- --depth 18
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { PLANS, planBase, type MiddlegamePlan } from '../src/content/middlegame'
import { lineScore } from '../src/engine/types'
import { expandTolerance, moveLegalSomewhere, namedMoves } from './lib/prose-moves'

const args = process.argv.slice(2)
const depthArg = args.indexOf('--depth')
/**
 * Middlegames are sharper than openings and settle faster, but they also have
 * more legal moves. 14 is enough to catch a hung piece or a positional howler
 * and cheap enough that the whole file runs in a couple of minutes.
 */
const DEPTH = depthArg >= 0 ? Number(args[depthArg + 1]) : 14

/**
 * How far a plan move may fall short of the engine's choice.
 *
 * Deliberately not zero, and not tight. These plans teach a scheme, and a
 * scheme is often the second-best move — Bh2 keeping the bishop, Be2 stepping
 * back, Nf1 taking the long route. Insisting on the top move would fail
 * exactly the moves worth teaching. A pawn is the line between "not the
 * engine's first choice" and "this loses something".
 */
const BLUNDER_CP = 100

interface Problem {
  where: string
  detail: string
}

const problems: Problem[] = []
const rows: string[] = []

async function main() {
  const engine = new NodeEngine()
  console.log(`Verifying ${PLANS.length} plans, depth ${DEPTH}\n`)

  for (const plan of PLANS) {
    await checkPlan(engine, plan)
  }

  console.log(rows.join('\n'))

  if (problems.length === 0) {
    console.log(`\n✓ all ${PLANS.length} plans reachable, legal, and sound at depth ${DEPTH}`)
    process.exit(0)
  }
  console.log(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
  for (const p of problems) console.log(`  ${p.where}: ${p.detail}`)
  process.exit(1)
}

async function checkPlan(engine: NodeEngine, plan: MiddlegamePlan) {
  const where = plan.id

  /* --- reachable ------------------------------------------------------ */
  let base: { fen: string; history: string[] }
  try {
    base = planBase(plan)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    problems.push({ where, detail })
    rows.push(`  ✗ ${where.padEnd(22)} UNREACHABLE — ${detail}`)
    return
  }

  /* --- whose move is it, and does that match `side`? ------------------ */
  const board = new Chess(base.fen)
  const stm = board.turn() === 'w' ? 'white' : 'black'
  /**
   * The plan's moves start from whoever is to move in the base position, so
   * the parity of "your" plies depends on whether that is you. Getting this
   * wrong would judge the opponent's moves and skip your own — silently, and
   * in the direction that makes everything pass.
   */
  const youMoveFirst = stm === plan.side

  /*
   * A move carries a `why` if and only if it is yours. That is how the trainer
   * decides what to ask for, so a mismatch here is a real bug rather than a
   * style point — an unlabelled move of yours is one the trainer plays FOR
   * you, which is the opposite of the intent.
   */
  for (const [i, m] of plan.moves.entries()) {
    const yours = youMoveFirst ? i % 2 === 0 : i % 2 === 1
    if (yours && !m.why) {
      problems.push({ where, detail: `move ${i + 1} "${m.san}" is yours but has no reason attached` })
    }
    if (!yours && m.why) {
      problems.push({
        where,
        detail: `move ${i + 1} "${m.san}" is the opponent's but carries a reason — check the move order`,
      })
    }
  }

  if (plan.steps.length !== 3) {
    problems.push({ where, detail: `has ${plan.steps.length} steps, expected 3` })
  }

  /* --- legal, and sound ----------------------------------------------- */
  let worst: { san: string; loss: number; best: string } | null = null
  let checked = 0
  const linePositions: string[] = [board.fen()]

  for (const [i, move] of plan.moves.entries()) {
    const yours = youMoveFirst ? i % 2 === 0 : i % 2 === 1
    const fenBefore = board.fen()

    if (yours) {
      const verdict = await judge(engine, fenBefore, move.san)
      if (verdict === 'illegal') {
        const detail = `move ${i + 1} "${move.san}" is illegal here`
        problems.push({ where, detail })
        rows.push(`  ✗ ${where.padEnd(22)} ILLEGAL — ${detail}`)
        return
      }
      checked++
      if (verdict.loss > BLUNDER_CP) {
        problems.push({
          where,
          detail: `move ${i + 1} "${move.san}" loses ${(verdict.loss / 100).toFixed(2)} against ${verdict.best}`,
        })
      }
      if (!worst || verdict.loss > worst.loss) {
        worst = { san: move.san, loss: verdict.loss, best: verdict.best }
      }
    }

    try {
      const played = board.move(move.san)
      if (!played) throw new Error('rejected')
    } catch {
      const detail = `move ${i + 1} "${move.san}" is illegal here`
      problems.push({ where, detail })
      rows.push(`  ✗ ${where.padEnd(22)} ILLEGAL — ${detail}`)
      return
    }
    linePositions.push(board.fen())
  }

  /*
   * Every claim the PROSE makes must survive the board.
   *
   * These plans are the most explanation-dense content in the app — a brief,
   * three steps, and a reason per move, all hand-written — and until now none
   * of that text was checked against anything. The trapped-queen episode
   * showed exactly how that goes wrong: confident sentences about moves that
   * do not exist, caught by Sean rather than by tooling.
   *
   * Scope is the WHOLE line plus flips and one-ply replies, because a brief
   * legitimately talks about moves that only become legal later ("the pawn
   * wants f4" is written before the bishop has stepped out of its way), and
   * about the opponent's ideas ("...cxd4 and counterplay down the c-file").
   *
   * No counting-claim check here on purpose: plan prose uses "moves" for
   * tempo ("Nbd2–f1–g3 takes four moves"), which is a journey, not a legal-
   * move count, and holding it to the wrong ruler would flag true sentences.
   */
  const proseScope = expandTolerance(linePositions)
  const lintProse = (text: string, label: string) => {
    for (const san of namedMoves(text)) {
      if (!moveLegalSomewhere(san, proseScope)) {
        problems.push({
          where,
          detail: `${label} names "${san}", which is never a legal move anywhere in this plan`,
        })
      }
    }
  }

  lintProse(plan.structure, 'structure')
  lintProse(plan.theirPlan, 'theirPlan')
  for (const [i, st] of plan.steps.entries()) lintProse(`${st.label}. ${st.detail}`, `step ${i + 1}`)
  for (const [i, m] of plan.moves.entries()) {
    if (m.why) lintProse(m.why, `move ${i + 1} ("${m.san}")`)
  }
  lintProse(plan.takeaway, 'takeaway')

  const mark = problems.some((p) => p.where === where) ? '✗' : '✓'
  const w = worst
    ? `worst ${worst.san} −${(Math.max(0, worst.loss) / 100).toFixed(2)} (engine: ${worst.best})`
    : 'no moves of yours'
  rows.push(
    `  ${mark} ${where.padEnd(22)} ${String(checked).padStart(2)} of your moves · ${w}`,
  )
}

/**
 * How much worse is this move than the engine's choice, in centipawns?
 *
 * Both searches are from the same side's point of view: the position before
 * the move has you to play, and the position after has the opponent to play,
 * so the second score is negated. Getting that sign wrong is the classic way
 * to build a checker that approves everything.
 */
async function judge(
  engine: NodeEngine,
  fenBefore: string,
  san: string,
): Promise<'illegal' | { loss: number; best: string }> {
  const probe = new Chess(fenBefore)
  let after: string
  try {
    const m = probe.move(san)
    if (!m) return 'illegal'
    after = probe.fen()
  } catch {
    return 'illegal'
  }

  const before = await engine.analyse(fenBefore, { depth: DEPTH, multipv: 1 })
  const bestLine = before.lines[0]
  if (!bestLine) return { loss: 0, best: '?' }
  const bestCp = lineScore(bestLine)

  // Mate for the side to move in the base position: any non-mating move is a
  // huge nominal "loss" and would fail every plan that walks past a mate it
  // was never claiming to see. Plans are not tactics puzzles.
  if (bestLine.mate !== null && bestLine.mate !== undefined && bestLine.mate > 0) {
    return { loss: 0, best: sanOf(fenBefore, before.bestMove) }
  }

  if (probe.isCheckmate()) return { loss: 0, best: san }

  const now = await engine.analyse(after, { depth: DEPTH, multipv: 1 })
  const nowLine = now.lines[0]
  if (!nowLine) return { loss: 0, best: '?' }
  const yourCp = -lineScore(nowLine)

  return { loss: bestCp - yourCp, best: sanOf(fenBefore, before.bestMove) }
}

function sanOf(fen: string, uci: string | null | undefined): string {
  if (!uci) return '?'
  try {
    const b = new Chess(fen)
    const m = b.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci[4] ?? 'q',
    })
    return m?.san ?? uci
  } catch {
    return uci
  }
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
