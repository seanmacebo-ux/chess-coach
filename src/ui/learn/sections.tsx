/**
 * The body of each Learn section.
 *
 * RECONSTRUCTED — see coach/rating.ts for why these files had to be rebuilt.
 *
 * Split out of Learn.tsx so the screen file holds navigation and nothing else.
 * That split is the point: when the sections lived inline, Learn.tsx was a
 * thousand lines in which the routing and five unrelated content layouts were
 * interleaved, and every change to one risked the others.
 *
 * The rule every section here follows: NOTHING NESTS MORE THAN ONE LEVEL. Where
 * a section has more content than fits — openings, mainly — it uses
 * list-and-detail, replacing the list with the thing you chose, rather than
 * expanding a drawer inside it. The section already owns the whole screen, so
 * there is room to just show the thing.
 */

import { useMemo, useState } from 'react'
import { CATEGORIES, type Category } from '../../coach/categories'
import { ENDGAMES, type EndgamePosition } from '../../coach/endgames'
import { LESSONS, lessonsAtRating, type Lesson } from '../../content/lessons'
import { tiersFor } from '../../coach/tiers'
import { Playground } from '../Playground'

export { OpeningsSection } from '../screens/Openings'

/* ----------------------------------------------------------- shared */

/**
 * The one thing on a section that should be tapped first.
 *
 * Exactly one per section — the moment there are two, neither is a feature and
 * the section is a menu again.
 */
function Feature({
  title,
  hook,
  body,
  onStart,
}: {
  title: string
  hook: string
  body: string
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
          Train
        </button>
      </div>
      <p className="feature-body">{body}</p>
    </div>
  )
}

/* ---------------------------------------------------------- tactics */

export function TacticsSection({
  rating,
  onTrain,
  onStartCandidates,
}: {
  rating: number
  onTrain: (motifs: string[], label: string) => void
  onStartCandidates: () => void
}) {
  const [openCat, setOpenCat] = useState<string | null>(null)

  return (
    <div className="stack">
      <Feature
        title="Candidate moves"
        hook="Which moves would you even look at? Pick before you calculate."
        body="The other drills ask for the best move. This one asks what was on your list — because you cannot find a move you never considered, and calculating one idea deeply while missing the other two is the most common way club games are lost."
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

/* --------------------------------------------------------- endgames */

/**
 * Which endgames to learn next — ranked, not listed.
 *
 * The order is the order they decide games in: the mates first because you
 * cannot convert anything without them, then king and pawn because every
 * endgame collapses into it, then rooks because rook endings are the most
 * common ending there is.
 *
 * The ranking IS the list order rather than a second copy of it above the list.
 * Showing "master these three" and then all twenty underneath meant the first
 * three appeared twice, which reads as a bug the first time you see it.
 */
const MASTER_ORDER = ['mate-kq', 'mate-kr', 'opposition', 'key-squares', 'lucena', 'philidor']

export function EndgameSection({
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

  return (
    <div className="stack">
      <p className="lede">
        {ENDGAMES.length} positions, every result checked against the engine. You play, it defends
        at full strength, and holding a draw counts as a pass — half of these are draws to save
        rather than wins to convert. In this order: mates first, because you cannot convert
        anything without them, then king and pawn, then the rook endings you actually reach.
      </p>

      <div className="rows">
        {ranked.map((e, i) => (
          <div key={e.id} className="row-item">
            <span className="row-main">
              <span className="row-title">
                <span className="rank">{i + 1}</span> {e.name}
              </span>
              <span className="row-sub">
                {e.goal === 'win' ? 'Convert' : 'Hold'} as {e.youPlay === 'w' ? 'White' : 'Black'},
                inside {e.moveCap} moves. {e.why.split('.')[0]}.
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
    </div>
  )
}

/* ---------------------------------------- positional and strategy */

/**
 * These two sections are concept-led rather than position-led: there is no
 * corpus of "space advantage" positions the way there is for forks. So each
 * level gets its question — the thing to actually ask yourself at the board.
 *
 * The board underneath is the honest version of "make it a playground". It does
 * not grade you, because nothing here can be graded from the position alone;
 * it lets you set an idea up and look at it while the question stays on screen.
 * Pretending to score a "weak squares" answer would mean inventing a right
 * answer, which is the one thing this app is not allowed to do.
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

export function ConceptSection({
  pillar,
  onStartScan,
  onStartThreat,
}: {
  pillar: 'positional' | 'strategy'
  onStartScan: () => void
  onStartThreat: () => void
}) {
  const tiers = tiersFor(pillar)
  const [asked, setAsked] = useState<string | null>(tiers[0]?.id ?? null)
  const question = asked ? QUESTIONS[asked] : undefined

  return (
    <div className="stack">
      {pillar === 'positional' ? (
        <Feature
          title="Spot the loose piece"
          hook="Real positions. Which of your pieces are attacked with nothing defending them?"
          body="The highest-value habit below 1600. Forks and pins only work because something was loose first, so this trains the cause rather than the symptom — and it is the same question the blunder check asks during a real game."
          onStart={onStartScan}
        />
      ) : (
        <Feature
          title="Read the threat"
          hook="If you passed right now, what would they play? Answer before you plan."
          body="Most players below 1600 only ever calculate their own ideas, which is exactly why tactics feel like surprises. Takes a few seconds to build — every position is searched twice to work out what they actually want."
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
    </div>
  )
}

/* -------------------------------------------------------------- ideas */

export function IdeasSection({ rating }: { rating: number }) {
  const mine = lessonsAtRating(rating)
  const [openId, setOpenId] = useState<string | null>(mine[0]?.id ?? null)

  return (
    <div className="stack">
      <p className="lede">
        {mine.length} of {LESSONS.length} aimed at {rating}. Reading rather than training, which is
        why this section has no rating of its own — there is nothing here to be measured at.
      </p>
      <div className="rows">
        {mine.map((l) => (
          <IdeaRow
            key={l.id}
            lesson={l}
            open={openId === l.id}
            onToggle={() => setOpenId(openId === l.id ? null : l.id)}
          />
        ))}
      </div>
    </div>
  )
}

function IdeaRow({
  lesson,
  open,
  onToggle,
}: {
  lesson: Lesson
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="row-item col">
      <button className="row-main" aria-expanded={open} onClick={onToggle}>
        <span className="row-title">{lesson.title}</span>
        <span className="row-sub">{lesson.hook}</span>
      </button>
      {open && (
        <div className="idea-body">
          <p>{lesson.body}</p>
          <p className="try">
            <b>Try this.</b> {lesson.practice}
          </p>
          <p className="source">{lesson.source}</p>
        </div>
      )}
    </div>
  )
}
