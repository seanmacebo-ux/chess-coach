/**
 * Game analysis: turning your moves into a diagnosis.
 *
 * A severity label ("blunder") tells you a move was bad. It does not tell you
 * what to practise. This module answers the second question — WHY the move
 * was bad, as a tag that maps onto a tier you can go train.
 *
 * Two engine calls per move (position before, position after), so a 40-move
 * game is ~80 searches. Run it after the game, not during.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { getEngine } from '../engine/uci'
import { lineScore, type UciMove } from '../engine/types'

export type Severity = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

/**
 * Why the move was bad. Each tag maps to tier themes so a diagnosis becomes
 * a training prescription rather than a scolding.
 */
export type MistakeTag =
  | 'hung-piece'
  | 'missed-free-material'
  | 'missed-mate'
  | 'missed-fork'
  | 'allowed-fork'
  | 'missed-tactic'
  | 'bad-trade'
  | 'king-safety'
  | 'passive'
  | 'endgame-technique'
  | 'opening-inaccuracy'

export const TAG_LABEL: Record<MistakeTag, string> = {
  'hung-piece': 'Left a piece hanging',
  'missed-free-material': 'Missed free material',
  'missed-mate': 'Missed a forced mate',
  'missed-fork': 'Missed a fork',
  'allowed-fork': 'Walked into a fork',
  'missed-tactic': 'Missed a tactic',
  'bad-trade': 'Bad trade',
  'king-safety': 'Weakened your king',
  passive: 'Too passive',
  'endgame-technique': 'Endgame technique',
  'opening-inaccuracy': 'Opening inaccuracy',
}

/** Which tier themes each tag should push you toward. */
export const TAG_THEMES: Record<MistakeTag, string[]> = {
  'hung-piece': ['piece-safety', 'hangingPiece'],
  'missed-free-material': ['hangingPiece', 'piece-safety'],
  'missed-mate': ['mateIn1', 'mateIn2', 'mateIn3', 'backRankMate'],
  'missed-fork': ['fork'],
  'allowed-fork': ['fork', 'threat-detection'],
  'missed-tactic': ['pin', 'skewer', 'discoveredAttack', 'deflection'],
  'bad-trade': ['simplification', 'bishop-quality'],
  'king-safety': ['exposedKing', 'defence', 'threat-detection'],
  passive: ['plan-selection', 'open-file', 'space'],
  'endgame-technique': ['rookEndgame', 'pawnEndgame', 'conversion'],
  'opening-inaccuracy': ['opening-principles', 'development'],
}

export type Phase = 'opening' | 'middlegame' | 'endgame'

export interface MoveAssessment {
  ply: number
  /** Position before the move. */
  fen: string
  san: string
  uci: UciMove
  /** Centipawns lost versus the engine's choice. Clamped, always >= 0. */
  lossCp: number
  severity: Severity
  /** What the engine wanted instead. */
  bestUci: UciMove | null
  bestSan: string | null
  tag: MistakeTag | null
  phase: Phase
}

/* ------------------------------------------------------------------ */
/* Board helpers                                                       */
/* ------------------------------------------------------------------ */

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

/** Same clamp rationale as the calibration harness: mates would swamp everything. */
const EVAL_CAP = 1000
const clampEval = (cp: number) => Math.max(-EVAL_CAP, Math.min(EVAL_CAP, cp))

function phaseOf(chess: Chess): Phase {
  const moveNo = Number(chess.fen().split(' ')[5] ?? 1)
  let officers = 0
  for (const row of chess.board()) {
    for (const c of row) {
      if (c && c.type !== 'p' && c.type !== 'k') officers++
    }
  }
  if (officers <= 4) return 'endgame'
  if (moveNo <= 12) return 'opening'
  return 'middlegame'
}

/**
 * Pieces of `colour` that are attacked and undefended.
 *
 * Deliberately cheap. Not a full static-exchange evaluation — that needs a
 * proper SEE and this runs on a phone after every game.
 */
