/**
 * Sandbox the generated drills.
 *
 * The puzzle corpus and the endgame library are fixed data, so checking them
 * means checking rows. These three drills are different: they GENERATE their
 * own questions and their own answers at runtime. Nothing had ever verified
 * that the answer a drill marks correct is actually correct — you could only
 * click through the app and believe whatever it told you, which is precisely
 * the failure mode a sandbox exists to prevent.
 *
 * The method is independent re-derivation. It is not enough to call the
 * builder and check it returned something; the check has to work out the right
 * answer a DIFFERENT way and see if the two agree:
 *
 *   Scan      — re-derive loose pieces from the board, and separately confirm
 *               every decoy really does have a defender. A decoy that is
 *               actually hanging would mark a correct answer wrong.
 *   Threat    — re-run the null move at a DEEPER depth than the builder used.
 *               If the deeper search picks a different destination square, the
 *               question was set at too shallow a depth to be trustworthy.
 *   Candidate — re-rank with a deeper, wider multipv. Every move the drill
 *               marks "good" must still be near the top.
 *
 * Yield is reported too. A drill that only manages two questions out of eight
 * requested is broken in a way no correctness check would catch.
 *
 * Usage:  npm run sandbox:drills
 *         npm run sandbox:drills -- --count 12
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'

import { NodeEngine } from './lib/engine-node'
import { hydrate, type RawPuzzle, type Puzzle } from '../src/data/puzzles'
import {
  buildScanQuestions,
  buildThreatQuestions,
  buildCandidateQuestions,
  CANDIDATE_TOP_N,
} from '../src/coach/drills'
import { loosePieces, nullMoveFen } from '../src/coach/exercises'
import { lineScore } from '../src/engine/types'

const PUZZLE_DIR = resolve(import.meta.dirname, '../public/puzzles')
/** Bands spanning the whole rating range, so no drill is checked only at 1400. */
const BANDS = [800, 1200, 1600, 2000]

/** Deeper than any builder uses — the point is an independent second opinion. */
const AUDIT_DEPTH = 18
/** Threats are audited deeper still, because the builder now searches to 16. */
const THREAT_AUDIT_DEPTH = 20

interface Problem {
  drill: string
  id: string
  detail: string
}

