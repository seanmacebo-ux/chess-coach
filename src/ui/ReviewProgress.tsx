/**
 * What a running game review looks like.
 *
 * WHY THIS EXISTS. Sean reported the review as broken. It is not — a game
 * reviews correctly from both entry points, verified end to end. What is
 * broken is that it says almost nothing while it works.
 *
 * A review is one engine search per move, at depth 14, in WebAssembly, on the
 * device. On a laptop that is a few seconds. On a phone a full game is minutes.
 * And for all of those minutes the entire feedback was the word "reviewing"
 * followed by a fraction, in 12px muted grey, on the row you tapped. During a
 * two-minute wait that is indistinguishable from a button that did nothing —
 * which is exactly what "game review is not working" describes.
 *
 * So the wait is now a thing on the screen: a bar that moves, a count, and one
 * line explaining why it takes a moment. The point is not decoration. A
 * progress bar that visibly advances is the difference between "this is
 * working" and "this is hung", and that judgement is the whole complaint.
 *
 * `total` is the number of YOUR moves, not plies — the opponent's are skipped
 * without a search, so counting them would make the bar stall at every other
 * move for no reason.
 */

import { Bar } from './learn/RatingChip'

export interface ReviewProgressProps {
  /** Your moves analysed so far. */
  done: number
  /** Your moves in total. Zero before the first search returns. */
  total: number
}

export function ReviewProgress({ done, total }: ReviewProgressProps) {
  /*
   * Before the first search comes back there is no total yet, and a bar at 0/0
   * looks stuck. Saying "starting" is honest and, more importantly, different
   * from what it says a second later — a message that CHANGES is the signal
   * that something is happening.
   */
  const started = total > 0

  return (
    <div className="review-progress" role="status" aria-live="polite">
      <div className="row spread" style={{ alignItems: 'baseline', gap: 10 }}>
        <span className="rp-title">
          {started ? 'Reviewing your moves' : 'Starting the engine'}
        </span>
        <span className="rp-count">{started ? `${done} / ${total}` : '…'}</span>
      </div>

      <Bar done={done} total={Math.max(total, 1)} />

      {/* No "you can leave, it'll be waiting" reassurance here, because that is
          not true: the analysis is written back to the game, but the review
          screen itself is component state and navigating away drops it. */}
      <span className="small muted">
        Every move gets its own engine search, and it all runs on your phone rather than a server —
        so a full game takes a minute or two. Keep this screen open and it will appear here.
      </span>
    </div>
  )
}
