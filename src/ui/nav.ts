/**
 * A navigation stack for screens you click INTO.
 *
 * The alternative this replaces is the accordion, and it is worth being
 * explicit about why it loses. An accordion answers "show me more" by growing
 * in place: the thing you tapped moves under your thumb, everything below it
 * jumps, and on a phone the content you asked for often opens off-screen. Nest
 * two of them and there is no longer any such thing as "where you are" — Learn
 * had four levels, so the same tap could mean expand-a-pillar,
 * expand-a-category, expand-an-opening or expand-a-lesson depending on
 * invisible state. Depth had no representation, so it had no exit either.
 *
 * A stack gives depth a name. One screen at a time, a back affordance that
 * always means the same thing, and a position you could describe out loud.
 *
 * THE BACK BUTTON IS PART OF THE DESIGN, not a detail. This ships as an
 * installed PWA, where the system back gesture is how people leave things. If
 * screens are pushed without history entries, back does not go up a level —
 * it closes the app, from three levels deep, with no warning. So every push
 * adds a real history entry and the system gesture drives the same pop the
 * on-screen control does. There is one source of truth for depth: history.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface NavStack<T> {
  /** Screens above the root, outermost last. Empty means you are at the root. */
  path: T[]
  /** Where the topmost screen is, or null at the root. */
  top: T | null
  depth: number
  /** Which way the last change went — for the transition, nothing else. */
  direction: 'push' | 'pop'
  push: (entry: T) => void
  /** Up one level. Delegates to history so the gesture and the button agree. */
  pop: () => void
  /** All the way back to the root. */
  toRoot: () => void
}

interface HistoryMark {
  /** Which stack this entry belongs to — two on a page must not pop each other. */
  navId: string
  depth: number
}

let counter = 0

export function useNavStack<T>(): NavStack<T> {
  const [path, setPath] = useState<T[]>([])
  const [direction, setDirection] = useState<'push' | 'pop'>('push')
  const navId = useRef<string>('')
  if (!navId.current) navId.current = `nav-${++counter}`

  // Read in the popstate handler, which must not be re-bound on every push or
  // it would miss events fired mid-update.
  const depthRef = useRef(0)

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const mark = e.state as HistoryMark | null
      // Entries that are not ours (or the entry below the whole stack) mean
      // depth zero, which is the correct reading: we have been popped out.
      const depth = mark && mark.navId === navId.current ? mark.depth : 0
      if (depth >= depthRef.current) return
      depthRef.current = depth
      setDirection('pop')
      setPath((p) => p.slice(0, Math.max(0, depth)))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /*
   * Leaving the screen entirely — a tab change unmounts this — has to give the
   * history entries back. Without it, a user who goes three deep in Learn and
   * then taps Play would need three back presses before the gesture did
   * anything visible, which reads as the app ignoring them.
   */
  useEffect(() => {
    return () => {
      const depth = depthRef.current
      if (depth > 0) window.history.go(-depth)
    }
  }, [])

  /*
   * The history entry is pushed HERE, not inside the state updater.
   *
   * It was inside it, and that was a real bug rather than a style point: React
   * treats updaters as pure and calls them twice under StrictMode, so every
   * navigation pushed two entries. The screen looked perfect and the back
   * button silently needed two presses per level — the first one popped a
   * duplicate that had no visible effect. Only a browser could find that.
   */
  const push = useCallback((entry: T) => {
    setDirection('push')
    const depth = depthRef.current + 1
    const mark: HistoryMark = { navId: navId.current, depth }
    window.history.pushState(mark, '')
    depthRef.current = depth
    setPath((p) => [...p, entry])
  }, [])

  const pop = useCallback(() => {
    if (depthRef.current === 0) return
    // Deliberately not setPath here. Letting history drive means the on-screen
    // control and the system gesture cannot drift apart.
    window.history.back()
  }, [])

  const toRoot = useCallback(() => {
    const depth = depthRef.current
    if (depth > 0) window.history.go(-depth)
  }, [])

  // Kept honest for the unmount cleanup, which reads it after the last render.
  useEffect(() => {
    depthRef.current = path.length
  }, [path.length])

  return {
    path,
    top: path.length > 0 ? (path[path.length - 1] as T) : null,
    depth: path.length,
    direction,
    push,
    pop,
    toRoot,
  }
}
