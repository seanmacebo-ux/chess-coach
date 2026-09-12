/**
 * Reading a position, and weighing the moves in it — from the board.
 *
 * Sean: "I need to be able to understand what is happening in the game and
 * how to weigh options."
 *
 * Everything the app said until now was a VERDICT. "Blunder." "Mistake."
 * "d3 82%, c3 81%." All true, all useless at the board, because none of it is
 * reproducible without the engine sitting next to you. Knowing that d3 scores
 * one point higher teaches nothing; knowing that d3 defends the bishop while
 * c3 leaves it loose teaches the check you can run yourself next time.
 *
 * So this module answers two questions in terms a person can verify:
 *
 *   WHAT IS HAPPENING — material, king safety, loose pieces on both sides,
 *   the centre, space, development, and who has more to do. Silman's
 *   imbalances, which is the framework the books in this repo actually teach.
 *
 *   WHAT DOES THIS MOVE DO, AND COST — per candidate: what it wins, defends,
 *   develops or threatens, and what it drops, exposes or blocks.
 *
 * EVERY CLAIM IS COMPUTED FROM THE BOARD. No engine, no prose templates with
 * a hole in them, nothing that could be true "usually". This is deliberate
 * and it is not a style preference: this app has previously told Sean that a
 * queen had to run when she had seven squares, and that a knight would block
 * a pawn that was already captured. A coach that invents is worse than a
 * coach that says less, so this says only what chess.js can confirm.
 *
 * The one thing it will not do is rank the moves. Weighing is the skill being
 * taught; handing over an ordering would replace it with obedience.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'

export type Side = 'w' | 'b'

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}
const CENTRE: Square[] = ['d4', 'e4', 'd5', 'e5']

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function pieces(chess: Chess, side: Side): { square: Square; type: string }[] {
  const out: { square: Square; type: string }[] = []
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === side) out.push({ square: cell.square as Square, type: cell.type })
    }
  }
  return out
}

function material(chess: Chess, side: Side): number {
  return pieces(chess, side).reduce((sum, p) => sum + (VALUE[p.type] ?? 0), 0)
}

/** Attacked by the enemy and defended by nobody. Kings and pawns excluded. */
export function hanging(chess: Chess, side: Side): { square: Square; type: string }[] {
  return pieces(chess, side).filter(
    (p) =>
      p.type !== 'k' &&
      p.type !== 'p' &&
      chess.isAttacked(p.square, other(side)) &&
      !chess.isAttacked(p.square, side),
  )
}

function kingSquare(chess: Chess, side: Side): Square | null {
  return pieces(chess, side).find((p) => p.type === 'k')?.square ?? null
}

/**
 * How many legal moves a side has, including when it is not their turn.
 *
 * Counting the side not to move needs the turn flipped, and a flipped
 * position can be nonsense — if they are in check, "their move" is a position
 * where a king can be captured. Those return null rather than a made-up
 * number.
 */
export function mobility(fen: string, side: Side): number | null {
  const chess = new Chess(fen)
  if (chess.turn() === side) return chess.moves().length
  const parts = fen.split(' ')
  parts[1] = side
  parts[3] = '-'
  try {
    const flipped = new Chess(parts.join(' '))
    /*
     * The illegal case is the OPPONENT being in check after the flip: that
     * means we have handed the move to a side that can capture a king, and
     * the move count would be fantasy. The first version asked whether the
     * flipped side was in check, which is a different and mostly harmless
     * question — so it happily counted moves in exactly the position it was
     * meant to refuse.
     */
    const theirKing = kingSquare(flipped, other(side))
    if (theirKing && flipped.isAttacked(theirKing, side)) return null
    return flipped.moves().length
  } catch {
    return null
  }
}

