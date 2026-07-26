/**
 * Check that every endgame position is what it claims to be.
 *
 * The endgame library asserts a theoretical result — "this is a win", "this is
 * a draw". Those assertions are the teaching content, so if one is wrong the
 * app confidently teaches Sean something false and then marks him down for
 * playing the position correctly. That's worse than not shipping the tier.
 *
 * So: parse every FEN, search it deeply, and compare the engine's verdict with
 * the declared goal. Any disagreement fails the run and names the position.
 *
 * Usage:  npm run verify:endgames
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { ENDGAMES, type EndgamePosition } from '../src/coach/endgames'

/** Deep enough that the theoretical results resolve; still finishes in minutes. */
const DEPTH = 26

/**
 * Above this, the side to move is winning rather than merely better.
 *
 * Deliberately high. Bishop-up-but-drawn positions ("wrong bishop", lone
 * minor piece) evaluate around +2 to +3 on material while being dead draws,
 * and Stockfish only collapses them to 0.00 when it recognises the draw. A low
 * threshold would fail those positions for being materially unequal, which is
 * the entire point of them.
 */
const WIN_CP = 450

interface Verdict {
  pos: EndgamePosition
  /** Engine result from the trainee's point of view. */
  saw: 'win' | 'draw' | 'loss'
  detail: string
  ok: boolean
}

/**
 * Is the side that is NOT to move in check?
 *
 * This is the check that actually mattered. chess.js happily loads a position
 * where the opponent is already in check — it validates the placement, not the
 * game history — so two of the first sixteen positions here were illegal and
 * looked fine. Stockfish refuses them outright and returns no line at all,
 * which surfaced as a confusing "engine returned no line" rather than
 * "your FEN is impossible". Flip the side to move and ask directly.
 */
function opponentInCheck(fen: string): boolean {
  const parts = fen.split(' ')
  if (parts.length < 4) return false
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  // Clear en passant too. An ep square is only legal for the side it can be
  // captured by, so flipping the mover without clearing it makes chess.js
  // reject an otherwise fine position. Latent here (every endgame FEN below
  // has "-") but it cost 148 false failures in the puzzle sandbox.
  parts[3] = '-'
  try {
    return new Chess(parts.join(' ')).isCheck()
  } catch {
    // Un-loadable with the side flipped means something is wrong regardless.
    return true
  }
}

function legality(pos: EndgamePosition): string | null {
  let board: Chess
  try {
    board = new Chess(pos.fen)
  } catch (err) {
    return `illegal FEN: ${err instanceof Error ? err.message : String(err)}`
  }
  if (opponentInCheck(pos.fen)) {
    return 'illegal: the side NOT to move is in check'
  }
  if (board.isGameOver()) return 'position is already over'
  if (board.moves().length === 0) return 'no legal moves'
  return null
}

async function judge(engine: NodeEngine, pos: EndgamePosition): Promise<Verdict> {
  const bad = legality(pos)
  if (bad) return { pos, saw: 'draw', detail: bad, ok: false }

  const board = new Chess(pos.fen)
  const mover = board.turn()

  const analysis = await engine.analyse(pos.fen, { depth: DEPTH, multipv: 1 })
  const line = analysis.lines[0]
  if (!line) return { pos, saw: 'draw', detail: 'engine returned no line', ok: false }

  // Scores are from the side-to-move's point of view. Flip when the trainee
  // is not the side to move — getting this backwards would silently invert
  // every defensive position, which are exactly the ones worth checking.
  const flip = mover === pos.youPlay ? 1 : -1

  let saw: 'win' | 'draw' | 'loss'
  let detail: string

  if (line.mate !== null) {
    const mate = line.mate * flip
    saw = mate > 0 ? 'win' : 'loss'
    detail = `mate in ${Math.abs(mate)}`
  } else {
    const cp = (line.cp ?? 0) * flip
    saw = cp >= WIN_CP ? 'win' : cp <= -WIN_CP ? 'loss' : 'draw'
    detail = `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`
  }

  // A declared draw is satisfied by anything that is not a loss — "you are
  // materially better but it is still only a draw" is a legitimate holding
  // position, and so is dead level. A declared win must actually be a win.
  const ok = pos.goal === 'win' ? saw === 'win' : saw !== 'loss'
  return { pos, saw, detail, ok }
}

async function main(): Promise<void> {
  const engine = new NodeEngine()
  await engine.init()

  console.log(`Verifying ${ENDGAMES.length} endgame positions at depth ${DEPTH}.\n`)
  console.log('  id                     you  goal   engine   eval        ')
  console.log('  ' + '-'.repeat(58))

  const results: Verdict[] = []
  for (const pos of ENDGAMES) {
    const v = await judge(engine, pos)
    results.push(v)
    const mark = v.ok ? 'ok  ' : 'FAIL'
    console.log(
      `  ${pos.id.padEnd(22)} ${pos.youPlay}    ${pos.goal.padEnd(6)} ${v.saw.padEnd(8)} ${v.detail.padEnd(11)} ${mark}`,
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log('')

  if (failed.length === 0) {
    console.log(`All ${results.length} positions match their declared result.`)
    return
  }

  console.log(`${failed.length} of ${results.length} positions do NOT match:\n`)
  for (const f of failed) {
    console.log(`  ${f.pos.id} — "${f.pos.name}"`)
    console.log(`    declared: ${f.pos.goal} for ${f.pos.youPlay}`)
    console.log(`    engine:   ${f.saw} (${f.detail})`)
    console.log(`    fen:      ${f.pos.fen}`)
    console.log('')
  }
  process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
