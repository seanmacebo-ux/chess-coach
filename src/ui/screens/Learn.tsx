/**
 * Learn — an index of places you go, not a stack of things that expand.
 *
 * WHAT CHANGED AND WHY. This screen used to be five accordion cards, each
 * containing more accordions: a pillar opened to reveal categories, a category
 * opened to reveal a paragraph, and the openings pillar opened to reveal
 * openings that themselves opened. Three levels of disclosure on one scroll,
 * every level rendered in the same bordered box at the same type size.
 *
 * That fails in a specific way rather than a vague one. Nothing on the screen
 * had a location: you could not be "in" endgames, only scrolled to a part of
 * the page where endgames happened to be expanded, and opening a second pillar
 * pushed the first one somewhere you had to hunt for. There was no back, so
 * there was no forward either. Accordions are for optional detail attached to
 * something you are already looking at — they are not navigation, and using
 * them as navigation is most of why the whole app read as one undifferentiated
 * surface.
 *
 * So: the index lists five modules. Tapping one goes there. Each module owns a
 * full view with a title and a way back, and each one puts something you can
 * touch above the fold — a board, a drill, a ranked list — rather than a
 * paragraph explaining what it would train if it were built.
 */

import { useEffect, useMemo, useState } from 'react'
import { PILLARS, tiersFor, type Pillar, type Tier } from '../../coach/tiers'
import { tierStatuses, type TierStatus } from '../../coach/profile'
import { getProfile } from '../../data/db'
import { LESSONS, lessonsAtRating, type Lesson } from '../../content/lessons'
import { CATEGORIES, type Category } from '../../coach/categories'
import { ENDGAMES, type EndgamePosition } from '../../coach/endgames'
import { openingsAtRating } from '../../content/openings'
import { Playground } from '../Playground'
import { Openings, ViewHeader } from './Openings'

export interface LearnProps {
  /** Launch a puzzle set built from these motifs. */
  onTrainCategory: (motifs: string[], label: string) => void
  /** Jump to the endgame play-out for this position. */
  onPlayEndgame: (position: EndgamePosition) => void
  /** Start a loose-piece scan built from real positions. */
  onStartScan: () => void
  /** Start an engine-backed "what are they threatening" set. */
  onStartThreat: () => void
  /** Start a Kotov candidate-move set. */
  onStartCandidates: () => void
}

type View = Pillar | 'ideas' | null

export function Learn(props: LearnProps) {
  const [rating, setRating] = useState(1400)
  const [statuses, setStatuses] = useState<TierStatus[]>([])
  const [view, setView] = useState<View>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await getProfile()
      const s = await tierStatuses(p.rating)
      if (cancelled) return
      setRating(p.rating)
      setStatuses(s)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const byId = useMemo(() => new Map(statuses.map((s) => [s.tier.id, s])), [statuses])
  const back = () => setView(null)

  if (view === 'opening') return <Openings rating={rating} onBack={back} />
  if (view === 'tactics')
    return (
      <TacticsView
        rating={rating}
        byId={byId}
        onTrain={props.onTrainCategory}
        onStartCandidates={props.onStartCandidates}
        onBack={back}
      />
    )
  if (view === 'endgame')
    return <EndgameView rating={rating} byId={byId} onPlay={props.onPlayEndgame} onBack={back} />
  if (view === 'positional' || view === 'strategy')
    return (
      <ConceptView
        pillar={view}
        byId={byId}
        onStartScan={props.onStartScan}
        onStartThreat={props.onStartThreat}
        onBack={back}
      />
    )
  if (view === 'ideas') return <IdeasView lessons={lessonsAtRating(rating)} onBack={back} />

  return <Index rating={rating} statuses={statuses} byId={byId} onOpen={setView} />
}

/* ------------------------------------------------------------- index */

/** What each module actually contains, so the card says something true. */
function moduleStat(pillar: Pillar, rating: number): string {
  switch (pillar) {
    case 'tactics':
      return `${CATEGORIES.length} categories, 28,800 puzzles`
    case 'endgame':
      return `${ENDGAMES.length} positions, engine-verified`
    case 'opening': {
      const mine = openingsAtRating(rating)
      return `${mine.length} openings, ${mine.reduce((n, o) => n + o.lines.length, 0)} lines`
    }
    case 'positional':
      return `${tiersFor('positional').length} levels, 1 drill`
    case 'strategy':
      return `${tiersFor('strategy').length} levels, 1 drill`
  }
}

