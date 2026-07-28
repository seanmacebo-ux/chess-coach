/**
 * Learn — modules you click into.
 *
 * This used to be four levels of accordion: a pillar expanded to reveal
 * categories, a category expanded to reveal its detail, an opening expanded to
 * reveal a board, a lesson expanded to reveal its text. Everything grew in
 * place, which has three costs that compound on a phone.
 *
 *   THE CONTENT OPENS WHERE YOU CANNOT SEE IT. Tap the eighth category and its
 *   detail unfolds below the fold; the screen looks unchanged, so the tap
 *   reads as broken. The fix people reach for is auto-scroll, which then
 *   fights the thumb.
 *
 *   THE SAME GESTURE MEANS FOUR THINGS. A tap could expand a pillar, a
 *   category, an opening or a lesson depending on state you cannot see. There
 *   was no way to say where you were, because there was nowhere to be.
 *
 *   DEPTH HAD NO EXIT. No back, because there was no forward — just more page.
 *   Closing what you opened meant finding the header you tapped, which by then
 *   had moved.
 *
 * So: one screen at a time, a back control that names its destination, and a
 * push that puts the thing you asked for at the top of the screen where you
 * are already looking. The pieces live in ui/Screen.tsx and ui/nav.ts so the
 * other views can adopt the same model.
 *
 * What did NOT change: everything visible is still either playable or explains
 * something concrete, everything at your level and below stays reachable, and
 * recommendations stay ranked rather than listed.
 */

import { useEffect, useMemo, useState } from 'react'
import { PILLARS, tiersFor, type Pillar, type Tier } from '../../coach/tiers'
import { tierStatuses, type TierStatus } from '../../coach/profile'
import { getProfile } from '../../data/db'
import { LESSONS, lessonsAtRating, type Lesson } from '../../content/lessons'
import { CATEGORIES } from '../../coach/categories'
import { ENDGAMES, type EndgamePosition } from '../../coach/endgames'
import { openingsAtRating, type Opening } from '../../content/openings'
import { LineBoard } from '../LineBoard'
import { NavCard, Screen, ScreenHeader } from '../Screen'
import { useNavStack } from '../nav'

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

/** Where you can be inside Learn. Every one of these is a screen. */
type Route =
  | { kind: 'pillar'; id: Pillar }
  | { kind: 'category'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'endgame'; id: string }
  | { kind: 'ideas' }
  | { kind: 'lesson'; id: string }

export function Learn(props: LearnProps) {
  const [rating, setRating] = useState(1400)
  const [statuses, setStatuses] = useState<TierStatus[]>([])
  const nav = useNavStack<Route>()

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
  const route = nav.top

  const body = !route ? (
    <Index rating={rating} statuses={statuses} byId={byId} onOpen={nav.push} />
  ) : route.kind === 'pillar' ? (
    <PillarScreen
      pillar={route.id}
      rating={rating}
      byId={byId}
      onBack={nav.pop}
      onOpen={nav.push}
      {...props}
    />
  ) : route.kind === 'category' ? (
    <CategoryScreen
      id={route.id}
      rating={rating}
      onBack={nav.pop}
      onTrain={props.onTrainCategory}
    />
  ) : route.kind === 'opening' ? (
    <OpeningScreen id={route.id} rating={rating} onBack={nav.pop} />
  ) : route.kind === 'endgame' ? (
    <EndgameScreen id={route.id} onBack={nav.pop} onPlay={props.onPlayEndgame} />
  ) : route.kind === 'ideas' ? (
    <IdeasScreen rating={rating} onBack={nav.pop} onOpen={nav.push} />
  ) : (
    <LessonScreen id={route.id} onBack={nav.pop} />
  )

  return (
    <Screen direction={nav.direction} depth={nav.depth}>
      {body}
    </Screen>
  )
}

/* ==================================================================== */
/* Index — the five modules                                             */
/* ==================================================================== */

