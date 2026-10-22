/**
 * What each bot plays in the opening — and why they needed one.
 *
 * MEASURED FIRST. scripts/diag-character.ts played five games per style at
 * 1400 and recorded the first move of each:
 *
 *     human        g4  c3  d3  b4  Nf3
 *     aggressive   g4  c3  b3  a3  Nc3
 *     solid        g4  Nc3 c3  b4  c4
 *     positional   g4  Nc3 d3  b4  e3
 *     tactical     g4  Nc3 a4  h3  Nf3
 *
 * Five different first moves in five games, for every style, and not one
 * e4 or d4 in twenty-five games. Two of the styles never castled at all.
 *
 * That is not a tuning problem, it is what the policy does by construction.
 * In the starting position every legal move is within about 130 centipawns
 * at depth 9, so a softmax over sixteen candidates spreads almost uniformly —
 * and the engine does not care that 1.g4 is a move no human has ever played
 * twice. Centipawns cannot see the difference between "slightly worse" and
 * "nobody plays that".
 *
 * Three of Sean's complaints turn out to be this one thing:
 *
 *   "the bots are generic" — they are. A player with no repertoire is not a
 *   character, whatever its card says. Nadia's card promises she "brings the
 *   queen out on move three and asks questions later" and she never did.
 *
 *   "the styles don't really mean much" — for the first fifteen moves they
 *   genuinely did not. Five styles all opening at random feel identical,
 *   because they ARE identical: identically random.
 *
 *   "I am not learning the openings the way I thought I would" — you cannot.
 *   The app teaches the Italian and then has nobody play 1.e4 at you. You
 *   never face the same position twice, so there is nothing to learn.
 *
 * THE DESIGN CALL THAT MATTERS: A BOOK CARRIES THE BOT'S FLAWS.
 *
 * The obvious implementation is to give every bot sound theory, and it is
 * wrong twice over. It makes the weak bots stronger exactly where they are
 * most beatable, and it erases the character it was meant to create — twelve
 * bots all playing correct openings are as generic as twelve playing random
 * ones.
 *
 * So Nadia really plays 2.Qh5, which is bad. Bud knows one move. Kit sets up
 * the same three pieces every game and has no idea what to do next. The book
 * is a portrait, not a theory file, and the weak lines in it are the point:
 * they are what you learn to punish, and punishing them is the single most
 * valuable opening lesson a sub-500 player can have.
 *
 * STRENGTH IS PROTECTED BY LENGTH, NOT BY QUALITY. A book move is a decided
 * move, so a long book is a free pass through the phase where a weak bot
 * would otherwise drift. Bud gets two plies. Orion gets fourteen. See
 * scripts/verify-book.ts, which checks that every line is legal, that the
 * weak lines really are weak, and that the ladder's ACPL is unmoved.
 */

import { Chess } from 'chess.js'
import type { UciMove } from './types'

export interface BookLine {
  /** Moves in SAN from the starting position, both sides, alternating. */
  moves: string[]
  /** What this line is, for the bot card and the post-game screen. */
  name: string
  /**
   * What the BOT is trying to do, and what you should do about it.
   *
   * Sean: "I am not learning the openings and moves the way I thought I
   * would." Giving the bots a repertoire fixes the supply — you now face the
   * same thing twice, which is the precondition for learning anything. This
   * is the other half: an opening you can name but not read is still just a
   * sequence of moves someone else made.
   *
   * Written as two short sentences on purpose. It appears under the board
   * mid-game, where a paragraph is noise and nobody reads it.
   */
  wants?: string
  answer?: string
}

export interface BotBook {
  /** Matches Bot.id in roster.ts. */
  bot: string
  /** One line about the opening habit, in the bot's own voice. */
  habit: string
  /** Lines it steers for with White. */
  white: BookLine[]
  /** ...and with Black. */
  black: BookLine[]
}

/*
 * ONE NOTE ON FORMAT. Lines are full move sequences including the opponent's
 * replies, because a repertoire is only meaningful as an answer to something.
 * Matching walks the actual game against every line and plays the bot's next
 * move from whichever line still agrees — so a line is both a plan and a set
 * of responses, and the bot leaves book the moment you play something none of
 * its lines expect. Which is honest: that is what happens to a human with a
 * narrow repertoire, and it is the moment the policy takes over.
 */