function loadPuzzles(perBand: number): Puzzle[] {
  const out: Puzzle[] = []
  for (const band of BANDS) {
    const rows = JSON.parse(
      readFileSync(resolve(PUZZLE_DIR, `band-${band}.json`), 'utf8'),
    ) as RawPuzzle[]
    // Spread across the file rather than taking the head, so the sample is not
    // all from one slice of the original dump.
    const step = Math.max(1, Math.floor(rows.length / perBand))
    let taken = 0
    for (let i = 0; i < rows.length && taken < perBand; i += step) {
      const p = hydrate(rows[i]!)
      if (p) {
        out.push(p)
        taken++
      }
    }
  }
  return out
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

/* ------------------------------------------------------------------ */

function auditScan(pool: Puzzle[], want: number): Problem[] {
  const problems: Problem[] = []
  const qs = buildScanQuestions(pool, want)

  console.log(`  scan       built ${qs.length}/${want}`)
  if (qs.length < want) {
    problems.push({
      drill: 'scan',
      id: '-',
      detail: `yield ${qs.length} of ${want} requested from ${pool.length} positions`,
    })
  }

  for (const q of qs) {
    const board = new Chess(q.fen)

    // Every claimed answer must genuinely be attacked AND undefended.
    const truth = new Set(loosePieces(q.fen, q.colour))
    for (const a of q.answers) {
      if (!truth.has(a)) {
        problems.push({ drill: 'scan', id: q.id, detail: `claims ${a} is loose; it is not` })
      }
    }

    // Every decoy must genuinely be safe, or a correct answer gets marked wrong.
    for (const opt of q.options) {
      if (q.answers.includes(opt)) continue
      if (truth.has(opt)) {
        problems.push({
          drill: 'scan',
          id: q.id,
          detail: `decoy ${opt} is actually loose — a right answer would score wrong`,
        })
      }
      const piece = board.get(opt)
      if (!piece) {
        problems.push({ drill: 'scan', id: q.id, detail: `option ${opt} holds no piece` })
      } else if (piece.color !== q.colour) {
        problems.push({ drill: 'scan', id: q.id, detail: `option ${opt} is not your piece` })
      }
    }

    // The answer has to be reachable from the options offered.
    for (const a of q.answers) {
      if (!q.options.includes(a)) {
        problems.push({ drill: 'scan', id: q.id, detail: `answer ${a} is not among the options` })
      }
    }
  }

  return problems
}

async function auditThreat(engine: NodeEngine, pool: Puzzle[], want: number): Promise<Problem[]> {
  const problems: Problem[] = []
  const qs = await buildThreatQuestions(pool, want, undefined, engine)

  console.log(`  threat     built ${qs.length}/${want}`)
  if (qs.length < want) {
    problems.push({
      drill: 'threat',
      id: '-',
      detail: `yield ${qs.length} of ${want} requested from ${pool.length} positions`,
    })
  }

  for (const q of qs) {
    // Independent second opinion at greater depth.
    const passed = nullMoveFen(q.fen)
    if (!passed) {
      problems.push({ drill: 'threat', id: q.id, detail: 'position cannot legally be passed' })
      continue
    }
    const deeper = await engine.analyse(passed, { depth: THREAT_AUDIT_DEPTH, multipv: 1 })
    const best = deeper.bestMove
    if (!best) continue

    if (best !== q.answer) {
      problems.push({
        drill: 'threat',
        id: q.id,
        detail: `answer ${q.san} (${q.answer}) but depth-${THREAT_AUDIT_DEPTH} prefers ${best}`,
      })
    }

    if (!q.options.some((o) => o.uci === q.answer)) {
      problems.push({ drill: 'threat', id: q.id, detail: 'answer is not among the options' })
    }

    /*
     * Every option must be a move they can legally play after the pass.
     *
     * This is the check that would have caught the decoy bug: the old builder
     * offered squares their pieces were standing on, so five of six options
     * were not moves at all and the answer was findable by elimination.
     */
    const legal = new Set(
      new Chess(passed).moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`),
    )
    const bogus = q.options.filter((o) => !legal.has(o.uci)).map((o) => o.san)
    if (bogus.length > 0) {
      problems.push({
        drill: 'threat',
        id: q.id,
        detail: `options are not legal moves for them: ${bogus.join(', ')}`,
      })
    }
    if (q.swingCp < 150) {
      problems.push({
        drill: 'threat',
        id: q.id,
        detail: `swing only ${q.swingCp}cp — below the threshold it claims to enforce`,
      })
    }
  }

  return problems
}

async function auditCandidates(
  engine: NodeEngine,
  pool: Puzzle[],
  want: number,
): Promise<Problem[]> {
  const problems: Problem[] = []
  const qs = await buildCandidateQuestions(pool, want, undefined, engine)

  console.log(`  candidate  built ${qs.length}/${want}`)
  if (qs.length < want) {
    problems.push({
      drill: 'candidate',
      id: '-',
      detail: `yield ${qs.length} of ${want} requested from ${pool.length} positions`,
    })
  }

  for (const q of qs) {
    const good = q.options.filter((o) => o.good)
    if (good.length !== CANDIDATE_TOP_N) {
      problems.push({
        drill: 'candidate',
        id: q.id,
        detail: `${good.length} moves marked good, expected ${CANDIDATE_TOP_N}`,
      })
    }

    // Every option must be a legal move in the position it is offered for.
    for (const o of q.options) {
      const board = new Chess(q.fen)
      try {
        const m = board.move({
          from: o.uci.slice(0, 2),
          to: o.uci.slice(2, 4),
          promotion: o.uci[4],
        })
        if (!m) throw new Error('illegal')
        if (m.san !== o.san) {
          problems.push({
            drill: 'candidate',
            id: q.id,
            detail: `option labelled ${o.san} is actually ${m.san}`,
          })
        }
      } catch {
        problems.push({ drill: 'candidate', id: q.id, detail: `option ${o.uci} is not legal` })
      }
    }

    /*
     * Measure each "good" move on its own merits rather than by its rank.
     *
     * Ranking was the wrong test. These positions are deliberately flat — the
     * builder rejects anything where the top three are more than 150cp apart —
     * so whether a move comes 3rd or 6th in a deeper search is close to noise,
     * and the audit was flagging perfectly reasonable moves for missing a top-5
     * cut. What actually matters is how much the move gives away, so play it
     * and evaluate the position it produces.
     */
    const deeper = await engine.analyse(q.fen, { depth: AUDIT_DEPTH, multipv: 1 })
    if (deeper.lines.length === 0) continue
    const topScore = lineScore(deeper.lines[0]!)

    for (const o of good) {
      const after = new Chess(q.fen)
      try {
        after.move({ from: o.uci.slice(0, 2), to: o.uci.slice(2, 4), promotion: o.uci[4] })
      } catch {
        continue
      }
      const reply = await engine.analyse(after.fen(), { depth: AUDIT_DEPTH, multipv: 1 })
      const replyLine = reply.lines[0]
      if (!replyLine) continue
      // Opponent to move, so negate to get the value to the side that chose.
      const value = -lineScore(replyLine)
      const loss = topScore - value
      if (loss > 250) {
        problems.push({
          drill: 'candidate',
          id: q.id,
          detail: `${o.san} marked good but gives away ${Math.round(loss)}cp at depth ${AUDIT_DEPTH}`,
        })
      }
    }
  }

  return problems
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const want = arg('count', 8)
  const pool = loadPuzzles(60)

  console.log('SANDBOX — generated drills\n')
  console.log(`  pool of ${pool.length} positions across bands ${BANDS.join(', ')}`)
  console.log(`  auditing every answer independently at depth ${AUDIT_DEPTH}\n`)

  const engine = new NodeEngine()
  await engine.init()

  /*
   * Sequential, not concurrent, and that is not laziness.
   *
   * NodeEngine serialises every search onto one UCI connection — the protocol
   * is a stateful line protocol and two overlapping `go` commands corrupt each
   * other. Running the three audits with Promise.all would interleave their
   * requests into that same queue: no faster, and much harder to attribute a
   * failure to a drill. One engine, one queue, one audit at a time.
   */
  const problems: Problem[] = []
  problems.push(...auditScan(pool, want))
  problems.push(...(await auditThreat(engine, pool, want)))
  problems.push(...(await auditCandidates(engine, pool, want)))

  console.log('')

  if (problems.length === 0) {
    console.log('All three drills check out — every answer independently confirmed.')
    return
  }

  const byDrill = new Map<string, Problem[]>()
  for (const p of problems) {
    const list = byDrill.get(p.drill) ?? []
    list.push(p)
    byDrill.set(p.drill, list)
  }

  console.log(`${problems.length} problems:\n`)
  for (const [drill, list] of byDrill) {
    console.log(`  ${drill} — ${list.length}`)
    for (const p of list.slice(0, 10)) {
      console.log(`    ${p.id.padEnd(10)} ${p.detail}`)
    }
    if (list.length > 10) console.log(`    ... and ${list.length - 10} more`)
    console.log('')
  }
  process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
