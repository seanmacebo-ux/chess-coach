/**
 * The end of a game, as an event rather than a receipt.
 *
 * Sean sent a screenshot of chess.com's post-game screen — "You Won! by
 * Checkmate", the rating jumping +26, three big tallies, a coach with a
 * speech bubble, and one large Game Review button — and asked to work on
 * ours. Ours was a grey card under the board: one line of status, a
 * sentence about centipawns, and a chip that said "Review my mistakes".
 * You had just won a game of chess and the app's reply was an audit.
 *
 * WHAT IS COPIED, AND WHAT IS NOT.
 *
 * The SHAPE is worth copying. Finishing a game is the moment you actually
 * feel something, and it should get the screen: what happened, what it cost
 * or earned, how you played, and one obvious way forward.
 *
 * The COACH LINE is worth beating. Theirs reads "Good job turning around the
 * game with that tactic in the middlegame!" — which tactic, on which move, is
 * not in the sentence, because that sentence is a template chosen from a
 * handful by a rough shape of the graph. It could be about anyone's game.
 * This app already computes exactly which ply the game turned on and by how
 * much (coach/report.ts), so the line names the move and the number. If there
 * is nothing true to say, it says the true small thing instead of the
 * flattering vague one.
 *
 * Nothing here is new analysis. The report is the one already built for the
 * review, so the headline and the review can never disagree.
 */

import { useMemo } from 'react'
import { Chess } from 'chess.js'
import { Board } from '../Board'
import { buildReport } from '../../coach/report'
import type { Moment, MoveRating } from '../../coach/report'
import type { MoveAssessment } from '../../coach/analysis'
import { RatingStrip, Moments } from './GameReview'

export type GameResult = 'win' | 'loss' | 'draw'

export interface GameOverProps {
  result: GameResult
  /** How it ended, in the fewest words: "checkmate", "out of time". */
  how: string
  opponentName: string
  opponentElo: number
  /** Final position, so the screen shows the thing you just did. */
  fen: string
  colour: 'white' | 'black'
  /** Rating after the game and the move it made, once the recorder is done. */
  rating: number | null
  delta: number | null
  /** Absent until the analysis finishes; the screen works without it. */
  moves: MoveAssessment[] | null
  analysing: { done: number; total: number } | null
  acpl: number | null
  onReview: (startPly?: number) => void
  onRematch: () => void
  onClose: () => void
}

const HEADLINE: Record<GameResult, string> = {
  win: 'You won',
  loss: 'You lost',
  draw: 'Drawn',
}

/**
 * One sentence about the game, built from what actually happened in it.
 *
 * Every branch here is a fact with a ply number behind it. The ordering is
 * the point: the most specific true thing wins, and the generic line is what
 * is left when nothing specific is true — not the default that a nice-looking
 * game falls into.
 */
export function coachLine(
  result: GameResult,
  moments: Moment[],
  counts: Record<MoveRating, number>,
  moveCount: number,
): string {
  const slips = counts.blunder + counts.mistake
  const worst = moments.find((m) => m.kind === 'yours-lost')
  const gift = moments.find((m) => m.kind === 'theirs-gave')
  const top = moments[0]

  if (result === 'win') {
    // Won from a losing position: the most interesting thing that can happen.
    if (worst && worst.to < 35) {
      return `You were down to ${Math.round(worst.to)}% after ${worst.moveNo}. ${worst.san}, and won it anyway.`
    }
    if (gift?.punished) {
      return `The game turned on move ${gift.moveNo}: ${gift.san} handed you ${Math.round(gift.swing)} points and you took it with ${gift.reply}.`
    }
    if (slips === 0) {
      return `Won without a single mistake in ${moveCount} moves. That is the clean version.`
    }
    return `A win, with ${slips} move${slips === 1 ? '' : 's'} in it that could have cost you the game.`
  }

  if (result === 'loss') {
    if (worst) {
      return `The game went at move ${worst.moveNo}: ${worst.san} took you from ${Math.round(worst.from)}% to ${Math.round(worst.to)}%.`
    }
    if (slips === 0) {
      return `No blunders, and still a loss — you were outplayed rather than caught out.`
    }
    return `Nothing collapsed; it went a little at a time.`
  }

  if (top) {
    return `A draw, with one real swing in it: ${top.moveNo}. ${top.san}, ${Math.round(top.swing)} points.`
  }
  return `A draw with nothing decisive in it either way.`
}

export function GameOver({
  result,
  how,
  opponentName,
  opponentElo,
  fen,
  colour,
  rating,
  delta,
  moves,
  analysing,
  acpl,
  onReview,
  onRematch,
  onClose,
}: GameOverProps) {
  const report = useMemo(() => (moves ? buildReport(moves) : null), [moves])

  const board = useMemo(() => {
    try {
      return new Chess(fen)
    } catch {
      return null
    }
  }, [fen])

  return (
    <div className="stack over">
      <div className="view-head">
        <button className="back" onClick={onClose} aria-label="Back to the board">
          ‹
        </button>
        <div>
          <h2 className={`over-head ${result}`}>{HEADLINE[result]}</h2>
          <div className="view-sub">
            by {how} · vs {opponentName} {opponentElo}
          </div>
        </div>
      </div>

      {/*
        The final position, small. It is the thing you just did, and on a win
        by mate it is the picture worth keeping — a result line cannot show
        you the mate.
      */}
      {board && (
        <div className="over-board">
          <Board
            fen={fen}
            orientation={colour}
            dests={new Map()}
            turn={null}
            playable={null}
            check={board.isCheck()}
            onMove={() => {}}
          />
        </div>
      )}

      {/*
        The rating, and what it did. The delta is the number that gets looked
        at, so it is the one set in the display face — but it stays attached
        to the rating it moved, because +14 on its own is trivia.
      */}
      {rating !== null && (
        <div className="over-rating">
          <span className="over-rating-n">{rating}</span>
          {delta !== null && (
            <span className={`over-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
              {delta > 0 ? `+${delta}` : delta === 0 ? '±0' : delta}
            </span>
          )}
          <span className="small muted">your rating</span>
        </div>
      )}

      <div className="rule" />

      {/* ---------------------------------------------- how you played */}
      {analysing && (
        <div className="status">
          <span className="dot thinking" />
          <span className="small muted">
            rating your moves… {analysing.done}/{analysing.total}
          </span>
        </div>
      )}

      {report && moves && (
        <>
          <RatingStrip counts={report.counts} total={moves.length} />

          <p className="over-say">{coachLine(result, report.moments, report.counts, moves.length)}</p>

          {acpl !== null && (
            <p className="small muted" style={{ margin: 0 }}>
              {acpl} centipawns lost per move across {moves.length} of your moves.
            </p>
          )}

          {/*
            Two, not three. This screen is about the turn the game took; the
            full list is one tap away behind Game review, and three cards of
            it push the button that leads there off the bottom.
          */}
          <Moments
            max={2}
            moments={report.moments}
            colour={colour}
            onGo={(ply) => {
              onReview(ply)
              return true
            }}
          />
        </>
      )}

      {/* ----------------------------------------------------- forward */}
      <div className="over-actions">
        <button className="primary big" onClick={() => onReview()} disabled={!moves}>
          Game review
        </button>
        <button className="chip" onClick={onRematch}>
          Play again
        </button>
      </div>
    </div>
  )
}
