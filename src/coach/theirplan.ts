/**
 * What the other side just did, what they want, and what you do about it —
 * for the whole game, not just the opening.
 *
 * Sean, after the opening book landed: "I want more, even the learning... but
 * I am not sure what's happening. And I mean the WHOLE GAME."
 *
 * He is describing a cliff. The book panel names the opponent's line and
 * their plan for as long as they are following it, which for most bots is
 * five to eleven plies. Then it vanishes and the screen goes back to saying
 * nothing about the person on the other side of the board for the remaining
 * sixty moves. The most useful commentary in the app ran out before the
 * middlegame started.
 *
 * So this covers the rest. Three questions, in the order a player asks them:
 *
 *   WHAT DID THAT MOVE DO — their last move, read off the board. Not "they
 *   played Nf6": you can see that. What CHANGED because of it.
 *
 *   WHAT DO THEY WANT — their style and the phase, which together are the
 *   closest honest thing to a plan. A solid bot in a middlegame wants trades.
 *   An aggressive one wants your king. Saying so turns a sequence of moves
 *   into someone trying to do something to you, which is what makes a game
 *   legible.
 *
 *   WHAT DO YOU DO — the concrete next check, in priority order, because an
 *   observation you cannot act on is not help.
 *
 * EVERY CLAIM IS COMPUTED FROM THE BOARD, the same rule coach/position.ts
 * sets and for the same reason: this app has previously told Sean a queen had
 * to run when she had seven squares. The style sentences are the one
 * exception and they are about the BOT's disposition, which is a fact about
 * its configuration rather than a claim about the position.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { hanging, type Side } from './position'
import type { Style } from '../engine/types'

export type Phase = 'opening' | 'middlegame' | 'endgame'

export interface TheirPlan {
  phase: Phase
  /** What their last move changed. Null on move one, or when nothing did. */
  did: string | null
  /** What they are trying to do. */
  wants: string
  /** The next thing for you to check or do. */
  you: string
}

const NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')
const fileOf = (sq: string) => sq.charCodeAt(0) - 97
const rankOf = (sq: string) => Number(sq[1]) - 1
const cheb = (a: string, b: string) =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)))

function kingOf(chess: Chess, side: Side): Square | null {
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type === 'k' && sq.color === side) return sq.square
  }
  return null
}

/**
 * Same phase rule the rest of the coach uses, so a phase means one thing.
 *
 * It reads the MATERIAL first and the move number second, and it takes the
 * move number off the FEN rather than from history(). The first version
 * asked `chess.history().length`, which is empty for any position loaded
 * from a FEN — so a bare king-and-pawn ending came back as "opening" and the
 * advice that followed told you to develop your pieces. The verifier caught
 * it on the first run.
 *
 * Material is checked before the move count on purpose: a position with two
 * kings and a pawn is an endgame on move three as surely as on move sixty.
 */
export function phaseOf(chess: Chess): Phase {
  let heavy = 0
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k' || sq.type === 'p') continue
      heavy += VALUE[sq.type] ?? 0
    }
  }
  if (heavy <= 14) return 'endgame'
  const fullmove = Number(chess.fen().split(' ')[5] ?? 1)
  return fullmove <= 10 ? 'opening' : 'middlegame'
}

/**
 * What their last move changed, from the two positions either side of it.
 *
 * Ordered by what a player would notice first, and it stops at the first
 * true thing. A move that both captures and checks is described as the
 * check, because that is the one that constrains your reply.
 */
export function describeTheirMove(
  fenBefore: string,
  san: string,
  fenAfter: string,
  you: Side,
): string | null {
  const after = new Chess(fenAfter)
  const before = new Chess(fenBefore)
  const them = other(you)

  // Replay it to get the move's details rather than parsing the SAN.
  let mv
  try {
    mv = before.move(san)
  } catch {
    return null
  }
  if (!mv) return null

  if (after.isCheckmate()) return 'That is mate.'
  if (after.isCheck()) {
    return mv.captured
      ? `Took your ${NAME[mv.captured]} on ${mv.to} with check.`
      : `Check, from the ${NAME[mv.piece]} on ${mv.to}.`
  }
  if (mv.captured) {
    return `Took your ${NAME[mv.captured]} on ${mv.to}.`
  }
  if (mv.san.startsWith('O-O')) {
    return 'Castled. Their king is tucked away and their rook is coming to the centre.'
  }
  if (mv.promotion) return `Promoted to a ${NAME[mv.promotion]} on ${mv.to}.`

  /*
   * Did the move create a NEW attack on something of yours that is not
   * defended? That is the single most actionable thing a quiet move can do
   * and the one most often missed.
   */
  const looseBefore = new Set(hanging(new Chess(fenBefore), you).map((h) => h.square))
  const looseNow = hanging(after, you).filter((h) => !looseBefore.has(h.square))
  if (looseNow.length > 0) {
    const first = looseNow[0]!
    return `Their ${NAME[mv.piece]} to ${mv.to} leaves your ${NAME[first.type]} on ${first.square} attacked and undefended.`
  }

  // Did it come at your king?
  const yourKing = kingOf(after, you)
  if (yourKing) {
    const was = cheb(mv.from, yourKing)
    const now = cheb(mv.to, yourKing)
    if (now < was && now <= 3 && mv.piece !== 'p') {
      return `Brought the ${NAME[mv.piece]} to ${mv.to}, closer to your king.`
    }
    /*
     * Two squares, not three, and it has to be in YOUR half.
     *
     * At three it fired for a pawn arriving on d4 while the king sat on e1
     * and called it an attack. A pawn that far away is a centre pawn, and
     * saying "at your king" about it is the kind of mild invention this
     * module exists to avoid — it is not false enough to notice and not true
     * enough to act on.
     */
    const yourHalf = you === 'w' ? rankOf(mv.to) <= 3 : rankOf(mv.to) >= 4
    if (mv.piece === 'p' && now <= 2 && now < was && yourHalf) {
      return `Pushed a pawn to ${mv.to}, at your king.`
    }
  }

  // Development, while there is still development to do.
  const homeRank = them === 'w' ? 0 : 7
  if (rankOf(mv.from) === homeRank && mv.piece !== 'k' && mv.piece !== 'r') {
    return `Developed the ${NAME[mv.piece]} to ${mv.to}.`
  }
  return null
}

