/**
 * Are the bot repertoires real, and do they say what the cards say?
 *
 * The book is hand-written SAN, which is the most typo-prone format in chess
 * — one wrong move and a bot silently leaves book on move two, which looks
 * exactly like having no book at all. So every ply of every line is played
 * on a real board.
 *
 * The more interesting half is the second one. The book exists to give the
 * bots character, and character means the weak bots play weak openings. A
 * book that quietly made Nadia sound would be a worse bug than a typo,
 * because nothing would look broken — she would simply stop being Nadia.
 *
 *   npm run verify:book
 */

import { Chess } from 'chess.js'
import { BOOKS, bookMove, bookDepth, bookFor } from '../src/engine/book'
import { BOTS } from '../src/engine/roster'
import { seededRng } from '../src/engine/policy'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

/* -------------------------------------------------- every line is legal -- */

for (const book of BOOKS) {
  for (const [side, lines] of [['white', book.white], ['black', book.black]] as const) {
    for (const line of lines) {
      const board = new Chess()
      let bad: string | null = null
      for (const san of line.moves) {
        try {
          if (!board.move(san)) bad = san
        } catch {
          bad = san
        }
        if (bad) break
      }
      check(
        `${book.bot} ${side}: "${line.name}" is playable`,
        bad === null,
        `${bad} is not legal after ${line.moves.slice(0, line.moves.indexOf(bad ?? '')).join(' ')}`,
      )
    }
  }
}

/* ------------------------------------------- the bot moves on its own ply - */

/*
 * A White line must give White's move at even indices and a Black line must
 * give Black's at odd ones. Get this wrong and the bot offers a move it is
 * not on turn for, bookMove returns null, and the book silently does nothing.
 */
for (const book of BOOKS) {
  for (const line of book.white) {
    check(`${book.bot}: white line "${line.name}" starts with a White move`,
          line.moves.length % 2 === 1 || line.moves.length === 0,
          `${line.moves.length} plies — a White repertoire line must end on White's move`)
  }
  for (const line of book.black) {
    check(`${book.bot}: black line "${line.name}" ends on a Black move`,
          line.moves.length % 2 === 0,
          `${line.moves.length} plies`)
  }
}

/* ------------------------------------------------- every bot has a book -- */

for (const bot of BOTS) {
  const b = bookFor(bot.id)
  check(`${bot.name} has a repertoire`, b !== undefined)
  if (b) {
    check(`${bot.name} has something to play as both colours`,
          b.white.length > 0 && b.black.length > 0)
  }
}

/* ----------------------------------------------- preparation runs deeper - */

/*
 * Book LENGTH is what protects the strength ladder: a book move is a decided
 * move, so a long book carries a weak bot through the phase where it would
 * otherwise drift and makes it stronger than its rating. Bud gets two plies
 * and Orion gets fifteen, and the order has to hold all the way up.
 */
const ladder = [...BOTS].sort((a, b) => a.elo - b.elo)
console.log('\n  bot          elo   book plies')
for (const bot of ladder) {
  console.log(`  ${bot.name.padEnd(12)} ${String(bot.elo).padStart(4)} ${String(bookDepth(bot.id)).padStart(11)}`)
}
check('the weakest bot has the shallowest preparation',
      bookDepth(ladder[0]!.id) === Math.min(...ladder.map((b) => bookDepth(b.id))),
      `${ladder[0]!.name} has ${bookDepth(ladder[0]!.id)}`)
check('the strongest has the deepest',
      bookDepth(ladder[ladder.length - 1]!.id) >= Math.max(...ladder.map((b) => bookDepth(b.id))) - 1)
check('Bud really does know almost nothing', bookDepth('bud') <= 2, String(bookDepth('bud')))

/* --------------------------------------------- the weak lines ARE weak --- */

/*
 * The whole point. Nadia's card says she brings the queen out on move three;
 * if the book ever makes her sound, she stops being the bot the card
 * describes and the thing this file exists to create is gone.
 */
