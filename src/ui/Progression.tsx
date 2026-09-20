/**
 * What you did, and whether it is going anywhere.
 *
 * Sean: "recording my progression is difficult, and tracing my usage and
 * training is hard with this."
 *
 * Learn was built entirely from pairwise snapshots — 67% from 60%, 3 → 10 in
 * 15 days. Two points can only ever answer "better or worse than last time";
 * they cannot show a shape, and six weeks of steady climbing looks identical
 * to six weeks of thrashing. And nothing recorded TRAINING at all: History
 * lists games, while the puzzles and drills — most of what he actually does
 * — went into the database and were never shown back.
 *
 * Two answers, in the order the questions get asked:
 *
 *   DID I TURN UP — a calendar of the last twelve weeks, one square a day.
 *   The most-looked-at chart on the internet is this one, for a reason: it
 *   answers "have I been doing the thing" without a single number.
 *
 *   IS IT WORKING — three trend lines over the same twelve weeks. Puzzle
 *   accuracy, playing strength, and mistakes per game. Not one composite
 *   score, because those three can move independently and a single number
 *   would hide exactly the case worth seeing: accuracy up while games get
 *   worse means the drills are not reaching the board.
 *
 * A LINE IS ONLY DRAWN WHERE THERE IS DATA. Weeks with too little to mean
 * anything come back null from coach/history.ts and leave a GAP rather than
 * a point at zero. A trend line that dives to the floor because you were
 * away is a graph telling you that you got worse on holiday.
 */

import { useMemo, useState } from 'react'
import type { Activity, WeekPoint } from '../coach/history'

/* ------------------------------------------------------------------ */
/* The calendar                                                        */
/* ------------------------------------------------------------------ */

const WEEKDAY = ['M', '', 'W', '', 'F', '', 'S']

/**
 * Twelve weeks of days, as a grid of squares.
 *
 * Shaded in the BOARD's dark square colour at four strengths, so it reads as
 * part of a chess app rather than as a widget borrowed from somewhere else,
 * and so it re-colours when the board theme does.
 */
