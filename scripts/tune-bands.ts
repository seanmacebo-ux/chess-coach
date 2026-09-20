/**
 * Solve for the band numbers instead of guessing at them.
 *
 * scripts/calibrate.ts plays games and reports what each band actually sheds.
 * It is the honest measurement and it takes over an hour, which makes it
 * useless as a tuning loop — you cannot try six ideas at ten minutes a band.
 *
 * This computes the same quantity ANALYTICALLY. The policy is a softmax over
 * scored candidates plus a blunder path, and both have closed forms once the
 * candidate evaluations are known: the expected centipawn loss of a move is
 * just the probability-weighted mean of the losses on offer. So one engine
 * pass over a set of positions gives every band's expected ACPL at any
 * temperature, and a bisection finds the temperature that hits its target.
 *
 * WHAT THE MEASUREMENT SAYS, AND WHY BOTH KNOBS MOVE.
 *
 * Every band plays STRONGER than its label — 800 sheds 70cp against a 150
 * target — which means a bot labelled 800 is really something like 1100. That
 * is not a cosmetic problem: rating stakes are computed from the label, so
 * beating an "800" that is really 1100 pays too little and losing to it costs
 * too much, and the user's rating is quietly held down.
 *
 * And the shape is wrong as well as the level. The blunder path does not play
 * a slightly bad move, it plays a move the engine never shortlisted — a
 * genuinely random legal move. At 9.3% that is one move in eleven being
 * arbitrary, so the bot plays three good moves and then hands over a rook.
 * Humans at 800 are not strong players with a tic; they are consistently
 * loose. Sean's words for the result were "too easy and simple".
 *
 * So the recommendation raises temperature (steady, human-sized errors) and
 * cuts blunderChance (fewer slot-machine moments) and lands on the same
 * target ACPL from a more believable direction.
 *
 *   npm run tune-bands -- [--depth 10] [--positions 24]
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { lineScore, BANDS, type Band } from '../src/engine/types'
import { bandProfile } from '../src/engine/policy'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const WANT = arg('positions', 24)

/**
 * How much harder real games are than this model says.
 *
 * The model was applied once and the game-playing calibration caught it
 * overshooting by a lot: band 800 solved to a predicted 150 and measured
 * 246.9 in real play, band 1000 predicted 120 and measured 183.7. Ratios of
 * 1.65 and 1.53.
 *
 * The reason is compounding, and it is not a bug in the arithmetic. This
 * model evaluates independent positions taken from master games, where the
 * candidate moves are close together because the position is sound. A loose
 * bot does not stay in positions like that: one sloppy move produces a worse
 * position, where the spread between best and tenth-best is far wider, so
 * the NEXT sloppy move costs more than the model's average says. Error feeds
 * on itself and a per-position expectation cannot see it.
 *
 * So the solver aims at target/REALISM and the measurement decides whether
 * that was right. This number is empirical — two bands, one run — and it is
 * meant to be re-derived whenever calibrate.ts disagrees with it again.
 */
const REALISM = arg('realism', 1.6)

/**
 * Enough of the move list that the "wild" tail is real.
 *
 * The blunder path samples from legal moves OUTSIDE the shortlist, so their
 * cost has to be known too. 40 lines covers most or all of a middlegame
 * position; anything beyond it is ignored, which biases the wild cost
 * slightly low and therefore the recommendation slightly conservative.
 */
const MULTIPV = arg('multipv', 40)

/**
 * How many candidates each band chooses from.
 *
 * A first run let the search widen the pool until the target became
 * reachable, and produced temperatures that went UP from 800 to 1000 — the
 * problem is under-determined, because pool size and temperature trade off
 * against each other and many pairs hit the same ACPL. Non-monotonic numbers
 * in a difficulty table are a bug waiting to happen even when they are
 * arithmetically fine.
 *
 * So the pool is fixed on a smooth schedule that says something in plain
 * terms — a weak player considers a lot of bad moves, a strong one has
 * already discarded them — and only temperature is solved for.
 */
const POOL: Record<Band, number> = {
  800: 28, 1000: 24, 1200: 20, 1400: 16, 1600: 12, 1800: 9, 2000: 7, 2200: 5,
}

const GAMES = [
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7 Nbd2 cxd4',
  'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7 Bd3 e5',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5',
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 h6 Bh4 dxc4 e4 g5 Bg3 b5 Be2 Bb7 O-O Nbd7 Qc2 Qb6',
]

function positions(): string[] {
  const out: string[] = []
  for (const line of GAMES) {
    const b = new Chess()
    const sans = line.split(' ')
    for (let i = 0; i < sans.length; i++) {
      b.move(sans[i]!)
      if (i >= 8) out.push(b.fen())
    }
  }
  return out.slice(0, WANT)
}

/** One position, reduced to the costs the policy has to choose between. */
interface Shape {
  /** Losses of the shortlisted candidates, in centipawns. */
  short: number[]
  /** Mean loss of the legal moves outside the shortlist. */
  wild: number
}

/** Expected loss of the softmax over `losses` at temperature `t`. */
function softmaxLoss(losses: number[], t: number): number {
  let num = 0
  let den = 0
  for (const l of losses) {
    const w = Math.exp(-l / Math.max(1, t))
    num += w * l
    den += w
  }
  return den > 0 ? num / den : 0
}

function expectedAcpl(shapes: Shape[], t: number, blunder: number): number {
  let total = 0
  for (const s of shapes) {
    total += (1 - blunder) * softmaxLoss(s.short, t) + blunder * s.wild
  }
  return total / Math.max(1, shapes.length)
}

