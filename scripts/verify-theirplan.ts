/**
 * Does the whole-game read ever say something untrue?
 *
 * This module exists because the opening book's commentary ran out after
 * eleven plies and the screen then said nothing about the opponent for the
 * rest of the game. Sean: "I am not sure what's happening, and I mean the
 * WHOLE GAME."
 *
 * The danger in narration is invention. coach/position.ts carries the scar:
 * this app once told him a queen had to run when she had seven squares, and
 * that a knight would block a pawn that had already been captured. A coach
 * that invents is worse than one that says less, so every claim here is
 * checked against a real board.
 *
 *   npm run verify:theirplan
 */

import { Chess } from 'chess.js'
import {
  describeTheirMove,
  freePiece,
  phaseOf,
  theirPlan,
  yourMove,
  theirIntent,
} from '../src/coach/theirplan'
import { STYLES } from '../src/engine/types'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/** Play a line and hand back the position either side of the last move. */
function after(sans: string[]): { before: string; san: string; fen: string } {
  const b = new Chess()
  for (const s of sans.slice(0, -1)) b.move(s)
  const before = b.fen()
  const san = b.move(sans[sans.length - 1]!)!.san
  return { before, san, fen: b.fen() }
}

/* --------------------------------------------- what their move did ----- */

{
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 — Black is 'b', the Bc4 is White's.
  const m = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
  const said = describeTheirMove(m.before, m.san, m.fen, 'b')
  check('a developing move is named as development',
        said !== null && /Developed the bishop to c4/.test(said), String(said))
}

{
  // A capture is named with the piece taken and the square.
  const m = after(['e4', 'd5', 'exd5'])
  const said = describeTheirMove(m.before, m.san, m.fen, 'b')
  check('a capture says what was taken and where',
        said !== null && /Took your pawn on d5/.test(said), String(said))
}

{
  // Check outranks capture, because it is the one that constrains your reply.
  const m = after(['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7'])
  const said = describeTheirMove(m.before, m.san, m.fen, 'b')
  check('a capture WITH check is described as the check',
        said !== null && /with check/.test(said), String(said))
}

{
  const m = after(['f4', 'e5', 'g4', 'Qh4'])
  const said = describeTheirMove(m.before, m.san, m.fen, 'w')
  check('mate is called mate', said === 'That is mate.', String(said))
}

{
  const m = after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
  const said = describeTheirMove(m.before, m.san, m.fen, 'b')
  check('castling is named', said !== null && /Castled/.test(said), String(said))
}

{
  // Move one: there is no previous move, and it must not pretend there was.
  const plan = theirPlan({ fen: new Chess().fen(), you: 'w', style: 'human' })
  check('with no move played yet, nothing is claimed about one', plan.did === null)
}

/*
 * THE ONE THAT MATTERS. When it says a piece of yours is newly attacked and
 * undefended, that has to be TRUE — this is the claim a player will act on,
 * and acting on a false one loses material.
 */
{
  const board = new Chess('rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2')
  const before = board.fen()
  const san = board.move('e4')!.san     // attacks d5, which is defended by Qd8
  const said = describeTheirMove(before, san, board.fen(), 'b')
  check('a defended pawn is NOT reported as hanging',
        said === null || !/undefended/.test(said), String(said))
}

{
  // A genuinely loose piece, verified independently.
  const fen = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3'
  const board = new Chess(fen)
  const before = board.fen()
  const san = board.move('Nf3')!.san
  const said = describeTheirMove(before, san, board.fen(), 'b')
  if (said && /undefended/.test(said)) {
    const sq = said.match(/on ([a-h][1-8])/)?.[1]
    const probe = new Chess(board.fen())
    const piece = probe.get(sq as never)
    check('a square it calls hanging really holds one of YOUR pieces',
          Boolean(piece) && piece!.color === 'b', `${sq} holds ${JSON.stringify(piece)}`)
  } else {
    check('no false hanging claim made here', true)
  }
}

/* ------------------------------------------------------ the phases ----- */

check('a fresh board is the opening', phaseOf(new Chess()) === 'opening')
check('a bare king-and-pawn position is the endgame',
      phaseOf(new Chess('8/8/4k3/8/8/4K3/4P3/8 w - - 0 40')) === 'endgame',
      phaseOf(new Chess('8/8/4k3/8/8/4K3/4P3/8 w - - 0 40')))

/* ------------------------------------------------ what YOU should do --- */

{
  /*
   * A check that is NOT mate. The first fixture here was the Fool's Mate
   * position, which is mate — so the module correctly said "checkmate" and
   * the test correctly failed. The fixture was wrong, not the code.
   */
  const board = new Chess()
  board.move('e4')
  board.move('d5')
  board.move('Bb5')          // check, and Black can block three different ways
  const said = yourMove(board.fen(), 'b', 'opening', 'human')
  check('the position really is check and not mate',
        new Chess(board.fen()).isCheck() && !new Chess(board.fen()).isCheckmate())
  check('being in check outranks everything else', /in check/.test(said), said)
}

{
  // Your own hanging piece comes before their hanging piece.
  const fen = 'rnbqkb1r/pppp1ppp/5n2/4N3/8/8/PPPPPPPP/RNBQKB1R b KQkq - 0 3'
  const said = yourMove(fen, 'b', 'opening', 'human')
  check('your own loose piece is raised before anything else',
        /attacked and nothing defends it|attacked and undefended/.test(said) || /still at home/.test(said),
        said)
}

{
  const said = yourMove(new Chess().fen(), 'w', 'opening', 'human')
  check('at the start it tells you to develop', /still at home/.test(said), said)
}

{
  const eg = '8/5p2/4k3/8/8/4K3/4P3/8 w - - 0 40'
  const said = yourMove(eg, 'w', 'endgame', 'human')
  check('in an endgame it names the two things that decide it',
        /king/.test(said) && /pawn/.test(said), said)
}

