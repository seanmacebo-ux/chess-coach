/**
 * Learn — an index of six sections, and a full screen for whichever one you
 * open. Two levels. That is the whole navigation model.
 *
 * WHAT THIS REPLACED, and why it had to go. The previous version held
 * `open: Pillar | null`, so exactly one pillar could be expanded at a time and
 * opening Endgames closed Tactics. Inside Tactics was a second accordion per
 * category. Inside Openings was a third per opening. Nothing was playable until
 * you were three clicks deep, the opening board inherited padding from three
 * nested cards and came out unreadable, and the whole screen read as — Sean's
 * words — "just a bunch of dropdowns and a bunch of widgets". He was right.
 *
 * The rules now:
 *
 *   EVERY SECTION IS VISIBLE AT ONCE on the index. No expanding, no "one open
 *   at a time". You see all six, their ratings, and their progress, and you
 *   choose. That single change removes the entire class of complaint.
 *
 *   A SECTION OWNS THE WHOLE SCREEN when you open it. It is not a drawer inside
 *   a list; it is a page, with a back control. Which is why the openings board
 *   can finally be large.
 *
 *   NOTHING NESTS MORE THAN ONE LEVEL. Where a section has more content than
 *   fits, it uses list-and-detail rather than disclosure — see `sections.tsx`.
 *
 *   NO BARE NUMBERS. Every rating on this screen says what it is, how it last
 *   moved, and what would move it next, on the surface where it appears. A
 *   metric you cannot interpret is decoration with extra steps.
 *
 * Two content rules carried over from the old file, because they were right:
 *
 *   EVERYTHING AT YOUR LEVEL OR BELOW IS SHOWN, and clearly marked. Hiding
 *   cleared material makes the ladder feel shorter than it is and removes the
 *   thing you go back to when a weakness resurfaces. Material above you is
 *   shown too, marked, because seeing what is coming is half of why a ladder
 *   works. The openings module used to violate this by hard-filtering on the
 *   rating band; it no longer does.
 *
 *   RECOMMENDATIONS ARE RANKED, not listed. "Here are 20 endgames" is a menu;
 *   "master these three next, in this order, because they decide the most games
 *   at your rating" is coaching. The ranking survives — as the order of the one
 *   list, rather than as a second copy of it.
 */

import { useEffect, useMemo, useState } from 'react'
import { PILLARS, tiersFor, type Pillar } from '../../coach/tiers'
import { tierStatuses, type TierStatus } from '../../coach/profile'
import { getProfile } from '../../data/db'
import { getSectionRatings, type SectionId, type SectionRating } from '../../coach/rating'
import { LESSONS } from '../../content/lessons'
import { CATEGORIES } from '../../coach/categories'
import { ENDGAMES, type EndgamePosition } from '../../coach/endgames'
import { POSITIONAL, type PositionalPosition } from '../../coach/positional'
import { OPENINGS } from '../../content/openings'
import { Bar, RatingChip, RatingExplainer } from '../learn/RatingChip'
import { Ladder } from '../learn/Ladder'
import {
  ConceptSection,
  EndgameSection,
  IdeasSection,
  OpeningsSection,
  TacticsSection,
} from '../learn/sections'
import { CoachedGame } from './CoachedGame'

/**
 * Ideas is a peer section, not a pillar — it has no tier ladder and no rating
 * of its own, because it is reading rather than training. It used to be a card
 * bolted on after the pillars, which made one of the six things the app
 * teaches look like a footnote.
 */
export type SectionKey = Pillar | 'ideas'

const SECTIONS: { key: SectionKey; name: string; blurb: string }[] = [
  ...PILLARS.map((p) => ({ key: p.id as SectionKey, name: p.name, blurb: p.blurb })),
  { key: 'ideas', name: 'Ideas', blurb: 'The thinking behind the moves.' },
]

/** What is actually in each section, stated on its card so the index is a menu
 *  with prices on it rather than six identical tiles. */
function contentsOf(key: SectionKey, lessonsAtLevel: number): string {
  switch (key) {
    case 'tactics':
      return `${CATEGORIES.length} categories to drill, plus the candidate-move trainer`
    case 'endgame':
      return `${ENDGAMES.length} positions to play out against the engine`
    case 'positional':
      return `${tiersFor('positional').length} board questions, plus the loose-piece scan`
    case 'strategy':
      return `${tiersFor('strategy').length} board questions, plus the threat trainer`
    case 'opening':
      return `${OPENINGS.length} openings with the plan behind each one`
    case 'ideas':
      return `${LESSONS.length} concept cards, ${lessonsAtLevel} of them aimed at you`
  }
}

