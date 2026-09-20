/**
 * Does the deeper breakdown describe the game that was actually played?
 *
 * Two things here can be wrong in a way that still looks plausible on
 * screen, which is the worst kind.
 *
 * The opponent's move is RECOVERED rather than recorded — replay yours, find
 * the one legal reply reaching the next position — so an off-by-one in which
 * position it is described FROM would characterise a different move on a
 * different board and produce a confident sentence about nothing. The
 * fixtures below use a game where the opponent's moves are known, so the
 * recovery can be checked against them by name.
 *
 * And a read taken from too few moves is a personality invented out of
 * three data points.
 *
 *   npm run verify:game-breakdown
 */

import { Chess } from 'chess.js'
import { byPhase, readOpponent, replyBetween } from '../src/coach/breakdown'
import type { MoveAssessment } from '../src/coach/analysis'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/** Build White's assessments from a full game, with evals you choose. */
function whiteAssessments(
  sans: string[],
  evals: (i: number) => { cpBest: number; cpPlayed: number },
  phaseAt: (i: number) => MoveAssessment['phase'] = () => 'middlegame',
): MoveAssessment[] {
  const board = new Chess()
  const out: MoveAssessment[] = []
  sans.forEach((san, ply) => {
    const fen = board.fen()
    const mv = board.move(san)!
    if (ply % 2 !== 0) return
    const i = ply / 2
    const { cpBest, cpPlayed } = evals(i)
    out.push({
      ply, fen, san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ''}`,
      lossCp: Math.max(0, cpBest - cpPlayed), cpBest, cpPlayed,
      severity: cpBest - cpPlayed > 250 ? 'blunder' : cpBest - cpPlayed > 100 ? 'mistake' : 'best',
      bestUci: null, bestSan: null, tag: null, phase: phaseAt(i),
    })
  })
  return out
}

/* An attacking game: Black throws everything at the white king. */
const ATTACK = [
  'd4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','h6','Bh4','Ne4','Bxe7','Qxe7',
  'Rc1','Nxc3','Rxc3','g5','Bd3','f5','O-O','f4','exf4','gxf4','Re1','Qg5','Ne5','Qg4',
]
const attacker = whiteAssessments(ATTACK, () => ({ cpBest: 30, cpPlayed: 25 }))

/* --------------------------------------------------- move recovery -- */

const recovered: string[] = []
for (let i = 0; i < attacker.length - 1; i++) {
  const uci = replyBetween(attacker[i]!, attacker[i + 1]!)
  if (uci) recovered.push(uci)
}
check('every opponent move in between is recovered',
      recovered.length === attacker.length - 1, `${recovered.length} of ${attacker.length - 1}`)

// Black's first reply is 1...d5, i.e. d7-d5.
check('the first recovered move is the one Black actually played',
      recovered[0] === 'd7d5', String(recovered[0]))
// Black's fifth move in this game is 5...O-O — a king move e8-g8.
check('castling is recovered as the king move', recovered.includes('e8g8'),
      recovered.slice(0, 6).join(' '))

/* ------------------------------------------------------- the read --- */

const read = readOpponent(attacker, 'Sofia')!
check('a read is produced for a long enough game', Boolean(read))
check('it counts only recovered moves', read.moves === attacker.length - 1, String(read.moves))
check('it names the opponent', read.verdict.startsWith('Sofia'), read.verdict)
console.log(`         → ${read.verdict}`)
console.log(`         → captures ${read.captures}, checks ${read.checks}, at king ${read.atYourKing}, quiet ${read.quiet}`)

/*
 * A game with nothing in it must not get a personality. Three moves is not
 * a style, and inventing one is exactly what makes an app untrustworthy on
 * everything else it says.
 */
const short = whiteAssessments(['e4','e5','Nf3','Nc6'], () => ({ cpBest: 20, cpPlayed: 20 }))
check('too few moves produces no read at all', readOpponent(short) === null)

/*
 * Gifts come from the eval, not the moves: cpPlayed assumes their best
 * answer and the next cpBest is what they actually left.
 */
const generous = whiteAssessments(ATTACK, (i) =>
  i === 3 ? { cpBest: 20, cpPlayed: 20 } : { cpBest: 20, cpPlayed: 20 },
)
generous[3]!.cpPlayed = -300
generous[4]!.cpBest = 300
const g = readOpponent(generous)!
check('a big gift is counted', g.gifts >= 1, String(g.gifts))
check('and its size is reported', g.biggestGift >= 30, String(g.biggestGift))

/* ------------------------------------------------------- by phase --- */

const phased = whiteAssessments(
  ATTACK,
  (i) => (i === 6 ? { cpBest: 50, cpPlayed: -350 } : { cpBest: 30, cpPlayed: 25 }),
  (i) => (i < 5 ? 'opening' : i < 12 ? 'middlegame' : 'endgame'),
)
const rows = byPhase(phased)
check('one row per phase that occurred', rows.length === 3, String(rows.length))
check('phases come out in playing order',
      rows.map((r) => r.phase).join(' ') === 'opening middlegame endgame',
      rows.map((r) => r.phase).join(' '))
const mid = rows.find((r) => r.phase === 'middlegame')!
check('the blunder lands in the phase it happened in', mid.slips === 1, String(mid.slips))
check('and the worst move of that phase is named', mid.worst?.san === phased[6]!.san,
      String(mid.worst?.san))
const open = rows.find((r) => r.phase === 'opening')!
check('a clean phase names no worst move', open.worst === null, JSON.stringify(open.worst))
check('a phase with no moves is left out entirely',
      byPhase(phased.filter((m) => m.phase !== 'endgame')).length === 2)

console.log(fail === 0 ? '\n✓ the breakdown matches the game' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
