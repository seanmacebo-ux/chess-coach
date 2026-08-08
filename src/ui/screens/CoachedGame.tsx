/**
 * One whole game, coached live. This screen IS the style.
 *
 * WHY. Sean, after everything else was built: "is this teaching me anything
 * really — learn doesn't teach me the style that makes sense." He is right
 * about the structure. Learn is organised like a library — tactics on one
 * shelf, endgames on another — and nobody plays chess by shelf. A style is
 * one connected way of playing a whole game, and no screen taught that.
 *
 * The style itself is not invented here. It is the one the books already in
 * this repo prescribe for exactly his level, stitched into a single loop:
 *
 *   1. THEIR THREAT   — after every opponent move: what did that just attack?
 *                       (Kotov's discipline; the threat trainer as a habit)
 *   2. YOUR MOVE      — in the opening, the repertoire move, drawn as an
 *                       arrow while the game still follows the book
 *   3. SAFETY CHECK   — after your move: is anything of yours now hanging?
 *                       (Nunn: "loose pieces drop off" — LPDO)
 *
 * That loop is the whole of low-rated chess. Silman's data and the app's own
 * History screen agree: below 1600 games are decided by free material given
 * and taken, not by plans. So the style taught is named honestly on screen —
 * solid, safety-first — and every rep of this screen is a rep of the loop.
 *
 * MECHANICS, all reused rather than reinvented:
 *   - the bot, its live support and the game recording are the same code the
 *     opening trainer's play-on uses (and record.ts saves the game, so it
 *     counts — History row, rating movement)
 *   - the book phase tracks YOUR repertoire line for as long as the actual
 *     game matches it; the moment either side leaves it, the coach says so
 *     and the loop carries on alone. That is honest: a bot is not a script,
 *     and knowing what to do when the book runs out IS the style.
 *   - threats and hanging pieces come from loosePieces() — board logic, not
 *     prose, so the coach cannot claim a threat that does not exist.
 *
 * SCORED, NOT JUST NARRATED. Sean, after the first version: "those games
 * don't feel like they are helping me with what they say." He was right on
 * two counts. First, the banner said "take what hangs" but the coach only
 * ever warned about HIS pieces — it never once pointed at a free enemy piece,
 * so half the named style was silent. Now step 1 reads both sides of the
 * board. Second, the game claimed to teach the loop but never showed whether
 * you ran it: it ended with "go look in History". Now every game keeps a
 * ledger — free pieces taken vs left, pieces hung, book moves followed — and
 * ends with the loop SCORED, compared against your previous coached game so
 * the number visibly moves. A lesson you cannot fail is not a lesson.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import { Board } from '../Board'
import { uciArrow } from '../arrows'
import { EngineOpponent } from '../../engine/opponent'
import { getEngine } from '../../engine/uci'
import { lineScore } from '../../engine/types'
import { loosePieces } from '../../coach/exercises'
import { recordFinishedGame, outcomeOf } from '../../coach/record'
import { suggestedBot } from '../../engine/roster'
import { openingsFor, mainLine } from '../../content/openings'
import { toDests } from '../../chess/game'

/** Same thresholds as the opening trainer's live support, for the same feel. */
const SUPPORT_DEPTH = 11
const SUPPORT_LOSS_CP = 90

const PIECE_NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/**
 * The ledger one coached game accumulates. Move numbers, not just counts,
 * so the receipt can say WHERE — "you hung a piece on move 14" is a memory,
 * "you hung 2 pieces" is a statistic.
 */
interface LoopLog {
  /** Full-move numbers where a free enemy piece was taken. */
  took: number[]
  /** ...where one was pointed at and left on the table. */
  missed: number[]
  /** ...where one of YOUR pieces was newly hanging after your move. */
  hung: number[]
}

interface Receipt extends LoopLog {
  /** Your moves that followed the repertoire before the game left it. */
  bookMoves: number
  won: boolean
}

/** Last coached game's receipt — the number the next game tries to beat. */
const RECEIPT_KEY = 'cc.coached'