export const BOOKS: BotBook[] = [
  {
    bot: 'bud',
    habit: 'Plays e4 because somebody told him to. After that he is improvising.',
    white: [
      {
        name: 'One move of theory',
        moves: ['e4'],
        wants: 'Nothing. He has no plan past move one.',
        answer: 'Develop, castle, and take what he leaves hanging — there will be plenty.',
      },
    ],
    black: [
      {
        name: 'Mirrors you',
        moves: ['e4', 'e5'],
        wants: 'To copy whatever you do, because he has no idea.',
        answer: 'Play normally. He runs out of copying long before you run out of plan.',
      },
      {
        name: 'Mirrors you',
        moves: ['d4', 'd5'],
        wants: 'To copy whatever you do, because he has no idea.',
        answer: 'Play normally. He runs out of copying long before you run out of plan.',
      },
    ],
  },
  {
    bot: 'kit',
    habit: 'Sets up the same three pieces every game, then runs out of ideas.',
    white: [
      {
        name: 'Italian set-up',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
        wants: 'The bishop on c4 aimed at f7, your weakest square.',
        answer: 'Develop, castle early, and keep an eye on f7 until your king is away from it.',
      },
      {
        name: 'Italian set-up',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'Bc4'],
        wants: 'The same bishop on c4, whatever you played.',
        answer: 'Hit the bishop with ...e6 and ...d5 and take the centre he is ignoring.',
      },
    ],
    black: [
      {
        name: 'Symmetrical',
        moves: ['e4', 'e5', 'Nf3', 'Nc6'],
        wants: 'To copy you until something happens.',
        answer: 'Break the symmetry first. Whoever commits to a plan first is the one with a plan.',
      },
      {
        name: 'Symmetrical',
        moves: ['d4', 'd5', 'Nf3', 'Nf6'],
        wants: 'To copy you until something happens.',
        answer: 'Break the symmetry first. Whoever commits to a plan first is the one with a plan.',
      },
    ],
  },
  {
    bot: 'nadia',
    habit: 'Queen out early, every single game. Scholar’s Mate if you let her.',
    white: [
      {
        name: 'Scholar’s Mate attempt',
        moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5'],
        wants: 'Qxf7 mate. Her queen and bishop both hit f7 and nothing else of hers is out.',
        answer: '...g6 attacks the queen and defends f7. Then ...Nf6 hits her again and you are a tempo up with her queen running.',
      },
      {
        name: 'Wayward Queen',
        moves: ['e4', 'e5', 'Qh5'],
        wants: 'The same mate on f7, a move earlier and even looser.',
        answer: '...Nc6 defends e5, then ...g6 kicks the queen. Chase her with developing moves.',
      },
      {
        name: 'Queen sortie',
        moves: ['e4', 'c5', 'Qf3'],
        wants: 'An early hit on f7 before you have castled.',
        answer: 'Develop toward the centre. Every time the queen has to move again, you get a free move.',
      },
    ],
    black: [
      {
        name: 'Early queen',
        moves: ['e4', 'd5', 'exd5', 'Qxd5'],
        wants: 'Her queen in the middle of the board on move two.',
        answer: 'Nc3 hits it immediately. You develop, she retreats, and you are already better.',
      },
    ],
  },
  {
    bot: 'pip',
    habit: 'Develops something every move and takes whatever you leave out.',
    white: [
      {
        name: 'Italian Game',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'],
        wants: 'The bishop on c4 and a slow build with c3 and d4.',
        answer: 'Mirror it, castle early, and watch f7 until you are safe.',
      },
      {
        name: 'Open game',
        moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bc4'],
        wants: 'Pieces out fast, everything aimed at the middle.',
        answer: 'Match the development. Do not grab pawns while your pieces are still at home.',
      },
    ],
    black: [
      {
        name: 'Open game',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
        wants: 'Pieces out fast, everything aimed at the middle.',
        answer: 'Match the development. Do not grab pawns while your pieces are still at home.',
      },
      {
        name: 'Queen’s Pawn',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
        wants: 'A grip on the centre and a quiet game.',
        answer: 'Develop and strike at d4 with ...c5. A centre you never challenge is one you lose to.',
      },
    ],
  },
  {
    bot: 'walter',
    habit: 'The London, every game, whatever you do. Then he offers trades.',
    white: [
      {
        name: 'London System',
        moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3', 'Bd6', 'Bg3'],
        wants: 'Bishop to f4, pawns on d4 and e3, the same shape whatever you do. Then trades.',
        answer: 'Take space while he sets up. ...c5 or ...Qb6 hits b2 and asks a question his system does not answer.',
      },
      {
        name: 'London System',
        moves: ['d4', 'Nf6', 'Bf4', 'e6', 'e3', 'd5', 'Nf3'],
        wants: 'The same set-up again. He is not reacting to you.',
        answer: 'Play ...c5 early. The London has no answer to a centre that pushes back.',
      },
      {
        name: 'London System',
        moves: ['d4', 'g6', 'Bf4', 'Bg7', 'e3', 'd6', 'Nf3'],
        wants: 'The same set-up a third time.',
        answer: 'Your bishop on g7 is already pointed at his centre. Break with ...e5 and he is worse.',
      },
    ],
    black: [
      {
        name: 'Exchange everything',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6'],
        wants: 'Trades, and more trades, until nothing is left to go wrong.',
        answer: 'Avoid the trades. Keep pieces on and he has no idea what to do with them.',
      },
      {
        name: 'Solid centre',
        moves: ['d4', 'd5', 'c4', 'e6'],
        wants: 'A centre that does not break and no weaknesses to aim at.',
        answer: 'Take space on a wing. Solid is not a plan, and he does not have one.',
      },
    ],
  },
  {
    bot: 'imani',
    habit: 'Goes straight for the Fried Liver. Will sacrifice on f7 on sight.',
    white: [
      {
        name: 'Fried Liver Attack',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7'],
        wants: 'Ng5, then a knight sacrificed on f7 to drag your king out into the open.',
        answer: 'After Ng5, ...d5 is forced. Then ...Na5 instead of ...Nxd5 sidesteps the whole thing.',
      },
      {
        name: 'Two Knights',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'],
        wants: 'A pawn offered to rip the centre open while you are undeveloped.',
        answer: 'You can take it, but develop first. The gambit only works on a king still in the middle.',
      },
      {
        name: 'Open Sicilian',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'],
        wants: 'An open d-file and a lead in development.',
        answer: 'Finish developing before you push anything. Her lead only matters if you give her a target.',
      },
    ],
    black: [
      {
        name: 'Two Knights',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'],
        wants: 'Sharp play in the centre before either side is safe.',
        answer: 'Keep developing and castle. The tactics only work on an uncastled king.',
      },
      {
        name: 'Sharp centre',
        moves: ['d4', 'Nf6', 'c4', 'e5'],
        wants: 'Immediate tension and an early fight for the middle.',
        answer: 'Keep calm and develop. Tension favours whoever is better developed when it breaks.',
      },
    ],
  },
  {
    bot: 'sofia',
    habit: 'Queen’s Gambit. Takes space, trades when it suits her, never rushes.',
    white: [
      {
        name: 'Queen’s Gambit Declined',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3'],
        wants: 'Space in the centre, a long squeeze, and no tactics offered to you.',
        answer: 'Hold with ...e6 and ...c6, develop everything, and do not let the space come for free.',
      },
      {
        name: 'Queen’s Gambit Accepted',
        moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3'],
        wants: 'The centre back with e3 and a lead in development while you hold the pawn.',
        answer: 'Do not try to keep the pawn. Give it back, play ...c5, and you are equal.',
      },
      {
        name: 'Catalan-ish',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'd5', 'g3'],
        wants: 'A bishop on the long diagonal squeezing your queenside forever.',
        answer: 'Challenge the diagonal early or you will be answering it for forty moves.',
      },
    ],
    black: [
      {
        name: 'Caro-Kann',
        moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'],
        wants: 'A solid structure with her bishop out before ...e6 could lock it in.',
        answer: 'Take space while she sets up, and do not let her trade into a comfortable ending.',
      },
      {
        name: 'Queen’s Gambit Declined',
        moves: ['d4', 'd5', 'c4', 'e6'],
        wants: 'Space in the centre and a slow squeeze.',
        answer: 'Hold the centre, develop, and break with ...c5 when you are ready.',
      },
    ],
  },
  {
    bot: 'darius',
    habit: 'Opens lines at your king and worries about the cost later.',
    white: [
      {
        name: 'Scotch Gambit',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Bc4'],
        wants: 'An open centre fast, with pieces aimed at your king.',
        answer: 'Take the pawn, then give it back for development. A pawn is not worth a lead in pieces.',
      },
      {
        name: 'King’s Gambit',
        moves: ['e4', 'e5', 'f4'],
        wants: 'Your f-pawn gone and the f-file open at your king.',
        answer: 'You can take it. Or play ...d5 and give it straight back for the centre, which is the safe way.',
      },
      {
        name: 'Grand Prix Attack',
        moves: ['e4', 'c5', 'Nc3', 'Nc6', 'f4'],
        wants: 'A pawn storm at your king with f4 and f5.',
        answer: 'Castle early and break in the centre with ...d5 before the storm arrives.',
      },
    ],
    black: [
      {
        name: 'Sicilian Dragon',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'],
        wants: 'A bishop on g7 pointed straight through your queenside.',
        answer: 'Castle long and storm the kingside, or trade the dragon bishop. Those are the two plans.',
      },
      {
        name: 'King’s Indian',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
        wants: 'A kingside pawn storm once the centre is closed.',
        answer: 'Keep the centre open, or get your own play on the queenside first. It is a race.',
      },
    ],
  },
  {
    bot: 'ren',
    habit: 'Main lines only. Nothing clever, nothing loose.',
    white: [
      {
        name: 'Ruy Lopez',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'],
        wants: 'Pressure on your knight and a slow build. No weaknesses given.',
        answer: '...a6 asks the bishop what it is doing. Then develop and castle. This one is lost by drifting.',
      },
      {
        name: 'Queen’s Gambit Declined, Exchange',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5'],
        wants: 'A clean structure and slow pressure down the c-file.',
        answer: 'Knight to f6, bishop to e7, castle, and meet the c-file with ...c6.',
      },
    ],
    black: [
      {
        name: 'Berlin Defence',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4'],
        wants: 'A dead-equal ending and nothing for you to attack.',
        answer: 'Avoid the ending if you want a game. Keep queens on.',
      },
      {
        name: 'Slav Defence',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4'],
        wants: 'A solid chain and the light-squared bishop out early.',
        answer: 'Take space in the centre and do not let that bishop settle on f5 for free.',
      },
    ],
  },
  {
    bot: 'valentina',
    habit: 'Walks you into the sharpest line on the board and has seen it before.',
    white: [
      {
        name: 'Open Sicilian, Najdorf',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3'],
        wants: 'The sharpest line there is, played by someone who has seen it and you have not.',
        answer: 'Do not go line for line. Trade into something quiet and play the position instead.',
      },
      {
        name: 'Ruy Lopez',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'],
        wants: 'A long squeeze with everything protected.',
        answer: 'Get ...b5 and ...d6 in, claim your own space, and be ready for a long game.',
      },
    ],
    black: [
      {
        name: 'Najdorf Sicilian',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
        wants: 'The sharpest defence there is, in the hands of someone who knows it.',
        answer: 'Avoid the theory. A quiet line you understand beats a sharp one you do not.',
      },
      {
        name: 'Nimzo-Indian',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
        wants: 'The bishop pinning your knight and doubling your pawns if you allow it.',
        answer: 'Break the pin, or take the doubled pawns and open the c-file. Both are playable.',
      },
    ],
  },
  {
    bot: 'orion',
    habit: 'Everything, well.',
    white: [
      {
        name: 'Ruy Lopez, Closed',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3'],
        wants: 'A long, slow squeeze with every piece protected.',
        answer: 'There is no trick here. Develop, hold the centre, and do not create a weakness.',
      },
      {
        name: 'Queen’s Gambit Declined',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3'],
        wants: 'Space, structure and patience.',
        answer: 'Hold with ...c6, finish developing, and look for ...dxc4 followed by ...b5 at the right moment.',
      },
    ],
    black: [
      {
        name: 'Najdorf Sicilian',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5'],
        wants: 'The sharpest defence there is, played properly.',
        answer: 'If you do not know the theory, steer for something quiet on move three.',
      },
      {
        name: 'Nimzo-Indian',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O'],
        wants: 'The pin, and the structural concession it wins.',
        answer: 'Decide early whether you want the bishop pair or the clean pawns. Do not drift between them.',
      },
    ],
  },
]

