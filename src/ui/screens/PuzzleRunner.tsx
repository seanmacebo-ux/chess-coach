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
 *   NOT-THE-BOOK-MOVE IS NOT THE SAME AS WRONG. Lichess ships one line per
 *   puzzle and this used to compare your move against it as a string, so an
 *   equally fast mate down the other diagonal, a transposition, or the same
 *   rook taken by the other piece all came back "wrong" — and were written
 *   into the weakness profile as real mistakes. Now the engine is asked first,
 *   and it explains how the two moves relate either way. See
 *   coach/adjudicate.ts for the rules and why each threshold is where it is.
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
import { adjudicate, type Verdict } from '../../coach/adjudicate'
import { categoryOf } from '../../coach/categories'

/**
 * 'checking' is the engine deciding whether the move you just played is a
 * legitimate alternative. It sits between the move landing and the verdict
 * because the search takes a moment and a board that freezes with no
 * explanation reads as a hang.
 */
type Phase = 'solving' | 'checking' | 'wrong' | 'solved' | 'shown'

/**
 * How long the rejected move stays on the board before it is taken back.
 * Shorter than the old 1200ms because the move has already been sitting there
 * for the length of the engine search — you have seen it.
 */
const SHOW_MISTAKE_MS = 900

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
  /** Why the last wrong move fails, in words. Board-only, so it is instant. */
  const [whyWrong, setWhyWrong] = useState<string | null>(null)
  /** The engine's account of how your move compares — set when it was ACCEPTED. */
  const [altNote, setAltNote] = useState<string | null>(null)
  /** Same thing when it was REJECTED. Kept apart so neither leaks into the other's panel. */
  const [bookNote, setBookNote] = useState<string | null>(null)
  /** Your accepted move left the stored line, so the puzzle stopped early. */
  const [diverged, setDiverged] = useState(false)
  // Refs shadow the counters because finish() reads them from inside a
  // setTimeout, where the state snapshot would be stale.
  const missesRef = useRef(0)
  const hintRef = useRef(false)
  const startedAt = useRef(Date.now())
  /**
   * Adjudication is async and the board does not wait for it. Every puzzle
   * load — and every reveal — bumps this, and a search whose token has gone
   * stale is dropped rather than applied to a position that has moved on.
   */
  const checkToken = useRef(0)

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
    setAltNote(null)
    setBookNote(null)
    setDiverged(false)
    setMisses(0)
    setHintUsed(false)
    setHintSquare(null)
    setEarned(null)
    missesRef.current = 0
    hintRef.current = false
    startedAt.current = Date.now()
    checkToken.current++
  }, [puzzle])

  const dests = useMemo(
    () => (phase === 'solving' ? toDests(chess.current) : new Map<Key, Key[]>()),
    [fen, phase],
  )

  const finish = useCallback(
    /**
     * `alternative` means it was solved with a move the stored line does not
     * list. It scores exactly the same — the engine already agreed it is as
     * good — and is recorded only so the two can be told apart later.
     */
    async (correct: boolean, alternative = false) => {
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
        alternative,
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
    // Any adjudication still in flight is about a puzzle that is now over.
    // Without this, a search that lands after "Show me" would call finish()
    // a second time and overwrite the revealed answer with a verdict.
    checkToken.current++
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

  /**
   * You played something the stored line does not have. Ask the engine whether
   * it is genuinely worse before charging you for it.
   */
  const judgeAlternative = useCallback(
    async (fenBefore: string, bookUci: string, played: string) => {
      if (!puzzle) return
      const token = checkToken.current

      let verdict: Verdict | null = null
      try {
        verdict = await adjudicate(fenBefore, bookUci, played)
      } catch (err) {
        // Engine unavailable, or the search came back empty. Fall through to
        // the old string comparison rather than waving the move through:
        // being wrongly marked wrong is the bug being fixed here, but quietly
        // passing a real blunder would be the worse one.
        console.warn('[puzzle] adjudication failed, falling back to the stored line', err)
      }

      // The board moved on while we were searching — next puzzle, or the
      // answer was revealed. Whatever we found is about a position that is no
      // longer in front of the player.
      if (token !== checkToken.current) return

      if (verdict?.accepted) {
        setWhyWrong(null)
        setBookNote(null)
        setAltNote(verdict.explain)
        /*
         * End the puzzle here, solved.
         *
         * The rest of a Lichess line is a script: the opponent's replies are
         * read straight out of puzzle.line and they are only legal in the
         * position the book move produces. Play something else — even
         * something better — and the next scripted reply is a move that does
         * not exist on this board, so chess.js throws and the runner either
         * crashes or silently swallows it.
         *
         * The alternatives were to re-derive the remainder with the engine (a
         * full solve per move, on a phone, while the user waits) or to stop
         * and say so. Stopping is not a consolation prize: the move scores
         * exactly what the book move scores, and the divergence is stated
         * rather than hidden.
         */
        setDiverged(step + 1 < puzzle.line.length)
        void finish(true, true)
        return
      }

      const used = missesRef.current + 1
      missesRef.current = used
      setMisses(used)
      // Two explanations, deliberately. The board-only one is concrete about
      // this square ("your knight is attacked there and nothing defends it");
      // the engine one says how your move stands to the book move, which is
      // the part you cannot see by looking.
      setWhyWrong(explainWrongMove(fenBefore, played))
      setBookNote(verdict?.explain ?? null)
      setAltNote(null)
      setPhase('wrong')
      // Show the mistake on the board before taking it back — you need to see
      // what you played, not just be told it was wrong.
      window.setTimeout(() => {
        if (token !== checkToken.current) return
        chess.current.undo()
        setFen(chess.current.fen())
        setLastMove(undefined)
        if (used >= MAX_TRIES) reveal()
        else setPhase('solving')
      }, SHOW_MISTAKE_MS)
    },
    [puzzle, step, finish, reveal],
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
        // Not wrong — not yet. The move stays on the board while the engine
        // decides, and 'checking' empties the destination map so nothing else
        // can be dropped in the meantime.
        setPhase('checking')
        void judgeAlternative(fenBefore, expected, played)
        return
      }
      setWhyWrong(null)
      setBookNote(null)
      setAltNote(null)

      const next = step + 1
      setStep(next)
      if (next >= puzzle.line.length) {
        void finish(true)
      } else {
        playReply(next)
      }
    },
    [puzzle, phase, step, finish, playReply, judgeAlternative],
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
        {phase === 'checking' && (
          <div>
            <strong>Checking…</strong>{' '}
            <span className="muted">
              That is not the move on file. Asking the engine whether it is just as good.
            </span>
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
            {bookNote && (
              <div className="small muted" style={{ marginTop: 4 }}>
                {bookNote}
              </div>
            )}
          </div>
        )}
        {phase === 'solved' && (
          <div>
            {/*
              An accepted alternative is a teaching moment, not a pass mark.
              The headline says so and the engine's sentence takes the place of
              the generic motif blurb, because "you found a different move that
              mates just as fast" is the thing worth reading.
            */}
            <strong>
              {altNote ? 'That works too' : 'Correct'}
              {earned !== null ? ` — ${earned} pts` : ''}.
            </strong>{' '}
            <span className="muted">{altNote ?? describeThemes(puzzle.themes)}</span>
            {diverged && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Your move leaves the line this puzzle stores, so it stops here rather than playing
                a reply that no longer exists. Full marks. {describeThemes(puzzle.themes)}
              </div>
            )}
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

      {/*
        The haystack size — two separate numbers, and conflating them read as
        nonsense: with 3 legal moves and a 4-move solution the old copy said
        "4 of them in sequence", i.e. four of the three. Legal moves are how
        many you can play RIGHT NOW; solution length is how far the line runs.
      */}
      {!done && (
        <div className="card small muted">
          <strong style={{ color: 'var(--text)' }}>{brief.legalMoves} legal moves</strong> right
          now — that is everything you are allowed to play this turn, and exactly one of them
          starts the solution.{' '}
          {brief.yourMoves > 1 && (
            <>
              The line then runs{' '}
              <strong style={{ color: 'var(--text)' }}>{brief.yourMoves}</strong> of your moves in
              total.{' '}
            </>
          )}
          A big number means narrow it down with checks, captures and threats rather than scanning
          all of them.
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
            {/*
              Both are held shut while a move is being adjudicated. "Show me"
              mid-search would end the puzzle underneath a verdict that has not
              landed yet, and the token guard would then throw that verdict
              away — correct, but the user would have watched the board decide
              something and then ignore it.
            */}
            <button
              className="ghost"
              style={{ flex: 1 }}
              disabled={hintUsed || phase !== 'solving'}
              onClick={takeHint}
            >
              {hintUsed ? 'Nudge used' : `Nudge (−${POINTS_HINT})`}
            </button>
            <button
              className="ghost"
              style={{ flex: 1 }}
              disabled={phase !== 'solving'}
              onClick={reveal}
            >
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