function Index({
  rating,
  statuses,
  byId,
  onOpen,
}: {
  rating: number
  statuses: TierStatus[]
  byId: Map<string, TierStatus>
  onOpen: (r: Route) => void
}) {
  const cleared = statuses.filter((s) => s.cleared).length
  const available = statuses.filter((s) => s.inBand && !s.cleared).length
  const yourLessons = lessonsAtRating(rating)

  return (
    <div className="stack">
      <div className="card">
        <div className="row spread">
          <span className="small muted">Everything the app can teach you</span>
          <span className="small muted">
            {cleared} / {statuses.length} cleared
          </span>
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          Five areas, {statuses.length} levels, {CATEGORIES.length} tactical categories,{' '}
          {ENDGAMES.length} endgames and {LESSONS.length} ideas. At <strong>{rating}</strong> you
          can work on <strong>{available}</strong> levels right now — and everything below you
          stays open to go back to.
        </div>
      </div>

      {PILLARS.map((p) => {
        const tiers = tiersFor(p.id)
        const atLevel = tiers.filter((t) => byId.get(t.id)?.inBand && !byId.get(t.id)?.cleared)
        const done = tiers.filter((t) => byId.get(t.id)?.cleared).length
        return (
          <NavCard
            key={p.id}
            state={atLevel.length > 0 ? 'now' : done === tiers.length ? 'done' : 'past'}
            title={p.name}
            subtitle={
              <>
                {p.blurb} — {countLabel(p.id)}
              </>
            }
            meta={`${done}/${tiers.length}`}
            onOpen={() => onOpen({ kind: 'pillar', id: p.id })}
          />
        )
      })}

      <NavCard
        title="Ideas"
        subtitle="The concepts behind the drills, in plain words. Read one, then go and use it."
        meta={`${yourLessons.length} of ${LESSONS.length}`}
        onOpen={() => onOpen({ kind: 'ideas' })}
      />
    </div>
  )
}

/** What each pillar actually contains, so the card promises something real. */
function countLabel(pillar: Pillar): string {
  switch (pillar) {
    case 'tactics':
      return `${CATEGORIES.length} categories to train`
    case 'endgame':
      return `${ENDGAMES.length} positions to play out`
    case 'opening':
      return 'a repertoire, with the plans'
    case 'positional':
      return 'the loose-piece drill, and the questions to ask'
    case 'strategy':
      return 'the threat drill, and the questions to ask'
  }
}

/* ==================================================================== */
/* Pillar screens                                                       */
/* ==================================================================== */

