/**
 * Does the captured tray count what is actually gone?
 *
 * The interesting case is promotion. Promote a pawn and the board holds eight
 * pieces where it expects nine and two queens where it expects one, so a
 * naive difference reports a captured pawn that never existed and a queen
 * "un-captured". Both directions are tested.
 *
 *   npm run verify:material
 */

import { Chess } from 'chess.js'
import { materialFrom } from '../src/chess/material'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

const start = materialFrom(new Chess().fen())!
check('nothing is taken at the start',
      start.takenByWhite.length === 0 && start.takenByBlack.length === 0)
check('the start is level', start.edge === 0, String(start.edge))

/* A queen off for nothing. */
const queenGone = materialFrom('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')!
check('a missing black queen is credited to White',
      queenGone.takenByWhite.join('') === 'q' && queenGone.takenByBlack.length === 0,
      JSON.stringify(queenGone))
check('and White is nine pawns up', queenGone.edge === 9, String(queenGone.edge))

/* Heaviest first, so a tray reads in a fixed order. */
const several = materialFrom('rnb1k1n1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQq - 0 1')!
check('captures are listed heaviest first',
      several.takenByWhite.join('') === 'qrb',
      several.takenByWhite.join(''))

/* An even trade shows on both sides and leaves the edge at zero. */
const traded = materialFrom('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1')!
check('queens off is one each', traded.takenByWhite.length === 1 && traded.takenByBlack.length === 1)
check('and still level', traded.edge === 0, String(traded.edge))

/* --------------------------------------------------------- promotion */

/*
 * White has promoted on d8, taking Black's queen on the way: two white
 * queens, seven white pawns, every other white piece present.
 *
 * NOTHING of White's has been captured. The naive subtraction reports a
 * white pawn taken — it is simply missing from the board — which is the bug
 * this fixture exists to hold down, and it did catch it.
 */
const promoted = materialFrom('rnbQkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w kq - 0 1')!
check('a promotion does not invent a captured pawn',
      promoted.takenByBlack.length === 0,
      promoted.takenByBlack.join(''))
check('the queen that WAS taken is still listed',
      promoted.takenByWhite.join('') === 'q', promoted.takenByWhite.join(''))
/*
 * And the edge has to see the promotion even though no capture produced it:
 * a queen won (9) plus a pawn become a queen (+8).
 */
check('the promoted queen counts in the edge', promoted.edge === 17, String(promoted.edge))

/* Under-promotion is the same rule and the tray must not special-case it. */
const knightPromo = materialFrom('rnbNkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w kq - 0 1')!
check('an under-promotion does not invent a captured pawn either',
      knightPromo.takenByBlack.length === 0, knightPromo.takenByBlack.join(''))

/* ------------------------------------------------------------- junk */

check('an unparseable position returns nothing rather than zeros',
      materialFrom('not a fen') === null)

console.log(fail === 0 ? '\n✓ material counting holds' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