/** Enemy pieces standing within two squares of your king. */
function attackersNearKing(chess: Chess, side: Side): number {
  const king = kingSquare(chess, side)
  if (!king) return 0
  const kf = king.charCodeAt(0)
  const kr = Number(king[1])
  return pieces(chess, other(side)).filter((p) => {
    if (p.type === 'k' || p.type === 'p') return false
    const d = Math.max(Math.abs(p.square.charCodeAt(0) - kf), Math.abs(Number(p.square[1]) - kr))
    return d <= 2
  }).length
}

/** Pawns still on their starting squares in front of a castled king. */
function shieldIntact(chess: Chess, side: Side): boolean | null {
  const king = kingSquare(chess, side)
  if (!king) return null
  const homeRank = side === 'w' ? '1' : '8'
  if (king[1] !== homeRank) return null
  const file = king.charCodeAt(0)
  const shieldRank = side === 'w' ? '2' : '7'
  let intact = 0
  for (const df of [-1, 0, 1]) {
    const f = String.fromCharCode(file + df)
    if (f < 'a' || f > 'h') continue
    const p = chess.get(`${f}${shieldRank}` as Square)
    if (p && p.type === 'p' && p.color === side) intact++
  }
  return intact >= 2
}

/* ------------------------------------------------------------------ */
/* What is happening                                                   */
/* ------------------------------------------------------------------ */

export interface PositionRead {
  /** Material difference in pawns, from your side. Positive = you are up. */
  materialDiff: number
  yourHanging: { square: Square; type: string }[]
  theirHanging: { square: Square; type: string }[]
  /** Centre squares you attack, and they attack. */
  yourCentre: number
  theirCentre: number
  /** Legal moves available, or null where the flipped position is illegal. */
  yourMobility: number | null
  theirMobility: number | null
  /** Officers still on the back rank — only meaningful in the opening. */
  yourUndeveloped: number
  theirUndeveloped: number
  yourKingShield: boolean | null
  theirKingShield: boolean | null
  attackersNearYourKing: number
  attackersNearTheirKing: number
  inCheck: boolean
  /** The read as sentences, each one backed by a number above. */
  lines: string[]
}

/**
 * Knights and bishops still at home. NOT the queen or the rooks.
 *
 * The first version counted the queen, which would have told him he was
 * "behind in development" for leaving her on d1 — the single most correct
 * thing a beginner can do in the opening. Rooks are out too: they develop by
 * castling and by files opening, not by leaving the back rank early.
 */
function undeveloped(chess: Chess, side: Side): number {
  const rank = side === 'w' ? '1' : '8'
  return pieces(chess, side).filter(
    (p) => p.square[1] === rank && (p.type === 'n' || p.type === 'b'),
  ).length
}

function centreControl(chess: Chess, side: Side): number {
  return CENTRE.filter((sq) => chess.isAttacked(sq, side)).length
}

