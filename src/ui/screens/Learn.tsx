/**
 * Learn — one module per pillar, and every one of them does something.
 *
 * The previous version listed tier names and a table of training modes, most
 * marked "soon". That is a roadmap, not a learning surface: nothing on the
 * screen could be tapped and practised, and the openings pillar showed five
 * tier headings with no openings behind them.
 *
 * The rule now is that everything visible is either playable or explains
 * something concrete. Two consequences worth stating:
 *
 *   EVERYTHING AT YOUR LEVEL OR BELOW IS SHOWN, and clearly marked. Hiding
 *   cleared material makes the ladder feel shorter than it is and removes the
 *   thing you go back to when a weakness resurfaces. Locked material above you
 *   is shown too, greyed, because seeing what is coming is half of why a
 *   ladder works.
 *
 *   RECOMMENDATIONS ARE RANKED, not listed. "Here are 15 endgames" is a menu;
 *   "master these three next, in this order, because they decide the most
 *   games at your rating" is coaching.
 */

import { useEffect, useMemo, useState } from 'react'
import { PILLARS, tiersFor, type Pillar, type Tier } from '../../coach/tiers'
import { tierStatuses, type TierStatus } from '../../coach/profile'
import { getProfile } from '../../data/db'
import { LESSONS, lessonsAtRating, type Lesson } from '../../content/lessons'
import { CATEGORIES, type Category } from '../../coach/categories'
import { ENDGAMES, type EndgamePosition } from '../../coach/endgames'
import { openingsAtRating, type Opening } from '../../content/openings'
import { LineBoard } from '../LineBoard'

export interface LearnProps {
  /** Launch a puzzle set built from these motifs. */
  onTrainCategory: (motifs: string[], label: string) => void
  /** Jump to the endgame play-out for this position. */
  onPlayEndgame: (position: EndgamePosition) => void
  /** Start a loose-piece scan built from real positions. */
  onStartScan: () => void
  /** Start an engine-backed "what are they threatening" set. */
  onStartThreat: () => void
}

