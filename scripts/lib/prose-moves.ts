/**
 * Machine-checking the chess PROSE, not just the chess moves.
 *
 * WHY THIS EXISTS. Sean said it straight: "you not tuned to chess so you not
 * getting it." He is right, and he has the receipts — the trapped-queen
 * breakdown claimed a queen "has to run" when she had seven moves including
 * taking the rook, and the FIX then invented two king moves that do not exist.
 * A 316-rated player caught both, because he looks at the board and the prose
 * generator does not.
 *
 * The app's architecture already assumes this: every move that ships is
 * engine-approved, every puzzle comes from a checked corpus, and the weakness
 * profile is Stockfish's judgement of Sean's games, not mine. The one layer
 * that was still unverified was the sentences AROUND the moves — and that is
 * exactly where both errors lived.
 *
 * So this module lets every verifier hold the prose to the board:
 *
 *   namedMoves        — SAN-shaped tokens in a sentence. Bare pawn pushes
 *                       ("d4") are deliberately not matched, because they are
 *                       indistinguishable from square names.
 *
 *   moveLegalSomewhere — a named move must be LEGAL in at least one of the
 *                       positions the text is about. "Kf1 allows Qxh1 mate"
 *                       names two moves, neither playable by the side to move,
 *                       so callers pass a tolerance set (flips, one-ply
 *                       replies, the whole line) that matches how explanations
 *                       actually reference variations.
 *
 *   movesClaimNumbers / countHoldsSomewhere — counting claims. "She has seven
 *                       moves" and "exactly two legal moves" are checkable
 *                       facts: the number must equal the side-to-move's total
 *                       or some single piece's move count in a position the
 *                       text is attached to. "The only move" is a count of one.
 *                       This is the exact class of claim that was fabricated.
 *
 * WHAT THIS STILL CANNOT CATCH, stated so nobody over-trusts it: a semantic
 * lie built from real moves. "h4 is the only square left on the file" names a
 * legal move and is still false — that needed a human. The counting check now
 * covers the numeric half of that sentence; the judgement half stays prose,
 * which is why every breakdown also carries its engine-checked line.
 */

import { Chess } from 'chess.js'

/** SAN-shaped tokens in prose, deduplicated, castling included. */
export function namedMoves(text: string): string[] {
  const re =
    /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/g
  return [...new Set(text.match(re) ?? [])]
}

/** The same position with the other side to move, when that is legal at all. */
function flipped(fen: string): string | null {
  const parts = fen.split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  // Flipping en passant/counters can confuse nothing here; the square file is
  // the only field that could mislead and chess.js revalidates it.
  parts[3] = '-'
  try {
    return new Chess(parts.join(' ')).fen()
  } catch {
    return null
  }
}

/**
 * Widen a set of positions with side-flips and every one-ply reply. This is
 * the breadth explanations genuinely use — "Kf1 allows Qxh1" reasons one move
 * deep for the other side — and no wider.
 */
export function expandTolerance(fens: string[]): string[] {
  const out = new Set<string>()
  for (const f of fens) {
    out.add(f)
    const flip = flipped(f)
    if (flip) out.add(flip)
  }
  for (const base of [...out]) {
    let board: Chess
    try {
      board = new Chess(base)
    } catch {
      continue
    }
    for (const m of board.moves()) {
      const b2 = new Chess(base)
      try {
        b2.move(m)
        out.add(b2.fen())
      } catch {
        /* skip */
      }
    }
  }
  return [...out]
}

/** Is this SAN a legal move in any of the given positions? */
export function moveLegalSomewhere(san: string, fens: string[]): boolean {
  const forms = [san, san.replace(/[+#]$/, '')]
  for (const f of fens) {
    for (const form of forms) {
      try {
        if (new Chess(f).move(form)) return true
      } catch {
        /* not legal here */
      }
    }
  }
  return false
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/**
 * Numeric claims about move counts. "seven moves", "exactly two legal moves",
 * "the only move". Deliberately narrow: "one square", "two checks", "four
 * moves of the knight's journey" in a tempo sense are not matched — plural
 * "moves" directly after a number, or the fixed phrase "the only move".
 */
export function movesClaimNumbers(text: string): number[] {
  const out: number[] = []
  // "moves ago/later/earlier/deep" are time references, not count claims —
  // "the position was lost two moves ago" counts nothing.
  const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+(?:legal\s+|possible\s+)?moves\b(?!\s+(?:ago|later|earlier|deep|in|of))/gi
  for (const m of text.matchAll(re)) {
    const raw = m[1]!.toLowerCase()
    out.push(NUMBER_WORDS[raw] ?? Number(raw))
  }
  if (/\bthe only (?:legal |safe )?move\b/i.test(text)) out.push(1)
  return out
}

/**
 * Does the claimed count hold in any given position? True when it equals the
 * side-to-move's total legal moves, or the move count of one single piece.
 * Callers keep this set TIGHT (the attached position and its flip, not the
 * one-ply expansion) or the check goes vacuous — some piece somewhere always
 * has N moves.
 */
export function countHoldsSomewhere(n: number, fens: string[]): boolean {
  for (const f of fens) {
    let board: Chess
    try {
      board = new Chess(f)
    } catch {
      continue
    }
    const verbose = board.moves({ verbose: true })
    if (verbose.length === n) return true
    const byFrom = new Map<string, number>()
    for (const m of verbose) byFrom.set(m.from, (byFrom.get(m.from) ?? 0) + 1)
    for (const count of byFrom.values()) if (count === n) return true
  }
  return false
}

/** The tight set for counting claims: the position itself plus its flip. */
export function countingScope(fen: string): string[] {
  const flip = flipped(fen)
  return flip ? [fen, flip] : [fen]
}
