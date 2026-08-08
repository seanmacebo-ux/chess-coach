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
    const loose = loosePieces(chess.current.fen(), 'w')
    setThreatLine(
      loose.length === 0
        ? 'Their move threatens nothing of yours directly. Good — now improve your position.'
        : loose.length === 1
          ? `Their move attacks your piece on ${loose[0]} and nothing defends it. Deal with that first.`
          : `Careful — ${loose.length} of your pieces are attacked and undefended: ${loose.join(', ')}.`,
    )
  }, [])

  /* ------------------------------------------------ safety check */
  /** Steps 2+3: instant loose-piece verdict, engine comparison appended. */
  const supportFor = useCallback(async (fenBefore: string, playedSan: string) => {
    const after = chess.current.fen()
    const loose = loosePieces(after, 'w')
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
                  ? 'Checkmate — you lost this one. The review in History will show which loop step got skipped.'
                  : 'Checkmate — you won. That is the style working.'
                : 'Drawn.')
            : (threatLine && !coachLine
                ? threatLine
                : (coachLine ??
                  (inBook
                    ? `Follow the arrow while the game follows the book — this is your ${opening.name}. When either side leaves it, the loop takes over.`
                    : 'Your move. Ask the three questions in order — the loop is the style.')))}
        </div>
        {threatLine && coachLine && !over && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {threatLine}
          </div>
        )}
        {gameNote && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {gameNote}
          </div>
        )}
      </div>
    </div>
  )
}
