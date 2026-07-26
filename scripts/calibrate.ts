/**
 * The Elo sandbox.
 *
 * Every rating band in policy.ts is currently a GUESS. This harness turns the
 * guess into a measurement by isolating each band and asking three questions:
 *
 *   1. ACPL       Does "1400" actually shed ~75 centipawns a move like a real
 *                 1400 does? Measured against a deeper reference search, not
 *                 against the bot's own shallow view of itself.
 *
 *   2. LADDER     Does 1600 beat 1400 at roughly the rate Elo predicts (~76%)?
 *                 A dial where every setting plays the same strength is not a
 *                 difficulty dial.
 *
 *   3. STYLE      Do the five styles at ONE band land at similar strength?
 *                 They must. If "aggressive" is quietly 200 points weaker,
 *                 style has become a secret difficulty slider and every
 *                 training signal downstream is corrupted.
 *
 * This is Loop A — the bots learning to be honest about their rating. It is
 * deliberately separate from Loop B (the app learning Sean), because a bot
 * that gets easier when you lose destroys the training value of the whole app.
 *
 * REPORT ONLY. This never writes back to PROFILES. A handful of games is
 * noise, and silently auto-tuning strength from noise is exactly the failure
 * mode worth avoiding. Read the report, then tune deliberately.
 *
 *   npm run calibrate -- --games 6 --ref-depth 12
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

import { NodeEngine } from './lib/engine-node'
import { bandProfile, chooseMove, seededRng, type Rng } from '../src/engine/policy'
import { BANDS, STYLES, lineScore, type Band, type Style } from '../src/engine/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ----------------------------------------------------------------- args */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

const GAMES = arg('games', 4)
const MAX_PLIES = arg('max-plies', 200)
const STYLE_BAND = arg('style-band', 1400) as Band
const QUICK = process.argv.includes('--quick')
/** Eval margin (cp) above which a ply-capped game is scored as won. */
const ADJUDICATE_CP = arg('adjudicate-cp', 150)

/**
 * The referee must out-search every player, or the players look superhuman:
 * a move only registers as a "loss" if the reference can see something the
 * player couldn't. Reference depth below a band's own search depth silently
 * reports near-zero ACPL for that band.
 */
const DEEPEST_BAND_DEPTH = Math.max(...BANDS.map((b) => bandProfile(b).depth))
const REQUESTED_REF_DEPTH = arg('ref-depth', 16)
const REF_DEPTH = Math.max(REQUESTED_REF_DEPTH, DEEPEST_BAND_DEPTH + 3)
if (REF_DEPTH !== REQUESTED_REF_DEPTH) {
  console.warn(
    `[calibrate] ref-depth raised ${REQUESTED_REF_DEPTH} -> ${REF_DEPTH} ` +
      `(deepest band searches at ${DEEPEST_BAND_DEPTH}; referee must out-search it)`,
  )
}

/* ------------------------------------------------------------- plumbing */

const engine = new NodeEngine()

interface MoveRecord {
  /** Centipawns lost versus the reference-best move. Always >= 0. */
  loss: number
  band: Band
  style: Style
}

/**
 * Loss for the move actually played, measured at REF_DEPTH.
 *
 * Both evaluations are taken from the MOVER's point of view. UCI reports
 * side-to-move POV, so the eval after the move (opponent to move) is negated.
 * Getting this sign wrong silently reports every bot as superhuman, which is
 * the easiest way to produce a confident, wrong calibration.
 */
/**
 * Clamp an evaluation before differencing.
 *
 * lineScore maps a forced mate to ±100,000. Differencing raw scores means a
 * single mate anywhere in a game produces a ~99,000cp "loss" and swamps the
 * average — the first run of this harness reported 947 ACPL for a bot whose
 * real figure was double digits. Capping at ±1000cp is the conventional fix
 * (it's what Lichess does): past a decisive advantage, extra centipawns carry
 * no information about move quality, and a losing position shouldn't punish
 * every subsequent move.
 */
const EVAL_CAP = 1000
const clampEval = (cp: number) => Math.max(-EVAL_CAP, Math.min(EVAL_CAP, cp))