export interface LearnProps {
  /** Launch a puzzle set built from these motifs. */
  onTrainCategory: (motifs: string[], label: string) => void
  /** Jump to the endgame play-out for this position. */
  onPlayEndgame: (position: EndgamePosition) => void
  /** Jump to the coached positional play-out for this position. */
  onPlayPositional: (position: PositionalPosition) => void
  /** Start a loose-piece scan built from real positions. */
  onStartScan: () => void
  /** Start an engine-backed "what are they threatening" set. */
  onStartThreat: () => void
  /** Start a Kotov candidate-move set. */
  onStartCandidates: () => void
}

export function Learn({
  onTrainCategory,
  onPlayEndgame,
  onPlayPositional,
  onStartScan,
  onStartThreat,
  onStartCandidates,
}: LearnProps) {
  const [rating, setRating] = useState(1400)
  const [statuses, setStatuses] = useState<TierStatus[]>([])
  const [ratings, setRatings] = useState<Record<SectionId, SectionRating> | null>(null)
  /** null is the index. Anything else is that section, full screen. */
  const [view, setView] = useState<SectionKey | null>(null)
  /** The coached game takes the whole screen, from wherever it is started. */
  const [coached, setCoached] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await getProfile()
      const s = await tierStatuses(p.rating)
      const r = await getSectionRatings()
      if (cancelled) return
      setRating(p.rating)
      setStatuses(s)
      setRatings(r)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Opening a section is a page change, so it starts at the top. Without this
  // you land halfway down a section because you tapped a card that was halfway
  // down the index.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [view])

  const byId = useMemo(() => new Map(statuses.map((s) => [s.tier.id, s])), [statuses])
  const lessonsAtLevel = LESSONS.filter(
    (l) => rating >= l.band[0] && rating <= l.band[1],
  ).length

  if (coached) {
    return <CoachedGame rating={rating} onExit={() => setCoached(false)} />
  }

  if (view === null) {
    return (
      <Index
        rating={rating}
        statuses={statuses}
        ratings={ratings}
        byId={byId}
        lessonsAtLevel={lessonsAtLevel}
        onOpen={setView}
        onCoached={() => setCoached(true)}
      />
    )
  }

  const meta = SECTIONS.find((s) => s.key === view)!
  const isPillar = view !== 'ideas'
  const sectionRating = isPillar ? ratings?.[view as SectionId] : undefined

  return (
    <div className="stack">
      <div className="secbar">
        <button className="ghost back" onClick={() => setView(null)}>
          ← All sections
        </button>
        <span className="small muted">Learn</span>
      </div>

      <div className="card stack">
        <div className="row spread" style={{ alignItems: 'flex-start', gap: 16 }}>
          <span>
            <div className="focus-title">{meta.name}</div>
            <div className="small muted">{meta.blurb}</div>
          </span>
          {isPillar && <RatingChip r={sectionRating} />}
        </div>
        {isPillar && <RatingExplainer r={sectionRating} full />}
      </div>

      {view === 'tactics' && (
        <TacticsSection
          rating={rating}
          onTrain={onTrainCategory}
          onStartCandidates={onStartCandidates}
        />
      )}
      {view === 'endgame' && <EndgameSection rating={rating} onPlay={onPlayEndgame} />}
      {view === 'opening' && <OpeningsSection rating={rating} />}
      {view === 'positional' && POSITIONAL.length > 0 && (
        <div className="card stack">
          <span className="small muted">Play the idea — coached, against the engine</span>
          {POSITIONAL.map((p) => (
            <div key={p.id} className="row spread" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span>
                <div><strong>{p.name}</strong></div>
                <div className="small muted">{p.concepts.join(' · ')}</div>
              </span>
              <button className="primary small" onClick={() => onPlayPositional(p)}>
                Play
              </button>
            </div>
          ))}
        </div>
      )}
      {(view === 'positional' || view === 'strategy') && (
        <ConceptSection
          pillar={view}
          rating={rating}
          onStartScan={onStartScan}
          onStartThreat={onStartThreat}
        />
      )}
      {view === 'ideas' && <IdeasSection rating={rating} />}

      {/* The wall. A primary element of the section, not a footnote under the
          drills — it is the answer to "what have I done and what is left". */}
      {isPillar && <Ladder tiers={tiersFor(view as Pillar)} byId={byId} rating={rating} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Index({
  rating,
  statuses,
  ratings,
  byId,
  lessonsAtLevel,
  onOpen,
  onCoached,
}: {
  rating: number
  statuses: TierStatus[]
  ratings: Record<SectionId, SectionRating> | null
  byId: Map<string, TierStatus>
  lessonsAtLevel: number
  onOpen: (k: SectionKey) => void
  onCoached: () => void
}) {
  const cleared = statuses.filter((s) => s.cleared).length
  const openNow = statuses.filter((s) => s.inBand && !s.cleared).length

  return (
    <div className="stack">
      {/*
        Was twelve lines of prose, and prose is what "flat" looks like.
        Everything it said is still true and most of it was not needed at the
        top of a menu: the counts are on the cards, and what a section rating
        means is explained on the section page where you can act on it. What is
        left is the only thing this header has to answer — where am I, and how
        much is open.
      */}
      <div className="learn-top">
        <div className="learn-top-num">
          <span className="hero-num">{rating}</span>
          <span className="hero-cap">your rating</span>
        </div>
        <div className="learn-top-facts">
          <div className="learn-top-lead">
            <b>{openNow}</b> levels open to you now
          </div>
          <div className="learn-top-sub">
            {cleared} of {statuses.length} cleared · nothing below you is ever locked
          </div>
        </div>
      </div>

      {/*
        THE STYLE, above the shelves. Sean's critique of this screen was
        structural and correct: "learn doesn't teach me the style that makes
        sense." Six sections organised by topic are a library, and nobody
        plays chess by shelf. This card is the through-line — one real game
        where the opening, the threat check and the safety check happen in
        order, live, with arrows. The sections below are where you sharpen
        each step; this is where they become one way of playing.
      */}
      <button className="coached-cta" onClick={onCoached}>
        <span className="coached-kicker">The style, in one game</span>
        <span className="coached-title">Play a coached game</span>
        <span className="small muted">
          Your opening with arrows while the game follows it, then the loop on every move: what do
          they threaten, what hangs for free, is anything of yours loose. At the end the loop is
          scored — pieces taken, pieces hung, book moves — against your last coached game.
        </span>
      </button>

      <div className="sec-grid">
        {SECTIONS.map((s) => {
          const tiers = s.key === 'ideas' ? [] : tiersFor(s.key as Pillar)
          const done = tiers.filter((t) => byId.get(t.id)?.cleared).length
          const isPillar = s.key !== 'ideas'
          const r = isPillar ? ratings?.[s.key as SectionId] : undefined

          return (
            <button
              key={s.key}
              /*
               * Tone per section. Six identical cards in the same brown was
               * most of why this screen read as flat — nothing distinguished
               * Tactics from Endgames except the word, so the eye had nothing
               * to navigate by and the whole column merged.
               */
              className={`sec-card tone-${s.key}`}
              onClick={() => onOpen(s.key)}
            >
              <span className="row spread" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="sec-name">{s.name}</span>
                {isPillar ? <RatingChip r={r} /> : <span className="tag">reading</span>}
              </span>

              <span className="small muted">{s.blurb}</span>

              {/*
                The rating explainer used to sit here on every card, which meant
                "Not trained yet — the number is a starting guess" appeared six
                times down one screen. The same sentence repeated is not
                information; it is texture. It says it once above the grid now,
                and the full version lives on the section page.
              */}

              {/*
                Ideas has no ladder to clear, so it gets the one measure that
                does apply to it — how much of the set is written for where you
                are. Without this the card had a hole in it where the other five
                have a progress bar, which made the newest peer section look
                like the afterthought it used to be.
              */}
              {isPillar ? (
                <>
                  <Bar done={done} total={tiers.length} />
                  <span className="small muted">
                    {done} of {tiers.length} levels cleared ·{' '}
                    {tiers.filter((t) => byId.get(t.id)?.inBand).length} open at {rating}
                  </span>
                </>
              ) : (
                <>
                  <Bar done={lessonsAtLevel} total={LESSONS.length} />
                  <span className="small muted">
                    {lessonsAtLevel} written for {rating} · the rest are marked, not hidden
                  </span>
                </>
              )}

              <span className="small sec-contents">{contentsOf(s.key, lessonsAtLevel)}</span>
              <span className="sec-go small">Open →</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
