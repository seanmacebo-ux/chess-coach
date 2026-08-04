/**
 * The openings module — a book you can play on.
 *
 * What this replaces: one accordion row per opening, each expanding to a single
 * twelve-move diagram you could only step through. The prose around it named
 * the Fried Liver, the Advance Variation, the Exchange, 4...Qh4 — none of which
 * were anywhere on screen. So the words described a decision tree and the board
 * showed one path through it, which is exactly why openings felt like
 * memorisation rather than teaching.
 *
 * The shape here follows how openings actually work. An opening is a main road
 * plus the handful of turnings your opponent can take, and the entire skill is
 * recognising which one you are on. So the variations are the primary
 * navigation — chips across the top, colour-coded by what they mean to you —
 * and each one states its own trigger ("how you know you are here") before its
 * answer.
 *
 * Every line is playable, not steppable: you can take the opponent's side, try
 * the move you were about to play, and find out. See Playground.
 *
 * The evaluation shown under each line is the real one, measured by
 * `npm run verify:openings` at depth 18 rather than asserted from memory. That
 * matters more than it looks: the Fried Liver is taught almost everywhere as
 * winning and it is worth about a pawn, and a trainer that repeats the folklore
 * is teaching you to be over-confident in the one position where it costs most.
 */

import { useState } from 'react'
import {
  OPENINGS,
  mainLine,
  type Opening,
  type OpeningLine,
  type LineRole,
} from '../../content/openings'
import { Playground } from '../Playground'
import { OpeningTrainer } from '../OpeningTrainer'
import { coachedPlies } from '../../content/coaching'

const ROLE_LABEL: Record<LineRole, string> = {
  main: 'Main line',
  critical: 'Must know',
  punish: 'Punished',
  sideline: 'Also seen',
}

/**
 * What each role means in one line, shown next to the chips.
 *
 * Without this the colours are decoration. "Must know" and "Also seen" look
 * equally important on a chip and are not remotely equally important to study.
 */
const ROLE_NOTE: Record<LineRole, string> = {
  main: 'What happens when nobody deviates. Learn this first.',
  critical: 'A sound alternative you will meet. You need an answer ready.',
  punish: 'Somebody played a losing move. This is the refutation.',
  sideline: 'A different set-up. Changes your plan, not your health.',
}

function evalBadge(line: OpeningLine): { text: string; tone: string } {
  const who = line.favours === 'white' ? 'White' : 'Black'
  switch (line.ends) {
    case 'mate':
      return { text: `Mate — ${who} wins`, tone: 'danger' }
    case 'winning':
      return { text: `Winning for ${who}`, tone: 'danger' }
    case 'edge':
      return { text: `Clear edge to ${who} — not a win`, tone: 'warn' }
    case 'balanced':
      return { text: 'Balanced — a normal game', tone: 'good' }
  }
}

export interface OpeningsSectionProps {
  rating: number
}

/**
 * List and detail, not disclosure — the section owns the screen already, so a
 * chosen opening replaces the list rather than expanding inside it.
 *
 * Every opening is shown, including ones aimed above your rating, with the ones
 * outside your band marked rather than hidden. Hard-filtering on the band was
 * the old behaviour and it meant the answer to "what will I play later" was an
 * empty space.
 */