export function Learn({
  onTrainCategory,
  onPlayEndgame,
  onStartScan,
  onStartThreat,
}: LearnProps) {
  const [rating, setRating] = useState(1400)
  const [statuses, setStatuses] = useState<TierStatus[]>([])
  const [open, setOpen] = useState<Pillar | null>('tactics')

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
  const yourLessons = lessonsAtRating(rating)
  const cleared = statuses.filter((s) => s.cleared).length

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
          can work on{' '}
          <strong>{statuses.filter((s) => s.inBand && !s.cleared).length}</strong> levels right
          now — and everything below you stays open to go back to.
        </div>
      </div>

      {PILLARS.map((p) => (
        <PillarCard
          key={p.id}
          pillar={p}
          rating={rating}
          byId={byId}
          isOpen={open === p.id}
          onToggle={() => setOpen(open === p.id ? null : p.id)}
          onTrainCategory={onTrainCategory}
          onPlayEndgame={onPlayEndgame}
          onStartScan={onStartScan}
          onStartThreat={onStartThreat}
        />
      ))}

      <IdeasCard lessons={yourLessons} total={LESSONS.length} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PillarCard({
  pillar,
  rating,
  byId,
  isOpen,
  onToggle,
  onTrainCategory,
  onPlayEndgame,
  onStartScan,
  onStartThreat,
}: {
  pillar: { id: Pillar; name: string; blurb: string }
  rating: number
  byId: Map<string, TierStatus>
  isOpen: boolean
  onToggle: () => void
  onTrainCategory: (motifs: string[], label: string) => void
  onPlayEndgame: (p: EndgamePosition) => void
  onStartScan: () => void
  onStartThreat: () => void
}) {
  const tiers = tiersFor(pillar.id)
  const atLevel = tiers.filter((t) => byId.get(t.id)?.inBand).length

  return (
    <div className="card stack">
      <button
        className="lesson-head"
        style={{ margin: 0, padding: 0, width: '100%' }}
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span>
          <span className="lesson-title">{pillar.name}</span>
          <span className="small muted">
            {pillar.blurb} — {atLevel} at your level, {tiers.length} in all
          </span>
        </span>
        <span className="chev" aria-hidden="true">
          {isOpen ? '−' : '+'}
        </span>
      </button>

      {isOpen && (
        <div className="stack">
          {pillar.id === 'tactics' && <TacticsModule rating={rating} onTrain={onTrainCategory} />}
          {pillar.id === 'endgame' && <EndgameModule rating={rating} onPlay={onPlayEndgame} />}
          {pillar.id === 'opening' && <OpeningModule rating={rating} />}
          {(pillar.id === 'positional' || pillar.id === 'strategy') && (
            <ConceptModule
              pillar={pillar.id}
              onStartScan={onStartScan}
              onStartThreat={onStartThreat}
            />
          )}

          <div className="small muted" style={{ marginTop: 4 }}>
            The ladder
          </div>
          <div className="stack" style={{ gap: 2 }}>
            {tiers.map((t) => (
              <TierRow key={t.id} tier={t} status={byId.get(t.id)} rating={rating} />
            ))}
          </div>
        </div>
      )}
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

/* ------------------------------------------ tactics: the playground */

function TacticsModule({
  rating,
  onTrain,
}: {
  rating: number
  onTrain: (motifs: string[], label: string) => void
}) {
  const [openCat, setOpenCat] = useState<string | null>(null)

  return (
    <div className="stack">
      <div className="small muted">
        Eight categories, every one of them playable right now at your rating. Tap Train and you
        get a set built from that category alone — three tries each, points off for a miss and
        more off for a nudge.
      </div>
      {CATEGORIES.map((c) => (
        <div key={c.id} className="lvl now" style={{ paddingBottom: 8 }}>
          <div className="row spread">
            <button
              className="ghost"
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                minHeight: 0,
                textAlign: 'left',
                flex: 1,
              }}
              onClick={() => setOpenCat(openCat === c.id ? null : c.id)}
            >
              <strong>{c.name}</strong>
              <div className="small muted">{c.teaches}</div>
            </button>
            <button className="chip" onClick={() => onTrain(c.motifs, c.name)}>
              Train
            </button>
          </div>
          {openCat === c.id && <CategoryDetail category={c} rating={rating} />}
        </div>
      ))}
    </div>
  )
}

function CategoryDetail({ category, rating }: { category: Category; rating: number }) {
  return (
    <div className="small" style={{ marginTop: 8 }}>
      <p style={{ margin: '0 0 6px' }}>{category.why}</p>
      <div className="muted">
        Served at {Math.max(600, rating - 150)}–{Math.min(2200, rating + 150)}, so it stays hard
        enough to be worth doing. Covers: {category.motifs.slice(0, 6).join(', ')}
        {category.motifs.length > 6 ? `, and ${category.motifs.length - 6} more` : ''}.
      </div>
    </div>
  )
}

/* --------------------------------------------------------- endgames */

/**
 * Which endgames to learn next.
 *
 * Ranked, not listed. The order is the order they decide games in: the mates
 * first because you cannot convert anything without them, then king and pawn
 * because every endgame collapses into it, then rooks because rook endings are
 * the most common ending there is.
 */
const MASTER_ORDER = ['mate-kq', 'mate-kr', 'opposition', 'key-squares', 'lucena', 'philidor']

function EndgameModule({
  rating,
  onPlay,
}: {
  rating: number
  onPlay: (p: EndgamePosition) => void
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
      <div className="small muted">
        {ENDGAMES.length} positions, every one checked against the engine so the result it claims
        is the result it has. You play, the engine defends at full strength, and holding a draw
        counts as a pass — half of these are draws to save rather than wins to convert.
      </div>

      <div className="card" style={{ background: 'var(--surface-hi)' }}>
        <div className="small" style={{ marginBottom: 6 }}>
          <strong>Master these three next, in this order</strong>
        </div>
        {next.map((e, i) => (
          <div key={e.id} className="row spread hist-row">
            <span style={{ flex: 1 }}>
              <strong>
                {i + 1}. {e.name}
              </strong>
              <div className="small muted">{e.why.split('.')[0]}.</div>
            </span>
            <button className="chip" onClick={() => onPlay(e)}>
              Play
            </button>
          </div>
        ))}
        <div className="small muted" style={{ marginTop: 6 }}>
          Mates first — you cannot convert anything without them. Then king and pawn, because
          every endgame eventually becomes one. Then the rook endings, which are the ones you
          will actually reach most often.
        </div>
      </div>

      <div className="small muted">All {ENDGAMES.length}, at your level and below</div>
      {ranked.map((e) => (
        <div key={e.id} className="row spread hist-row">
          <span style={{ flex: 1 }}>
            <strong>{e.name}</strong>
            <div className="small muted">
              {e.goal === 'win' ? 'Convert' : 'Hold'} as {e.youPlay === 'w' ? 'White' : 'Black'},
              inside {e.moveCap} moves.
            </div>
          </span>
          <button className="chip" onClick={() => onPlay(e)}>
            Play
          </button>
        </div>
      ))}
      <div className="small muted">
        Nothing here is locked. At {rating} the first six are the ones that pay; the rest are
        there when you want them.
      </div>
    </div>
  )
}

/* --------------------------------------------------------- openings */

function OpeningModule({ rating }: { rating: number }) {
  const mine = openingsAtRating(rating)
  const repertoire = mine.filter((o) => o.kind === 'repertoire')
  const traps = mine.filter((o) => o.kind === 'trap')
  const [openId, setOpenId] = useState<string | null>(repertoire[0]?.id ?? null)

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
        <div key={o.id} className="lvl now">
          <button
            className="lesson-head"
            style={{ margin: 0, padding: '4px 0', width: '100%' }}
            aria-expanded={openId === o.id}
            onClick={() => setOpenId(openId === o.id ? null : o.id)}
          >
            <span>
              <span style={{ fontWeight: 600 }}>{o.name}</span>
              <span className="small muted">
                {o.side === 'white'
                  ? 'As White'
                  : `As Black${o.against ? ` against ${o.against}` : ''}`}
                {o.kind === 'trap' ? ' · trap to know' : ''} · {o.band[0]}–{o.band[1]}
              </span>
            </span>
            <span className="chev" aria-hidden="true">
              {openId === o.id ? '−' : '+'}
            </span>
          </button>

          {openId === o.id && <OpeningDetail opening={o} />}
        </div>
      ))}
    </div>
  )
}

