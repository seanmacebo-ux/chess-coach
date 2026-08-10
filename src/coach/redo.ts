/**
 * Your own mistakes, rebuilt as one-move puzzles.
 *
 * Shared by the Fix-your-own-games drill (Learn) and the daily session —
 * because "the diagnosis is from MY games but the training never is" was the
 * exact complaint, the daily prescription now leads with these before any
 * corpus puzzle. Everything a one-move puzzle needs was already in the
 * mistakes table: the position (fen) and the better move (bestSan). The
 * engine adjudication in the runner does the rest, so a move as good as the
 * one you missed passes.
 */

import { Chess } from 'chess.js'
import { db } from '../data/db'
import { TAG_THEMES } from './analysis'
import type { Puzzle } from '../data/puzzles'

export async function buildRedoSet(limit: number): Promise<Puzzle[]> {
  // Newest first: the mistake you made yesterday is the one still in your
  // hands. 200 rows is plenty of pool after dedup.
  const rows = await db.mistakes.orderBy('at').reverse().limit(200).toArray()
  const seen = new Set<string>()
  const out: Puzzle[] = []
  for (const r of rows) {
    // Puzzle-sourced rows have no position of "your game" behind them, and
    // rows without a better move recorded have nothing to find.
    if (r.source === 'puzzle' || !r.bestSan || !r.fen) continue
    if (r.severity !== 'blunder' && r.severity !== 'mistake') continue
    if (seen.has(r.fen)) continue
    const probe = new Chess(r.fen)
    let uci: string | null = null
    try {
      const m = probe.move(r.bestSan)
      if (m) uci = `${m.from}${m.to}${m.promotion ?? ''}`
    } catch {
      uci = null
    }
    if (!uci) continue
    seen.add(r.fen)
    out.push({
      id: `redo-${r.id ?? out.length}`,
      fen: r.fen,
      solution: [uci],
      line: [uci],
      // 0 = unrated: this is your game, not a calibrated puzzle, and the
      // runner knows to say nothing rather than "rated 0".
      rating: 0,
      themes: r.tag ? TAG_THEMES[r.tag] : [],
      opening: '',
      colour: new Chess(r.fen).turn() === 'w' ? 'white' : 'black',
    })
    if (out.length >= limit) break
  }
  return out
}