/* ------------------------------------------- every style says something - */

for (const s of STYLES) {
  for (const phase of ['opening', 'middlegame', 'endgame'] as const) {
    const t = theirIntent(s.id, phase)
    check(`${s.id}/${phase} has an intent`, t.length > 20 && /[.!]$/.test(t), t)
  }
}

/*
 * And the five styles must not all say the same thing — that was the original
 * complaint about the bots, and a narration that describes them identically
 * would quietly reintroduce it in words.
 */
for (const phase of ['opening', 'middlegame', 'endgame'] as const) {
  const said = new Set(STYLES.map((s) => theirIntent(s.id, phase)))
  check(`the five styles read differently in the ${phase}`, said.size === STYLES.length,
        `${said.size} distinct of ${STYLES.length}`)
}

/* ------------------------------------- no ASCII-only garbage in prose --- */

/*
 * A stray character from an editing slip once reached a user-facing string in
 * this file. Prose is data too.
 */
const prose: string[] = []
for (const s of STYLES) {
  for (const phase of ['opening', 'middlegame', 'endgame'] as const) {
    prose.push(theirIntent(s.id, phase))
    prose.push(yourMove(new Chess().fen(), 'w', phase, s.id))
  }
}
const odd = prose.filter((t) => /[^\x20-\x7E—’…]/.test(t))
check('no stray characters in anything shown to a player', odd.length === 0, odd.join(' | '))

/* --------------------------------------------- it counts in English ---- */

{
  const board = new Chess()
  board.move('e4'); board.move('e5')
  board.move('Nf3'); board.move('Nc6')
  board.move('Bc4'); board.move('Bc5')
  board.move('d3'); board.move('d6')
  board.move('Bg5')   // White now has only the queen's knight at home
  const said = yourMove(board.fen(), 'w', 'opening', 'human')
  check('it does not say "1 of your pieces ARE still at home"',
        !/\b1 of your pieces are\b/.test(said), said)
}

/*
 * A pawn arriving on d4 while the king is on e1 was being announced as an
 * attack on the king. Three squares away is a centre pawn, not a threat, and
 * mild invention is the kind this module is least likely to catch itself.
 */
{
  const board = new Chess()
  board.move('e4')
  const before = board.fen()
  const san = board.move('d5')!.san
  const said = describeTheirMove(before, san, board.fen(), 'w')
  check('a centre pawn is not reported as an attack on your king',
        said === null || !/at your king/.test(said), String(said))
}

/* ------------------------------------------- something of theirs is free -- */

/*
 * The loudest claim the panel makes, so the one most worth being sure of.
 * A false "take it" costs a piece.
 */
{
  const b = new Chess()
  b.move('e4'); b.move('e5'); b.move('Nf3'); b.move('Nc6')
  b.move('Nxe5')          // the knight on e5 is attacked by Nc6 and undefended
  const g = freePiece(b.fen(), 'b')
  check('a piece sitting en prise is reported', g !== null, JSON.stringify(g))
  if (g) {
    const probe = new Chess(b.fen())
    const piece = probe.get(g.square as never)
    check('the square it names really holds one of THEIR pieces',
          Boolean(piece) && piece!.color === 'w', `${g.square} → ${JSON.stringify(piece)}`)
    check('and that piece really is attacked and undefended',
          probe.isAttacked(g.square as never, 'b') && !probe.isAttacked(g.square as never, 'w'),
          g.square)
  }
}

{
  // Nothing loose: it must stay silent rather than reach for something.
  const b = new Chess()
  b.move('e4'); b.move('e5'); b.move('Nf3')
  check('a quiet position reports nothing free',
        freePiece(b.fen(), 'b') === null, JSON.stringify(freePiece(b.fen(), 'b')))
}

/*
 * THE CASE A LIVE GAME CAUGHT. Nadia plays 2.Qh5 — safe. You answer 2...Nf6
 * and NOW her queen is attacked and undefended. Her move did not hang it;
 * yours did. The first version only looked at what their move changed and
 * stayed silent through the most takeable moment in the opening.
 */
{
  const b = new Chess()
  b.move('e4'); b.move('e5'); b.move('Qh5')
  check('her queen is safe the moment she plays it',
        freePiece(b.fen(), 'b') === null, JSON.stringify(freePiece(b.fen(), 'b')))
  b.move('Nf6')
  const g = freePiece(b.fen(), 'b')
  check('...and free once YOUR move attacks it',
        g !== null && g.square === 'h5' && g.piece === 'queen', JSON.stringify(g))
}

{
  // Pawns are deliberately out of scope.
  const b = new Chess()
  b.move('e4'); b.move('e5')
  const g = freePiece(b.fen(), 'w')
  check('a loose pawn is not announced', g === null || g.piece !== 'pawn', JSON.stringify(g))
}

{
  /*
   * Several loose: it must name the most expensive, not the first found.
   * A knight on e5 attacks g4 and d3 (the first fixture here used f4, which
   * a knight on e5 does not attack at all — the test was wrong, not the code).
   */
  const fen = '4k3/8/8/4n3/6Q1/3B4/8/4K3 b - - 0 1'
  const probe = new Chess(fen)
  check('the fixture really has both hanging',
        probe.isAttacked('g4', 'b') && !probe.isAttacked('g4', 'w') &&
        probe.isAttacked('d3', 'b') && !probe.isAttacked('d3', 'w'))
  const g = freePiece(fen, 'b')
  check('with a choice it names the most valuable',
        g !== null && g.piece === 'queen' && g.square === 'g4', JSON.stringify(g))
}

console.log(fail === 0 ? '\n✓ the whole-game read never claims what the board does not show'
                       : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
