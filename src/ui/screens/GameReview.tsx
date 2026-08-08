/**
 * What actually went wrong, move by move, on a board.
 *
 * WHAT THIS REPLACES. The entire post-game review was two sentences:
 *
 *     "You averaged 87 centipawns lost per move — that's about 1150 strength.
 *      3 blunders logged. Tomorrow's session will target what showed up."
 *
 * A number and a count. `analyseGame` had already computed, for every single
 * move: what you played, what the engine wanted, how much it cost, which habit
 * it belongs to and the position it happened in. All of that went into
 * IndexedDB to feed the weakness profile, and none of it was ever shown to the
 * person who played the game. You were told you had been bad, not where, and
 * "tomorrow's session will target it" asks you to take the coaching on trust.
 *
 * The design rules here:
 *
 *   THE POSITION, NOT THE MOVE NUMBER. "Move 14 was a blunder" is useless —
 *   you have no memory of move 14. The board shows the position as it was,
 *   with your move played, so you are looking at the thing you were looking at
 *   when you got it wrong.
 *
 *   YOUR MOVE AND THE BETTER MOVE, SIDE BY SIDE, both playable. Being told
 *   "Qxd5 was better" teaches nothing until you can see the position after it.
 *   Tapping either plays it on the board.
 *
 *   COST IN PAWNS, NOT CENTIPAWNS. "You lost 320 centipawns" is engine units.
 *   "That cost you a piece" is chess.
 *
 *   THE HABIT IS NAMED. Every mistake carries a tag — hung piece, missed fork,
 *   king safety — and the same tag is what the ladder reorders around. Saying
 *   it here is what connects "I lost a rook on move 22" to "this is why the
 *   app is serving me loose-piece drills tomorrow".
 *
 * Best and good moves are not listed. A review that walks you through 30 fine
 * moves to reach the 3 that mattered buries the lesson — the count of good
 * moves is in the summary, and this screen is only about what to fix.
 */

import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'
import { Board } from '../Board'
import { TAG_LABEL, type MoveAssessment, type Severity } from '../../coach/analysis'
import { loosePieces } from '../../coach/exercises'
import { EvalMeter, oddsSwing, winChance } from '../EvalMeter'

const SEVERITY_LABEL: Record<Severity, string> = {
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
}

const PIECE: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/**
 * The badge line, and every material claim in it is board-checked.
 *
 * The old version mapped centipawns to material words — 250cp became "gave up
 * a piece" whether or not a piece changed hands. Sean caught it on a screen
 * where Nxe6 TRADED knight for bishop, at 90% winning, labelled "Blunder —
 * gave up a piece": two claims, both false in kind. Same rule as the prose
 * verifiers now: say material only when the board shows material, otherwise
 * say odds, which is what the engine actually measured.
 */
function verdictInWords(m: MoveAssessment): string {
  if (m.cpPlayed <= -900) return 'walked into a forced mate'
  if (m.tag === 'missed-mate') return 'missed a forced mate'

  // Did the move actually leave something to be taken? Board logic, not cp.
  try {
    const after = new Chess(m.fen)
    const mover = after.turn()
    after.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] })
    const was = new Set(loosePieces(m.fen, mover))
    const newly = loosePieces(after.fen(), mover)
      .filter((sq) => !was.has(sq))
      .map((sq) => ({ sq, piece: after.get(sq) }))
      .filter((x) => x.piece && x.piece.type !== 'p')
    if (newly.length > 0) {
      const val: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 }
      const worst = newly.sort((a, b) => (val[b.piece!.type] ?? 0) - (val[a.piece!.type] ?? 0))[0]!
      return `left your ${PIECE[worst.piece!.type]} on ${worst.sq} hanging`
    }
  } catch {
    /* unreplayable move — fall through to odds language */
  }

  if (m.tag === 'missed-free-material' && m.bestUci) {
    const victim = new Chess(m.fen).get(m.bestUci.slice(2, 4) as Square)
    if (victim) return `missed a free ${PIECE[victim.type]} on ${m.bestUci.slice(2, 4)}`
  }

  const drop = Math.round(winChance(m.cpBest) - winChance(m.cpPlayed))
  if (m.cpPlayed >= 300) return 'you are still winning — the better move keeps more of it'
  return `cost ${drop} points of winning chances`
}

export interface GameReviewProps {
  moves: MoveAssessment[]
  /** Which colour is being reviewed, for board orientation. */
  colour: 'white' | 'black'
  acpl: number
  perf: number
  onClose: () => void
  /**
   * Re-run the review for the other colour, if the caller can.
   *
   * Both sides matter and analysing both up front would double the wait for a
   * review most people only want one half of, so the swap is on demand.
   */
  onSwapSide?: (() => void) | undefined
  swapping?: boolean
}

