/**
 * WHERE does a bot shed its centipawns, and does the shedding look human?
 *
 * measure-acpl.ts answers "how much" and stops there. A single average hides
 * the two complaints that actually get made about these bots: that they are
 * weirdly perfect in some positions and absurd in others, and that a bad move
 * from them rarely resembles a bad move from a person.
 *
 * So this splits the same measurement three ways:
 *
 *   BY PHASE. A human's accuracy moves with the position — sharper play in
 *   quiet endings, worse play when it is complicated. If a bot sheds 150cp
 *   per move in the middlegame and 4cp in the endgame, its rating is a
 *   fiction: you lose the opening to an 800 and then cannot beat a 2200.
 *
 *   BY SOURCE. A softmax reaching a loose move and the blunder path firing a
 *   uniformly random legal move both land in the average as "a big loss".
 *   Only one of them looks like a mistake; the other looks like a bug.
 *
 *   BY ROOM. Temperature can only spread probability across the candidates the
 *   search returns. If best and worst candidate are four centipawns apart, no
 *   temperature makes the bot weak there — and no amount of tuning will fix
 *   it, which is worth knowing before tuning again.
 *
 *   npm run diag:bots -- --bands 800,1600 --games 8
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { lineScore } from '../src/engine/types'
import { profileFor, chooseMoveDetailed } from '../src/engine/policy'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const GAMES = arg('games', 8)
const MAX_PLIES = arg('max-plies', 160)
const REF_DEPTH = arg('ref-depth', 14)

/*
 * Raw Elos, NOT snapped to a band. Snapping is the bug this whole diagnostic
 * exists to measure: asking for 350 and being handed the 800 profile is how
 * three of the roster's bots turned out to be the same opponent.
 */
const RATINGS = (() => {
  const i = process.argv.indexOf('--bands')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  return [...new Set((raw ?? '350,800,1400,2000').split(',').map(Number).filter(Number.isFinite))]
})()

const EVAL_CAP = 1000
const clamp = (cp: number) => Math.max(-EVAL_CAP, Math.min(EVAL_CAP, cp))

const engine = new NodeEngine()

type Phase = 'opening' | 'middlegame' | 'endgame'

/**
 * Same rule the coach uses, so a phase means one thing across the app:
 * opening is the first twelve moves, endgame is once the heavy material is
 * gone, everything else is the middlegame.
 */
function phaseOf(board: Chess): Phase {
  const plies = board.history().length
  if (plies < 24) return 'opening'
  let value = 0
  for (const row of board.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k' || sq.type === 'p') continue
      value += { n: 3, b: 3, r: 5, q: 9 }[sq.type] ?? 0
    }
  }
  return value <= 14 ? 'endgame' : 'middlegame'
}

interface Sample {
  loss: number
  phase: Phase
  source: 'pool' | 'wild' | 'forced'
  spread: number
  candidates: number
  /** Did this move hang something that was not hanging before? null = can't tell. */
  hangs: boolean | null
}

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

/**
 * The cheapest honest test for "a move no person would play": the side to
 * move can take something worth 300cp or more and the recapture does not get
 * it back. Not a full static exchange evaluation — it only looks one capture
 * deep — but it catches a hung piece, which is the shape being hunted.
 */
function somethingHangs(fen: string): boolean {
  const board = new Chess(fen)
  for (const m of board.moves({ verbose: true })) {
    if (!m.captured) continue
    const won = VALUE[m.captured] ?? 0
    if (won < 300) continue
    board.move(m)
    const recapture = board
      .moves({ verbose: true })
      .filter((r) => r.to === m.to)
      .map((r) => VALUE[r.captured ?? 'p'] ?? 0)
    const back = recapture.length > 0 ? Math.max(...recapture) : 0
    board.undo()
    if (won - back >= 300) return true
  }
  return false
}

/**
 * Did THIS move hang something, as opposed to leaving something that was
 * already hanging?
 *
 * The first version of this compared the position after the move against the
 * position before it — but before the move it is the bot on move, so that
 * asked "could the bot win material" and compared it against "can the
 * opponent win material". Two different questions, and the difference between
 * them was being reported as a statistic.
 *
 * The right baseline is the same position with the other side to move, which
 * is a null move. chess.js will not make one, so the FEN is edited directly.
 * It is refused when the mover is in check (a null move is not legal there
 * and the resulting FEN is not a chess position), and in that case the move
 * is simply not counted either way.
 */
function hangsSomethingNew(fenBefore: string, fenAfter: string): boolean | null {
  if (!somethingHangs(fenAfter)) return false
  const parts = fenBefore.split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  let already: boolean
  try {
    const probe = new Chess(fenBefore)
    if (probe.isCheck()) return null
    already = somethingHangs(parts.join(' '))
  } catch {
    return null
  }
  return !already
}