/** Temperature at which the policy sheds `target`, or null if unreachable. */
function solveTemperature(shapes: Shape[], target: number, blunder: number): number | null {
  let lo = 5
  let hi = 4000
  if (expectedAcpl(shapes, hi, blunder) < target) return null
  if (expectedAcpl(shapes, lo, blunder) > target) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (expectedAcpl(shapes, mid, blunder) < target) lo = mid
    else hi = mid
  }
  return Math.round((lo + hi) / 2)
}

async function main() {
  const engine = new NodeEngine()
  await engine.init()
  const fens = positions()
  console.log(`  ${fens.length} positions, multipv ${MULTIPV}\n`)

  /*
   * One pass PER DEPTH, not one pass shared by every band.
   *
   * Each band generates its candidates at its own search depth, and a depth-6
   * list is a materially worse list than a depth-13 one. Measuring every band
   * against a single deep analysis would flatter the weak ones and make the
   * pool look better than the pool they actually draw from.
   */
  const depths = [...new Set((BANDS as Band[]).map((b) => bandProfile(b).depth))]
  const byDepth = new Map<number, number[][]>()
  for (const d of depths) {
    const rows: number[][] = []
    for (const fen of fens) {
      const a = await engine.analyse(fen, { depth: d, multipv: MULTIPV })
      const scored = a.lines.filter((l) => l.pv.length > 0).map((l) => lineScore(l))
      if (scored.length < 6) continue
      const best = Math.max(...scored)
      rows.push(scored.map((s) => Math.max(0, best - s)))
    }
    byDepth.set(d, rows)
    process.stdout.write(`  depth ${d} analysed\r`)
  }
  console.log('                        ')

  const shapesFor = (losses: number[][], multipv: number): Shape[] =>
    losses.map((l) => {
      const short = l.slice(0, multipv)
      const tail = l.slice(multipv)
      return {
        short,
        // Legal moves beyond the 40 lines we have are at least as bad as the
        // worst we saw, so this under-states the blunder cost and therefore
        // errs towards a conservative recommendation.
        wild: tail.length > 0
          ? tail.reduce((a, c) => a + c, 0) / tail.length
          : (l[l.length - 1] ?? 0),
      }
    })

  console.log(`  aiming at target / ${REALISM} — see REALISM above\n`)
  console.log('  band  target    aim    now   |  multipv     blunder         temperature')
  const rows: string[] = []
  for (const band of BANDS as Band[]) {
    const p = bandProfile(band)
    const losses = byDepth.get(p.depth) ?? []
    const nowAcpl = expectedAcpl(shapesFor(losses, p.multipv), p.temperature, p.blunderChance)
    /* What the model must predict for real play to land on the target. */
    const aim = p.targetAcpl / REALISM

    /*
     * Blunders are cut to roughly a third. A real 800 hangs a piece, but not
     * every eleventh move, and the rest of the loss should come from playing
     * consistently loose rather than from a slot machine.
     */
    /*
     * Idempotent: once a band is at or under the floor it is left alone.
     * Without this the tool cuts by a third EVERY run, so running it twice
     * recommends half of what it recommended the first time and reports the
     * targets it just hit as unreachable. A tuner whose output depends on how
     * many times you have run it is not a measurement.
     */
    const FLOOR = 0.022
    const wanted =
      p.blunderChance <= FLOOR
        ? p.blunderChance
        : Math.max(FLOOR, Math.round(p.blunderChance * 0.35 * 1000) / 1000)

    /*
     * WIDEN THE POOL UNTIL THE TARGET IS REACHABLE.
     *
     * This is the finding the first run produced, and it is the actual
     * reason every band plays over its label: at multipv 10 the shortlist is
     * a strong engine's top ten moves, and all ten are decent. No amount of
     * temperature makes a weak player out of a choice between ten good
     * moves — the measurement said "unreachable" for seven of the eight
     * bands, meaning even uniform sampling over that pool is too strong.
     *
     * The pool has to contain moves a weak player would actually consider,
     * which means going deeper down the list, not hotter over the top of it.
     */
    const multipv = POOL[band]
    /*
     * Cutting blunders removes loss, and at the bottom of the ladder there
     * may not be enough left in the candidate pool to make it up: you cannot
     * shed 150cp a move by choosing among twenty-eight engine-ranked moves,
     * however hot the sampling. When the cut makes the target unreachable the
     * band keeps the blunder rate it has, because a recommendation that
     * cannot hit its own target is not a recommendation.
     */
    let newBlunder = wanted
    let temp = solveTemperature(shapesFor(losses, multipv), aim, newBlunder)
    if (temp === null && wanted !== p.blunderChance) {
      newBlunder = p.blunderChance
      temp = solveTemperature(shapesFor(losses, multipv), aim, newBlunder)
    }

    const reached = temp !== null
    const newTemp = temp ?? p.temperature
    console.log(
      `  ${String(band).padStart(4)}  ${String(p.targetAcpl).padStart(6)}` +
      `  ${aim.toFixed(0).padStart(5)}  ${nowAcpl.toFixed(1).padStart(5)}   |` +
      `  ${String(p.multipv).padStart(2)} → ${String(multipv).padStart(2)}` +
      `    ${p.blunderChance.toFixed(3)} → ${newBlunder.toFixed(3)}` +
      `    ${String(p.temperature).padStart(4)} → ${String(newTemp).padStart(4)}` +
      (reached ? '' : '   STILL UNREACHABLE'),
    )
    rows.push(
      `  ${band}: { targetAcpl: ${p.targetAcpl}, temperature: ${newTemp}, ` +
      `blunderChance: ${newBlunder}, depth: ${p.depth}, multipv: ${multipv} },`,
    )
  }

  console.log('\n  suggested PROFILES:\n')
  for (const r of rows) console.log(r)
  console.log('')
  process.exit(0)
}

void main()