export function GameReview({
  moves,
  colour,
  acpl,
  perf,
  onClose,
  onSwapSide,
  swapping = false,
}: GameReviewProps) {
  // Worst first. You have limited attention after a game and the biggest
  // mistake is the one worth spending it on; move order would bury a dropped
  // rook under two opening inaccuracies.
  const problems = useMemo(
    () =>
      moves
        .filter((m) => m.severity === 'blunder' || m.severity === 'mistake' || m.severity === 'inaccuracy')
        .sort((a, b) => b.lossCp - a.lossCp),
    [moves],
  )

  const [index, setIndex] = useState(0)
  /** Which move is on the board: what you played, or what you should have. */
  const [showing, setShowing] = useState<'yours' | 'better'>('yours')

  const current = problems[index]

  const blunders = moves.filter((m) => m.severity === 'blunder').length
  const mistakes = moves.filter((m) => m.severity === 'mistake').length
  const inaccuracies = moves.filter((m) => m.severity === 'inaccuracy').length
  const clean = moves.length - blunders - mistakes - inaccuracies

  return (
    <div className="stack">
      <div className="view-head">
        <button className="back" onClick={onClose} aria-label="Close">
          ‹
        </button>
        <div>
          <h2 className="view-title">Game review</h2>
          <div className="view-sub">
            {colour === 'white' ? 'White' : 'Black'} · {acpl} centipawns lost per move · about{' '}
            {perf} strength
          </div>
        </div>
      </div>

      {onSwapSide && (
        <button className="chip" onClick={onSwapSide} disabled={swapping} style={{ alignSelf: 'flex-start' }}>
          {swapping
            ? 'Analysing…'
            : `Review ${colour === 'white' ? 'Black' : 'White'}'s moves instead`}
        </button>
      )}

      <div className="rev-tally">
        <Tally n={blunders} label="blunders" tone="danger" />
        <Tally n={mistakes} label="mistakes" tone="warn" />
        <Tally n={inaccuracies} label="inaccuracies" tone="muted" />
        <Tally n={clean} label="fine" tone="good" />
      </div>

      {problems.length === 0 ? (
        <div className="feature">
          <div className="feature-title">Nothing to correct</div>
          <p className="feature-body">
            No inaccuracies, mistakes or blunders in {moves.length} moves. That is a genuinely
            clean game — play someone stronger.
          </p>
        </div>
      ) : (
        <>
          <p className="lede">
            {problems.length} position{problems.length === 1 ? '' : 's'} worth looking at, worst
            first. The board shows what you were looking at — tap between your move and the better
            one to see the difference.
          </p>

          <div className="rev-pager">
            <button
              className="pg-nav"
              onClick={() => {
                setIndex((i) => Math.max(0, i - 1))
                setShowing('yours')
              }}
              disabled={index === 0}
              aria-label="Previous mistake"
            >
              ‹
            </button>
            <span className="rev-count">
              {index + 1} of {problems.length}
            </span>
            <button
              className="pg-nav"
              onClick={() => {
                setIndex((i) => Math.min(problems.length - 1, i + 1))
                setShowing('yours')
              }}
              disabled={index >= problems.length - 1}
              aria-label="Next mistake"
            >
              ›
            </button>
          </div>

          {current && (
            <MistakeCard
              key={`${current.ply}-${current.san}`}
              m={current}
              colour={colour}
              showing={showing}
              onShow={setShowing}
            />
          )}
        </>
      )}
    </div>
  )
}

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`tally ${tone}`}>
      <span className="tally-n">{n}</span>
      <span className="tally-l">{label}</span>
    </div>
  )
}

