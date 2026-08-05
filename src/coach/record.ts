/**
 * Save a finished game — from wherever it was played.
 *
 * WHY THIS IS ITS OWN MODULE. Games against a bot could be started from three
 * places and only one of them counted. The Play tab saved the game, updated
 * the rating and ran the analysis; the opening trainer's "play on" and the
 * middlegame trainer's "play on" did none of it. You could finish a real game
 * against a rated bot from a plan and afterwards there was no History row, no
 * rating movement, and no review — the game had never happened.
 *
 * That is the same class of bug as the one Sean already named: "when I learn
 * something it doesn't track progress on that". This is the rest of it.
 *
 * The fix is not to copy the Play tab's fifty lines into two more components.
 * It is to have exactly one function that knows what saving a game means, and
 * call it from all three.
 *
 * ANALYSIS IS OPTIONAL AND OFF BY DEFAULT HERE. The Play tab wants it — you
 * finished a game and you are looking at a review screen. A trainer play-on
 * does not: you are mid-lesson, the engine is busy giving live support, and a
 * forty-position search would freeze the board you are about to reset. So the
 * trainers save the game and move the rating, and the review is available from
 * History whenever you want it.
 */

import { Chess } from 'chess.js'
import { db } from '../data/db'
import { updateRatingFromGame } from './profile'
import { analyseGame, acpl, performanceRating, type MoveAssessment } from './analysis'
import type { Style } from '../engine/types'

export interface FinishedGame {
  pgn: string
  /** Which colour the human had. */
  humanColour: 'w' | 'b'
  result: 'win' | 'loss' | 'draw'
  /** How it ended, in words — "checkmate", "stalemate", "threefold". */
  reason: string
  opponentElo: number
  opponentStyle: Style
  /**
   * Where it was played. Trainer games are real games and belong in History,
   * but a game that started from move 13 of a plan is not the same object as
   * one played from the initial position, and pretending otherwise would make
   * the opening-phase numbers in any future stats meaningless.
   */
  source?: 'play' | 'opening-trainer' | 'middlegame-trainer'
}

export interface RecordOptions {
  /** Run the full engine review and store the mistakes. Off by default. */
  analyse?: boolean
  onProgress?: (done: number, total: number) => void
}

export interface RecordResult {
  gameId: number
  /** The new overall rating and how far it moved. */
  rating: number
  delta: number
  /**
   * Present only when `analyse` was asked for and the search succeeded.
   *
   * Returned rather than left in the database on purpose: the review screen
   * needs every move including the good ones, and only the mistakes are
   * stored. Without this the caller has to run the whole engine pass a second
   * time to draw a screen for a game that was just analysed.
   */
  assessments?: MoveAssessment[]
}

/**
 * Persist the game, move the rating, and optionally review it.
 *
 * Returns the rating movement so a caller can show it — a game that silently
 * changes your rating is nearly as bad as one that does not change it at all,
 * because the number moves and nothing explains why.
 */
export async function recordFinishedGame(
  game: FinishedGame,
  options: RecordOptions = {},
): Promise<RecordResult> {
  const playedAt = new Date().toISOString()
  const score: 0 | 0.5 | 1 = game.result === 'win' ? 1 : game.result === 'loss' ? 0 : 0.5

  const gameId = await db.games.add({
    playedAt,
    humanColour: game.humanColour,
    opponentElo: game.opponentElo,
    opponentStyle: game.opponentStyle,
    result: game.result,
    reason: game.reason,
    pgn: game.pgn,
    acpl: null,
    performanceRating: null,
    analysedAt: null,
  })

  const { rating, delta } = await updateRatingFromGame(game.opponentElo, score)

  if (!options.analyse) return { gameId, rating, delta }

  try {
    const assessments = await analyseGame(game.pgn, {
      colour: game.humanColour,
      onProgress: options.onProgress,
    })

    await db.mistakes.bulkAdd(
      assessments
        .filter((a) => a.severity !== 'best' && a.severity !== 'good')
        .map((a) => ({
          gameId,
          ply: a.ply,
          fen: a.fen,
          san: a.san,
          bestSan: a.bestSan,
          lossCp: a.lossCp,
          severity: a.severity,
          tag: a.tag,
          phase: a.phase,
          at: playedAt,
        })),
    )

    const avg = acpl(assessments)
    await db.games.update(gameId, {
      acpl: avg,
      performanceRating: performanceRating(avg),
      analysedAt: new Date().toISOString(),
    })
    return { gameId, rating, delta, assessments }
  } catch {
    /*
     * The game is already saved and the rating already moved — both happen
     * above, before the engine is touched. An engine that failed to load is a
     * reason to have no review, not a reason to lose the game. The caller sees
     * a result with no `assessments` and can say so.
     */
  }

  return { gameId, rating, delta }
}

/**
 * Read a finished position and say what happened, from one side's point of
 * view. Shared so the three callers cannot disagree about what a draw is.
 */
export function outcomeOf(
  chess: Chess,
  humanColour: 'w' | 'b',
): { result: 'win' | 'loss' | 'draw'; reason: string } | null {
  if (!chess.isGameOver()) return null
  if (chess.isCheckmate()) {
    // The side to move is the one that has been mated.
    const loser = chess.turn()
    return {
      result: loser === humanColour ? 'loss' : 'win',
      reason: 'checkmate',
    }
  }
  if (chess.isStalemate()) return { result: 'draw', reason: 'stalemate' }
  if (chess.isThreefoldRepetition()) return { result: 'draw', reason: 'threefold repetition' }
  if (chess.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient material' }
  return { result: 'draw', reason: 'fifty-move rule' }
}