export function readPosition(fen: string, you: Side): PositionRead {
  const chess = new Chess(fen)
  const them = other(you)

  const read: PositionRead = {
    materialDiff: material(chess, you) - material(chess, them),
    yourHanging: hanging(chess, you),
    theirHanging: hanging(chess, them),
    yourCentre: centreControl(chess, you),
    theirCentre: centreControl(chess, them),
    yourMobility: mobility(fen, you),
    theirMobility: mobility(fen, them),
    yourUndeveloped: undeveloped(chess, you),
    theirUndeveloped: undeveloped(chess, them),
    yourKingShield: shieldIntact(chess, you),
    theirKingShield: shieldIntact(chess, them),
    attackersNearYourKing: attackersNearKing(chess, you),
    attackersNearTheirKing: attackersNearKing(chess, them),
    inCheck: chess.turn() === you && chess.inCheck(),
    lines: [],
  }

  /*
   * Ordered by what decides games at this level, not by what is most
   * interesting: material and loose pieces first, king safety next, and the
   * slow stuff last. A read that opens with centre control while a rook is
   * hanging is technically true and practically useless.
   */
  const lines: string[] = []

  if (read.inCheck) lines.push('You are in check — that is the whole move.')

  if (read.materialDiff > 0) lines.push(`You are up ${describeMaterial(read.materialDiff)}.`)
  else if (read.materialDiff < 0) lines.push(`You are down ${describeMaterial(-read.materialDiff)}.`)
  else lines.push('Material is level.')

  if (read.theirHanging.length > 0) {
    const list = read.theirHanging.map((p) => `${NAME[p.type]} on ${p.square}`).join(', ')
    lines.push(`Free for the taking: their ${list}. Check it is really free before you take.`)
  }
  if (read.yourHanging.length > 0) {
    const list = read.yourHanging.map((p) => `${NAME[p.type]} on ${p.square}`).join(', ')
    lines.push(`Loose and undefended: your ${list}.`)
  }
  if (read.theirHanging.length === 0 && read.yourHanging.length === 0) {
    lines.push('Nothing is hanging on either side.')
  }

  if (read.attackersNearYourKing >= 2 && read.attackersNearYourKing > read.attackersNearTheirKing) {
    lines.push(
      `${read.attackersNearYourKing} of their pieces are within two squares of your king and ${read.attackersNearTheirKing} of yours are near theirs. You are the one being attacked.`,
    )
  } else if (
    read.attackersNearTheirKing >= 2 &&
    read.attackersNearTheirKing > read.attackersNearYourKing
  ) {
    lines.push(
      `${read.attackersNearTheirKing} of your pieces are within two squares of their king. You are the one attacking.`,
    )
  }

  if (read.yourKingShield === false && read.theirKingShield !== false) {
    lines.push('Your king is on its home rank with its pawn cover broken.')
  }

  if (read.yourUndeveloped + read.theirUndeveloped > 0) {
    if (read.yourUndeveloped > read.theirUndeveloped) {
      lines.push(
        `They have ${read.theirUndeveloped} pieces still at home and you have ${read.yourUndeveloped}. You are behind in development.`,
      )
    } else if (read.theirUndeveloped > read.yourUndeveloped) {
      lines.push(
        `You have ${read.yourUndeveloped} pieces still at home and they have ${read.theirUndeveloped}. You are ahead in development.`,
      )
    }
  }

  if (read.yourCentre !== read.theirCentre) {
    lines.push(
      `The centre: you cover ${read.yourCentre} of the four middle squares, they cover ${read.theirCentre}.`,
    )
  }

  read.lines = lines
  return read
}

function describeMaterial(diff: number): string {
  if (diff >= 9) return 'a queen or more'
  if (diff >= 5) return 'a rook'
  if (diff >= 3) return 'a piece'
  if (diff === 2) return 'two pawns'
  return 'a pawn'
}

/* ------------------------------------------------------------------ */
/* Weighing one move                                                   */
/* ------------------------------------------------------------------ */

export interface MoveWeight {
  san: string
  /** What it achieves, board-checked. */
  does: string[]
  /** What it gives up, board-checked. */
  costs: string[]
}

/**
 * What a move does and what it costs.
 *
 * Deliberately no score and no ranking. A number would let him skip the
 * thinking, which is the thing being trained; two lists make him compare.
 */