function MistakeCard({
  m,
  colour,
  showing,
  onShow,
}: {
  m: MoveAssessment
  colour: 'white' | 'black'
  showing: 'yours' | 'better'
  onShow: (s: 'yours' | 'better') => void
}) {
  const uci = showing === 'better' && m.bestUci ? m.bestUci : m.uci

  const { fen, lastMove, shapes, lineSan } = useMemo(() => {
    const board = new Chess(m.fen)
    let mv
    try {
      mv = board.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci[4] ?? 'q',
      })
    } catch {
      // Fall back to the position before the move rather than rendering
      // nothing — a board is still useful even if the move will not replay.
      return { fen: m.fen, lastMove: undefined, shapes: [], lineSan: null }
    }
    if (!mv) return { fen: m.fen, lastMove: undefined, shapes: [], lineSan: null }

    /*
     * "Show me the lines that you are seeing or I am missing" — Sean, looking
     * at a bare verdict. So the engine's line is DRAWN, not asserted:
     *
     *   yours view  — the punishment: what best play does to the move you
     *                 played (their moves red, your forced replies blue)
     *   better view — the point: how the better move's line continues
     *                 (their replies red, your follow-ups green)
     *
     * Arrows come from the stored PV, replayed move by move on a probe board;
     * a pv move that fails to replay stops the drawing rather than drawing
     * fiction. Older reviews analysed before PVs were stored draw nothing.
     */
    const pv = showing === 'better' ? (m.pvBest ?? []).slice(1) : (m.pvPunish ?? [])
    const drawn: DrawShape[] = []
    const sans: string[] = []
    const probe = new Chess(board.fen())
    for (let i = 0; i < pv.length; i++) {
      const step = pv[i]!
      let played
      try {
        played = probe.move({
          from: step.slice(0, 2) as Square,
          to: step.slice(2, 4) as Square,
          promotion: step[4] ?? 'q',
        })
      } catch {
        break
      }
      if (!played) break
      sans.push(played.san)
      // Their moves red; yours green on the line you missed, blue on the
      // forced defence. Only the first two full moves become arrows — four
      // arrows is a line, eight is spaghetti — but the words get the rest.
      if (i < 4) {
        drawn.push({
          orig: played.from as Key,
          dest: played.to as Key,
          brush: i % 2 === 0 ? 'red' : showing === 'better' ? 'green' : 'blue',
        })
      }
    }

    /*
     * Coverage: what the shown move's piece now reaches. Circles mark the
     * enemy pieces it attacks from its new square — the "area" the move buys.
     * chess.js only generates moves for the side to move, so the probe flips
     * the turn back; a position that will not load that way just draws none.
     */
    try {
      const parts = board.fen().split(' ')
      parts[1] = mv.color
      parts[3] = '-'
      const flipped = new Chess(parts.join(' '))
      for (const t of flipped.moves({ square: mv.to as Square, verbose: true })) {
        if (t.captured) {
          drawn.push({ orig: t.to as Key, brush: showing === 'better' ? 'paleGreen' : 'paleBlue' })
        }
      }
    } catch {
      /* no coverage circles for this one */
    }

    return {
      fen: board.fen(),
      lastMove: [mv.from, mv.to] as [Key, Key],
      shapes: drawn,
      lineSan: sans.length > 0 ? sans.join('  ') : null,
    }
  }, [m, uci, showing])

  const moveNumber = Math.floor(m.ply / 2) + 1
  const dots = m.ply % 2 === 0 ? '.' : '…'

  return (
    <div className="stack">
      <Board
        fen={fen}
        orientation={colour}
        dests={new Map()}
        turn={null}
        playable={null}
        lastMove={lastMove}
        shapes={shapes}
        onMove={() => {}}
      />

      <div className="rev-switch">
        <button
          className={'rev-opt yours' + (showing === 'yours' ? ' on' : '')}
          onClick={() => onShow('yours')}
        >
          <span className="rev-opt-label">You played</span>
          <span className="rev-opt-move">
            {moveNumber}
            {dots} {m.san}
          </span>
        </button>
        <button
          className={'rev-opt better' + (showing === 'better' ? ' on' : '')}
          onClick={() => onShow('better')}
          disabled={!m.bestSan}
        >
          <span className="rev-opt-label">Better was</span>
          <span className="rev-opt-move">{m.bestSan ?? '—'}</span>
        </button>
      </div>

      {/*
        The odds, before the explanation. "You dropped 320 centipawns" is the
        engine's unit; "your chances went from 71% to 34%" is the thing that
        actually lands, and the marker on the bar shows where the better move
        would have left you.
      */}
      <EvalMeter
        cp={showing === 'better' ? m.cpBest : m.cpPlayed}
        compareCp={showing === 'better' ? m.cpPlayed : m.cpBest}
        tone={m.severity === 'blunder' ? 'danger' : m.severity === 'mistake' ? 'warn' : 'good'}
        label={showing === 'better' ? `Odds after ${m.bestSan ?? 'the better move'}` : `Odds after ${m.san}`}
      />

      <div className="line-brief">
        <div className={`eval-badge ${m.severity === 'blunder' ? 'danger' : m.severity === 'mistake' ? 'warn' : 'good'}`}>
          {SEVERITY_LABEL[m.severity]} — {verdictInWords(m)}
        </div>
        {lineSan && (
          <p className="brief-when">
            <span className="brief-key">{showing === 'better' ? 'The line' : 'What follows'}</span>{' '}
            {showing === 'better'
              ? `After ${m.bestSan}: ${lineSan} — the arrows on the board walk it.`
              : `Best play punishes ${m.san} with ${lineSan} — drawn on the board.`}
          </p>
        )}
        <p className="brief-when">
          <span className="brief-key">Odds</span> {oddsSwing(m.cpBest, m.cpPlayed)}
        </p>
        <p className="brief-when">
          <span className="brief-key">Where</span> Move {moveNumber} of the {m.phase}.
        </p>
        {m.tag && (
          <p className="brief-answer">
            <span className="brief-key">Habit</span> {TAG_LABEL[m.tag]}. This is the tag the
            ladder reorders around — see it here often enough and the app starts serving drills
            for it.
          </p>
        )}
        {m.bestSan && (
          <p className="brief-role">
            Tap "Better was {m.bestSan}" above to see the position you could have had. The
            difference between the two boards is the lesson.
          </p>
        )}
      </div>
    </div>
  )
}
