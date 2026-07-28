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
  mainLine,
  openingsAtRating,
  type Opening,
  type OpeningLine,
  type LineRole,
} from '../../content/openings'
import { Playground } from '../Playground'

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

export interface OpeningsProps {
  rating: number
  onBack: () => void
}

export function Openings({ rating, onBack }: OpeningsProps) {
  const mine = openingsAtRating(rating)
  const [openId, setOpenId] = useState<string | null>(null)

  const selected = mine.find((o) => o.id === openId) ?? null
  if (selected) {
    return <OpeningDetail opening={selected} onBack={() => setOpenId(null)} />
  }

  const repertoire = mine.filter((o) => o.kind === 'repertoire')
  const traps = mine.filter((o) => o.kind === 'trap')
  const white = repertoire.filter((o) => o.side === 'white')
  const vsE4 = repertoire.filter((o) => o.against === '1.e4')
  const vsD4 = repertoire.filter((o) => o.against === '1.d4')

  const lineCount = mine.reduce((n, o) => n + o.lines.length, 0)

  return (
    <div className="stack">
      <ViewHeader
        title="Openings"
        sub={`${mine.length} openings, ${lineCount} lines — all playable`}
        onBack={onBack}
      />

      <p className="lede">
        Repertoire, not memorisation. Everything here produces the same
        structures every game, so what you learn is the plan rather than move
        twelve. Chosen for {rating} — nothing outside your band is shown.
      </p>

      <div className="slots">
        <Slot label="As White" openings={white} onPick={setOpenId} />
        <Slot label="Against 1.e4" openings={vsE4} onPick={setOpenId} />
        <Slot label="Against 1.d4" openings={vsD4} onPick={setOpenId} />
      </div>

      {traps.length > 0 && (
        <>
          <h3 className="sect">Traps worth knowing</h3>
          <div className="op-grid">
            {traps.map((o) => (
              <OpeningCard key={o.id} opening={o} onPick={() => setOpenId(o.id)} />
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
  onPick,
}: {
  label: string
  openings: Opening[]
  onPick: (id: string) => void
}) {
  return (
    <div className="slot">
      <div className="slot-label">{label}</div>
      {openings.length === 0 ? (
        <div className="small muted">Nothing at your level yet.</div>
      ) : (
        <div className="op-grid">
          {openings.map((o) => (
            <OpeningCard key={o.id} opening={o} onPick={() => onPick(o.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function OpeningCard({ opening, onPick }: { opening: Opening; onPick: () => void }) {
  const main = mainLine(opening)
  return (
    <button className="op-card" onClick={onPick}>
      <span className="op-name">{opening.name}</span>
      <span className="op-moves">{firstMoves(main.moves, 6)}</span>
      <span className="op-meta">
        {opening.lines.length} lines · {opening.band[0]}–{opening.band[1]}
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

function OpeningDetail({ opening, onBack }: { opening: Opening; onBack: () => void }) {
  const [lineId, setLineId] = useState(mainLine(opening).id)
  const line = opening.lines.find((l) => l.id === lineId) ?? mainLine(opening)
  const badge = evalBadge(line)

  return (
    <div className="stack">
      <ViewHeader
        title={opening.name}
        sub={
          opening.side === 'white'
            ? 'As White'
            : `As Black${opening.against ? ` against ${opening.against}` : ''}`
        }
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
