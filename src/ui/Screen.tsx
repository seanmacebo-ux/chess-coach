/**
 * The pieces a drill-down screen is made of.
 *
 * These exist so that "click into" means the same thing everywhere. Three
 * rules, and they are the whole design:
 *
 *   A CHEVRON MEANS IT NAVIGATES. Plus and minus meant "grow in place"; a
 *   right chevron means "this takes you somewhere". If those two ever look
 *   alike, every tap becomes a guess about which kind of thing you hit.
 *
 *   BACK SAYS WHERE IT GOES. "Back" on its own makes you remember your own
 *   position in the app. "‹ Learn" does not.
 *
 *   THE QUICK ACTION STAYS ON THE CARD. Drilling in to reach a Train button
 *   you could see from the list is a tax on the thing people do most. So the
 *   card navigates AND carries its primary action, and the action wins when
 *   you hit it.
 *
 * That last rule is why NavCard is not simply a big <button>. A button inside
 * a button is invalid, and making the whole card a click handler on a div
 * loses keyboard and screen-reader support. Instead the card is a plain
 * container, the title is a real button, and it stretches an invisible
 * ::after over the whole card — so the card is one big target, the action sits
 * above it, and both are genuinely focusable.
 */

import type { ReactNode } from 'react'

export function ScreenHeader({
  title,
  parent,
  meta,
  blurb,
  onBack,
}: {
  title: string
  /** Where back goes — named, not implied. */
  parent: string
  meta?: ReactNode
  blurb?: ReactNode
  onBack: () => void
}) {
  return (
    <div className="screen-head">
      <button className="back" onClick={onBack}>
        <span aria-hidden="true">‹</span> {parent}
      </button>
      <div className="row spread" style={{ alignItems: 'baseline', gap: 12 }}>
        <h2 className="screen-title">{title}</h2>
        {meta && <span className="small muted">{meta}</span>}
      </div>
      {blurb && <div className="small muted screen-blurb">{blurb}</div>}
    </div>
  )
}

export function NavCard({
  title,
  subtitle,
  meta,
  state,
  action,
  onOpen,
}: {
  title: ReactNode
  subtitle?: ReactNode
  /** Progress or status, shown right of the title. */
  meta?: ReactNode
  /** Drives the left edge marker — same vocabulary as the ladder rows. */
  state?: 'now' | 'done' | 'later' | 'past'
  action?: { label: string; onClick: () => void }
  onOpen: () => void
}) {
  return (
    <div className={'nav-card' + (state ? ' ' + state : '')}>
      <button className="nav-main" onClick={onOpen}>
        <span className="nav-text">
          <span className="nav-title">{title}</span>
          {subtitle && <span className="small muted nav-sub">{subtitle}</span>}
        </span>
      </button>

      <span className="nav-side">
        {meta && <span className="small muted nav-meta">{meta}</span>}
        {action && (
          <button
            className="chip nav-action"
            onClick={(e) => {
              // The card underneath would otherwise navigate as well, and you
              // would arrive somewhere you did not ask to go.
              e.stopPropagation()
              action.onClick()
            }}
          >
            {action.label}
          </button>
        )}
        <span className="nav-chev" aria-hidden="true">
          ›
        </span>
      </span>
    </div>
  )
}

/**
 * Wraps a pushed screen so it animates in from the side it conceptually came
 * from. Purely presentational — `direction` comes from the nav stack.
 */
export function Screen({
  direction,
  depth,
  children,
}: {
  direction: 'push' | 'pop'
  /** Keying on depth is what makes React restart the animation per screen. */
  depth: number
  children: ReactNode
}) {
  return (
    <div key={depth} className={'screen ' + direction}>
      {children}
    </div>
  )
}
