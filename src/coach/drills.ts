/**
 * Question builders for the three generated drills.
 *
 * These used to live inside the runner components, which made them
 * unverifiable: importing a .tsx into a Node script drags in React and
 * chessground, and chessground touches the DOM. So the logic that decides what
 * the right answer IS could only ever be checked by clicking through the app
 * and trusting what it told you — which is exactly the thing a sandbox exists
 * to stop.
 *
 * Two consequences of pulling them out:
 *
 *   Every builder takes an optional `Analyser`. The browser passes the Worker
 *   engine, the sandbox passes the Node one. Same code path in both, so the
 *   check measures what actually ships rather than a reimplementation.
 *
 *   The components keep only rendering and scoring. Question generation is
 *   pure data-in, data-out.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'

import { buildThreatExercise, loosePieces, type ThreatMove } from './exercises'
import { getEngine } from '../engine/uci'
import { lineScore, type Analysis } from '../engine/types'
import type { Puzzle } from '../data/puzzles'

/**
 * The only part of the engine these builders need.
 *
 * Deliberately minimal so both the browser Worker engine and the Node
 * transport satisfy it without either knowing about the other.
 */
export interface Analyser {
  analyse(fen: string, opts?: { depth?: number; multipv?: number }): Promise<Analysis>
}

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

/* ================================================================== */
/* Scan — spot the loose piece                                         */
/* ================================================================== */

export interface ScanQuestion {
  id: string
  fen: string
  colour: 'w' | 'b'
  answers: Square[]
  options: Square[]
}

/** Ignore loose pawns. At club level a hanging pawn is rarely the game. */
const MIN_VALUE = 300
const SCAN_OPTIONS = 6

/**
 * Turn puzzle positions into scan questions.
 *
 * Uses the puzzle corpus purely as a supply of realistic middlegame positions —
 * the puzzle's own tactic is irrelevant. Rejects positions with nothing loose,
 * because "nothing is hanging" as an answer teaches the wrong reflex when it is
 * the only case you ever meet.
 */
export function buildScanQuestions(puzzles: Puzzle[], want: number): ScanQuestion[] {
  const out: ScanQuestion[] = []

  for (const p of puzzles) {
    if (out.length >= want) break
    const colour: 'w' | 'b' = p.colour === 'white' ? 'w' : 'b'
    const board = new Chess(p.fen)

    const answers = loosePieces(p.fen, colour).filter((sq) => {
      const piece = board.get(sq)
      return piece ? (VALUE[piece.type] ?? 0) >= MIN_VALUE : false
    })
    if (answers.length === 0 || answers.length > 3) continue

    // Decoys are your OWN other pieces — the discrimination being trained is
    // loose versus defended, not "which square has a piece on it".
    const decoys: Square[] = []
    for (const row of board.board()) {
      for (const cell of row) {
        if (!cell || cell.color !== colour || cell.type === 'k') continue
        const sq = cell.square as Square
        if (answers.includes(sq)) continue
        if ((VALUE[cell.type] ?? 0) < MIN_VALUE) continue
        decoys.push(sq)
      }
    }
    if (decoys.length === 0) continue

    const options = [...answers, ...decoys.slice(0, SCAN_OPTIONS - answers.length)].sort()
    if (options.length < 2) continue

    out.push({ id: p.id, fen: p.fen, colour, answers, options })
  }

  return out
}

/* ================================================================== */
/* Threat — what would they play if you passed                         */
/* ================================================================== */

export interface ThreatQuestion {
  id: string
  fen: string
  colour: 'w' | 'b'
  /** UCI of the move they would actually play. The thing being asked for. */
  answer: string
  /** Where it lands. Used to explain the threat afterwards, not to answer it. */
  answerSquare: Square
  san: string
  swingCp: number
  /** How clear-cut the answer is — see `minMarginCp` in buildThreatExercise. */
  marginCp: number
  options: ThreatMove[]
}

// Raised from 10, then from 14, after the sandbox found deeper audits
// disagreeing with the drill's answer. A threat question that names the wrong
// square marks a correct answer wrong, which is worse than not asking.
const THREAT_DEPTH = 16
const THREAT_OPTIONS = 6