async function lossOf(fenBefore: string, uci: string): Promise<number | null> {
  const before = await engine.analyse(fenBefore, { depth: REF_DEPTH, multipv: 1 })
  const bestLine = before.lines[0]
  if (!bestLine) return null
  const bestScore = clampEval(lineScore(bestLine))

  const board = new Chess(fenBefore)
  try {
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return null
  }
  if (board.isGameOver()) {
    // Terminal position — a mate delivered is not a "loss".
    return board.isCheckmate() ? 0 : null
  }

  const after = await engine.analyse(board.fen(), { depth: REF_DEPTH, multipv: 1 })
  const afterLine = after.lines[0]
  if (!afterLine) return null
  const playedScore = clampEval(-lineScore(afterLine))

  return Math.max(0, bestScore - playedScore)
}

interface GameResult {
  /** 1 = white won, 0 = black won, 0.5 = draw. */
  score: number
  plies: number
  moves: MoveRecord[]
  reason: string
}

async function playGame(
  white: { band: Band; style: Style },
  black: { band: Band; style: Style },
  seed: number,
  measure: boolean,
): Promise<GameResult> {
  await engine.newGame()
  const board = new Chess()
  const rngW: Rng = seededRng(seed)
  const rngB: Rng = seededRng(seed ^ 0x9e3779b9)
  const moves: MoveRecord[] = []

  while (!board.isGameOver() && board.history().length < MAX_PLIES) {
    const side = board.turn() === 'w' ? white : black
    const rng = board.turn() === 'w' ? rngW : rngB
    const profile = bandProfile(side.band)
    const fen = board.fen()

    const analysis = await engine.analyse(fen, {
      depth: profile.depth,
      multipv: profile.multipv,
    })
    const uci = chooseMove(fen, analysis.lines, side.band, side.style, rng) ?? analysis.bestMove
    if (!uci) break

    if (measure) {
      const loss = await lossOf(fen, uci)
      if (loss !== null) moves.push({ loss, band: side.band, style: side.style })
    }

    try {
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    } catch {
      break
    }
  }

  let score = 0.5
  let reason = 'draw'
  if (board.isCheckmate()) {
    score = board.turn() === 'w' ? 0 : 1
    reason = 'checkmate'
  } else if (board.isStalemate()) reason = 'stalemate'
  else if (board.isInsufficientMaterial()) reason = 'insufficient material'
  else if (board.isDraw()) reason = 'draw'
  else {
    // Hit the ply cap. Scoring this as a draw makes the whole ladder test
    // blind — long games are exactly the ones a stronger bot grinds out, and
    // calling them all 0.5 forces every pairing to 50%. Adjudicate on the
    // final evaluation instead: a decisive advantage counts as a win.
    const adj = await engine.analyse(board.fen(), { depth: REF_DEPTH, multipv: 1 })
    const line = adj.lines[0]
    const stmScore = line ? lineScore(line) : 0
    const whiteScore = board.turn() === 'w' ? stmScore : -stmScore
    if (whiteScore > ADJUDICATE_CP) {
      score = 1
      reason = `adjudicated white (+${Math.round(whiteScore)}cp)`
    } else if (whiteScore < -ADJUDICATE_CP) {
      score = 0
      reason = `adjudicated black (${Math.round(whiteScore)}cp)`
    } else {
      reason = `adjudicated draw (${Math.round(whiteScore)}cp)`
    }
  }

  return { score, plies: board.history().length, moves, reason }
}

/* -------------------------------------------------------------- metrics */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Elo implied by a score rate, clamped so 100%/0% don't return Infinity. */
function impliedElo(score: number): number {
  const s = Math.min(0.99, Math.max(0.01, score))
  return Math.round(-400 * Math.log10(1 / s - 1))
}

function bar(value: number, max: number, width = 22): string {
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)))
  return '#'.repeat(n) + '.'.repeat(width - n)
}

/* ----------------------------------------------------------------- main */

const startedAt = new Date().toISOString()
console.log(`Elo sandbox — ${GAMES} games/cell, reference depth ${REF_DEPTH}`)
console.log('report only; PROFILES is never written back to\n')

await engine.init()

const bands = QUICK ? ([1200, 1400, 1600] as Band[]) : BANDS

/* --- 1. ACPL per band ------------------------------------------------- */

console.log('1. ACPL per band (self-play, style=human)')
const bandRows: {
  band: Band
  targetAcpl: number
  measuredAcpl: number
  blunderRate: number
  moves: number
}[] = []

