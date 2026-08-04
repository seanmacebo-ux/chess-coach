/**
 * A rating, and what it means, in the same object.
 *
 * RECONSTRUCTED — see coach/rating.ts for why these files had to be rebuilt.
 *
 * The rule this serves is "no bare numbers". A section rating of 1240 sitting
 * on a card tells you nothing you can act on: not whether it is trustworthy,
 * not which way it is moving, not what would move it. So the chip always
 * carries its provisional state and its direction, and the explainer says the
 * rest in words.
 */

import { explainSection, type SectionRating } from '../../coach/rating'

export function RatingChip({ r }: { r?: SectionRating | undefined }) {
  if (!r) {
    return <span className="ratechip empty">not rated</span>
  }

  const dir = r.trend > 4 ? 'up' : r.trend < -4 ? 'down' : 'flat'
  return (
    <span className={`ratechip ${r.provisional ? 'prov' : ''}`}>
      <span className="ratechip-num">{r.rating}</span>
      {!r.provisional && r.trend !== 0 && (
        <span className={`ratechip-trend ${dir}`}>
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}
          {Math.abs(r.trend)}
        </span>
      )}
      {r.provisional && <span className="ratechip-prov">provisional</span>}
    </span>
  )
}

/**
 * The sentence under the number.
 *
 * `full` is the section-page version: the whole explanation, including what
 * would move the rating next.
 *
 * The index version is deliberately much shorter, and that is a fix rather
 * than a preference. Six cards each carrying "800 is a starting guess — 0 of 6
 * attempts needed before it means anything" is the same sentence six times down
 * one screen, which stops being information after the first one and turns the
 * index into a wall of grey text. The card says the state; the section page
 * says the reasoning.
 */
export function RatingExplainer({ r, full = false }: { r?: SectionRating | undefined; full?: boolean }) {
  if (!full) {
    return <div className="rate-explain">{shortForm(r)}</div>
  }
  const { what, moved, next } = explainSection(r)
  return (
    <div className="rate-explain">
      <span>{what}</span>
      {moved && <span className="rate-moved"> {moved}</span>}
      {next && <div className="rate-next">{next}</div>}
    </div>
  )
}

/** One clause. Enough to know whether the number can be trusted. */
function shortForm(r: SectionRating | undefined): string {
  if (!r || r.played === 0) return 'Not trained yet — the number is a starting guess.'
  if (r.provisional) return `${r.played} attempt${r.played === 1 ? '' : 's'} in — still settling.`
  const pct = Math.round((r.correct / Math.max(1, r.played)) * 100)
  if (r.trend > 4) return `${r.played} attempts, ${pct}% correct. Up ${r.trend} lately.`
  if (r.trend < -4) return `${r.played} attempts, ${pct}% correct. Down ${Math.abs(r.trend)} lately.`
  return `${r.played} attempts, ${pct}% correct. Holding steady.`
}

/**
 * Progress as a bar rather than "3/15".
 *
 * A fraction is read as arithmetic; a bar is read at a glance, which is what a
 * six-card index needs.
 *
 * The DOM here is dictated by the stylesheet rather than the other way round:
 * `.bar` with an `<i>` fill, and `.bar.ok` once it is complete. The first
 * reconstruction of this component invented its own markup — a track span and
 * a number span — which collided with the existing `.bar` rule and rendered the
 * count clipped over the end of the track. The caller prints the numbers
 * alongside, so the bar carries none itself.
 */
export function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <span
      className={'bar' + (total > 0 && done >= total ? ' ok' : '')}
      role="img"
      aria-label={`${done} of ${total}`}
    >
      <i style={{ width: `${pct}%` }} />
    </span>
  )
}