function loosePieces(chess: Chess, colour: 'w' | 'b'): { square: Square; value: number }[] {
  const enemy = colour === 'w' ? 'b' : 'w'
  const out: { square: Square; value: number }[] = []
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== colour || cell.type === 'k') continue
      const sq = cell.square as Square
      if (!chess.isAttacked(sq, enemy)) continue
      if (!chess.isAttacked(sq, colour)) {
        out.push({ square: sq, value: VALUE[cell.type] ?? 0 })
      }
    }
  }
  return out
}

/** Does the piece now on `to` attack two or more valuable enemy pieces? */
function isFork(chess: Chess, to: Square): boolean {
  const mover = chess.get(to)
  if (!mover) return false
  const targets = chess
    .moves({ square: to, verbose: true })
    .filter((m) => m.captured && (VALUE[m.captured] ?? 0) >= 320)
  return targets.length >= 2 || (targets.length >= 1 && chess.isCheck())
}

function severityOf(loss: number): Severity {
  if (loss < 10) return 'best'
  if (loss < 50) return 'good'
  if (loss < 100) return 'inaccuracy'
  if (loss < 250) return 'mistake'
  return 'blunder'
}

/* ------------------------------------------------------------------ */
/* Diagnosis                                                           */
/* ------------------------------------------------------------------ */

/**
 * Why was this move bad? Ordered most-specific first — the first match wins,
 * because "you hung a rook" is more actionable than "you missed a tactic".
 */