export async function buildThreatQuestions(
  puzzles: Puzzle[],
  want: number,
  onProgress?: (done: number, total: number) => void,
  engine?: Analyser,
): Promise<ThreatQuestion[]> {
  const out: ThreatQuestion[] = []

  // Cheap filter first: if nothing of yours is hanging there is usually no
  // threat worth asking about, and finding that out costs two searches.
  const candidates = puzzles.filter((p) => {
    const colour: 'w' | 'b' = p.colour === 'white' ? 'w' : 'b'
    const board = new Chess(p.fen)
    return loosePieces(p.fen, colour).some((sq) => {
      const piece = board.get(sq)
      return piece ? (VALUE[piece.type] ?? 0) >= MIN_VALUE : false
    })
  })

  const budget = Math.min(candidates.length, want * 4)

  for (let i = 0; i < budget && out.length < want; i++) {
    const p = candidates[i]!
    onProgress?.(i + 1, budget)

    let ex
    try {
      ex = await buildThreatExercise(p.fen, {
        depth: THREAT_DEPTH,
        minSwingCp: 150,
        multipv: THREAT_OPTIONS,
        engine,
      })
    } catch {
      continue
    }
    if (!ex) continue

    const colour: 'w' | 'b' = p.colour === 'white' ? 'w' : 'b'

    /*
     * Decoys are their OTHER moves — not squares their pieces happen to sit on.
     *
     * The previous version built decoys from every square occupied by an enemy
     * piece, while the answer was the square their move LANDED on. Those are
     * different kinds of thing, and the difference was visible: five options
     * held one of their pieces and the sixth did not, so the answer was the
     * odd one out and the whole drill could be solved by elimination without
     * looking at the board once.
     *
     * Ranking real candidate moves fixes both halves. Every option is now
     * something they could actually play, so there is nothing to eliminate,
     * and the options are the same kind of object as the question — which is
     * what lets the prompt say "what would they play" and mean it.
     */
    const options: ThreatMove[] = [
      { uci: ex.threatUci, san: ex.threatSan },
      ...ex.alternatives.slice(0, THREAT_OPTIONS - 1),
    ]
    // Alphabetical, so the answer's position carries no information.
    options.sort((a, b) => a.san.localeCompare(b.san))
    if (options.length < 3) continue

    out.push({
      id: p.id,
      fen: ex.fen,
      colour,
      answer: ex.threatUci,
      answerSquare: ex.answerSquare,
      san: ex.threatSan,
      swingCp: ex.swingCp,
      marginCp: ex.marginCp,
      options,
    })
  }

  return out
}

/* ================================================================== */
/* Candidates — which moves would you even look at                     */
/* ================================================================== */

export interface CandidateOption {
  uci: string
  san: string
  cp: number | null
  good: boolean
}

export interface CandidateQuestion {
  id: string
  fen: string
  colour: 'w' | 'b'
  options: CandidateOption[]
  best: string[]
}

export const CANDIDATE_TOP_N = 3
export const CANDIDATE_PICK_LIMIT = 3
const CANDIDATE_OPTIONS = 8
// 16, not 12. At depth 12 the spread check passed a move that a depth-16
// search showed giving away 517cp — the drill would have told you a
// five-pawn blunder "deserved a look", which is the precise error the spread
// filter exists to prevent. The set is built once per session, so the extra
// depth costs a second and buys correctness.
const CANDIDATE_DEPTH = 16

/**
 * Past this, a score is a forced mate rather than a number of pawns.
 * lineScore maps mates onto ±100,000 so they sort correctly.
 */
const MATE_THRESHOLD = 90_000

/**
 * How far apart the top three may be before the position stops being a
 * candidate-moves exercise.
 *
 * This check exists because the sandbox caught the drill red-handed. In a
 * position with a forced mate, the engine's second and third choices are
 * worthless — and the drill was marking them "good" and rewarding you for
 * picking them. Same in any position with one crushing move: it reported
 * "you should also have considered Rf6", a move that drops a rook.
 *
 * A position with one obviously best move is a FIND-THE-MOVE puzzle, and the
 * puzzle runner already does those. Kotov's exercise only makes sense where
 * several moves are genuinely competitive, so positions where they are not are
 * now rejected rather than mistaught.
 */
const CANDIDATE_MAX_SPREAD_CP = 150

function toSan(fen: string, uci: string): string | null {
  const board = new Chess(fen)
  try {
    return (
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })?.san ?? null
    )
  } catch {
    return null
  }
}