function OpeningDetail({ opening }: { opening: Opening }) {
  return (
    <div className="stack" style={{ marginTop: 8 }}>
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
        <div className="card" style={{ background: 'var(--surface-hi)' }}>
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
          <div className="small muted" style={{ marginTop: 6 }}>
            Most players below 1600 only ever calculate their own ideas, which is exactly why
            tactics feel like surprises. Takes a few seconds to build — every position is searched
            twice to work out what they actually want.
          </div>
        </div>
      )}

      {pillar === 'positional' && (
        <div className="card" style={{ background: 'var(--surface-hi)' }}>
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
          <div className="small muted" style={{ marginTop: 6 }}>
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

/* ------------------------------------------------------------ ideas */

function IdeasCard({ lessons, total }: { lessons: Lesson[]; total: number }) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div className="card stack">
      <div className="row spread">
        <span className="small muted">Ideas at your level</span>
        <span className="small muted">
          {lessons.length} of {total}
        </span>
      </div>
      {lessons.map((l) => (
        <div key={l.id}>
          <button
            className="lesson-head"
            style={{ margin: 0, padding: '8px 0', width: '100%' }}
            aria-expanded={openId === l.id}
            onClick={() => setOpenId(openId === l.id ? null : l.id)}
          >
            <span>
              <span style={{ fontWeight: 600 }}>{l.title}</span>
              <span className="small muted">{l.hook}</span>
            </span>
            <span className="chev" aria-hidden="true">
              {openId === l.id ? '−' : '+'}
            </span>
          </button>
          {openId === l.id && (
            <div className="lesson-body" style={{ padding: '0 0 12px' }}>
              <p>{l.body}</p>
              <p className="small">
                <strong>Try this.</strong> {l.practice}
              </p>
              <p className="small muted source">{l.source}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
