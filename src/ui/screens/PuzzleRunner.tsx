/**
 * The puzzle player.
 *
 * Lichess puzzles are multi-move: you play a move, the opponent replies from
 * the stored line, you play again. So the runner tracks position within the
 * line rather than treating a puzzle as a single question.
 *
 * Rules that make this train rather than test:
 *
 *   THREE TRIES. Not one, and not unlimited. One try turns every puzzle into
 *   a pass/fail exam and you learn nothing from the 40% you miss; unlimited
 *   turns it into guessing until the board lets you through. Three is enough
 *   to think again after seeing why the first idea failed, and few enough that
 *   the score still means something.
 *
 *   A wrong move is shown, not swallowed. You see the piece land, then it
 *   comes back — so you can tell WHAT you played, not just that you failed.
 *
 *   The category is named up front. You are told this is a "two things at
 *   once" puzzle before you solve it. That makes it easier, deliberately:
 *   knowing the family and still having to find the move is how you build the
 *   pattern. The alternative — hiding it — tests recall you do not have yet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import type { Square } from 'chess.js'

import { Board } from '../Board'
import { toDests } from '../../chess/game'
import { briefing, type Puzzle } from '../../data/puzzles'
import { db } from '../../data/db'
import { recordTierAttempt } from '../../coach/profile'
import { explainWrongMove, tagForThemes } from '../../coach/analysis'
import { categoryOf } from '../../coach/categories'

type Phase = 'solving' | 'wrong' | 'solved' | 'shown'

/** Goes per puzzle before the answer is revealed. */
const MAX_TRIES = 3

/*
 * Scoring. Deliberately harsh on hints and cheap on a second look — the point
 * is to reward finding it yourself, not to reward getting it first time.
 */
const POINTS_FULL = 10
const POINTS_PER_MISS = 3
const POINTS_HINT = 4

function scoreFor(misses: number, hintUsed: boolean): number {
  const raw = POINTS_FULL - misses * POINTS_PER_MISS - (hintUsed ? POINTS_HINT : 0)
  // Solving it at all is worth something, however many goes it took.
  return Math.max(1, raw)
}

export interface PuzzleRunnerProps {
  puzzles: Puzzle[]
  /** Tier these count toward, if any. */
  tierId?: string | null
  onDone: (result: { solved: number; total: number; points: number }) => void
}

