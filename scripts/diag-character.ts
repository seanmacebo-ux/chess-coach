/**
 * Do the bots have CHARACTER over a whole game?
 *
 * verify:style already checks that the five styles pick different moves in a
 * fixed set of positions, and they do. That is a per-move measurement, and
 * Sean's complaint is not about moves: "the styles don't really mean much and
 * the bots are generic." You do not experience a bot one move at a time. You
 * experience an opening it plays, whether it castles, whether its queen comes
 * at you on move four, how it feels to sit across from for forty moves.
 *
 * So this plays whole games and measures the signature a person would
 * actually notice:
 *
 *   OPENING IDENTITY — how many different first moves across N games. A bot
 *   that opens with a different move every game has no repertoire, and a
 *   player with no repertoire is not a character, whatever its card says.
 *
 *   KING SAFETY HABITS — does it castle, and when.
 *
 *   THE QUEEN — does it come out early, which is the single most recognisable
 *   beginner-bot trait and the one Nadia's card explicitly promises.
 *
 *   VIOLENCE — captures and checks per hundred plies, and how close its
 *   pieces get to your king.
 *
 *   npm run diag:character -- --styles human,aggressive,positional --games 6
 */

import { Chess } from 'chess.js'
import { NodeEngine } from './lib/engine-node'
import { profileFor, chooseMove, seededRng } from '../src/engine/policy'
import { bookMove } from '../src/engine/book'
import { nearestBot } from '../src/engine/roster'
import { STYLES, type Style } from '../src/engine/types'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const GAMES = arg('games', 6)
const MAX_PLIES = arg('max-plies', 120)
const ELO = arg('elo', 1400)

const STYLE_LIST = (() => {
  const i = process.argv.indexOf('--styles')
  const raw = i >= 0 ? process.argv[i + 1] : undefined
  const ids = STYLES.map((s) => s.id)
  return (raw ? raw.split(',') : ids).filter((s): s is Style => ids.includes(s as Style))
})()

/** Pass --no-book to measure what the bots were like before the repertoire. */
const BOT_ID = process.argv.includes('--no-book') ? null : nearestBot(ELO).id

const engine = new NodeEngine()

interface Signature {
  firstMoves: Map<string, number>
  castledBy: number[]
  neverCastled: number
  earlyQueen: number
  captures: number
  checks: number
  plies: number
  games: number
  /** Mean Chebyshev distance from the bot's pieces to the enemy king, moves 10-30. */
  kingPressure: number[]
}

function blank(): Signature {
  return {
    firstMoves: new Map(), castledBy: [], neverCastled: 0, earlyQueen: 0,
    captures: 0, checks: 0, plies: 0, games: 0, kingPressure: [],
  }
}

const fileOf = (sq: string) => sq.charCodeAt(0) - 97
const rankOf = (sq: string) => Number(sq[1]) - 1
const cheb = (a: string, b: string) =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)))

function enemyKing(board: Chess, me: 'w' | 'b'): string | null {
  for (const row of board.board()) {
    for (const sq of row) if (sq && sq.type === 'k' && sq.color !== me) return sq.square
  }
  return null
}

/**
 * One game, the studied style as WHITE against a plain `human` bot of the
 * same rating. Only White's behaviour is recorded — mixing both sides would
 * average the character away, which is exactly the mistake being hunted.
 */