function Index({
  rating,
  statuses,
  byId,
  onOpen,
}: {
  rating: number
  statuses: TierStatus[]
  byId: Map<string, TierStatus>
  onOpen: (v: View) => void
}) {
  const cleared = statuses.filter((s) => s.cleared).length
  const open = statuses.filter((s) => s.inBand && !s.cleared).length
  const lessons = lessonsAtRating(rating)

  return (
    <div className="stack">
      <div className="learn-hero">
        <div className="hero-rating">
          <span className="hero-num">{rating}</span>
          <span className="hero-cap">your rating</span>
        </div>
        <div className="hero-bars">
          <div className="hero-line">
            <b>{open}</b> levels open to you right now
          </div>
          <div className="hero-line muted">
            {cleared} of {statuses.length} cleared · everything below you stays open
          </div>
        </div>
      </div>

      <div className="mod-grid">
        {PILLARS.map((p) => {
          const tiers = tiersFor(p.id)
          const atLevel = tiers.filter((t) => byId.get(t.id)?.inBand).length
          const done = tiers.filter((t) => byId.get(t.id)?.cleared).length
          return (
            <button key={p.id} className={`mod mod-${p.id}`} onClick={() => onOpen(p.id)}>
              <span className="mod-name">{p.name}</span>
              <span className="mod-blurb">{p.blurb}</span>
              <span className="mod-stat">{moduleStat(p.id, rating)}</span>
              <span className="mod-foot">
                <span className="mod-prog">
                  {done}/{tiers.length}
                </span>
                {atLevel > 0 && <span className="mod-live">{atLevel} at your level</span>}
              </span>
            </button>
          )
        })}

        <button className="mod mod-ideas" onClick={() => onOpen('ideas')}>
          <span className="mod-name">Ideas</span>
          <span className="mod-blurb">The short things worth knowing.</span>
          <span className="mod-stat">
            {lessons.length} at your level, {LESSONS.length} in all
          </span>
          <span className="mod-foot" />
        </button>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- tactics */

function TacticsView({
  rating,
  byId,
  onTrain,
  onStartCandidates,
  onBack,
}: {
  rating: number
  byId: Map<string, TierStatus>
  onTrain: (motifs: string[], label: string) => void
  onStartCandidates: () => void
  onBack: () => void
}) {
  const [openCat, setOpenCat] = useState<string | null>(null)

  return (
    <div className="stack">
      <ViewHeader
        title="Tactics"
        sub={`${CATEGORIES.length} categories, every one playable now`}
        onBack={onBack}
      />

      <FeatureDrill
        title="Candidate moves"
        hook="Which moves would you even look at? Pick before you calculate."
        body="The other drills ask for the best move. This one asks what was on your list — because you cannot find a move you never considered, and calculating one idea deeply while missing the other two is the most common way club games are lost."
        cta="Train"
        onStart={onStartCandidates}
      />

      <h3 className="sect">Categories</h3>
      <p className="lede">
        Tap Train and you get a set built from that category alone — three tries each, points off
        for a miss and more off for a nudge. Served at {Math.max(600, rating - 150)}–
        {Math.min(2200, rating + 150)}, so it stays hard enough to be worth doing.
      </p>

      <div className="rows">
        {CATEGORIES.map((c) => (
          <div key={c.id} className="row-item">
            <button
              className="row-main"
              onClick={() => setOpenCat(openCat === c.id ? null : c.id)}
              aria-expanded={openCat === c.id}
            >
              <span className="row-title">{c.name}</span>
              <span className="row-sub">{c.teaches}</span>
              {openCat === c.id && <CategoryDetail category={c} />}
            </button>
            <button className="chip" onClick={() => onTrain(c.motifs, c.name)}>
              Train
            </button>
          </div>
        ))}
      </div>

      <Ladder pillar="tactics" byId={byId} />
    </div>
  )
}

function CategoryDetail({ category }: { category: Category }) {
  return (
    <span className="row-detail">
      {category.why}
      <br />
      <span className="muted">
        Covers: {category.motifs.slice(0, 6).join(', ')}
        {category.motifs.length > 6 ? `, and ${category.motifs.length - 6} more` : ''}.
      </span>
    </span>
  )
}

/* ---------------------------------------------------------- endgames */

/**
 * Which endgames to learn next.
 *
 * Ranked, not listed. The order is the order they decide games in: the mates
 * first because you cannot convert anything without them, then king and pawn
 * because every endgame collapses into it, then rooks because rook endings are
 * the most common ending there is.
 */
const MASTER_ORDER = ['mate-kq', 'mate-kr', 'opposition', 'key-squares', 'lucena', 'philidor']

function EndgameView({
  rating,
  byId,
  onPlay,
  onBack,
}: {
  rating: number
  byId: Map<string, TierStatus>
  onPlay: (p: EndgamePosition) => void
  onBack: () => void
}) {
  const ranked = useMemo(() => {
    const score = (e: EndgamePosition) => {
      const i = MASTER_ORDER.findIndex((m) => e.concepts.includes(m))
      return i === -1 ? 99 : i
    }
    return [...ENDGAMES].sort((a, b) => score(a) - score(b))
  }, [])
  const next = ranked.slice(0, 3)

  return (
    <div className="stack">
      <ViewHeader
        title="Endgames"
        sub={`${ENDGAMES.length} positions, every result engine-checked`}
        onBack={onBack}
      />

      <p className="lede">
        You play, the engine defends at full strength, and holding a draw counts as a pass — half
        of these are draws to save rather than wins to convert.
      </p>

      <div className="next-up">
        <div className="next-head">Master these three next, in this order</div>
        {next.map((e, i) => (
          <div key={e.id} className="row-item">
            <span className="row-main">
              <span className="row-title">
                <span className="rank">{i + 1}</span> {e.name}
              </span>
              <span className="row-sub">{e.why.split('.')[0]}.</span>
            </span>
            <button className="chip" onClick={() => onPlay(e)}>
              Play
            </button>
          </div>
        ))}
        <div className="next-note">
          Mates first — you cannot convert anything without them. Then king and pawn, because every
          endgame eventually becomes one. Then the rook endings, which are the ones you reach most.
        </div>
      </div>

      <h3 className="sect">All {ENDGAMES.length}</h3>
      <div className="rows">
        {ranked.map((e) => (
          <div key={e.id} className="row-item">
            <span className="row-main">
              <span className="row-title">{e.name}</span>
              <span className="row-sub">
                {e.goal === 'win' ? 'Convert' : 'Hold'} as {e.youPlay === 'w' ? 'White' : 'Black'},
                inside {e.moveCap} moves.
              </span>
            </span>
            <button className="chip" onClick={() => onPlay(e)}>
              Play
            </button>
          </div>
        ))}
      </div>
      <p className="lede muted">
        Nothing here is locked. At {rating} the first six are the ones that pay; the rest are there
        when you want them.
      </p>

      <Ladder pillar="endgame" byId={byId} />
    </div>
  )
}

/* ---------------------------------------- positional and strategy */

/**
 * These two pillars are concept-led rather than position-led: there is no
 * corpus of "space advantage" puzzles the way there is for forks. So each tier
 * gets its question — the thing to actually ask yourself at the board.
 *
 * The board below them is the honest version of "make it a playground". It
 * does not grade you, because nothing here can be graded from the position
 * alone; it lets you set an idea up and look at it while the question stays on
 * screen. Pretending to score a "weak squares" answer would be inventing a
 * right answer, which is the one thing this app is not allowed to do.
 */
const QUESTIONS: Record<string, string> = {
  'positional-1': 'Before anything else: which of my pieces is attacked and not defended?',
  'positional-2': 'Are my pieces out, is my king safe, and who owns the centre?',
  'positional-3': 'Which file is open or about to open, and which rook belongs on it?',
  'positional-4': 'Is there a square their pawns can never attack again? Can a knight live there?',
  'positional-5': 'Which pawn is weak, and can it be attacked more times than it is defended?',
  'positional-6': 'Is my bishop blocked by my own pawns? Can I move the pawns or trade the bishop?',
  'positional-7': 'I have more space — do I have a way to use it, or am I just further forward?',
  'positional-8': 'What do they want to play next? Can I make it impossible instead of reacting?',
  'strategy-1': 'If I passed right now, what would they play? That is the threat.',
  'strategy-2': 'Name three plans before choosing one. Which fits this structure?',
  'strategy-3': 'How many pieces attack their king, how many defend, and can I add another?',
  'strategy-4': 'Trade the attacker, block the line, or run the king. Which is available?',
  'strategy-5': 'If I make this pawn break, what does the position look like afterwards?',
  'strategy-6': 'I am winning. What is the simplest path that cannot go wrong?',
}

function ConceptView({
  pillar,
  byId,
  onStartScan,
  onStartThreat,
  onBack,
}: {
  pillar: 'positional' | 'strategy'
  byId: Map<string, TierStatus>
  onStartScan: () => void
  onStartThreat: () => void
  onBack: () => void
}) {
  const tiers = tiersFor(pillar)
  const [asked, setAsked] = useState<string | null>(tiers[0]?.id ?? null)
  const question = asked ? QUESTIONS[asked] : undefined

  return (
    <div className="stack">
      <ViewHeader
        title={pillar === 'positional' ? 'Position' : 'Strategy'}
        sub={pillar === 'positional' ? 'Read the board.' : 'Control the game.'}
        onBack={onBack}
      />

      {pillar === 'positional' ? (
        <FeatureDrill
          title="Spot the loose piece"
          hook="Real positions. Which of your pieces are attacked with nothing defending them?"
          body="The highest-value habit below 1600. Forks and pins only work because something was loose first, so this trains the cause rather than the symptom — and it is the same question the blunder check asks during a real game."
          cta="Train"
          onStart={onStartScan}
        />
      ) : (
        <FeatureDrill
          title="Read the threat"
          hook="If you passed right now, what would they play? Answer before you plan."
          body="Most players below 1600 only ever calculate their own ideas, which is exactly why tactics feel like surprises. Takes a few seconds to build — every position is searched twice to work out what they actually want."
          cta="Train"
          onStart={onStartThreat}
        />
      )}

      <h3 className="sect">The questions</h3>
      <p className="lede">
        These are questions, not puzzles. There is no corpus of "good bishop" positions the way
        there is for forks, so rather than serve random tactics and call it positional training,
        each level gives you the question to ask at the board. Pick one, then use the board below
        to set the idea up and look at it.
      </p>

      <div className="q-list">
        {tiers.map((t) => (
          <button
            key={t.id}
            className={'q-item' + (asked === t.id ? ' on' : '')}
            onClick={() => setAsked(t.id)}
          >
            <span className="q-name">{t.name}</span>
            <span className="q-blurb">{t.blurb}</span>
          </button>
        ))}
      </div>

      {question && (
        <div className="q-board">
          <div className="q-ask">{question}</div>
          <Playground
            book={[]}
            orientation="white"
            caption="A free board. Drag either side, build the structure you want to look at, and ask the question above. Nothing here is scored — there is no single right answer to score."
          />
        </div>
      )}

      <Ladder pillar={pillar} byId={byId} />
    </div>
  )
}

/* -------------------------------------------------------------- ideas */

function IdeasView({ lessons, onBack }: { lessons: Lesson[]; onBack: () => void }) {
  const [openId, setOpenId] = useState<string | null>(lessons[0]?.id ?? null)
  return (
    <div className="stack">
      <ViewHeader title="Ideas" sub={`${lessons.length} at your level`} onBack={onBack} />
      <div className="rows">
        {lessons.map((l) => (
          <div key={l.id} className="row-item col">
            <button
              className="row-main"
              aria-expanded={openId === l.id}
              onClick={() => setOpenId(openId === l.id ? null : l.id)}
            >
              <span className="row-title">{l.title}</span>
              <span className="row-sub">{l.hook}</span>
            </button>
            {openId === l.id && (
              <div className="idea-body">
                <p>{l.body}</p>
                <p className="try">
                  <b>Try this.</b> {l.practice}
                </p>
                <p className="source">{l.source}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ shared */

function FeatureDrill({
  title,
  hook,
  body,
  cta,
  onStart,
}: {
  title: string
  hook: string
  body: string
  cta: string
  onStart: () => void
}) {
  return (
    <div className="feature">
      <div className="feature-top">
        <div>
          <div className="feature-title">{title}</div>
          <div className="feature-hook">{hook}</div>
        </div>
        <button className="chip solid" onClick={onStart}>
          {cta}
        </button>
      </div>
      <p className="feature-body">{body}</p>
    </div>
  )
}

function Ladder({ pillar, byId }: { pillar: Pillar; byId: Map<string, TierStatus> }) {
  const tiers = tiersFor(pillar)
  return (
    <details className="ladder">
      <summary>The ladder — {tiers.length} levels</summary>
      <div className="rows">
        {tiers.map((t) => (
          <TierRow key={t.id} tier={t} status={byId.get(t.id)} />
        ))}
      </div>
    </details>
  )
}

function TierRow({ tier, status }: { tier: Tier; status: TierStatus | undefined }) {
  const state = status?.cleared ? 'done' : status?.inBand ? 'now' : 'later'
  return (
    <div className={'lvl ' + state}>
      <div className="lvl-top">
        <span className="lvl-name">{tier.name}</span>
        <span className="lvl-band">
          {state === 'done'
            ? 'cleared'
            : state === 'now'
              ? `${status?.solved ?? 0}/${tier.clear.solved}`
              : `${tier.band[0]}+`}
        </span>
      </div>
      <div className="lvl-blurb">{tier.blurb}</div>
    </div>
  )
}
