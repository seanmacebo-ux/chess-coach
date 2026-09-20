/**
 * Do the bot styles actually play differently?
 *
 * Sean: "our bots are too easy and simple, and we're not uncovering the big
 * part of them." The strength dial is measured by scripts/calibrate.ts; this
 * measures the other axis, which nothing has ever checked.
 *
 * The suspicion came from the calibration report: at band 1400, `positional`
 * and `tactical` came back with IDENTICAL average loss (46.4) and identical
 * match score (0.5) over four games each. Those two styles are near-opposites
 * in styleWeight() — one favours quiet moves and penalises captures, the
 * other does the reverse — so identical numbers are either a coincidence or
 * the personalities are cosmetic.
 *
 * WHAT IS MEASURED. Over a spread of real middlegame positions, each style is
 * given the same engine candidates and asked which move it would most likely
 * play. Two numbers come out:
 *
 *   AGREEMENT  — how often two styles land on the same move. A pair that
 *                agrees almost always is one personality wearing two names.
 *
 *   CHARACTER  — how often a style's pick shows the trait it is named for:
 *                aggressive and tactical should capture and check more than
 *                positional does, positional should play quiet moves more.
 *                A style can differ from the others and still not be the
 *                thing it says on the tin, which is the more embarrassing
 *                failure.
 *
 *   npm run verify:style -- [--depth 12]
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { weighCandidates, describeMove } from '../src/engine/policy'
import { STYLES, type Style } from '../src/engine/types'

const DEPTH = (() => {
  const i = process.argv.indexOf('--depth')
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : 12
})()

const BAND = 1400

/**
 * Positions with something to choose between: a real game walked from the
 * opening into the middlegame, sampled every few plies. A style dial cannot
 * show itself in a position with one sensible move.
 */
const GAMES = [
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7',
  'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7',
  'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5',
]

function positions(): string[] {
  const out: string[] = []
  for (const line of GAMES) {
    const board = new Chess()
    const sans = line.split(' ')
    for (let i = 0; i < sans.length; i++) {
      board.move(sans[i]!)
      if (i >= 9 && i % 3 === 0) out.push(board.fen())
    }
  }
  return out
}

/** The move a style is most likely to play — its weight peak, not a sample. */
function pick(fen: string, lines: Parameters<typeof weighCandidates>[1], style: Style): string | null {
  const cands = weighCandidates(fen, lines, BAND, style)
  if (cands.length === 0) return null
  return cands.reduce((a, c) => (c.weight > a.weight ? c : a)).uci
}

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

async function main() {
  const engine = new NodeEngine()
  await engine.init()
  const fens = positions()
  const styles = STYLES.map((s) => s.id).filter((s) => s !== 'human')

  const picks = new Map<Style, string[]>(styles.map((s) => [s, []]))
  const traits = new Map<Style, { forcing: number; quiet: number }>(
    styles.map((s) => [s, { forcing: 0, quiet: 0 }]),
  )

  for (const fen of fens) {
    const a = await engine.analyse(fen, { depth: DEPTH, multipv: 8 })
    if (a.lines.length < 3) continue
    for (const s of styles) {
      const uci = pick(fen, a.lines, s)
      picks.get(s)!.push(uci ?? '')
      if (!uci) continue
      const f = describeMove(fen, uci)
      if (!f) continue
      const t = traits.get(s)!
      if (f.givesCheck || f.isCapture) t.forcing++
      if (f.isQuiet) t.quiet++
    }
  }

  const n = picks.get(styles[0]!)!.length
  console.log(`\n  ${n} positions, depth ${DEPTH}, band ${BAND}\n`)

  /* ------------------------------------------------------ agreement */
  console.log('  agreement between styles')
  let worstPair = { pair: '', rate: 0 }
  for (let i = 0; i < styles.length; i++) {
    for (let j = i + 1; j < styles.length; j++) {
      const a = picks.get(styles[i]!)!
      const b = picks.get(styles[j]!)!
      const same = a.filter((m, k) => m === b[k]).length
      const rate = same / Math.max(1, a.length)
      console.log(`    ${styles[i]!.padEnd(11)} vs ${styles[j]!.padEnd(11)} ${(rate * 100).toFixed(0)}%`)
      if (rate > worstPair.rate) worstPair = { pair: `${styles[i]} / ${styles[j]}`, rate }
    }
  }

  /* -------------------------------------------------------- character */
  console.log('\n  character of the moves chosen')
  for (const s of styles) {
    const t = traits.get(s)!
    console.log(
      `    ${s.padEnd(11)} forcing ${String(Math.round((t.forcing / n) * 100)).padStart(3)}%` +
      `   quiet ${String(Math.round((t.quiet / n) * 100)).padStart(3)}%`,
    )
  }
  console.log('')

  /*
   * Two styles that pick the same move nearly every time are one
   * personality with two labels, whatever their weight tables say.
   */
  check('no two styles are near-identical', worstPair.rate < 0.85,
        `${worstPair.pair} agree ${(worstPair.rate * 100).toFixed(0)}%`)

  const forcing = (s: Style) => traits.get(s)!.forcing / Math.max(1, n)
  const quiet = (s: Style) => traits.get(s)!.quiet / Math.max(1, n)

  check('aggressive forces more than positional',
        forcing('aggressive') > forcing('positional'),
        `${(forcing('aggressive') * 100).toFixed(0)}% vs ${(forcing('positional') * 100).toFixed(0)}%`)
  check('tactical forces more than solid',
        forcing('tactical') > forcing('solid'),
        `${(forcing('tactical') * 100).toFixed(0)}% vs ${(forcing('solid') * 100).toFixed(0)}%`)
  check('positional plays more quiet moves than aggressive',
        quiet('positional') > quiet('aggressive'),
        `${(quiet('positional') * 100).toFixed(0)}% vs ${(quiet('aggressive') * 100).toFixed(0)}%`)

  console.log(fail === 0 ? '\n✓ the styles are genuinely different' : `\n✗ ${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