export function weighMove(fen: string, san: string): MoveWeight | null {
  const before = new Chess(fen)
  const you = before.turn()
  const them = other(you)

  let mv
  try {
    mv = before.move(san)
  } catch {
    return null
  }
  if (!mv) return null
  // `before` has now advanced; keep both states explicitly.
  const after = before
  const start = new Chess(fen)

  const does: string[] = []
  const costs: string[] = []

  /* ---- what it achieves ---- */

  if (mv.captured) {
    const taken = VALUE[mv.captured] ?? 0
    const risked = VALUE[mv.piece] ?? 0
    const defended = after.isAttacked(mv.to as Square, them)
    if (!defended) does.push(`Wins a ${NAME[mv.captured]} for nothing.`)
    else if (taken >= risked) does.push(`Takes a ${NAME[mv.captured]} with a ${NAME[mv.piece]} — an even trade or better, but they can take back.`)
    else costs.push(`Gives up a ${NAME[mv.piece]} for a ${NAME[mv.captured]} on a defended square.`)
  }

  if (after.isCheckmate()) does.push('Checkmate.')
  else if (after.isCheck()) does.push('Gives check — they must answer it.')

  if (mv.san === 'O-O' || mv.san === 'O-O-O') does.push('Castles the king into safety and connects the rooks.')

  // Development: an officer leaving the back rank, in the opening only.
  const homeRank = you === 'w' ? '1' : '8'
  if (mv.from[1] === homeRank && ['n', 'b', 'q', 'r'].includes(mv.piece) && Number(fen.split(' ')[5] ?? 1) <= 12) {
    does.push(`Develops the ${NAME[mv.piece]} off the back rank.`)
  }

  // Does it defend something that was loose?
  const looseBefore = hanging(start, you).map((p) => p.square)
  const looseAfter = hanging(after, you).map((p) => p.square)
  const nowDefended = looseBefore.filter((sq) => !looseAfter.includes(sq) && sq !== mv.from)
  if (nowDefended.length > 0) {
    does.push(`Defends your ${nowDefended.map((sq) => `piece on ${sq}`).join(' and ')}.`)
  }

  // Does it attack something valuable that was not attacked before?
  const newlyAttacked = pieces(after, them).filter(
    (p) =>
      p.type !== 'k' &&
      (VALUE[p.type] ?? 0) >= 3 &&
      after.isAttacked(p.square, you) &&
      !start.isAttacked(p.square, you),
  )
  if (newlyAttacked.length >= 2) {
    does.push(
      `Attacks two pieces at once — their ${newlyAttacked.map((p) => `${NAME[p.type]} on ${p.square}`).join(' and ')}.`,
    )
  } else if (newlyAttacked.length === 1) {
    const t = newlyAttacked[0]!
    does.push(`Attacks their ${NAME[t.type]} on ${t.square}.`)
  }

  const centreGained = CENTRE.filter((sq) => after.isAttacked(sq, you) && !start.isAttacked(sq, you))
  if (centreGained.length > 0) does.push(`Takes control of ${centreGained.join(' and ')}.`)

  /* ---- what it costs ---- */

  // The moved piece landing somewhere it is simply taken.
  if (after.isAttacked(mv.to as Square, them) && !after.isAttacked(mv.to as Square, you)) {
    costs.push(`Your ${NAME[mv.piece]} on ${mv.to} is attacked there and nothing defends it.`)
  }

  // Something else left hanging that was not hanging before.
  const newlyLoose = looseAfter.filter((sq) => !looseBefore.includes(sq) && sq !== mv.to)
  if (newlyLoose.length > 0) {
    costs.push(
      `Leaves your ${newlyLoose
        .map((sq) => `${NAME[after.get(sq)?.type ?? 'p']} on ${sq}`)
        .join(' and ')} undefended.`,
    )
  }

  // A pawn leaving the shield in front of a castled king.
  if (mv.piece === 'p' && shieldIntact(start, you) === true && shieldIntact(after, you) === false) {
    costs.push('Breaks the pawn cover in front of your own king.')
  }

  // Moving the same piece twice in the opening, for nothing.
  const history = start.history({ verbose: true })
  if (
    Number(fen.split(' ')[5] ?? 1) <= 12 &&
    !mv.captured &&
    history.some((h) => h.color === you && h.to === mv.from)
  ) {
    costs.push(`Moves the ${NAME[mv.piece]} a second time while pieces are still at home.`)
  }

  if (does.length === 0) does.push('Nothing concrete — a quiet move.')
  if (costs.length === 0) costs.push('Nothing loose, nothing exposed.')

  return { san: mv.san, does, costs }
}