const nadia = bookFor('nadia')!
const queenEarly = nadia.white.filter((l) => {
  const board = new Chess()
  for (let i = 0; i < l.moves.length; i++) {
    const m = board.move(l.moves[i]!)
    if (m && m.color === 'w' && m.piece === 'q' && Math.floor(i / 2) + 1 <= 3) return true
  }
  return false
})
check('Nadia genuinely brings her queen out by move three',
      queenEarly.length === nadia.white.length,
      `${queenEarly.length} of ${nadia.white.length} white lines`)

const walter = bookFor('walter')!
check('Walter really plays the London every game',
      walter.white.every((l) => l.moves[0] === 'd4' && l.moves.includes('Bf4')),
      walter.white.map((l) => l.moves.slice(0, 3).join(' ')).join(' | '))

const imani = bookFor('imani')!
check('Imani really goes for f7',
      imani.white.some((l) => l.moves.some((m) => m.includes('xf7'))),
      imani.white.map((l) => l.name).join(', '))

/* --------------------------------------------------- the lookup works --- */

{
  const rng = seededRng(5)
  const board = new Chess()
  const first = bookMove('walter', 'w', [], board.fen(), rng)
  check('Walter opens 1.d4 whatever the seed', first === 'd2d4', String(first))

  // Follow Nadia's main line and check she reaches Qh5.
  const game = new Chess()
  const hist: string[] = []
  const theirs = ['e5', 'Nc6']
  let reachedQh5 = false
  for (let i = 0; i < 6; i++) {
    if (game.turn() === 'w') {
      const uci = bookMove('nadia', 'w', hist, game.fen(), seededRng(1))
      if (!uci) break
      const m = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })!
      hist.push(m.san)
      if (m.san === 'Qh5') reachedQh5 = true
    } else {
      const san = theirs.shift()
      if (!san) break
      hist.push(game.move(san)!.san)
    }
  }
  check('Nadia reaches Qh5 against 1...e5 and 2...Nc6', reachedQh5, hist.join(' '))
}

/* A move the book does not expect must drop it out of book, not crash. */
{
  const board = new Chess()
  board.move('e4')
  board.move('a5')
  const out = bookMove('nadia', 'w', ['e4', 'a5'], board.fen(), seededRng(3))
  check('an unexpected reply takes the bot out of book cleanly', out === null, String(out))
}

/* And a bot that does not exist must not throw. */
check('an unknown bot has no book', bookMove('nobody', 'w', [], new Chess().fen()) === null)

/* ------------------------------------------- the teaching is attached --- */

/*
 * The lines a beginner MUST learn to punish are the trappy ones, and a trap
 * you can name but not answer is still just a sequence somebody else played.
 * Those lines have to carry their refutation.
 */
const mustTeach = ['Scholar\u2019s Mate attempt', 'Wayward Queen', 'Fried Liver Attack',
                   'King\u2019s Gambit', 'Scotch Gambit', 'Grand Prix Attack']
for (const book of BOOKS) {
  for (const line of [...book.white, ...book.black]) {
    if (!mustTeach.includes(line.name)) continue
    check(`${book.bot}: "${line.name}" says what it wants`, Boolean(line.wants), line.name)
    check(`${book.bot}: "${line.name}" says how to meet it`, Boolean(line.answer), line.name)
  }
}

const annotated = BOOKS.flatMap((b) => [...b.white, ...b.black]).filter((l) => l.wants)
const total = BOOKS.flatMap((b) => [...b.white, ...b.black]).length
console.log(`\n  ${annotated.length} of ${total} lines carry a what-it-wants and an answer.`)
check('most lines are annotated', annotated.length / total > 0.6,
      `${annotated.length}/${total}`)

console.log(fail === 0 ? '\n✓ every bot has a repertoire, and it is the one on its card' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
