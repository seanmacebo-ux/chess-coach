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
 *   EVERY MOVE IS RATED, AND THE GAME HAS A SHAPE. The header used to count
 *   three kinds of failure and put everything else in a bucket called "fine" —
 *   a report card written by someone who only noticed you when you got it
 *   wrong. Now each move carries a verdict with a rule behind it (coach/
 *   report.ts), the mix is one bar, and the two or three plies the game
 *   actually turned on are named at the top, including the ones where the
 *   OPPONENT handed you something.
 *
 * The move-by-move list still defaults to what needs fixing, because attention
 * after a game is limited — but "Every move" walks the whole game, and it is
 * reachable from a clean game too.
 */

import { useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import type { Key } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'
import { Board } from '../Board'
import { TAG_LABEL, type MoveAssessment } from '../../coach/analysis'
import { loosePieces } from '../../coach/exercises'
import { readPosition, weighMove } from '../../coach/position'
import {
  buildReport, RATING_LABEL, RATING_MEANING,
  type MoveRating, type Moment,
} from '../../coach/report'
import { EvalMeter, oddsSwing, winChance } from '../EvalMeter'
import { bookPlies, type OpeningName } from '../../coach/eco'
import { byPhase, readOpponent } from '../../coach/breakdown'

/**
 * The ratings in the order they are shown: best news first, worst last.
 *
 * Not alphabetical and not by frequency — a strip that reads left to right
 * from brilliant to blunder is a shape you can take in without reading the
 * labels, and the same order is used for the bar and its legend so the two
 * are the same object seen twice.
 */
const RATING_ORDER: MoveRating[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book',
  'inaccuracy', 'mistake', 'blunder', 'miss',
]

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
  /*
   * Every move is walkable now, not just the flagged ones, so this has to
   * have something true to say about a GOOD move. It did not: a move labelled
   * "Best" was being described as "the better move keeps more of it", which
   * names a better move that by definition does not exist.
   */
  if (m.severity === 'best') return 'the engine plays this too'
  if (m.severity === 'good') return 'nothing lost'
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


export type ProblemOrder = 'severity' | 'game' | 'all'

/**
 * The positions worth looking at, in the order asked for.
 *
 * Exported and standalone because the component needs it twice — once to
 * render and once to keep your place when the order changes — and two copies
 * of a sort is how the two silently drift apart.
 */
export function orderProblems(
  moves: MoveAssessment[],
  order: ProblemOrder,
): MoveAssessment[] {
  /*
   * 'all' is every move you played, in order.
   *
   * Sean: "you not breaking down my choices or my movement." The review only
   * ever showed the moves it flagged — and since severity became odds-based,
   * a decided game can flag exactly one. Every other decision you made, good
   * ones included, got no account at all. Walking the whole game is how you
   * look at a choice you were unsure of rather than only the ones that cost.
   */
  if (order === 'all') return [...moves].sort((a, b) => a.ply - b.ply)

  const bad = moves.filter(
    (m) => m.severity === 'blunder' || m.severity === 'mistake' || m.severity === 'inaccuracy',
  )
  return order === 'severity'
    ? // Ties broken by ply so the list is stable rather than depending on
      // whatever order the analysis happened to return.
      [...bad].sort((a, b) => b.lossCp - a.lossCp || a.ply - b.ply)
    : [...bad].sort((a, b) => a.ply - b.ply)
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
  /**
   * What the opening was called, when it is known.
   *
   * Two jobs. It names the game — which this screen could never do — and it
   * decides which of your moves were PREPARED. Without it, a book move was
   * scored as though you had worked it out at the board.
   */
  opening?: OpeningName | null
  /** Who you were playing, so the opponent read can name them. */
  opponentName?: string
  /**
   * Open on this ply rather than at the top of the list.
   *
   * The end-of-game screen names the move the game turned on; tapping it has
   * to land there, not at whatever the worst-first sort puts first.
   */
  startPly?: number | null
}

export function GameReview({
  moves,
  colour,
  acpl,
  perf,
  onClose,
  onSwapSide,
  swapping = false,
  opening = null,
  opponentName,
  startPly = null,
}: GameReviewProps) {
  /*
   * ORDER IS A CHOICE NOW.
   *
   * This screen only ever showed worst-first, on the reasoning that attention
   * after a game is limited and the dropped rook matters more than two opening
   * inaccuracies. That is true for triage and useless for understanding:
   * Sean — "sometimes it's not sequential so I can't follow through". Jumping
   * from move 22 to move 6 to move 15 shows you a pile of positions, not a
   * game. Both readings are legitimate, so both are offered, and the game
   * graph above them gives the shape either way.
   */
  /*
   * Arriving on a named move means walking the game from there, so the order
   * starts as the full walk. Worst-first is for triage you chose; it is the
   * wrong thing to drop someone into when they tapped a specific position.
   */
  const [order, setOrder] = useState<ProblemOrder>(startPly === null ? 'severity' : 'all')

  const problems = useMemo(() => orderProblems(moves, order), [moves, order])

  /*
   * Every move rated, and the game's turning points, from the numbers the
   * analysis already produced. Sean: "please can you also start rating the
   * moves, I need a full game review and you can highlight the moments."
   * Until now this screen counted three kinds of bad move and nothing else —
   * a game was a list of failures with no shape and no credit.
   */
  const report = useMemo(() => buildReport(moves, bookPlies(opening)), [moves, opening])

  /*
   * The two things the review never said.
   *
   * Sean: "break down the game more — our bots are too simple and we're not
   * uncovering the big part of them." Phase was on every assessment and
   * nothing aggregated it, so a game whose opening was fine and whose endgame
   * collapsed read exactly like one that was uniformly mediocre. And the
   * opponent was a black box: half the game, never mentioned once.
   */
  const phases = useMemo(() => byPhase(moves), [moves])
  const them = useMemo(() => readOpponent(moves, opponentName ?? 'They'), [moves, opponentName])

  const [index, setIndex] = useState(() => {
    if (startPly === null) return 0
    const i = orderProblems(moves, 'all').findIndex((m) => m.ply >= startPly)
    return i >= 0 ? i : 0
  })
  /** Which move is on the board: what you played, or what you should have. */
  const [showing, setShowing] = useState<'yours' | 'better'>('yours')

  const current = problems[index]
  /** Last ply assessed, so the pager can say where in the game you are. */
  const lastPly = moves.length > 0 ? moves[moves.length - 1]!.ply : 0

  /** Jump the pager to a ply, if that ply is in the current list. */
  const goTo = (ply: number) => {
    const i = problems.findIndex((p) => p.ply === ply)
    if (i >= 0) {
      setIndex(i)
      setShowing('yours')
      return true
    }
    // The move exists but this ordering hides it — switch to the full walk
    // rather than doing nothing when a turning point is tapped.
    const j = orderProblems(moves, 'all').findIndex((p) => p.ply === ply)
    if (j >= 0) {
      setOrder('all')
      setIndex(j)
      setShowing('yours')
      return true
    }
    return false
  }

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
          {opening && (
            <div className="view-sub opening">
              <span className="eco">{opening.eco}</span> {opening.name}
              <span className="muted"> · book to move {Math.floor(opening.ply / 2) + 1}</span>
            </div>
          )}
        </div>
      </div>

      {onSwapSide && (
        <button className="chip" onClick={onSwapSide} disabled={swapping} style={{ alignSelf: 'flex-start' }}>
          {swapping
            ? 'Analysing…'
            : `Review ${colour === 'white' ? 'Black' : 'White'}'s moves instead`}
        </button>
      )}

      <RatingStrip counts={report.counts} total={moves.length} />

      {/*
        The game itself, as a shape — above the conditional, because the shape
        of a clean game is worth seeing too. Every one of your moves plotted by
        what your winning chances were after it, so the review opens with the
        story before it starts picking through individual positions.
      */}
      <GameGraph
        moves={moves}
        ratings={report.ratings}
        currentPly={current?.ply ?? null}
        onPick={goTo}
      />

      <Moments moments={report.moments} colour={colour} onGo={goTo} />

      {/* ------------------------------------------------- by phase */}
      {phases.length > 1 && (
        <div className="phases">
          <span className="brief-key">How each part went</span>
          {phases.map((p) => (
            <div key={p.phase} className="phase-row">
              <span className="phase-name">{p.phase}</span>
              <span className="phase-bar">
                {/* Winning chances given away, as a share of the whole game's
                    — so the widest bar is the phase that actually cost you
                    the game rather than the phase that lasted longest. */}
                <i
                  style={{
                    width: `${Math.min(
                      100,
                      (p.given / Math.max(1, phases.reduce((a, q) => a + q.given, 0))) * 100,
                    )}%`,
                  }}
                />
              </span>
              <span className="phase-n">
                {p.moves} moves · {p.acpl} cp
              </span>
              {p.worst && (
                <span className="phase-worst">
                  worst {p.worst.moveNo}. {p.worst.san} (−{p.worst.cost})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------ the other player */}
      {them && (
        <div className="them">
          <span className="brief-key">What they were doing</span>
          <p className="them-say">{them.verdict}</p>
          <div className="them-stats">
            <TraitStat n={them.captures} of={them.moves} label="captures" />
            <TraitStat n={them.checks} of={them.moves} label="checks" />
            <TraitStat n={them.atYourKing} of={them.moves} label="at your king" />
            <TraitStat n={them.quiet} of={them.moves} label="quiet" />
          </div>
          {them.gifts > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              They handed you something {them.gifts} time{them.gifts === 1 ? '' : 's'} — the
              biggest was worth {them.biggestGift} points of winning chances.
            </p>
          )}
        </div>
      )}

      {problems.length === 0 ? (
        <div className="feature">
          <div className="feature-title">Nothing to correct</div>
          <p className="feature-body">
            No inaccuracies, mistakes or blunders in {moves.length} moves. That is a genuinely
            clean game — play someone stronger.
          </p>
          {/*
            A clean game still has 30 decisions in it. The walk used to be
            unreachable from here, because the only way to it was a chip inside
            the branch that this message replaces — so playing well locked you
            out of the screen that explains your play.
          */}
          <button className="chip" onClick={() => { setOrder('all'); setIndex(0) }}>
            Walk the game move by move
          </button>
        </div>
      ) : (
        <>
          <p className="lede">
            {problems.length}{' '}
            {order === 'all'
              ? `move${problems.length === 1 ? '' : 's'}`
              : `position${problems.length === 1 ? '' : 's'} worth looking at`}
            {order === 'severity'
              ? ', worst first'
              : order === 'all'
                ? ' — every move you played, in order'
                : ', in the order they happened'}. The board
            shows what you were looking at — tap between your move and the better one to see the
            difference.
          </p>

          <div className="rev-order">
            {(
              [
                ['severity', 'Worst first'],
                ['game', 'In game order'],
                ['all', 'Every move'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className="chip"
                aria-pressed={order === id}
                onClick={() => {
                  // Keep the position you are looking at when the order
                  // changes — re-sorting under the reader and silently
                  // showing them a different move is disorienting.
                  const keep = current?.ply
                  setOrder(id)
                  if (keep !== undefined) {
                    const i = orderProblems(moves, id).findIndex((m) => m.ply === keep)
                    if (i >= 0) setIndex(i)
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>

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
              {current && (
                <span className="muted">
                  {' '}
                  · move {Math.floor(current.ply / 2) + 1} of {Math.floor(lastPly / 2) + 1}
                </span>
              )}
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
              rating={report.ratings.get(current.ply) ?? 'good'}
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

/**
 * Every move you played, by kind — the whole game, not only the bad parts.
 *
 * The old header counted blunders, mistakes, inaccuracies and "fine". Three
 * ways to have failed and one bucket for everything else, which is a report
 * card written by someone who only noticed you when you got it wrong. The
 * moves you found are now named too, and Brilliant is in there because it is
 * earned by a rule (report.ts) rather than handed out for looking nice.
 *
 * The bar is the mix at a glance; the legend under it is the exact counts.
 * Zero-count ratings are dropped — a row of noughts is not information.
 */
export function RatingStrip({
  counts,
  total,
}: {
  counts: Record<MoveRating, number>
  total: number
}) {
  if (total === 0) return null
  const shown = RATING_ORDER.filter((r) => counts[r] > 0)
  return (
    <div className="rat-strip">
      <div className="rat-bar" role="img" aria-label={
        shown.map((r) => `${counts[r]} ${RATING_LABEL[r]}`).join(', ')
      }>
        {shown.map((r) => (
          <span key={r} className={`rat-seg rat-${r}`} style={{ flexGrow: counts[r] }} />
        ))}
      </div>
      <div className="rat-legend">
        {shown.map((r) => (
          <span key={r} className="rat-item" title={RATING_MEANING[r]}>
            <span className={`rat-dot rat-${r}`} />
            <span className="rat-n">{counts[r]}</span>
            <span className="rat-l">{RATING_LABEL[r]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * The moments — where the game actually turned.
 *
 * Sean: "you can highlight the moments for me, like specific turnaround."
 * A list of mistakes sorted by size is not the story of a game; two or three
 * plies are, and one of them is usually something the OPPONENT did. Each row
 * says which way the swing went, in winning chances, and taps through to the
 * position.
 *
 * Gifts carry your answer with them. "They dropped a piece" only means
 * something alongside whether you took it, and that is the difference between
 * a turning point and a moment that passed you by.
 */
export function Moments({
  moments,
  colour,
  onGo,
  max = 3,
}: {
  moments: Moment[]
  colour: 'white' | 'black'
  onGo: (ply: number) => boolean
  /** How many to show. The result screen wants fewer than the review does. */
  max?: number
}) {
  // A list of nine turning points has no turning points in it.
  const top = moments.slice(0, max)
  if (top.length === 0) return null

  const you = colour === 'white' ? 'White' : 'Black'
  return (
    <div className="moments">
      <span className="brief-key">Where it turned</span>
      {top.map((mo, i) => {
        const dots = mo.ply % 2 === 0 ? '.' : '…'
        // A gift is their move; the position to look at is your answer to it.
        const target = mo.kind === 'theirs-gave' ? mo.ply + 1 : mo.ply
        return (
          <button
            key={`${mo.kind}-${mo.ply}`}
            className={`moment ${mo.kind}`}
            onClick={() => onGo(target)}
          >
            <span className="moment-head">
              <span className="moment-move">
                {mo.moveNo}
                {dots} {mo.san}
              </span>
              <span className="moment-swing">
                {Math.round(mo.from)}% → {Math.round(mo.to)}%
              </span>
            </span>
            <span className="moment-say">
              {mo.kind === 'yours-lost'
                ? `You gave up ${Math.round(mo.swing)} points of winning chances here${
                    // Only the first row can claim to be the biggest — the
                    // list is sorted by swing, so saying it on every row of a
                    // game with two collapses in it is simply false.
                    i === 0 ? ' — the biggest single swing of the game' : ''
                  }.`
                : `They handed you ${Math.round(mo.swing)} points. ${
                    mo.punished
                      ? `You answered ${mo.reply} — the engine's move too.`
                      : `You answered ${mo.reply}, which gave some of it straight back.`
                  }`}
            </span>
            <span className="moment-who">{mo.kind === 'yours-lost' ? you : 'Opponent'}</span>
          </button>
        )
      })}
    </div>
  )
}

function MistakeCard({
  m,
  rating,
  colour,
  showing,
  onShow,
}: {
  m: MoveAssessment
  rating: MoveRating
  colour: 'white' | 'black'
  showing: 'yours' | 'better'
  onShow: (s: 'yours' | 'better') => void
}) {
  /** Which option has its breakdown open, by SAN. */
  const [weighing, setWeighing] = useState<string | null>(null)

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
        {/*
          The rating, its rule, and what it cost — in that order.
          The badge used to read "Blunder — cost 40 points" and stop there,
          which tells you the verdict but never the standard it was judged by.
          RATING_MEANING is the standard, printed next to the word, so a
          Brilliant is checkable rather than flattering.
        */}
        <div className={`eval-badge rat-${rating}`}>
          {RATING_LABEL[rating]} — {verdictInWords(m)}
        </div>
        <p className="brief-when">
          <span className="brief-key">Why that word</span> {RATING_MEANING[rating]}
        </p>
        {lineSan && (
          <p className="brief-when">
            <span className="brief-key">{showing === 'better' ? 'The line' : 'What follows'}</span>{' '}
            {showing === 'better'
              ? `After ${m.bestSan}: ${lineSan} — the arrows on the board walk it.`
              : /* "punishes" is only true if the move was a mistake. On a good
                   move the same line is simply how the game goes on. */
                m.severity === 'best' || m.severity === 'good'
                ? `The game continues ${lineSan} — drawn on the board.`
                : `Best play punishes ${m.san} with ${lineSan} — drawn on the board.`}
          </p>
        )}
        <p className="brief-when">
          <span className="brief-key">Odds</span> {oddsSwing(m.cpBest, m.cpPlayed)}
        </p>

        {/*
          WHAT WAS HAPPENING HERE. Every number on this screen so far is the
          engine's verdict, which cannot be reproduced at the board. This is
          the position in terms you can check yourself: material, what is
          loose on both sides, king safety, development, the centre. Computed
          from the board, so it cannot say something the position does not.
        */}
        {(() => {
          const read = readPosition(m.fen, m.uci.length > 0 ? (new Chess(m.fen).turn() as 'w' | 'b') : 'w')
          return (
            <div className="reading">
              <span className="brief-key">What was happening</span>
              <ul className="read-lines">
                {read.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )
        })()}

        {/*
          The choice, not just the verdict. These are the moves that were
          actually on the table in this position, best first, with yours
          marked — so a move you were unsure about has an account even when it
          cost nothing, which is most of them.
        */}
        {m.alts && m.alts.length > 1 && (
          <div className="alts">
            <span className="brief-key">Your options — tap one to weigh it</span>
            <div className="alt-rows">
              {m.alts.map((a, i) => (
                <div key={a.san + i}>
                  <button
                    className={'alt' + (a.played ? ' played' : '') + (weighing === a.san ? ' open' : '')}
                    onClick={() => setWeighing(weighing === a.san ? null : a.san)}
                  >
                    <span className="alt-san">{a.san}</span>
                    <span className="alt-bar">
                      <i style={{ width: `${Math.round(winChance(a.cp))}%` }} />
                    </span>
                    <span className="alt-pct">{Math.round(winChance(a.cp))}%</span>
                  </button>
                  {/*
                    Tap an option and it says what it DOES and what it COSTS —
                    deliberately two lists and no score, because a number
                    lets you skip the weighing, which is the skill.
                  */}
                  {weighing === a.san && <Weighed fen={m.fen} san={a.san} />}
                </div>
              ))}
              {/* Played something the engine never shortlisted: say so rather
                  than leaving your own move missing from your own options. */}
              {/*
                Played something the engine never shortlisted. It goes in the
                list like any other option AND it opens like one — it is the
                move most worth weighing, and in the first version it was the
                only row you could not tap.
              */}
              {!m.alts.some((a) => a.played) && (
                <div>
                  <button
                    className={'alt played' + (weighing === m.san ? ' open' : '')}
                    onClick={() => setWeighing(weighing === m.san ? null : m.san)}
                  >
                    <span className="alt-san">{m.san}</span>
                    <span className="alt-bar">
                      <i style={{ width: `${Math.round(winChance(m.cpPlayed))}%` }} />
                    </span>
                    <span className="alt-pct">{Math.round(winChance(m.cpPlayed))}%</span>
                  </button>
                  {weighing === m.san && <Weighed fen={m.fen} san={m.san} />}
                </div>
              )}
            </div>
          </div>
        )}
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
        {/*
          Only where there is a lesson. A move the engine also plays has no
          better version, and one that lost nothing measurable does not have a
          "difference between the two boards" worth calling the lesson — the
          toggle is still there for both, it just stops being instructed.
        */}
        {m.bestSan && m.severity !== 'best' && m.severity !== 'good' && (
          <p className="brief-role">
            Tap "Better was {m.bestSan}" above to see the position you could have had. The
            difference between the two boards is the lesson.
          </p>
        )}
      </div>
    </div>
  )
}


/**
 * The game as a shape: your winning chances after every move you played.
 *
 * Sean asked for "the progression of the game" because the review served a
 * pile of positions in severity order with nothing tying them together. A
 * position out of context teaches a move; a line across the whole game teaches
 * where you actually lost it — the long slide, or the one cliff.
 *
 * Drawn from numbers already computed: `cpPlayed` per move through the same
 * win-probability curve the odds meter uses, so the graph and the meter can
 * never disagree. Only YOUR moves are assessed, so each step is one of yours.
 *
 * The line is an SVG scaled to the container (non-scaling stroke keeps it an
 * even weight at any width); the marks are positioned HTML so they stay round
 * rather than stretching with the viewBox.
 */
function GameGraph({
  moves,
  ratings,
  currentPly,
  onPick,
}: {
  moves: MoveAssessment[]
  /** Every move's rating, so a mark can be a verdict and not just a dot. */
  ratings: Map<number, MoveRating>
  currentPly: number | null
  onPick: (ply: number) => void
}) {
  if (moves.length < 2) return null

  const pct = moves.map((m) => winChance(m.cpPlayed))
  const x = (i: number) => (i / (moves.length - 1)) * 100
  /*
   * The plot is inset top and bottom. Without it a move at 0% or 100% sits
   * exactly on the frame edge and its mark is sliced in half by the rounded
   * clip — which is precisely where the interesting moves are, since those
   * are the ones that won or lost the game.
   */
  const PAD = 11
  const y = (p: number) => PAD + ((100 - p) * (100 - 2 * PAD)) / 100

  const line = pct.map((p, i) => `${x(i)},${y(p)}`).join(' ')
  const area = `0,100 ${line} 100,100`

  /*
   * Which moves get a mark. Previously it was "whatever the current ordering
   * is showing", which meant the graph's dots moved when you changed the sort
   * — the shape of the game is not supposed to depend on how you are reading
   * it. Now it is the moves with something to say about them: the costly ones
   * and the ones you earned.
   */
  const MARKED: MoveRating[] = ['brilliant', 'great', 'miss', 'blunder', 'mistake', 'inaccuracy']

  return (
    <div className="rev-graph">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={area} className="rev-graph-fill" />
        <line x1="0" y1="50" x2="100" y2="50" className="rev-graph-mid" vectorEffect="non-scaling-stroke" />
        <polyline points={line} className="rev-graph-line" vectorEffect="non-scaling-stroke" />
      </svg>
      {moves.map((m, i) => {
        const r = ratings.get(m.ply)
        if (!r || !MARKED.includes(r)) return null
        const on = m.ply === currentPly
        const no = Math.floor(m.ply / 2) + 1
        return (
          <button
            key={m.ply}
            className={`rev-mark rat-${r}${on ? ' on' : ''}`}
            style={{ left: `${x(i)}%`, top: `${y(pct[i]!)}%` }}
            title={`Move ${no} — ${m.san} · ${RATING_LABEL[r]}`}
            aria-label={`Move ${no}, ${m.san}, ${RATING_LABEL[r]}`}
            onClick={() => onPick(m.ply)}
          />
        )
      })}
      <span className="rev-graph-cap top">winning</span>
      <span className="rev-graph-cap bottom">losing</span>
    </div>
  )
}

/**
 * One move, weighed: what it does and what it costs.
 *
 * No score. "d3 82%" is an answer; these are the reasons, and the reasons are
 * the part that transfers to the next game. Both lists come from the board —
 * see coach/position.ts on why nothing here is allowed to be true "usually".
 */
function Weighed({ fen, san }: { fen: string; san: string }) {
  const w = weighMove(fen, san)
  if (!w) return null
  return (
    <div className="weighed">
      <div className="weigh-col">
        <span className="weigh-head good">What it does</span>
        <ul>
          {w.does.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
      <div className="weigh-col">
        <span className="weigh-head bad">What it costs</span>
        <ul>
          {w.costs.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * One counted trait of the opponent's play, as a share of their moves.
 *
 * The denominator is shown because "6 captures" means nothing without it:
 * six out of forty is a quiet game and six out of twelve is a bloodbath.
 */
function TraitStat({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <div className="them-stat">
      <span className="them-stat-n">
        {n}
        <span className="them-stat-of">/{of}</span>
      </span>
      <span className="them-stat-l">{label}</span>
    </div>
  )
}