async function play(style: Style, seed: number, sig: Signature) {
  const profile = profileFor(ELO)
  const plain = profileFor(ELO)
  const board = new Chess()
  const rngW = seededRng(seed)
  const rngB = seededRng(seed ^ 0x5bf03635)
  let castledAt: number | null = null
  let queenOut = false

  while (!board.isGameOver() && board.history().length < MAX_PLIES) {
    const mine = board.turn() === 'w'
    const p = mine ? profile : plain
    /*
     * The book, for White only. Black stays bookless on purpose: the point
     * is to see what the studied style brings to the board, and giving both
     * sides a repertoire would measure the book against itself.
     */
    let uci: string | null = null
    if (mine && BOT_ID) {
      uci = bookMove(BOT_ID, 'w', board.history(), board.fen(), rngW)
    }
    if (!uci) {
      const a = await engine.analyse(board.fen(), { depth: p.depth, multipv: p.multipv })
      uci = chooseMove(board.fen(), a.lines, ELO, mine ? style : 'human', mine ? rngW : rngB)
        ?? a.bestMove
    }
    if (!uci) break

    const before = board.history().length
    let mv
    try {
      mv = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    } catch {
      break
    }
    if (!mv) break

    if (mine) {
      const moveNo = Math.floor(before / 2) + 1
      if (before === 0) sig.firstMoves.set(mv.san, (sig.firstMoves.get(mv.san) ?? 0) + 1)
      if (mv.san.startsWith('O-O') && castledAt === null) castledAt = moveNo
      if (mv.piece === 'q' && rankOf(mv.from) === 0 && moveNo < 8) queenOut = true
      if (mv.captured) sig.captures++
      if (mv.san.includes('+') || mv.san.includes('#')) sig.checks++
      sig.plies++
      if (moveNo >= 10 && moveNo <= 30) {
        const ek = enemyKing(board, 'w')
        if (ek) {
          const dists: number[] = []
          for (const row of board.board()) {
            for (const sq of row) {
              if (sq && sq.color === 'w' && sq.type !== 'k' && sq.type !== 'p') {
                dists.push(cheb(sq.square, ek))
              }
            }
          }
          if (dists.length) sig.kingPressure.push(dists.reduce((a, c) => a + c, 0) / dists.length)
        }
      }
    }
  }
  sig.games++
  if (castledAt === null) sig.neverCastled++
  else sig.castledBy.push(castledAt)
  if (queenOut) sig.earlyQueen++
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0)
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) : '0')

async function main() {
  await engine.init()
  console.log(`\n  ${GAMES} games per style at ${ELO}, each as White against a plain bot.\n`)
  const sigs = new Map<Style, Signature>()

  for (const style of STYLE_LIST) {
    const sig = blank()
    for (let g = 0; g < GAMES; g++) {
      await play(style, 0xC0FFEE + g * 7919, sig)
      process.stdout.write(`    ${style}: ${g + 1}/${GAMES} games   \r`)
    }
    sigs.set(style, sig)
  }

  console.log('  style        1st moves   castles   by move   Q out early   capt/100   chk/100   king dist')
  for (const style of STYLE_LIST) {
    const s = sigs.get(style)!
    const opening = [...s.firstMoves.entries()].sort((a, b) => b[1] - a[1])
    console.log(
      `  ${style.padEnd(12)} ${String(opening.length).padStart(5)}/${s.games}` +
        `   ${pct(s.games - s.neverCastled, s.games).padStart(5)}%` +
        `   ${(s.castledBy.length ? mean(s.castledBy).toFixed(1) : '  —').padStart(7)}` +
        `   ${pct(s.earlyQueen, s.games).padStart(10)}%` +
        `   ${((s.captures / Math.max(1, s.plies)) * 100).toFixed(1).padStart(8)}` +
        `   ${((s.checks / Math.max(1, s.plies)) * 100).toFixed(1).padStart(7)}` +
        `   ${mean(s.kingPressure).toFixed(2).padStart(9)}`,
    )
  }

  console.log('\n  opening repertoire, per style:')
  for (const style of STYLE_LIST) {
    const s = sigs.get(style)!
    const opening = [...s.firstMoves.entries()].sort((a, b) => b[1] - a[1])
    console.log(`    ${style.padEnd(12)} ${opening.map(([m, n]) => `${m}x${n}`).join(' ')}`)
  }
  console.log(
    '\n  "1st moves" is how many DIFFERENT opening moves it played across the games.\n' +
      '  A bot that opens differently every time has no repertoire, and a player\n' +
      '  with no repertoire is not a character whatever its card says.\n',
  )
  process.exit(0)
}

void main()