async function lossOf(fenBefore: string, uci: string): Promise<number | null> {
  const before = await engine.analyse(fenBefore, { depth: REF_DEPTH, multipv: 1 })
  const bestLine = before.lines[0]
  if (!bestLine) return null
  const best = clamp(lineScore(bestLine))

  const board = new Chess(fenBefore)
  try {
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return null
  }
  if (board.isGameOver()) return board.isCheckmate() ? 0 : null

  const after = await engine.analyse(board.fen(), { depth: REF_DEPTH, multipv: 1 })
  const afterLine = after.lines[0]
  if (!afterLine) return null
  return Math.max(0, best - clamp(-lineScore(afterLine)))
}

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

async function play(band: number): Promise<Sample[]> {
  const profile = profileFor(band)
  const out: Sample[] = []

  for (let g = 0; g < GAMES; g++) {
    await engine.newGame()
    const board = new Chess()
    const rngW = seeded(0x1234 + g * 7919)
    const rngB = seeded(0x9abc + g * 104729)

    while (!board.isGameOver() && board.history().length < MAX_PLIES) {
      const fen = board.fen()
      const phase = phaseOf(board)
      const rng = board.turn() === 'w' ? rngW : rngB
      const a = await engine.analyse(fen, { depth: profile.depth, multipv: profile.multipv })
      const choice = chooseMoveDetailed(fen, a.lines, band, 'human', rng)
      const uci = choice.uci ?? a.bestMove
      if (!uci) break

      const loss = await lossOf(fen, uci)
      try {
        board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      } catch {
        break
      }
      if (loss !== null) {
        out.push({
          loss,
          phase,
          source: choice.source,
          // Mate scores live 100,000 away from everything else, so one mate
          // in the pool made "room" read as twelve thousand centipawns. The
          // quantity wanted is how far apart the ordinary moves are.
          spread: Math.min(1000, choice.spread),
          candidates: choice.candidates,
          hangs: hangsSomethingNew(fen, board.fen()),
        })
      }
      process.stdout.write(`    ${band}: game ${g + 1}/${GAMES}, ${out.length} moves   \r`)
    }
  }
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0)
const ci95 = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, c) => a + (c - m) ** 2, 0) / (xs.length - 1)
  return 1.96 * Math.sqrt(v / xs.length)
}
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : '0.0')

async function main() {
  await engine.init()
  console.log(`\n  ${GAMES} self-play games per band, referee depth ${REF_DEPTH}`)

  for (const band of RATINGS) {
    const s = await play(band)
    const target = profileFor(band).targetAcpl
    const losses = s.map((x) => x.loss)
    console.log(`\n  ─── rating ${band} ${'─'.repeat(50)}`)
    console.log(
      `  overall  ${mean(losses).toFixed(1)} ± ${ci95(losses).toFixed(0)} acpl ` +
        `(target ${target}), ${s.length} moves`,
    )

    console.log('\n  by phase            acpl        moves   room *   forced')
    for (const p of ['opening', 'middlegame', 'endgame'] as Phase[]) {
      const rows = s.filter((x) => x.phase === p)
      if (rows.length === 0) continue
      const l = rows.map((x) => x.loss)
      console.log(
        `  ${p.padEnd(14)} ${mean(l).toFixed(1).padStart(7)} ± ${ci95(l).toFixed(0).padEnd(4)}` +
          ` ${String(rows.length).padStart(6)}` +
          ` ${mean(rows.map((x) => x.spread)).toFixed(0).padStart(6)}` +
          ` ${pct(rows.filter((x) => x.candidates <= 1).length, rows.length).padStart(7)}%`,
      )
    }
    console.log('  * room = centipawns between the best and worst candidate the search offered.')
    console.log('    No room means temperature has nothing to work with and the bot plays best.')

    console.log('\n  by source           acpl        moves    share   hangs a piece')
    for (const src of ['pool', 'wild', 'forced'] as const) {
      const rows = s.filter((x) => x.source === src)
      if (rows.length === 0) continue
      const l = rows.map((x) => x.loss)
      console.log(
        `  ${src.padEnd(14)} ${mean(l).toFixed(1).padStart(7)} ± ${ci95(l).toFixed(0).padEnd(4)}` +
          ` ${String(rows.length).padStart(6)}` +
          ` ${pct(rows.length, s.length).padStart(7)}%` +
          ` ${pct(rows.filter((x) => x.hangs === true).length, rows.filter((x) => x.hangs !== null).length).padStart(11)}%`,
      )
    }
    const shed = s.reduce((a, c) => a + c.loss, 0)
    const wildShed = s.filter((x) => x.source === 'wild').reduce((a, c) => a + c.loss, 0)
    console.log(
      `\n  the blunder path is ${pct(s.filter((x) => x.source === 'wild').length, s.length)}% of ` +
        `moves and ${pct(wildShed, shed)}% of everything lost.`,
    )
    console.log(
      `  moves that hang something: ${pct(s.filter((x) => x.hangs).length, s.length)}% overall.`,
    )
  }
  console.log('')
  process.exit(0)
}

void main()