for (const band of bands) {
  const all: number[] = []
  for (let g = 0; g < GAMES; g++) {
    const r = await playGame(
      { band, style: 'human' },
      { band, style: 'human' },
      band * 1000 + g,
      true,
    )
    all.push(...r.moves.map((m) => m.loss))
  }
  const target = bandProfile(band).targetAcpl
  const measured = mean(all)
  // "Blunder" in the conventional sense: a move shedding 200cp or more.
  const blunderRate = all.length ? all.filter((l) => l >= 200).length / all.length : 0
  bandRows.push({
    band,
    targetAcpl: target,
    measuredAcpl: Math.round(measured * 10) / 10,
    blunderRate: Math.round(blunderRate * 1000) / 1000,
    moves: all.length,
  })
  const flag = Math.abs(measured - target) > target * 0.4 ? '  <-- OFF TARGET' : ''
  console.log(
    `   ${String(band).padStart(4)}  target ${String(target).padStart(3)}  ` +
      `measured ${measured.toFixed(1).padStart(6)}  ` +
      `blunders ${(blunderRate * 100).toFixed(1).padStart(4)}%  ` +
      `${bar(measured, 180)}${flag}`,
  )
}

/* --- 2. Ladder: does higher actually beat lower? ---------------------- */

console.log('\n2. Ladder (higher band vs next lower, colours alternated)')
const pairRows: { higher: Band; lower: Band; score: number; impliedElo: number; games: number }[] =
  []

for (let i = 1; i < bands.length; i++) {
  const higher = bands[i]!
  const lower = bands[i - 1]!
  let points = 0
  const n = GAMES
  for (let g = 0; g < n; g++) {
    // Alternate colours so a first-move advantage can't skew the result.
    const higherIsWhite = g % 2 === 0
    const r = await playGame(
      { band: higherIsWhite ? higher : lower, style: 'human' },
      { band: higherIsWhite ? lower : higher, style: 'human' },
      higher * 7919 + lower * 104729 + g,
      false,
    )
    points += higherIsWhite ? r.score : 1 - r.score
  }
  const score = points / n
  const elo = impliedElo(score)
  pairRows.push({ higher, lower, score, impliedElo: elo, games: n })
  const flag = elo < 40 ? '  <-- BANDS NOT SEPARATED' : ''
  console.log(
    `   ${lower} vs ${higher}:  ${higher} scored ${(score * 100).toFixed(0).padStart(3)}%  ` +
      `implied gap ${String(elo).padStart(5)} (nominal 200)${flag}`,
  )
}

/* --- 3. Style parity at one band -------------------------------------- */

console.log(`\n3. Style parity at ${STYLE_BAND} (each style vs human, same band)`)
const styleRows: { style: Style; score: number; acpl: number; games: number }[] = []

for (const s of STYLES) {
  if (s.id === 'human') continue
  let points = 0
  const losses: number[] = []
  const n = GAMES
  for (let g = 0; g < n; g++) {
    const styleIsWhite = g % 2 === 0
    const r = await playGame(
      { band: STYLE_BAND, style: styleIsWhite ? s.id : 'human' },
      { band: STYLE_BAND, style: styleIsWhite ? 'human' : s.id },
      STYLE_BAND * 31 + g * 17 + s.id.length,
      true,
    )
    points += styleIsWhite ? r.score : 1 - r.score
    losses.push(...r.moves.filter((m) => m.style === s.id).map((m) => m.loss))
  }
  const score = points / n
  const acpl = mean(losses)
  styleRows.push({ style: s.id, score, acpl: Math.round(acpl * 10) / 10, games: n })
  const gap = Math.abs(impliedElo(score))
  const flag = gap > 120 ? '  <-- STYLE IS A DIFFICULTY SLIDER' : ''
  console.log(
    `   ${s.id.padEnd(11)} scored ${(score * 100).toFixed(0).padStart(3)}%  ` +
      `acpl ${acpl.toFixed(1).padStart(6)}  implied ${String(impliedElo(score)).padStart(5)}${flag}`,
  )
}

/* ---------------------------------------------------------------- write */

const report = {
  generatedAt: startedAt,
  finishedAt: new Date().toISOString(),
  config: { games: GAMES, refDepth: REF_DEPTH, maxPlies: MAX_PLIES, quick: QUICK },
  bands: bandRows,
  pairings: pairRows,
  styleParity: { band: STYLE_BAND, rows: styleRows },
  note: 'Report only. PROFILES in src/engine/policy.ts is not modified by this script.',
}

const outDir = join(root, 'calibration')
await mkdir(outDir, { recursive: true })
const stamp = startedAt.replace(/[:.]/g, '-')
const outPath = join(outDir, `report-${stamp}.json`)
await writeFile(outPath, JSON.stringify(report, null, 2))

console.log(`\nwrote ${outPath}`)
process.exit(0)
