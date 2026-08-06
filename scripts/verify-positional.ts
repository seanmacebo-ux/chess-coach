/**
 * Check that every positional position teaches something true.
 *
 * A positional drill claims "this move is the idea here". Unlike an endgame we
 * are not checking a win/draw verdict — a positional move rarely forces a
 * result — but we ARE checking that the thematic move is SOUND: that playing it
 * does not throw away the position. A drill that rewards you for a move the
 * engine considers a blunder teaches a habit that loses games, which is worse
 * than having no drill.
 *
 * Method (borrowed from the candidate-move drill's trustworthiness check in
 * drills.ts): rank the position's moves, then play the keyMove and evaluate the
 * result from the mover's side. If the keyMove's realised value is within a
 * spread of the engine's best, it is sound to teach. If it drops eval off a
 * cliff, it is not, and the run fails and names it.
 *
 * The engine cannot certify "this is an outpost" — only that the move is not a
 * blunder. The concept claim itself is cross-checked by the council at build
 * time (see the books plan). This script guards soundness; the council guards
 * pedagogy.
 *
 * Usage:  npm run verify:positional
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { lineScore } from '../src/engine/types'
import { POSITIONAL, type PositionalPosition } from '../src/coach/positional'

/** Deep enough that a positional assessment settles; still finishes quickly. */
const DEPTH = 20

/**
 * How far below the engine's best the thematic move may sit and still count as
 * sound to teach. A genuinely thematic positional move is usually AT or near
 * the top; this tolerance exists because the engine's single sharpest move is
 * sometimes a computer move a human would never find, and the human-thematic
 * move is a hair behind but still correct. A move that gives up more than this
 * is not being taught as "sound" — it is a mistake wearing a concept label.
 */
const SPREAD_CP = 60

/** Above this a score is a forced mate, not a number of pawns. */
const MATE_THRESHOLD = 90_000

interface Verdict {
  pos: PositionalPosition
  bestCp: number | null
  keyCp: number | null
  detail: string
  ok: boolean
}

/** Is the side that is NOT to move already in check? (illegal to reach.) */
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

function legality(pos: PositionalPosition): string | null {
  let board: Chess
  try {
    board = new Chess(pos.fen)
  } catch (err) {
    return `illegal FEN: ${err instanceof Error ? err.message : String(err)}`
  }
  if (opponentInCheck(pos.fen)) return 'illegal: the side NOT to move is in check'
  if (board.isGameOver()) return 'position is already over'
  if (board.turn() !== pos.youPlay) return `youPlay is ${pos.youPlay} but it is ${board.turn()} to move`
  return null
}

/** Play the keyMove; returns the resulting FEN, or null if the move is illegal. */
function playKey(pos: PositionalPosition): string | null {
  const board = new Chess(pos.fen)
  try {
    const m = board.move({
      from: pos.keyMove.slice(0, 2),
      to: pos.keyMove.slice(2, 4),
      promotion: pos.keyMove[4],
    })
    if (!m) return null
    if (m.san !== pos.keySan) {
      // Not fatal, but the SAN label is shown to the user — flag the mismatch.
      console.warn(`  ! ${pos.id}: keySan "${pos.keySan}" but move is "${m.san}"`)
    }
    return board.fen()
  } catch {
    return null
  }
}

async function judge(engine: NodeEngine, pos: PositionalPosition): Promise<Verdict> {
  const bad = legality(pos)
  if (bad) return { pos, bestCp: null, keyCp: null, detail: bad, ok: false }

  // Best available move for the side to move.
  const before = await engine.analyse(pos.fen, { depth: DEPTH, multipv: 1 })
  const bestLine = before.lines[0]
  if (!bestLine) return { pos, bestCp: null, keyCp: null, detail: 'engine returned no line', ok: false }
  const bestCp = lineScore(bestLine)

  const afterFen = playKey(pos)
  if (!afterFen) return { pos, bestCp, keyCp: null, detail: 'keyMove is not legal here', ok: false }

  // Value of the keyMove = the opponent's best reply, negated back to our side.
  const reply = await engine.analyse(afterFen, { depth: DEPTH, multipv: 1 })
  const replyLine = reply.lines[0]
  if (!replyLine) return { pos, bestCp, keyCp: null, detail: 'no reply line after keyMove', ok: false }
  const keyCp = -lineScore(replyLine)

  // A key move that walks into a forced mate is never sound to teach.
  if (Math.abs(keyCp) >= MATE_THRESHOLD && keyCp < 0) {
    return { pos, bestCp, keyCp, detail: 'keyMove walks into a forced mate', ok: false }
  }

  const drop = bestCp - keyCp
  const ok = drop <= SPREAD_CP
  const detail = `best ${(bestCp / 100).toFixed(2)}  key ${(keyCp / 100).toFixed(2)}  drop ${(drop / 100).toFixed(2)}`
  return { pos, bestCp, keyCp, detail, ok }
}

async function main(): Promise<void> {
  const engine = new NodeEngine()
  await engine.init()

  console.log(`Verifying ${POSITIONAL.length} positional positions at depth ${DEPTH} (spread ${SPREAD_CP}cp).\n`)

  const results: Verdict[] = []
  for (const pos of POSITIONAL) {
    const v = await judge(engine, pos)
    results.push(v)
    const mark = v.ok ? 'ok  ' : 'FAIL'
    console.log(`  ${pos.id.padEnd(28)} ${pos.keySan.padEnd(6)} ${v.detail.padEnd(42)} ${mark}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length === 0) {
    console.log(`All ${results.length} positions are sound to teach.`)
    return
  }

  console.log(`${failed.length} of ${results.length} positions FAILED:\n`)
  for (const f of failed) {
    console.log(`  ${f.pos.id} — "${f.pos.name}"`)
    console.log(`    move:  ${f.pos.keySan} (${f.pos.keyMove})`)
    console.log(`    ${f.detail}`)
    console.log(`    fen:   ${f.pos.fen}`)
    console.log('')
  }
  process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
})