export function OpeningsSection({ rating }: OpeningsSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  const selected = OPENINGS.find((o) => o.id === openId) ?? null
  if (selected) {
    return <OpeningDetail opening={selected} rating={rating} onBack={() => setOpenId(null)} />
  }

  const repertoire = OPENINGS.filter((o) => o.kind === 'repertoire')
  const traps = OPENINGS.filter((o) => o.kind === 'trap')
  const white = repertoire.filter((o) => o.side === 'white')
  const vsE4 = repertoire.filter((o) => o.against === '1.e4')
  const vsD4 = repertoire.filter((o) => o.against === '1.d4')

  const lineCount = OPENINGS.reduce((n, o) => n + o.lines.length, 0)
  const atLevel = OPENINGS.filter((o) => rating >= o.band[0] && rating <= o.band[1]).length

  return (
    <div className="stack">
      <p className="lede">
        Repertoire, not memorisation — {OPENINGS.length} openings and {lineCount} playable lines.
        Everything here produces the same structures every game, so what you learn is the plan
        rather than move twelve. {atLevel} are aimed at {rating} right now; the rest are shown
        anyway, marked, because what you will play next year is worth seeing.
      </p>

      <div className="slots">
        <Slot label="As White" openings={white} rating={rating} onPick={setOpenId} />
        <Slot label="Against 1.e4" openings={vsE4} rating={rating} onPick={setOpenId} />
        <Slot label="Against 1.d4" openings={vsD4} rating={rating} onPick={setOpenId} />
      </div>

      {traps.length > 0 && (
        <>
          <h3 className="sect">Traps worth knowing</h3>
          <div className="op-grid">
            {traps.map((o) => (
              <OpeningCard
                key={o.id}
                opening={o}
                rating={rating}
                onPick={() => setOpenId(o.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Slot({
  label,
  openings,
  rating,
  onPick,
}: {
  label: string
  openings: Opening[]
  rating: number
  onPick: (id: string) => void
}) {
  return (
    <div className="slot">
      <div className="slot-label">{label}</div>
      {openings.length === 0 ? (
        <div className="small muted">Nothing here yet.</div>
      ) : (
        <div className="op-grid">
          {openings.map((o) => (
            <OpeningCard
              key={o.id}
              opening={o}
              rating={rating}
              onPick={() => onPick(o.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OpeningCard({
  opening,
  rating,
  onPick,
}: {
  opening: Opening
  rating: number
  onPick: () => void
}) {
  const main = mainLine(opening)
  const inBand = rating >= opening.band[0] && rating <= opening.band[1]
  const ahead = opening.band[0] > rating
  return (
    <button className={'op-card' + (inBand ? '' : ' off-band')} onClick={onPick}>
      <span className="op-name">{opening.name}</span>
      <span className="op-moves">{firstMoves(main.moves, 6)}</span>
      <span className="op-meta">
        {opening.lines.length} lines ·{' '}
        {inBand ? 'at your level' : ahead ? `aimed at ${opening.band[0]}+` : 'below you now'}
      </span>
    </button>
  )
}

/** "1.e4 e5 2.Nf3" — enough to recognise it, not enough to read as the line. */
function firstMoves(moves: string[], n: number): string {
  const out: string[] = []
  for (let i = 0; i < Math.min(n, moves.length); i++) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.${moves[i]}`)
    else out.push(moves[i]!)
  }
  return out.join(' ') + (moves.length > n ? '…' : '')
}

/* ------------------------------------------------------------------ */

function OpeningDetail({
  opening,
  rating,
  onBack,
}: {
  opening: Opening
  rating: number
  onBack: () => void
}) {
  const inBand = rating >= opening.band[0] && rating <= opening.band[1]
  const [lineId, setLineId] = useState(mainLine(opening).id)
  const [training, setTraining] = useState(false)
  const line = opening.lines.find((l) => l.id === lineId) ?? mainLine(opening)
  const badge = evalBadge(line)
  const coached = coachedPlies(opening.id, line.id)

  /*
   * Training owns the screen. It is a different activity from browsing the
   * book — you are being asked for moves — and leaving the variation chips and
   * the prose on screen would let you read the answer off the page, which is
   * the one thing a drill cannot allow.
   */
  if (training) {
    return (
      <OpeningTrainer
        line={line}
        side={opening.side}
        openingId={opening.id}
        onExit={() => setTraining(false)}
      />
    )
  }

  return (
    <div className="stack">
      <ViewHeader
        title={opening.name}
        sub={`${
          opening.side === 'white'
            ? 'As White'
            : `As Black${opening.against ? ` against ${opening.against}` : ''}`
        } · ${inBand ? 'at your level' : `aimed at ${opening.band[0]}–${opening.band[1]}`}`}
        onBack={onBack}
      />

      <div className="var-tabs" role="tablist">
        {opening.lines.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={l.id === line.id}
            className={`var-tab role-${l.role}`}
            onClick={() => setLineId(l.id)}
          >
            <span className="var-role">{ROLE_LABEL[l.role]}</span>
            <span className="var-name">{l.name}</span>
          </button>
        ))}
      </div>

      {/*
        Opens on the finished position, not move zero. The structure the
        opening BUILDS is the thing worth seeing first — an untouched start
        board is identical for all ten openings and says nothing about any of
        them. Stepping back to see how it arose is the natural direction, and
        the move list makes any point one tap away.
      */}
      <Playground
        key={line.id}
        book={line.moves}
        orientation={opening.side}
        blunder={line.blunder}
        startAtEnd
        caption="Drag any piece — both sides move. Play something else and it will tell you what the book said."
      />

      {/*
        The drill sits directly under the board, above the prose. Reading about
        an opening and playing it are different things and the second is what
        makes it stick, so it should not be below three paragraphs.
      */}
      <button className="play-line" onClick={() => setTraining(true)}>
        <span className="play-line-main">Play this line ▸</span>
        <span className="play-line-sub">
          I play {opening.side === 'white' ? 'Black' : 'White'}, you find the moves
          {coached > 0 ? `, and I talk you through ${coached} of them` : ''}.
        </span>
      </button>

      <div className="line-brief">
        <div className={`eval-badge ${badge.tone}`}>{badge.text}</div>
        <p className="brief-when">
          <span className="brief-key">When</span> {line.when}
        </p>
        <p className="brief-answer">
          <span className="brief-key">Answer</span> {line.answer}
        </p>
        <p className="brief-role">{ROLE_NOTE[line.role]}</p>
      </div>

      <details className="why">
        <summary>Why this opening at all</summary>
        <div className="stack">
          <Field label="Why this one" text={opening.why} />
          <Field label="What it gives you" text={opening.gives} />
          <Field label="What you concede" text={opening.concedes} />
          <Field label="Where you attack" text={opening.attack} />
          <div>
            <div className="field-label">The plan</div>
            <ol className="plan">
              {opening.plans.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>
          <div className="watch">
            <div className="field-label">Watch out</div>
            {opening.watchOut}
          </div>
        </div>
      </details>
    </div>
  )
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <p className="field-text">{text}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * The header every module view gets.
 *
 * Exported because the whole point of the Learn rebuild is that modules are
 * places you go rather than rows that expand — and a place needs a name and a
 * way back, in the same spot, every time.
 */
export function ViewHeader({
  title,
  sub,
  onBack,
}: {
  title: string
  sub?: string
  onBack: () => void
}) {
  return (
    <div className="view-head">
      <button className="back" onClick={onBack} aria-label="Back">
        ‹
      </button>
      <div>
        <h2 className="view-title">{title}</h2>
        {sub && <div className="view-sub">{sub}</div>}
      </div>
    </div>
  )
}