function loadPrevReceipt(): Receipt | null {
  try {
    const raw = localStorage.getItem(RECEIPT_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Receipt
    return Array.isArray(r.hung) ? r : null
  } catch {
    return null
  }
}

export interface CoachedGameProps {
  rating: number
  onExit: () => void
}

export function CoachedGame({ rating, onExit }: CoachedGameProps) {
  const chess = useRef(new Chess())
  const [fen, setFen] = useState(() => new Chess().fen())
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined)
  const [thinking, setThinking] = useState(false)
  const [coachLine, setCoachLine] = useState<string | null>(null)
  const [threatLine, setThreatLine] = useState<string | null>(null)
  const [gameNote, setGameNote] = useState<string | null>(null)
  const recorded = useRef(false)
  /** The ledger, written by board logic as the game goes. */
  const log = useRef<LoopLog>({ took: [], missed: [], hung: [] })
  /** Free enemy pieces on the board when your turn started — step 1's output. */
  const freeNow = useRef<Square[]>([])
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [prevReceipt, setPrevReceipt] = useState<Receipt | null>(null)

  const bot = useMemo(() => suggestedBot(rating), [rating])
  const opponent = useMemo(
    () => new EngineOpponent({ elo: bot.elo, style: bot.style, name: bot.name }),
    [bot],
  )

  /*
   * You play White, and the book is your own repertoire's main line at this
   * rating — the Italian for most of the band this screen aims at. Following
   * it inside a live game is what turns "I know twelve moves" into an opening
   * you actually reach positions with.
   */
  const opening = useMemo(() => openingsFor('white', rating)[0] ?? openingsFor('white')[0]!, [rating])
  const book = useMemo(() => mainLine(opening).moves, [opening])

  /** How many plies of the game so far match the book. */
  const bookPly = useMemo(() => {
    const history = chess.current.history()
    let i = 0
    while (i < history.length && i < book.length && history[i] === book[i]) i++
    // In book only if EVERY move so far matched.
    return i === history.length ? i : -1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, book])
  const inBook = bookPly >= 0 && bookPly < book.length

  const yourTurn = chess.current.turn() === 'w' && !thinking && !chess.current.isGameOver()

  /** The book move as an arrow, only while the game still follows the book. */
  const shapes = useMemo(() => {
    if (!inBook || !yourTurn) return []
    const probe = new Chess(chess.current.fen())
    try {
      const m = probe.move(book[bookPly]!)
      return m ? uciArrow(m.from + m.to) : []
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inBook, yourTurn, bookPly, fen, book])

  const dests = useMemo(
    () => (yourTurn ? toDests(chess.current) : new Map<Key, Key[]>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fen, yourTurn],
  )

  /* ------------------------------------------------ their threat */
  /**
   * Step 1 of the loop, computed rather than asserted: after the bot moves,
   * your pieces that are attacked and undefended ARE its threat. Board logic
   * only — the coach cannot invent a threat the board does not show.
   */
  const readThreats = useCallback(() => {
    const f = chess.current.fen()
    const yours = loosePieces(f, 'w')
    // "Take what hangs" — the other half of the banner, previously never
    // spoken. Pawns are left out: hoovering loose pawns is not the habit
    // being built, and flagging every one would drown the piece that matters.
    const free = loosePieces(f, 'b').filter((sq) => chess.current.get(sq)?.type !== 'p')
    freeNow.current = free
    const pieceOn = (sq: Square) => PIECE_NAME[chess.current.get(sq)?.type ?? 'p']

    const danger =
      yours.length === 0
        ? null
        : yours.length === 1
          ? `Their move attacks your piece on ${yours[0]} and nothing defends it.`
          : `Careful — ${yours.length} of your pieces are attacked and undefended: ${yours.join(', ')}.`
    const gift =
      free.length === 0
        ? null
        : `Their ${pieceOn(free[0]!)} on ${free[0]} is hanging${free.length > 1 ? ` (so is ${free[1]})` : ''} — take what hangs.`

    setThreatLine(
      danger && gift
        ? `${danger} And ${gift.charAt(0).toLowerCase()}${gift.slice(1)} Count both before you touch a piece.`
        : (danger ? `${danger} Deal with that first.` : null) ??
            gift ??
            'Their move threatens nothing of yours directly. Good — now improve your position.',
    )
  }, [])

  /* ------------------------------------------------ safety check */
  /** Steps 2+3: instant loose-piece verdict, engine comparison appended. */
  const supportFor = useCallback(async (fenBefore: string, playedSan: string) => {
    const after = chess.current.fen()
    const loose = loosePieces(after, 'w')
    // The ledger counts only NEWLY loose squares — a piece you keep ignoring
    // is one failed safety check, not one per move it sits there.
    const wasLoose = new Set(loosePieces(fenBefore, 'w'))
    if (loose.some((sq) => !wasLoose.has(sq))) {
      log.current.hung.push(Math.ceil(chess.current.history().length / 2))
    }
    const immediate =
      loose.length === 0
        ? null
        : `Safety check: your piece on ${loose[0]} is now hanging${loose.length > 1 ? ` (and ${loose.length - 1} more)` : ''}.`
    setCoachLine(immediate ?? `${playedSan} — nothing of yours is hanging. That is the whole habit.`)

    try {
      const eng = getEngine()
      const before = await eng.analyse(fenBefore, { depth: SUPPORT_DEPTH, multipv: 1 })
      const bestLine = before.lines[0]
      if (!bestLine) return
      const bestCp = lineScore(bestLine)
      const now = await eng.analyse(after, { depth: SUPPORT_DEPTH, multipv: 1 })
      const nowLine = now.lines[0]
      if (!nowLine) return
      const yourCp = -lineScore(nowLine)
      const loss = bestCp - yourCp
      if (loss < SUPPORT_LOSS_CP) return
      const probe = new Chess(fenBefore)
      let bestSan: string | null = null
      try {
        const uci = before.bestMove
        bestSan = uci
          ? (probe.move({
              from: uci.slice(0, 2) as Square,
              to: uci.slice(2, 4) as Square,
              promotion: uci[4] ?? 'q',
            })?.san ?? null)
          : null
      } catch {
        bestSan = null
      }
      if (bestSan) {
        setCoachLine(
          [immediate, `${bestSan} was stronger — ${playedSan} costs about ${(loss / 100).toFixed(1)} pawns.`]
            .filter(Boolean)
            .join(' '),
        )
      }
    } catch {
      /* engine unavailable — the loose-piece verdict already landed */
    }
  }, [])

  /* ------------------------------------------------------- moves */
  const onMove = useCallback(
    (from: Key, to: Key) => {
      if (!yourTurn) return
      const fenBefore = chess.current.fen()
      let san: string
      try {
        const m = chess.current.move({ from: from as Square, to: to as Square, promotion: 'q' })
        if (!m) return
        san = m.san
      } catch {
        return
      }
      setFen(chess.current.fen())
      setLastMove([from, to])
      setThreatLine(null)

      // Step 1's follow-through: a free piece was pointed at. Did you take it?
      // Either way the ledger records it, and "either way" is the teaching —
      // the receipt at the end is built from exactly these moments.
      if (freeNow.current.length > 0) {
        const moveNo = Math.ceil(chess.current.history().length / 2)
        if (freeNow.current.includes(to as Square)) log.current.took.push(moveNo)
        else log.current.missed.push(moveNo)
        freeNow.current = []
      }

      // Book commentary is one line and never a takeback — this is a real
      // game, and the style is bigger than the memorised line.
      if (inBook && san !== book[bookPly]) {
        setCoachLine(`The book plays ${book[bookPly]} there, but the game goes on — run the loop.`)
      }

      void supportFor(fenBefore, san)

      if (chess.current.isGameOver()) return
      setThinking(true)
      void opponent
        .move(chess.current.fen())
        .then((uci) => {
          if (!uci) return
          try {
            const m = chess.current.move({
              from: uci.slice(0, 2) as Square,
              to: uci.slice(2, 4) as Square,
              promotion: uci[4] ?? 'q',
            })
            if (m) {
              setFen(chess.current.fen())
              setLastMove([uci.slice(0, 2) as Key, uci.slice(2, 4) as Key])
              readThreats()
            }
          } catch {
            /* an illegal engine move is not worth crashing the game over */
          }
        })
        .finally(() => setThinking(false))
    },
    [yourTurn, inBook, bookPly, book, supportFor, opponent, readThreats],
  )

  /* ------------------------------------------------ record the game */
  useEffect(() => {
    if (recorded.current) return
    const outcome = outcomeOf(chess.current, 'w')
    if (!outcome) return
    recorded.current = true

    // The loop, scored. Book plies are re-derived from the final history so
    // the count is what actually happened, not what a stale memo thought.
    const history = chess.current.history()
    let plies = 0
    while (plies < history.length && plies < book.length && history[plies] === book[plies]) plies++
    const scored: Receipt = {
      ...log.current,
      bookMoves: Math.ceil(plies / 2),
      won: outcome.result === 'win',
    }
    setPrevReceipt(loadPrevReceipt())
    setReceipt(scored)
    try {
      localStorage.setItem(RECEIPT_KEY, JSON.stringify(scored))
    } catch {
      /* storage blocked — the receipt still renders, it just will not carry */
    }

    void recordFinishedGame({
      pgn: chess.current.pgn(),
      humanColour: 'w',
      result: outcome.result,
      reason: outcome.reason,
      opponentElo: bot.elo,
      opponentStyle: bot.style,
      source: 'play',
    }).then(({ delta }) => {
      setGameNote(
        `Saved to History. Your rating ${delta === 0 ? 'held' : delta > 0 ? `went up ${delta}` : `went down ${-delta}`}. Review it there to see the loop's misses.`,
      )
    })
  }, [fen, bot])

  const over = chess.current.isGameOver()

  return (
    <div className="trainer-screen">
      <div className="trainer-head">
        <button className="chip" onClick={onExit}>
          ‹ Leave the game
        </button>
        <span className="trainer-prog">
          {bot.face} {bot.name} {bot.elo}
        </span>
      </div>

      {/*
        The style, named, above the board. Not decoration: this line is the
        curriculum, and every element below is one of its three steps.
      */}
      <div className="style-banner">
        <span className="style-name">Safety-first chess</span>
        <span className="small muted">
          The style that wins at your rating: take what hangs, hang nothing, king safe. One loop,
          every move.
        </span>
      </div>

      <Board
        fen={fen}
        orientation="white"
        dests={dests}
        turn={chess.current.turn() === 'w' ? 'white' : 'black'}
        playable={yourTurn ? 'white' : null}
        lastMove={lastMove}
        check={chess.current.isCheck()}
        shapes={shapes}
        onMove={onMove}
      />

      {/* The loop, as chips — the same visual as the plan steps, because it is
          the same idea: a scheme held across moves, not a per-move puzzle. */}
      <ol className="plan-steps compact">
        <li className={threatLine ? 'on' : ''}>1 · Their threat</li>
        <li className={inBook && yourTurn ? 'on' : ''}>2 · Your move{inBook ? ' (book)' : ''}</li>
        <li className={coachLine ? 'on' : ''}>3 · Safety check</li>
      </ol>

      <div className={'coach' + (over ? ' done' : '')}>
        <div className="coach-role">
          {over
            ? 'Game over'
            : thinking
              ? `${bot.name} is thinking…`
              : inBook
                ? `Book: ${opening.name}`
                : 'Out of book — the loop is everything now'}
        </div>
        <div className="coach-text">
          {over
            ? (chess.current.isCheckmate()
                ? chess.current.turn() === 'w'
                  ? 'Checkmate — you lost this one. The score below says which loop step slipped.'
                  : 'Checkmate — you won. That is the style working.'
                : 'Drawn.')
            : /* Step 1 leads. The threat read is about the move you are about
                 to make; the safety verdict is about the one you already made,
                 so when both exist the verdict steps down to the small line. */
              (threatLine ??
                coachLine ??
                (inBook
                  ? `Follow the arrow while the game follows the book — this is your ${opening.name}. When either side leaves it, the loop takes over.`
                  : 'Your move. Ask the three questions in order — the loop is the style.'))}
        </div>
        {threatLine && coachLine && !over && (
          <div className="small muted" style={{ marginTop: 6 }}>
            Last move — {coachLine}
          </div>
        )}
        {gameNote && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {gameNote}
          </div>
        )}
      </div>

      {/*
        The receipt: the loop as numbers, with move references so it reads as
        memories of THIS game. This card is the answer to "is this helping me
        with what it says" — the claim up top, the evidence down here.
      */}
      {over && receipt && (
        <div className="card receipt">
          <div className="receipt-title">The loop, scored</div>
          <ul className="receipt-lines small">
            <li className={receipt.took.length > 0 ? 'good' : ''}>
              Free pieces taken: <b>{receipt.took.length}</b>
              {receipt.took.length > 0 && ` (move ${receipt.took.join(', ')})`}
              {receipt.missed.length > 0 && (
                <> · left on the table: <b>{receipt.missed.length}</b> (move {receipt.missed.join(', ')})</>
              )}
            </li>
            <li className={receipt.hung.length === 0 ? 'good' : 'bad'}>
              {receipt.hung.length === 0
                ? 'Pieces you hung: none. That is the whole style.'
                : <>Pieces you hung: <b>{receipt.hung.length}</b> (move {receipt.hung.join(', ')})</>}
            </li>
            <li>
              Book: <b>{receipt.bookMoves}</b> {receipt.bookMoves === 1 ? 'move' : 'moves'} of the {opening.name}.
            </li>
            {prevReceipt && (
              <li className="small muted">
                {receipt.hung.length < prevReceipt.hung.length
                  ? `Last coached game you hung ${prevReceipt.hung.length} — this time ${receipt.hung.length}. The loop is landing.`
                  : receipt.hung.length > prevReceipt.hung.length
                    ? `Last coached game you hung ${prevReceipt.hung.length} — this time ${receipt.hung.length}. The safety check got skipped; slow that step down.`
                    : `Hung ${receipt.hung.length}, same as last coached game. The number to beat next time.`}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
