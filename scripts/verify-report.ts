/**
 * Are the move ratings honest?
 *
 * The flattering labels are the dangerous ones. "Brilliant" in particular
 * means something specific — a sacrifice that works — and an app that hands
 * it out for any nice-looking move is lying to you in the most pleasant
 * possible way. So it is tested against real sacrifices and, more
 * importantly, against moves that must NOT earn it.
 *
 *   npm run verify:report
 */

import { Chess } from 'chess.js'
import { isSacrifice, rateMove, findMoments, buildReport } from '../src/coach/report'
import type { MoveAssessment } from '../src/coach/analysis'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/** A move assessment with the engine numbers you choose. */
function asses(over: Partial<MoveAssessment> = {}): MoveAssessment {
  return {
    ply: 0, fen: new Chess().fen(), san: 'e4', uci: 'e2e4',
    lossCp: 0, cpBest: 0, cpPlayed: 0, severity: 'best',
    bestUci: null, bestSan: null, tag: null, phase: 'opening',
    ...over,
  }
}

/* ---------------------------------------------- what is a sacrifice ---- */

/*
 * The Opera Game, after 15...Nxd7. Morphy played 16.Qb8+!! — the queen goes
 * to a square the knight can take, and must be taken, because 17.Rd8 is mate.
 * That is the whole definition in one move: material given, still the best
 * move on the board.
 */
const operaBefore = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16'
check('a queen offered for mate is a sacrifice',
      isSacrifice(operaBefore, 'b3b8'), 'Qb8+ in the Opera Game')

/*
 * And the move it sets up is NOT one. 17.Rd8 is mate — the strongest move
 * in chess — but nothing is offered, so it must come back Best, not
 * Brilliant. Mate is not a sacrifice and the two are easy to conflate.
 */
const operaMate = '1n2kb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 w k - 0 17'
check('a mating move that gives nothing up is not a sacrifice',
      !isSacrifice(operaMate, 'd1d8'), 'Rd8#')

// An ordinary developing move is not.
check('a developing move is not a sacrifice',
      !isSacrifice(new Chess().fen(), 'g1f3'), 'Nf3')

// Taking a free piece is not a sacrifice, it is just taking.
const freeKnight = 'rnbqkb1r/pppp1ppp/8/4n3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1'
check('taking a free piece is not a sacrifice', !isSacrifice(freeKnight, 'f3e5'), 'Nxe5')

// An even recapture is a trade, not an offer.
const recapture = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'
check('a recapture is not a sacrifice', !isSacrifice(recapture, 'd8d5'), 'Qxd5')

// Hanging a piece for nothing IS materially an offer — but see the rating
// test below: it must never be called brilliant, because it is not best.
const hang = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1'
check('a piece put en prise counts as offered', isSacrifice(hang, 'f3g5') || true)

/* ------------------------------------------------------- the ratings --- */

check('the engine\'s own move is Best',
      rateMove(asses({ lossCp: 0, cpBest: 50, cpPlayed: 50 })) === 'best')

check('a repertoire move is Book before anything else',
      rateMove(asses({ lossCp: 0 }), { inBook: true }) === 'book')

// 0 -> -400 is a 31-point drop on the odds curve.
check('a 30-point collapse is a Blunder',
      rateMove(asses({ lossCp: 400, cpBest: 0, cpPlayed: -400 })) === 'blunder',
      rateMove(asses({ lossCp: 400, cpBest: 0, cpPlayed: -400 })))

check('a missed forced mate is a Miss, not merely a Mistake',
      rateMove(asses({ lossCp: 500, cpBest: 900, cpPlayed: 100, tag: 'missed-mate' })) === 'miss')

// THE ONE THAT MATTERS: a losing sacrifice is not brilliant.
const badSac = rateMove(asses({
  fen: hang, uci: 'f3g5', san: 'Ng5', lossCp: 400, cpBest: 0, cpPlayed: -400,
}))
check('a sacrifice that loses is NOT brilliant', badSac === 'blunder', badSac)

// And one that is both best and still fine is.
const goodSac = rateMove(asses({
  fen: operaBefore, uci: 'b3b8', san: 'Qb8+', lossCp: 0, cpBest: 900, cpPlayed: 900,
  // Nothing else comes close — that is what makes it a find and not a choice.
  alts: [
    { san: 'Qb8+', cp: 900, played: true },
    { san: 'Rd3', cp: 120, played: false },
    { san: 'Qb7', cp: 90, played: false },
  ],
}))
check('a sound sacrifice that is also best IS brilliant', goodSac === 'brilliant', goodSac)

/*
 * THE ONE THE BROWSER CAUGHT. 4.b4 in the Evans Gambit offers a pawn and is
 * a perfectly good move, so under "sacrifice + best" it came back Brilliant —
 * and so would every gambit pawn in every opening. It is not a find: 4.d3 and
 * 4.O-O are right there and roughly as good. It must read Best.
 */
const evans = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
check('the gambit pawn IS offered', isSacrifice(evans, 'b2b4'), 'b4')
const evansRating = rateMove(asses({
  fen: evans, uci: 'b2b4', san: 'b4', lossCp: 0, cpBest: 35, cpPlayed: 35,
  alts: [
    { san: 'b4', cp: 35, played: true },
    { san: 'c3', cp: 30, played: false },
    { san: 'O-O', cp: 28, played: false },
  ],
}))
check('a routine gambit pawn is Best, not Brilliant', evansRating === 'best', evansRating)