export async function buildCandidateQuestions(
  puzzles: Puzzle[],
  want: number,
  onProgress?: (done: number, total: number) => void,
  engine?: Analyser,
): Promise<CandidateQuestion[]> {
  const out: CandidateQuestion[] = []
  // Six times, not three: the trustworthiness check legitimately rejects
  // positions, so the pool has to be wide enough to still fill the set.
  const budget = Math.min(puzzles.length, want * 6)
  const eng = engine ?? getEngine()

  for (let i = 0; i < budget && out.length < want; i++) {
    const p = puzzles[i]!
    onProgress?.(i + 1, budget)

    /*
     * Use the position AFTER the puzzle's tactic has been played out.
     *
     * The corpus is, by construction, positions where one move wins — so
     * sourcing candidate questions from them directly produced nothing usable
     * once the "top three must be competitive" rule went in: the sandbox
     * reported a yield of 0 from 240 positions, which is the honest answer to
     * "is a tactic puzzle a candidate-moves exercise". It is not.
     *
     * Playing the line to its end spends the tactic and leaves an ordinary
     * middlegame, which is exactly the kind of position where several moves
     * genuinely deserve a look. Free, and it reuses positions already loaded.
     */
    const board = new Chess(p.fen)
    let playedOut = true
    for (const uci of p.line) {
      try {
        const m = board.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4],
        })
        if (!m) {
          playedOut = false
          break
        }
      } catch {
        playedOut = false
        break
      }
    }
    if (!playedOut || board.isGameOver()) continue

    const fen = board.fen()
    const legal = board.moves({ verbose: true })
    // Too few legal moves and "which would you consider" is not a question.
    if (legal.length < CANDIDATE_OPTIONS + 1) continue

    let analysis
    try {
      analysis = await eng.analyse(fen, { depth: CANDIDATE_DEPTH, multipv: CANDIDATE_TOP_N })
    } catch {
      continue
    }
    if (analysis.lines.length < CANDIDATE_TOP_N) continue

    const ranked = analysis.lines
      .map((l) => ({ uci: l.pv[0] ?? '', cp: lineScore(l) }))
      .filter((r) => r.uci !== '')
    if (ranked.length < CANDIDATE_TOP_N) continue

    const top = ranked.slice(0, CANDIDATE_TOP_N)

    // A forced mate means there is one move, not three worth weighing.
    if (Math.abs(top[0]!.cp) >= MATE_THRESHOLD) continue

    // And the three have to be genuinely close, or the drill would be telling
    // you that a rook-losing move "deserved a look".
    if (top[0]!.cp - top[top.length - 1]!.cp > CANDIDATE_MAX_SPREAD_CP) continue

    /*
     * Verify each pick by playing it, rather than trusting one multipv
     * snapshot.
     *
     * A single search ranks moves against each other at one depth, and that
     * ranking can hide a horizon problem: position 2rGYX passed the spread
     * check at depth 12 AND at depth 16, and a depth-18 audit then found one
     * of its "good" moves walking into a forced mate. Ranking says which move
     * the search preferred; playing the move and evaluating the result says
     * what it is actually worth. Only the second one is safe to teach from.
     *
     * Costs three extra searches per question. The set is built once per
     * session, behind a progress indicator, so that is affordable.
     */
    let trustworthy = true
    for (const r of top) {
      const probe = new Chess(fen)
      try {
        probe.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] })
      } catch {
        trustworthy = false
        break
      }
      const reply = await eng.analyse(probe.fen(), { depth: CANDIDATE_DEPTH, multipv: 1 })
      const replyLine = reply.lines[0]
      if (!replyLine) {
        trustworthy = false
        break
      }
      // Opponent to move after our move, so negate for the chooser's value.
      const value = -lineScore(replyLine)
      if (Math.abs(value) >= MATE_THRESHOLD || top[0]!.cp - value > CANDIDATE_MAX_SPREAD_CP) {
        trustworthy = false
        break
      }
    }
    if (!trustworthy) continue

    const goodUcis = new Set(top.map((r) => r.uci))

    const decoys = legal
      .map((m) => `${m.from}${m.to}${m.promotion ?? ''}`)
      .filter((u) => !goodUcis.has(u))
      .slice(0, CANDIDATE_OPTIONS - CANDIDATE_TOP_N)

    const options: CandidateOption[] = []
    for (const r of top) {
      const san = toSan(fen, r.uci)
      if (san) options.push({ uci: r.uci, san, cp: r.cp, good: true })
    }
    for (const u of decoys) {
      const san = toSan(fen, u)
      if (san) options.push({ uci: u, san, cp: null, good: false })
    }
    if (options.filter((o) => o.good).length < CANDIDATE_TOP_N) continue

    // Sort alphabetically so the good ones are not clustered at the front.
    options.sort((a, b) => a.san.localeCompare(b.san))

    out.push({
      id: p.id,
      fen,
      colour: board.turn(),
      options,
      best: top.map((r) => toSan(fen, r.uci) ?? r.uci),
    })
  }

  return out
}