const BY_BOT = new Map(BOOKS.map((b) => [b.bot, b]))

export function bookFor(botId: string): BotBook | undefined {
  return BY_BOT.get(botId)
}

/**
 * The bot's book move in this position, or null once it has left book.
 *
 * `history` is the game's moves in SAN. Every line the bot has for this
 * colour is walked against it; the ones that still agree offer their next
 * move, and `rng` picks between them so a bot with three lines does not
 * play the same one every single game.
 *
 * Returns the move in UCI, because that is what the Opponent contract
 * speaks and converting here keeps the caller from needing a board.
 */
export function bookMove(
  botId: string,
  colour: 'w' | 'b',
  history: string[],
  fen: string,
  rng: () => number = Math.random,
): UciMove | null {
  const book = BY_BOT.get(botId)
  if (!book) return null

  const lines = colour === 'w' ? book.white : book.black
  const options: string[] = []
  for (const line of lines) {
    // The line must cover everything played so far...
    if (line.moves.length <= history.length) continue
    let agrees = true
    for (let i = 0; i < history.length; i++) {
      if (line.moves[i] !== history[i]) {
        agrees = false
        break
      }
    }
    // ...and the next move in it must be the bot's to make.
    if (agrees) options.push(line.moves[history.length]!)
  }
  if (options.length === 0) return null

  const san = options[Math.floor(rng() * options.length)]!
  const board = new Chess(fen)
  try {
    const m = board.move(san)
    return m ? `${m.from}${m.to}${m.promotion ?? ''}` : null
  } catch {
    // A line that does not apply here is a data error, not a reason to
    // stall the game. verify:book exists so this never reaches a player.
    return null
  }
}