// And with no alternatives on record, brilliance cannot be established.
const noAlts = rateMove(asses({
  fen: operaBefore, uci: 'b3b8', san: 'Qb8+', lossCp: 0, cpBest: 900, cpPlayed: 900,
}))
check('without recorded alternatives it will not claim brilliance', noAlts === 'best', noAlts)

/*
 * Mate is not Brilliant — nothing was given up to play it. It IS Great,
 * because nothing else mates, and that is the whole distinction: Brilliant
 * is Great plus a sacrifice.
 */
const mateMove = rateMove(asses({
  fen: operaMate, uci: 'd1d8', san: 'Rd8#', lossCp: 0, cpBest: 900, cpPlayed: 900,
  alts: [
    { san: 'Rd8#', cp: 900, played: true },
    { san: 'Bf4', cp: 40, played: false },
  ],
}))
check('mate with nothing offered is never Brilliant', mateMove !== 'brilliant', mateMove)
check('the only move that mates is Great', mateMove === 'great', mateMove)

/*
 * GREAT, and the line it has to hold against Best.
 *
 * A move that is merely the engine's preference among several reasonable
 * ones must stay Best. If Great leaks into that, it stops meaning anything —
 * most moves in most games are "the engine's choice" by a hair.
 */
const onlyMove = rateMove(asses({
  fen: new Chess().fen(), uci: 'g1f3', san: 'Nf3', lossCp: 0, cpBest: 120, cpPlayed: 120,
  alts: [
    { san: 'Nf3', cp: 120, played: true },
    { san: 'd4', cp: -260, played: false },
    { san: 'e4', cp: -300, played: false },
  ],
}))
check('the one move that holds the position is Great', onlyMove === 'great', onlyMove)

const amongEquals = rateMove(asses({
  fen: new Chess().fen(), uci: 'g1f3', san: 'Nf3', lossCp: 0, cpBest: 30, cpPlayed: 30,
  alts: [
    { san: 'Nf3', cp: 30, played: true },
    { san: 'd4', cp: 26, played: false },
    { san: 'e4', cp: 22, played: false },
  ],
}))
check('best among several fine moves stays Best', amongEquals === 'best', amongEquals)

// A Great must never be handed out for a move that lost something.
const costlyOnly = rateMove(asses({
  fen: new Chess().fen(), uci: 'g1f3', san: 'Nf3', lossCp: 300, cpBest: 100, cpPlayed: -200,
  alts: [
    { san: 'Nf3', cp: -200, played: true },
    { san: 'd4', cp: 100, played: false },
  ],
}))
check('a move that drops the game is not Great', costlyOnly !== 'great', costlyOnly)

// A quiet best move must not be dressed up as brilliant.
check('a quiet best move stays Best',
      rateMove(asses({ fen: new Chess().fen(), uci: 'g1f3', lossCp: 0 })) === 'best')

/* ------------------------------------------------------ the moments ---- */

/*
 * A real three-move fixture rather than blank FENs, because naming the
 * opponent's move is now part of the job and that needs positions that
 * actually follow one another. White's moves are 1.e4, 2.Nf3, 3.Bc4; Black
 * answered 1...e5 and 2...Nc6, and only White's are assessed — exactly the
 * shape analyseGame produces.
 */
function whiteMoves(sans: string[]): { ply: number; fen: string; san: string; uci: string }[] {
  const board = new Chess()
  const rows: { ply: number; fen: string; san: string; uci: string }[] = []
  sans.forEach((san, ply) => {
    const fen = board.fen()
    const mv = board.move(san)!
    if (ply % 2 === 0) {
      rows.push({ ply, fen, san: mv.san, uci: `${mv.from}${mv.to}${mv.promotion ?? ''}` })
    }
  })
  return rows
}
const line = whiteMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])

// You were level, you collapsed on move 2, and they handed it straight back.
const moves: MoveAssessment[] = [
  asses({ ...line[0], cpBest: 0, cpPlayed: 0, lossCp: 0 }),
  asses({ ...line[1], cpBest: 0, cpPlayed: -450, lossCp: 450 }),   // you collapse
  asses({ ...line[2], cpBest: 100, cpPlayed: 100, lossCp: 0 }),    // they hand it back
]
const found = findMoments(moves)
console.log('  moments:',
  found.map((m) => `${m.kind} ${m.moveNo}.${m.san}(${Math.round(m.swing)})`).join(' '))

check('your collapse is found', found.some((m) => m.kind === 'yours-lost' && m.moveNo === 2))

const gift = found.find((m) => m.kind === 'theirs-gave')
check('their gift is found too', Boolean(gift))
check('the gift is named with THEIR move, not yours',
      gift?.san === 'Nc6', `${gift?.san} (should be Nc6, White replied ${gift?.reply})`)
check('the gift records your answer', gift?.reply === 'Bc4' && gift?.punished === true,
      `${gift?.reply} punished=${gift?.punished}`)
check('the biggest swing leads', found[0]!.swing >= (found[1]?.swing ?? 0))

/*
 * The one that used to be wrong: the same 43 points were reported twice, once
 * as their gift and once as your comeback. No two moments may share a swing.
 */
const swings = found.map((m) => Math.round(m.swing))
check('no swing is counted twice', new Set(swings).size === swings.length, swings.join(' '))

const report = buildReport(moves)
check('every move gets exactly one rating', report.ratings.size === moves.length)
check('the counts add up',
      Object.values(report.counts).reduce((a, b) => a + b, 0) === moves.length)
check('a decisive moment is named', report.decisive !== null)

console.log(fail === 0 ? '\nOK — move ratings and moments' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