export function PuzzleRunner({ puzzles, tierId = null, onDone }: PuzzleRunnerProps) {
  const [index, setIndex] = useState(0)
  const puzzle = puzzles[index]

  const chess = useRef(new Chess())
  const [fen, setFen] = useState('')
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<Phase>('solving')
  const [solvedCount, setSolvedCount] = useState(0)
  const [points, setPoints] = useState(0)
  const [earned, setEarned] = useState<number | null>(null)
  /** Wrong goes used on THIS puzzle. */
  const [misses, setMisses] = useState(0)
  const [hintUsed, setHintUsed] = useState(false)
  /** Square the solution starts from, once a hint is asked for. */
  const [hintSquare, setHintSquare] = useState<string | null>(null)
  /** The move in algebraic, once revealed. */
  const [answerSan, setAnswerSan] = useState<string | null>(null)
  /** Why the last wrong move fails, in words. */
  const [whyWrong, setWhyWrong] = useState<string | null>(null)
  // Refs shadow the counters because finish() reads them from inside a
  // setTimeout, where the state snapshot would be stale.
  const missesRef = useRef(0)
  const hintRef = useRef(false)
  const startedAt = useRef(Date.now())

  /* Load a puzzle. */
  useEffect(() => {
    if (!puzzle) return
    chess.current = new Chess(puzzle.fen)
    setFen(puzzle.fen)
    setLastMove(undefined)
    setStep(0)
    setPhase('solving')
    setAnswerSan(null)
    setWhyWrong(null)
    setMisses(0)
    setHintUsed(false)
    setHintSquare(null)
    setEarned(null)
    missesRef.current = 0
    hintRef.current = false
    startedAt.current = Date.now()
  }, [puzzle])

  const dests = useMemo(
    () => (phase === 'solving' ? toDests(chess.current) : new Map<Key, Key[]>()),
    [fen, phase],
  )

  const finish = useCallback(
    async (correct: boolean) => {
      if (!puzzle) return
      setPhase(correct ? 'solved' : 'shown')

      const got = correct ? scoreFor(missesRef.current, hintRef.current) : 0
      setEarned(got)
      if (correct) {
        setSolvedCount((c) => c + 1)
        setPoints((p) => p + got)
      }

      const at = new Date().toISOString()
      await db.puzzleAttempts.add({
        puzzleId: puzzle.id,
        themes: puzzle.themes.join(' '),
        rating: puzzle.rating,
        correct,
        ms: Date.now() - startedAt.current,
        tierId,
        at,
        attempts: missesRef.current + 1,
        hintUsed: hintRef.current,
        points: got,
      })

      // A failed puzzle is a real hole in your vision, so it goes in the same
      // log as a blunder from a real game. Without this the weakness profile
      // only ever learned from games and puzzle failures changed nothing.
      if (!correct) {
        const tag = tagForThemes(puzzle.themes)
        await db.mistakes.add({
          gameId: 0, // 0 = came from a puzzle, not a game
          source: 'puzzle',
          ply: 0,
          fen: puzzle.fen,
          san: '',
          bestSan: null,
          // Weight by puzzle difficulty: missing a 1600 tactic says more than
          // missing an 800 one. Scaled into the same centipawn units the
          // profile ranks games by.
          lossCp: Math.round(80 + puzzle.rating / 12),
          severity: 'mistake',
          tag,
          phase: puzzle.themes.some((t) => t.endsWith('Endgame')) ? 'endgame' : 'middlegame',
          at,
        })
      }

      if (tierId) await recordTierAttempt(tierId, correct)
    },
    [puzzle, tierId],
  )

  /** Reveal the answer and end the puzzle. Shared by "show me" and running out. */
  const reveal = useCallback(() => {
    if (!puzzle) return
    // Show the KEY MOVE, not the finished position. Play only the move that was
    // due, name it in algebraic, and leave the rest of the line alone.
    const board = new Chess(chess.current.fen())
    const due = puzzle.line[step]
    let san: string | null = null
    if (due) {
      try {
        san =
          board.move({
            from: due.slice(0, 2),
            to: due.slice(2, 4),
            promotion: due[4],
          })?.san ?? null
      } catch {
        san = null
      }
    }
    chess.current = board
    setFen(board.fen())
    setLastMove(due ? [due.slice(0, 2) as Key, due.slice(2, 4) as Key] : undefined)
    setAnswerSan(san)
    void finish(false)
  }, [puzzle, step, finish])

  /** Play the opponent's scripted reply, then hand back control. */
  const playReply = useCallback(
    (nextStep: number) => {
      if (!puzzle) return
      const reply = puzzle.line[nextStep]
      if (!reply) {
        void finish(true)
        return
      }
      window.setTimeout(() => {
        try {
          chess.current.move({
            from: reply.slice(0, 2),
            to: reply.slice(2, 4),
            promotion: reply[4],
          })
          setFen(chess.current.fen())
          setLastMove([reply.slice(0, 2) as Key, reply.slice(2, 4) as Key])
          setStep(nextStep + 1)
        } catch {
          void finish(true)
        }
      }, 320)
    },
    [puzzle, finish],
  )

  const onMove = useCallback(
    (from: Key, to: Key) => {
      if (!puzzle || phase !== 'solving') return
      const expected = puzzle.line[step]
      if (!expected) return

      const played = `${from}${to}`
      const fenBefore = chess.current.fen()
      // Compare the first four chars — auto-queening makes the promotion
      // suffix differ from the stored line even on a correct move.
      const isRight = expected.slice(0, 4) === played

      try {
        chess.current.move({ from, to, promotion: 'q' })
      } catch {
        return
      }
      setFen(chess.current.fen())
      setLastMove([from, to])

      if (!isRight) {
        const used = missesRef.current + 1
        missesRef.current = used
        setMisses(used)
        // Say WHY it fails, not just that it does. Computed from the position
        // before the move, board-only, so it appears instantly.
        setWhyWrong(explainWrongMove(fenBefore, played))
        setPhase('wrong')
        // Show the mistake on the board before taking it back — you need to
        // see what you played, not just be told it was wrong.
        window.setTimeout(() => {
          chess.current.undo()
          setFen(chess.current.fen())
          setLastMove(undefined)
          if (used >= MAX_TRIES) reveal()
          else setPhase('solving')
        }, 1200)
        return
      }
      setWhyWrong(null)

      const next = step + 1
      setStep(next)
      if (next >= puzzle.line.length) {
        void finish(true)
      } else {
        playReply(next)
      }
    },
    [puzzle, phase, step, finish, playReply, reveal],
  )

  /**
   * A nudge, not the answer: which piece moves, but not where it goes.
   *
   * That split matters. Being told the destination collapses the puzzle;
   * being told which piece is involved leaves the actual work — seeing what
   * it does — entirely intact.
   */
  const takeHint = useCallback(() => {
    if (!puzzle) return
    const due = puzzle.line[step]
    if (!due) return
    hintRef.current = true
    setHintUsed(true)
    setHintSquare(due.slice(0, 2))
  }, [puzzle, step])

  const next = useCallback(() => {
    if (index + 1 >= puzzles.length) {
      onDone({ solved: solvedCount, total: puzzles.length, points })
    } else {
      setIndex(index + 1)
    }
  }, [index, puzzles.length, solvedCount, points, onDone])

  if (!puzzle) {
    return <div className="card">No puzzles available.</div>
  }

  const done = phase === 'solved' || phase === 'shown'
  const brief = briefing(puzzle)
  const category = categoryOf(puzzle.themes)
  const triesLeft = MAX_TRIES - misses
  const hintPiece = hintSquare ? chess.current.get(hintSquare as Square) : null

  return (
    <div className="stack">
      {/* ------------------------------------------------------ progress */}
      <div className="row spread">
        <span className="small muted">
          Puzzle {index + 1} of {puzzles.length} · rated {puzzle.rating}
        </span>
        <span className="small muted">
          {solvedCount} solved · {points} pts
        </span>
      </div>

      {/* ------------------------------------------------- what this is */}
      <div className="card cat">
        <div className="row spread">
          <span className="cat-name">{category.name}</span>
          <span className="tries" aria-label={`${triesLeft} of ${MAX_TRIES} tries left`}>
            {Array.from({ length: MAX_TRIES }, (_, i) => (
              <i key={i} className={i < triesLeft ? 'live' : 'spent'} />
            ))}
          </span>
        </div>
        <div className="small muted">{category.teaches}</div>
      </div>

      <Board
        fen={fen}
        orientation={puzzle.colour}
        dests={dests}
        turn={puzzle.colour}
        playable={phase === 'solving' ? puzzle.colour : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        onMove={onMove}
      />

      <div className={'card verdict ' + phase}>
        {phase === 'solving' && (
          <div>
            <strong>{brief.objective}.</strong>{' '}
            <span className="muted">
              {puzzle.colour === 'white' ? 'White' : 'Black'} to play,{' '}
              {brief.yourMoves === 1 ? 'one move' : `${brief.yourMoves} moves`}.
            </span>
            {hintSquare && (
              <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
                Move the {hintPiece ? PIECE_NAME[hintPiece.type] : 'piece'} on {hintSquare}. Where
                it goes is still up to you.
              </div>
            )}
          </div>
        )}
        {phase === 'wrong' && (
          <div>
            <strong>Not that one.</strong>{' '}
            <span className="muted">
              {whyWrong ?? 'Look again.'}{' '}
              {triesLeft > 0
                ? `${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.`
                : 'That was the last try.'}
            </span>
          </div>
        )}
        {phase === 'solved' && (
          <div>
            <strong>Correct{earned !== null ? ` — ${earned} pts` : ''}.</strong>{' '}
            <span className="muted">{describeThemes(puzzle.themes)}</span>
          </div>
        )}
        {phase === 'shown' && (
          <div>
            {answerSan ? (
              <strong>The move was {answerSan}.</strong>
            ) : (
              <strong>Solution shown.</strong>
            )}{' '}
            <span className="muted">{describeThemes(puzzle.themes)} Logged as missed.</span>
          </div>
        )}
      </div>

      {/* --------------------------------------------- the haystack size */}
      {!done && (
        <div className="card small muted">
          <strong style={{ color: 'var(--text)' }}>{brief.legalMoves} legal moves</strong> in this
          position — that is every move you are allowed to play right now, and{' '}
          {brief.yourMoves === 1 ? 'one of them' : `${brief.yourMoves} of them in sequence`} is the
          answer. The number is the size of the haystack: a high one means narrow it down by
          looking at checks, captures and threats first instead of scanning everything.
        </div>
      )}

      {/* ---------------------------------------------- what it taught */}
      {done && (
        <div className="card small">
          <span className="muted">{category.why}</span>
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        {!done ? (
          <>
            <button className="ghost" style={{ flex: 1 }} disabled={hintUsed} onClick={takeHint}>
              {hintUsed ? 'Nudge used' : `Nudge (−${POINTS_HINT})`}
            </button>
            <button className="ghost" style={{ flex: 1 }} onClick={reveal}>
              Show me
            </button>
          </>
        ) : (
          <button className="primary" style={{ flex: 1 }} onClick={next}>
            {index + 1 >= puzzles.length ? 'Finish' : 'Next puzzle'}
          </button>
        )}
      </div>
    </div>
  )
}

const PIECE_NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/**
 * Turn Lichess motif tags into something a human reads.
 *
 * All 59 motifs the sandbox found are mapped. The previous version covered 24,
 * so a third of solved puzzles ended with an empty "The idea was ." sentence.
 */
const THEME_LABEL: Record<string, string> = {
  fork: 'a fork',
  pin: 'a pin',
  skewer: 'a skewer',
  discoveredAttack: 'a discovered attack',
  discoveredCheck: 'a discovered check',
  doubleCheck: 'a double check',
  deflection: 'a deflection',
  attraction: 'an attraction',
  clearance: 'a clearance',
  hangingPiece: 'a hanging piece',
  backRankMate: 'a back-rank mate',
  smotheredMate: 'a smothered mate',
  quietMove: 'a quiet move',
  defensiveMove: 'a defensive move',
  capturingDefender: 'capturing the defender',
  sacrifice: 'a sacrifice',
  advancedPawn: 'an advanced pawn',
  promotion: 'a promotion',
  underPromotion: 'an under-promotion',
  interference: 'an interference',
  xRayAttack: 'an x-ray',
  zugzwang: 'zugzwang',
  intermezzo: 'an in-between move',
  trappedPiece: 'a trapped piece',
  exposedKing: 'an exposed king',
  kingsideAttack: 'a kingside attack',
  queensideAttack: 'a queenside attack',
  attackingF2F7: 'the f7 weakness',
  enPassant: 'en passant',
  castling: 'a castling trick',
  collinearMove: 'a lined-up move',
  anastasiaMate: "Anastasia's mate",
  arabianMate: 'the Arabian mate',
  bodenMate: "Boden's mate",
  doubleBishopMate: 'a double-bishop mate',
  dovetailMate: 'a dovetail mate',
  hookMate: 'a hook mate',
  killBoxMate: 'a kill-box mate',
  vukovicMate: "Vukovic's mate",
  operaMate: 'the Opera mate',
  pillsburysMate: "Pillsbury's mate",
  epauletteMate: 'an epaulette mate',
  morphysMate: "Morphy's mate",
  cornerMate: 'a corner mate',
  swallowstailMate: "a swallow's-tail mate",
  triangleMate: 'a triangle mate',
  blindSwineMate: 'the blind swine mate',
  balestraMate: 'a balestra mate',
  mateIn1: 'mate in one',
  mateIn2: 'mate in two',
  mateIn3: 'mate in three',
  mateIn4: 'mate in four',
  mateIn5: 'a long forced mate',
  rookEndgame: 'a rook endgame',
  pawnEndgame: 'a pawn endgame',
  queenEndgame: 'a queen endgame',
  bishopEndgame: 'a bishop endgame',
  knightEndgame: 'a knight endgame',
  queenRookEndgame: 'a queen-and-rook endgame',
}

function describeThemes(themes: string[]): string {
  const named = themes.map((t) => THEME_LABEL[t]).filter(Boolean)
  if (named.length === 0) return ''
  return `The idea was ${named.slice(0, 2).join(' and ')}.`
}