/**
 * The line the bot is currently following, if it still is.
 *
 * This is the teaching half, and it only became possible once the bots had
 * repertoires at all. Sean: "I am not learning the openings and moves the
 * way I thought I would." He could not: measured, five games produced five
 * different first moves, so there was never the same position twice and
 * nothing to learn. Now there is, and the app can say what it is while you
 * are sitting in it rather than afterwards.
 *
 * Returns null the moment the bot is out of book — which is the honest
 * signal that you are on your own, and worth showing as much as the line is.
 */
export function currentLine(
  botId: string,
  colour: 'w' | 'b',
  history: string[],
): BookLine | null {
  const book = BY_BOT.get(botId)
  if (!book) return null
  const lines = colour === 'w' ? book.white : book.black
  // The longest line that still agrees with the game. Longest, because a
  // short line that happens to be a prefix of a deeper one is the less
  // specific description of what is actually going on.
  let best: BookLine | null = null
  for (const line of lines) {
    if (line.moves.length < history.length) continue
    let agrees = true
    for (let i = 0; i < history.length; i++) {
      if (line.moves[i] !== history[i]) {
        agrees = false
        break
      }
    }
    if (agrees && (!best || line.moves.length > best.moves.length)) best = line
  }
  return best
}

/** How deep this bot's preparation runs, in plies. For the bot card. */
export function bookDepth(botId: string): number {
  const b = BY_BOT.get(botId)
  if (!b) return 0
  return Math.max(0, ...[...b.white, ...b.black].map((l) => l.moves.length))
}