function PillarScreen({
  pillar,
  rating,
  byId,
  onBack,
  onOpen,
  onTrainCategory,
  onPlayEndgame,
  onStartScan,
  onStartThreat,
  onStartCandidates,
}: LearnProps & {
  pillar: Pillar
  rating: number
  byId: Map<string, TierStatus>
  onBack: () => void
  onOpen: (r: Route) => void
}) {
  const meta = PILLARS.find((p) => p.id === pillar)!
  const tiers = tiersFor(pillar)
  const done = tiers.filter((t) => byId.get(t.id)?.cleared).length

  return (
    <div className="stack">
      <ScreenHeader
        parent="Learn"
        title={meta.name}
        meta={`${done}/${tiers.length} cleared`}
        blurb={meta.blurb}
        onBack={onBack}
      />

      {pillar === 'tactics' && (
        <TacticsModule
          onOpen={onOpen}
          onTrain={onTrainCategory}
          onStartCandidates={onStartCandidates}
        />
      )}
      {pillar === 'endgame' && (
        <EndgameModule rating={rating} onOpen={onOpen} onPlay={onPlayEndgame} />
      )}
      {pillar === 'opening' && <OpeningModule rating={rating} onOpen={onOpen} />}
      {(pillar === 'positional' || pillar === 'strategy') && (
        <ConceptModule pillar={pillar} onStartScan={onStartScan} onStartThreat={onStartThreat} />
      )}

      <div className="card stack">
        <div className="small muted">The ladder</div>
        <div className="stack" style={{ gap: 2 }}>
          {tiers.map((t) => (
            <TierRow key={t.id} tier={t} status={byId.get(t.id)} rating={rating} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TierRow({
  tier,
  status,
  rating,
}: {
  tier: Tier
  status: TierStatus | undefined
  rating: number
}) {
  const state = status?.cleared
    ? 'done'
    : status?.inBand
      ? 'now'
      : tier.band[0] > rating
        ? 'later'
        : 'past'

  return (
    <div className={'lvl ' + state}>
      <div className="row spread">
        <span>
          <strong>{tier.name}</strong>{' '}
          <span className="small muted">
            {tier.band[0]}–{tier.band[1]}
          </span>
        </span>
        <span className="small muted">
          {state === 'done'
            ? 'cleared'
            : state === 'now'
              ? `${status?.solved ?? 0}/${tier.clear.solved}`
              : state === 'later'
                ? `unlocks at ${tier.band[0]}`
                : 'revisit any time'}
        </span>
      </div>
      <div className="small muted">{tier.blurb}</div>
    </div>
  )
}

/* ------------------------------------------------------------ tactics */

function TacticsModule({
  onOpen,
  onTrain,
  onStartCandidates,
}: {
  onOpen: (r: Route) => void
  onTrain: (motifs: string[], label: string) => void
  onStartCandidates: () => void
}) {
  return (
    <div className="stack">
      {/* Not a category — a different question entirely, so it sits above them
          rather than among them. */}
      <div className="card focus stack">
        <div className="row spread">
          <span style={{ flex: 1 }}>
            <strong>Candidate moves</strong>
            <div className="small muted">
              Which moves would you even look at? Pick before you calculate.
            </div>
          </span>
          <button className="chip" onClick={onStartCandidates}>
            Train
          </button>
        </div>
        <div className="small muted">
          The other drills ask for the best move. This one asks what was on your list — because you
          cannot find a move you never considered, and calculating one idea deeply while missing
          the other two is the most common way games are lost at club level.
        </div>
      </div>

      <div className="small muted">
        {CATEGORIES.length} categories, every one playable at your rating. Train straight from the
        card, or open one to see what it covers and why it matters.
      </div>

      {CATEGORIES.map((c) => (
        <NavCard
          key={c.id}
          state="now"
          title={c.name}
          subtitle={c.teaches}
          action={{ label: 'Train', onClick: () => onTrain(c.motifs, c.name) }}
          onOpen={() => onOpen({ kind: 'category', id: c.id })}
        />
      ))}
    </div>
  )
}

function CategoryScreen({
  id,
  rating,
  onBack,
  onTrain,
}: {
  id: string
  rating: number
  onBack: () => void
  onTrain: (motifs: string[], label: string) => void
}) {
  const category = CATEGORIES.find((c) => c.id === id)
  if (!category) return <Missing onBack={onBack} parent="Tactics" />

  return (
    <div className="stack">
      <ScreenHeader parent="Tactics" title={category.name} blurb={category.teaches} onBack={onBack} />

      <button className="primary" onClick={() => onTrain(category.motifs, category.name)}>
        Train this category
      </button>

      <div className="card stack">
        <div className="small muted">Why it matters</div>
        <div className="small">{category.why}</div>
      </div>

      <div className="card stack">
        <div className="small muted">What you will be served</div>
        <div className="small">
          Puzzles rated {Math.max(600, rating - 150)}–{Math.min(2200, rating + 150)}, so they stay
          hard enough to be worth doing. Three tries each, points off for a miss and more off for a
          nudge.
        </div>
        <div className="small muted">
          Covers {category.motifs.length} motif{category.motifs.length === 1 ? '' : 's'}:{' '}
          {category.motifs.join(', ')}.
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- endgames */

/**
 * Which endgames to learn next.
 *
 * Ranked, not listed. The order is the order they decide games in: the mates
 * first because you cannot convert anything without them, then king and pawn
 * because every endgame collapses into it, then rooks because rook endings are
 * the most common ending there is.
 */
const MASTER_ORDER = ['mate-kq', 'mate-kr', 'opposition', 'key-squares', 'lucena', 'philidor']

function rankedEndgames(): EndgamePosition[] {
  const score = (e: EndgamePosition) => {
    const i = MASTER_ORDER.findIndex((m) => e.concepts.includes(m))
    return i === -1 ? 99 : i
  }
  return [...ENDGAMES].sort((a, b) => score(a) - score(b))
}

function EndgameModule({
  rating,
  onOpen,
  onPlay,
}: {
  rating: number
  onOpen: (r: Route) => void
  onPlay: (p: EndgamePosition) => void
}) {
  const ranked = useMemo(rankedEndgames, [])
  const next = ranked.slice(0, 3)

  return (
    <div className="stack">
      <div className="small muted">
        {ENDGAMES.length} positions, every one checked against the engine so the result it claims is
        the result it has. You play, the engine defends at full strength, and holding a draw counts
        as a pass — half of these are draws to save rather than wins to convert.
      </div>

      <div className="card focus stack">
        <div className="small muted">Master these three next, in this order</div>
        {next.map((e, i) => (
          <NavCard
            key={e.id}
            state="now"
            title={`${i + 1}. ${e.name}`}
            subtitle={e.why.split('.')[0] + '.'}
            action={{ label: 'Play', onClick: () => onPlay(e) }}
            onOpen={() => onOpen({ kind: 'endgame', id: e.id })}
          />
        ))}
        <div className="small muted">
          Mates first — you cannot convert anything without them. Then king and pawn, because every
          endgame eventually becomes one. Then the rook endings, which are the ones you will
          actually reach most often.
        </div>
      </div>

      <div className="small muted">
        All {ENDGAMES.length}. Nothing here is locked — at {rating} the first six are the ones that
        pay, the rest are there when you want them.
      </div>
      {ranked.map((e) => (
        <NavCard
          key={e.id}
          title={e.name}
          subtitle={`${e.goal === 'win' ? 'Convert' : 'Hold'} as ${
            e.youPlay === 'w' ? 'White' : 'Black'
          }, inside ${e.moveCap} moves.`}
          action={{ label: 'Play', onClick: () => onPlay(e) }}
          onOpen={() => onOpen({ kind: 'endgame', id: e.id })}
        />
      ))}
    </div>
  )
}

function EndgameScreen({
  id,
  onBack,
  onPlay,
}: {
  id: string
  onBack: () => void
  onPlay: (p: EndgamePosition) => void
}) {
  const e = ENDGAMES.find((x) => x.id === id)
  if (!e) return <Missing onBack={onBack} parent="Endgames" />

  return (
    <div className="stack">
      <ScreenHeader
        parent="Endgames"
        title={e.name}
        meta={`${e.goal === 'win' ? 'Win' : 'Draw'} · ${e.moveCap} moves`}
        blurb={`You are ${e.youPlay === 'w' ? 'White' : 'Black'}. The engine defends at full strength.`}
        onBack={onBack}
      />

      <button className="primary" onClick={() => onPlay(e)}>
        Play it out
      </button>

      <div className="card stack">
        <div className="small muted">Why this one</div>
        {/* The list could only show the first sentence. This is the rest of it,
            which is the part that actually teaches. */}
        <div className="small">{e.why}</div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- openings */

function OpeningModule({ rating, onOpen }: { rating: number; onOpen: (r: Route) => void }) {
  const mine = openingsAtRating(rating)
  const repertoire = mine.filter((o) => o.kind === 'repertoire')
  const traps = mine.filter((o) => o.kind === 'trap')

  const white = repertoire.filter((o) => o.side === 'white')
  const vsE4 = repertoire.filter((o) => o.against === '1.e4')
  const vsD4 = repertoire.filter((o) => o.against === '1.d4')

  return (
    <div className="stack">
      <div className="small muted">
        Chosen for your level, not for how impressive they look. At {rating} the sharp theoretical
        lines punish you for forgetting move twelve, which teaches nothing — the mistake was
        memory, not chess. Everything here produces the same structures every game, so what you
        learn is the plan.
      </div>

      <div className="small">
        <strong>Your three slots:</strong> {white.length} as White · {vsE4.length} against 1.e4 ·{' '}
        {vsD4.length} against 1.d4
      </div>

      {[...repertoire, ...traps].map((o) => (
        <NavCard
          key={o.id}
          state={o.kind === 'trap' ? 'past' : 'now'}
          title={o.name}
          subtitle={
            <>
              {o.side === 'white' ? 'As White' : `As Black${o.against ? ` against ${o.against}` : ''}`}
              {o.kind === 'trap' ? ' · trap to know' : ''} · {o.band[0]}–{o.band[1]}
            </>
          }
          onOpen={() => onOpen({ kind: 'opening', id: o.id })}
        />
      ))}
    </div>
  )
}

function OpeningScreen({
  id,
  rating,
  onBack,
}: {
  id: string
  rating: number
  onBack: () => void
}) {
  const opening = openingsAtRating(rating).find((o) => o.id === id)
  if (!opening) return <Missing onBack={onBack} parent="Openings" />

  return (
    <div className="stack">
      <ScreenHeader
        parent="Openings"
        title={opening.name}
        blurb={
          opening.side === 'white'
            ? 'As White'
            : `As Black${opening.against ? ` against ${opening.against}` : ''}`
        }
        onBack={onBack}
      />
      <OpeningDetail opening={opening} />
    </div>
  )
}

function OpeningDetail({ opening }: { opening: Opening }) {
  return (
    <div className="stack">
      <LineBoard
        line={opening.line}
        orientation={opening.side}
        caption="Step back through it — the moves matter less than the shape they build."
      />

      <div className="small">
        <strong>Why this one.</strong> {opening.why}
      </div>
      <div className="small">
        <strong>What it gives you.</strong> {opening.gives}
      </div>
      <div className="small">
        <strong>What you concede.</strong> {opening.concedes}
      </div>
      <div className="small">
        <strong>Where you attack.</strong> {opening.attack}
      </div>

      <div className="small">
        <strong>The plan.</strong>
        <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {opening.plans.map((p, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              {p}
            </li>
          ))}
        </ol>
      </div>

      <div className="small" style={{ color: 'var(--warn)' }}>
        <strong>Watch out.</strong> {opening.watchOut}
      </div>
    </div>
  )
}

/* ---------------------------------------- positional and strategy */

/**
 * These two pillars are concept-led rather than position-led: there is no
 * corpus of "space advantage" puzzles the way there is for forks. So each tier
 * gets its question — the thing to actually ask yourself at the board — which
 * is the honest version of what they train, rather than a Train button that
 * would serve random tactics and pretend.
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

function ConceptModule({
  pillar,
  onStartScan,
  onStartThreat,
}: {
  pillar: Pillar
  onStartScan: () => void
  onStartThreat: () => void
}) {
  const tiers = tiersFor(pillar)
  return (
    <div className="stack">
      {/* The one concept in these two pillars that IS drillable, because the
          answer can be computed from the board rather than judged. */}
      {pillar === 'strategy' && (
        <div className="card focus stack">
          <div className="row spread">
            <span style={{ flex: 1 }}>
              <strong>Read the threat</strong>
              <div className="small muted">
                If you passed right now, what would they play? Answer before you plan.
              </div>
            </span>
            <button className="chip" onClick={onStartThreat}>
              Train
            </button>
          </div>
          <div className="small muted">
            Most players below 1600 only ever calculate their own ideas, which is exactly why
            tactics feel like surprises. Takes a few seconds to build — every position is searched
            twice to work out what they actually want.
          </div>
        </div>
      )}

      {pillar === 'positional' && (
        <div className="card focus stack">
          <div className="row spread">
            <span style={{ flex: 1 }}>
              <strong>Spot the loose piece</strong>
              <div className="small muted">
                Real positions. Which of your pieces are attacked with nothing defending them?
              </div>
            </span>
            <button className="chip" onClick={onStartScan}>
              Train
            </button>
          </div>
          <div className="small muted">
            The highest-value habit below 1600. Forks and pins only work because something was
            loose first, so this trains the cause rather than the symptom — and it is the same
            question the blunder check asks during a real game.
          </div>
        </div>
      )}

      <div className="small muted">
        These are questions, not puzzles. There is no corpus of "good bishop" positions the way
        there is for forks, so rather than serve random tactics and call it positional training,
        each level here gives you the question to ask at the board. Ask it every move for a week
        and it stops being a question.
      </div>

      {tiers.map((t) => (
        <div key={t.id} className="lvl now">
          <strong>{t.name}</strong>
          <div className="small muted">{t.blurb}</div>
          {QUESTIONS[t.id] && (
            <div className="small" style={{ marginTop: 4, color: 'var(--accent-hi)' }}>
              Ask: {QUESTIONS[t.id]}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ==================================================================== */
/* Ideas                                                                */
/* ==================================================================== */

function IdeasScreen({
  rating,
  onBack,
  onOpen,
}: {
  rating: number
  onBack: () => void
  onOpen: (r: Route) => void
}) {
  const lessons = lessonsAtRating(rating)
  return (
    <div className="stack">
      <ScreenHeader
        parent="Learn"
        title="Ideas"
        meta={`${lessons.length} of ${LESSONS.length}`}
        blurb="At your level. Read one, then go and use it in a game — that is the whole method."
        onBack={onBack}
      />
      {lessons.map((l) => (
        <NavCard
          key={l.id}
          title={l.title}
          subtitle={l.hook}
          onOpen={() => onOpen({ kind: 'lesson', id: l.id })}
        />
      ))}
    </div>
  )
}

function LessonScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const lesson: Lesson | undefined = LESSONS.find((l) => l.id === id)
  if (!lesson) return <Missing onBack={onBack} parent="Ideas" />

  return (
    <div className="stack">
      <ScreenHeader parent="Ideas" title={lesson.title} blurb={lesson.hook} onBack={onBack} />
      <div className="card stack">
        <p style={{ margin: 0 }}>{lesson.body}</p>
      </div>
      <div className="card stack">
        <div className="small muted">Try this</div>
        <div className="small">{lesson.practice}</div>
      </div>
      <div className="small muted source">{lesson.source}</div>
    </div>
  )
}

/* ==================================================================== */

/**
 * A route that points at content that is no longer there — a rating change can
 * take an opening out from under you while its screen is open. Better than a
 * blank screen, and better than crashing.
 */
function Missing({ onBack, parent }: { onBack: () => void; parent: string }) {
  return (
    <div className="stack">
      <ScreenHeader parent={parent} title="Not here any more" onBack={onBack} />
      <div className="card small muted">
        That one is not available at your current rating. Go back and pick another.
      </div>
    </div>
  )
}