export function ActivityGrid({
  activity,
  picked,
  onPick,
}: {
  activity: Activity
  picked: string | null
  onPick: (date: string) => void
}) {
  const { days } = activity

  /*
   * The busiest day sets the top of the scale, so the grid is always legible
   * whether you do five puzzles a day or fifty. A fixed scale makes a light
   * trainer's whole calendar the palest shade and tells them nothing.
   */
  const peak = useMemo(() => Math.max(4, ...days.map((d) => d.total)), [days])
  const level = (total: number) => (total === 0 ? 0 : Math.min(4, Math.ceil((total / peak) * 4)))

  // Columns of seven, oldest first. The window is a whole number of weeks.
  const columns: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7))

  return (
    <div className="act">
      <div className="act-days" aria-hidden="true">
        {WEEKDAY.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="act-grid">
        {columns.map((col, ci) => (
          <div className="act-col" key={ci}>
            {col.map((d) => (
              /*
                A tooltip is not an answer on a phone. These were spans with a
                title attribute, which on the device this app is actually used
                on means the information was simply not reachable — you could
                see that Tuesday was dark and had no way to ask what you did.
              */
              <button
                key={d.date}
                className={`act-cell l${level(d.total)}` + (picked === d.date ? ' on' : '')}
                aria-pressed={picked === d.date}
                aria-label={`${d.date}, ${d.total === 0 ? 'nothing' : `${d.puzzles} puzzles, ${d.games} games`}`}
                onClick={() => onPick(d.date)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The trend lines                                                     */
/* ------------------------------------------------------------------ */

export interface TrendProps {
  label: string
  /** One value per week, null where there was not enough to say. */
  points: (number | null)[]
  /** Which direction is good. Mistakes going down is progress. */
  goodWhen: 'up' | 'down'
  /** Rendered after the latest value. */
  unit?: string
}

/**
 * One metric over twelve weeks.
 *
 * Deliberately not a shared chart component with options. These are three
 * small, fixed-shape lines; the moment a chart takes axes and legends as
 * props it grows a configuration language and stops being readable at this
 * size.
 */
export function Trend({
  label, points, goodWhen, unit = '', weeks, picked, onPick,
}: TrendProps & {
  /** Week start dates, so a tapped point can say WHICH week it is. */
  weeks?: string[]
  picked?: number | null
  onPick?: (i: number) => void
}) {
  const real = points.filter((p): p is number => p !== null)
  if (real.length < 2) {
    return (
      <div className="trend empty">
        <span className="trend-label">{label}</span>
        <span className="small muted">
          not enough weeks yet — needs two with real work in them
        </span>
      </div>
    )
  }

  const lo = Math.min(...real)
  const hi = Math.max(...real)
  /* A flat line must sit in the middle rather than divide by zero. */
  const span = hi - lo || 1
  const PAD = 12
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * 100
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (100 - 2 * PAD)

  /*
   * Segments, not one polyline. A gap in the data has to be a gap in the
   * line — joining across it draws a trend through weeks that never happened.
   */
  const segments: string[] = []
  let run: string[] = []
  points.forEach((p, i) => {
    if (p === null) {
      if (run.length > 1) segments.push(run.join(' '))
      run = []
    } else {
      run.push(`${x(i)},${y(p)}`)
    }
  })
  if (run.length > 1) segments.push(run.join(' '))

  const firstReal = real[0]!
  const lastReal = real[real.length - 1]!
  const change = lastReal - firstReal
  const better = goodWhen === 'up' ? change > 0 : change < 0
  const tone = change === 0 ? '' : better ? 'good' : 'bad'
  const lastIndex = points.length - 1 - [...points].reverse().findIndex((p) => p !== null)

  return (
    <div className="trend">
      <div className="trend-head">
        <span className="trend-label">{label}</span>
        <span className="trend-now">
          {lastReal}
          {unit}
          <span className={`trend-delta ${tone}`}>
            {change === 0 ? ' —' : ` ${change > 0 ? '+' : ''}${Math.round(change * 10) / 10}`}
          </span>
        </span>
      </div>
      {/*
        The plot is its own positioned box. The dot used to be placed against
        the whole .trend — so its top percentage was a fraction of the label
        and footer too, and it landed outside the chart entirely, in one case
        on top of the next metric. A percentage needs the box it is a
        percentage OF to be the box you meant.
      */}
      <div className="trend-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {segments.map((s, i) => (
            <polyline key={i} points={s} className="trend-line" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span
          className={`trend-dot ${tone}`}
          style={{ left: `${x(lastIndex)}%`, top: `${y(lastReal)}%` }}
        />
        {/*
          One hit target per week that has a value. Invisible until touched —
          twelve visible dots on a 44px-tall chart is a row of buttons, not a
          trend — but a line you can question is worth far more than one you
          can only look at.
        */}
        {onPick &&
          points.map((v, i) =>
            v === null ? null : (
              <button
                key={i}
                className={'trend-hit' + (picked === i ? ' on' : '')}
                style={{ left: `${x(i)}%`, top: `${y(v)}%` }}
                aria-label={`${label}, week of ${weeks?.[i] ?? i + 1}: ${v}${unit}`}
                onClick={() => onPick(i)}
              />
            ),
          )}
      </div>
      {picked !== null && picked !== undefined && points[picked] !== null && (
        <div className="trend-picked">
          week of {weeks?.[picked] ?? '—'} · <strong>{points[picked]}{unit}</strong>
        </div>
      )}
      <div className="trend-foot small muted">
        12 weeks · {real.length} with enough data
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The section                                                         */
/* ------------------------------------------------------------------ */

export function Progression({ activity }: { activity: Activity }) {
  const weeks: WeekPoint[] = activity.weeks
  const [day, setDay] = useState<string | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const starts = weeks.map((w) => w.start)
  const shown = day ? activity.days.find((d) => d.date === day) : null

  return (
    <div className="card stack">
      <div className="row spread" style={{ alignItems: 'baseline' }}>
        <div className="prog-label">Did I turn up</div>
        <div className="small muted">last 12 weeks</div>
      </div>

      <ActivityGrid
        activity={activity}
        picked={day}
        onPick={(d) => setDay((cur) => (cur === d ? null : d))}
      />

      {/* What that square actually was. Reserved height, so tapping around
          the calendar does not shove the rest of the card up and down. */}
      <div className="act-day">
        {shown ? (
          shown.total === 0 ? (
            <>
              <strong>{shown.date}</strong> — nothing that day.
            </>
          ) : (
            <>
              <strong>{shown.date}</strong> —{' '}
              {shown.puzzles > 0 && (
                <>
                  {shown.puzzles} puzzle{shown.puzzles === 1 ? '' : 's'} ({shown.solved} solved)
                </>
              )}
              {shown.puzzles > 0 && shown.games > 0 && ', '}
              {shown.games > 0 && (
                <>
                  {shown.games} game{shown.games === 1 ? '' : 's'}
                </>
              )}
            </>
          )
        ) : (
          <span className="muted">Tap a square to see that day.</span>
        )}
      </div>

      <div className="act-stats">
        <Stat n={activity.currentRun} label="day run" />
        <Stat n={activity.activeDays} label="days trained" />
        <Stat n={activity.totalPuzzles} label="puzzles" />
        <Stat n={activity.totalGames} label="games" />
      </div>

      <div className="rule" />

      <div className="prog-label">Is it working</div>
      {/*
        Three lines rather than one score. They can move independently, and
        the case worth seeing is exactly the one a composite would hide:
        puzzle accuracy climbing while games get worse means the drills are
        not reaching the board.
      */}
      <Trend
        label="Puzzle accuracy"
        weeks={starts}
        picked={week}
        onPick={(i) => setWeek((cur) => (cur === i ? null : i))}
        points={weeks.map((w) => w.accuracy)}
        goodWhen="up"
        unit="%"
      />
      <Trend
        label="Playing strength"
        weeks={starts}
        picked={week}
        onPick={(i) => setWeek((cur) => (cur === i ? null : i))}
        points={weeks.map((w) => w.perf)}
        goodWhen="up"
      />
      <Trend
        label="Mistakes per game"
        weeks={starts}
        picked={week}
        onPick={(i) => setWeek((cur) => (cur === i ? null : i))}
        points={weeks.map((w) => w.mistakesPerGame)}
        goodWhen="down"
      />
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="act-stat">
      <span className="act-stat-n">{n}</span>
      <span className="act-stat-l">{label}</span>
    </div>
  )
}