function diagnose(
  fenBefore: string,
  playedUci: UciMove,
  bestUci: UciMove | null,
  bestIsMate: boolean,
  phase: Phase,
): MistakeTag | null {
  const before = new Chess(fenBefore)
  const mover = before.turn()

  if (bestIsMate) return 'missed-mate'

  const after = new Chess(fenBefore)
  try {
    after.move({
      from: playedUci.slice(0, 2),
      to: playedUci.slice(2, 4),
      promotion: playedUci[4],
    })
  } catch {
    return null
  }

  // Did this move leave something hanging that wasn't hanging before?
  const looseBefore = loosePieces(before, mover).reduce((s, p) => Math.max(s, p.value), 0)
  const looseAfter = loosePieces(after, mover).reduce((s, p) => Math.max(s, p.value), 0)
  if (looseAfter >= 300 && looseAfter > looseBefore) return 'hung-piece'

  if (bestUci) {
    // Was there free material the engine's move simply takes?
    const bestTo = bestUci.slice(2, 4) as Square
    const victim = before.get(bestTo)
    if (victim && victim.color !== mover) {
      const undefended = !before.isAttacked(bestTo, victim.color)
      if (undefended && (VALUE[victim.type] ?? 0) >= 300) return 'missed-free-material'
    }
    // Does the engine's move fork?
    const probe = new Chess(fenBefore)
    try {
      probe.move({ from: bestUci.slice(0, 2), to: bestTo, promotion: bestUci[4] })
      if (isFork(probe, bestTo)) return 'missed-fork'
    } catch {
      /* engine move not legal here — ignore */
    }
  }

  // Does the opponent now have a fork available?
  const enemyForks = after.moves({ verbose: true }).some((m) => {
    const probe = new Chess(after.fen())
    try {
      probe.move({ from: m.from, to: m.to, promotion: m.promotion })
    } catch {
      return false
    }
    return isFork(probe, m.to as Square)
  })
  if (enemyForks) return 'allowed-fork'

  if (phase === 'opening') return 'opening-inaccuracy'
  if (phase === 'endgame') return 'endgame-technique'
  return 'missed-tactic'
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface AnalyseOptions {
  /** Only assess moves by this colour — normally the human's. */
  colour: 'w' | 'b'
  depth?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * Walk a finished game and assess every move by `colour`.
 *
 * Evaluations are taken from the MOVER's point of view throughout. UCI reports
 * side-to-move POV, so the eval after the move gets negated — the same sign
 * trap that would otherwise report every move as brilliant.
 */
export async function analyseGame(
  pgnOrMoves: string[] | string,
  opts: AnalyseOptions,
): Promise<MoveAssessment[]> {
  const engine = getEngine()
  const depth = opts.depth ?? 14

  const replay = new Chess()
  if (typeof pgnOrMoves === 'string') replay.loadPgn(pgnOrMoves)
  else for (const m of pgnOrMoves) replay.move(m)

  const history = replay.history({ verbose: true })
  const board = new Chess()
  const out: MoveAssessment[] = []
  const mine = history.filter((h) => h.color === opts.colour).length
  let done = 0

  for (let ply = 0; ply < history.length; ply++) {
    const h = history[ply]!
    const fenBefore = board.fen()

    if (h.color !== opts.colour) {
      board.move({ from: h.from, to: h.to, promotion: h.promotion })
      continue
    }

    const before = await engine.analyse(fenBefore, { depth, multipv: 1 })
    const bestLine = before.lines[0]
    const bestScore = bestLine ? clampEval(lineScore(bestLine)) : 0
    const bestIsMate = Boolean(bestLine?.mate && bestLine.mate > 0)
    const bestUci = before.bestMove
    let bestSan: string | null = null
    if (bestUci) {
      const probe = new Chess(fenBefore)
      try {
        bestSan =
          probe.move({
            from: bestUci.slice(0, 2),
            to: bestUci.slice(2, 4),
            promotion: bestUci[4],
          })?.san ?? null
      } catch {
        bestSan = null
      }
    }

    const playedUci = `${h.from}${h.to}${h.promotion ?? ''}`
    board.move({ from: h.from, to: h.to, promotion: h.promotion })

    let lossCp = 0
    if (!board.isGameOver()) {
      const after = await engine.analyse(board.fen(), { depth, multipv: 1 })
      const afterLine = after.lines[0]
      const playedScore = afterLine ? clampEval(-lineScore(afterLine)) : bestScore
      lossCp = Math.max(0, bestScore - playedScore)
    }

    const severity = severityOf(lossCp)
    const phase = phaseOf(new Chess(fenBefore))
    const tag =
      severity === 'best' || severity === 'good'
        ? null
        : diagnose(fenBefore, playedUci, bestUci, bestIsMate, phase)

    out.push({
      ply,
      fen: fenBefore,
      san: h.san,
      uci: playedUci,
      lossCp: Math.round(lossCp),
      severity,
      bestUci,
      bestSan,
      tag,
      phase,
    })

    opts.onProgress?.(++done, mine)
  }

  return out
}

/** Average centipawn loss across assessed moves — your accuracy number. */
export function acpl(assessments: MoveAssessment[]): number {
  if (assessments.length === 0) return 0
  return Math.round(assessments.reduce((s, a) => s + a.lossCp, 0) / assessments.length)
}

/**
 * Rough performance rating from ACPL. Inverts the same band table the bots
 * use, so "you played like a 1450 today" is measured on one consistent scale
 * rather than two that quietly disagree.
 */
export function performanceRating(avgLoss: number): number {
  const table: [number, number][] = [
    [150, 800],
    [120, 1000],
    [95, 1200],
    [75, 1400],
    [60, 1600],
    [48, 1800],
    [38, 2000],
    [30, 2200],
  ]
  const first = table[0]!
  const last = table[table.length - 1]!
  if (avgLoss >= first[0]) return first[1]
  if (avgLoss <= last[0]) return last[1]
  for (let i = 0; i < table.length - 1; i++) {
    const [hiLoss, loElo] = table[i]!
    const [loLoss, hiElo] = table[i + 1]!
    if (avgLoss <= hiLoss && avgLoss > loLoss) {
      const t = (hiLoss - avgLoss) / (hiLoss - loLoss)
      return Math.round(loElo + t * (hiElo - loElo))
    }
  }
  return 1400
}