/** What this opponent is trying to do, given how it is built and where we are. */
export function theirIntent(style: Style, phase: Phase): string {
  if (phase === 'endgame') {
    switch (style) {
      case 'aggressive': return 'Pushing pawns and marching the king. She wants a queen on the board again.'
      case 'solid': return 'Trading into something he cannot lose. A draw suits him here.'
      case 'positional': return 'Getting the king active and the pawns rolling. Slow, and correct.'
      case 'tactical': return 'Looking for one trick before the position dries up completely.'
      default: return 'Pushing passed pawns and bringing the king up. That is the whole endgame.'
    }
  }
  if (phase === 'opening') {
    switch (style) {
      case 'aggressive': return 'Getting pieces out fast and pointing them at your king.'
      case 'solid': return 'Building a shape that cannot be attacked, then offering trades.'
      case 'positional': return 'Taking the centre and the space, in no hurry at all.'
      case 'tactical': return 'Looking for an early tactic before you have castled.'
      default: return 'Developing pieces and heading for a normal middlegame.'
    }
  }
  switch (style) {
    case 'aggressive': return 'Everything is aimed at your king. She is looking for a check that wins material.'
    case 'solid': return 'He wants trades. Every swap takes the position closer to one where nothing happens.'
    case 'positional': return 'Open files, good squares, more space. She will take forty moves over it and not mind.'
    case 'tactical': return 'Hunting for a fork or a pin. Every loose piece you own is a target.'
    default: return 'Improving pieces and waiting for you to leave something.'
  }
}

/**
 * The next thing for you to do, in priority order.
 *
 * Priority is the whole point. A list of five observations is not help; the
 * answer to "what is happening" has to end with one thing to do next, and it
 * has to be the thing that matters most right now.
 */
export function yourMove(fen: string, you: Side, phase: Phase, style: Style): string {
  const chess = new Chess(fen)
  if (chess.isCheckmate()) return 'Checkmate. Nothing to do.'
  if (chess.isCheck()) return 'You are in check. Move the king, block, or take the checker — nothing else is legal.'

  const yours = hanging(chess, you)
  if (yours.length > 0) {
    const h = yours[0]!
    return yours.length === 1
      ? `Your ${NAME[h.type]} on ${h.square} is attacked and nothing defends it. Deal with that before anything else.`
      : `${yours.length} of your pieces are attacked and undefended (${yours.map((x) => x.square).join(', ')}). Sort the most valuable one first.`
  }

  const theirs = hanging(chess, other(you)).filter((h) => h.type !== 'p')
  if (theirs.length > 0) {
    const h = theirs[0]!
    return `Their ${NAME[h.type]} on ${h.square} is attacked and undefended. Check it is really free, then take it.`
  }

  if (phase === 'opening') {
    const homeRank = you === 'w' ? '1' : '8'
    let home = 0
    for (const row of chess.board()) {
      for (const sq of row) {
        if (sq && sq.color === you && sq.square[1] === homeRank && (sq.type === 'n' || sq.type === 'b')) home++
      }
    }
    if (home === 1) return 'One of your pieces is still at home. Get it out, then castle.'
    if (home > 1) return `${home} of your pieces are still at home. Get them out, then castle.`
    return 'Everything is out. Castle if you have not, then find a plan for the middle.'
  }

  if (phase === 'endgame') {
    return 'Endgame: activate your king and push a passed pawn. Those two things decide it.'
  }

  // Nothing hanging either way: answer their plan rather than the board.
  switch (style) {
    case 'aggressive': return 'Nothing is loose. Count the attackers around your king before you do anything else.'
    case 'solid': return 'Nothing is loose. Avoid the trades he wants and keep pieces on.'
    case 'positional': return 'Nothing is loose. Claim a file or a strong square before she takes them all.'
    case 'tactical': return 'Nothing is loose — keep it that way. Every piece defended is a fork that does not work.'
    default: return 'Nothing is loose. Improve your worst-placed piece.'
  }
}

/** The whole read, for one position. */
export function theirPlan(args: {
  fen: string
  you: Side
  style: Style
  /** The position before their last move, and the move, when there was one. */
  fenBefore?: string
  lastSan?: string
}): TheirPlan {
  const chess = new Chess(args.fen)
  const phase = phaseOf(chess)
  return {
    phase,
    did:
      args.fenBefore && args.lastSan
        ? describeTheirMove(args.fenBefore, args.lastSan, args.fen, args.you)
        : null,
    wants: theirIntent(args.style, phase),
    you: yourMove(args.fen, args.you, phase, args.style),
  }
}
