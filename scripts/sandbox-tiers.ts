/**
 * Sandbox the tier ladder.
 *
 * The ladder is the spine of the whole app — it decides what you are served on
 * a cold start and what "cleared" means — and until now nothing checked it at
 * all. It is plain data, so the failure mode is not a crash: it is a tier that
 * quietly cannot be finished, or one that claims to train a motif the corpus
 * has never heard of. Both look completely fine in the UI.
 *
 * Four checks, and the third is the one with teeth:
 *
 *   STRUCTURE   — ids unique, indexes contiguous per pillar, bands ordered,
 *                 gates positive, accuracy a real fraction.
 *
 *   RAMP        — tactics gates never decrease with tier index. The ladder is
 *                 sorted by difficulty, so a later tier that is cheaper to
 *                 clear than an earlier one is a mistake by construction. This
 *                 is the check that would have caught tactics-1 and tactics-4
 *                 both sitting at 20.
 *
 *   STOCK       — every puzzle-backed tier must have at least `clear.solved`
 *                 DISTINCT puzzles carrying its motifs, in every rating band it
 *                 covers. Counted from the shipped band files rather than
 *                 estimated from index.json: a puzzle can carry several of a
 *                 tier's motifs at once, so summing per-theme counts
 *                 overstates the real stock and could wave through a gate the
 *                 corpus cannot actually fill. Raising a gate above stock does
 *                 not error — the tier just never clears, and the ladder stops
 *                 dead with no explanation.
 *
 *   BACKING     — no tier is quietly neither puzzle-backed nor exercise-backed.
 *                 A tier whose themes are all concept keys matches nothing in
 *                 the picker, which degrades to random rating-matched puzzles
 *                 while the UI still says the session is targeted.
 *
 * Usage:  npm run sandbox:tiers
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ALL_TIERS,
  PILLARS,
  TACTICS_TIERS,
  isExerciseBacked,
  puzzleThemes,
  tiersFor,
  type Tier,
} from '../src/coach/tiers'
import type { RawPuzzle } from '../src/data/puzzles'

const PUZZLE_DIR = resolve(import.meta.dirname, '../public/puzzles')

/* Mirrors src/data/puzzles.ts — bands are 200 wide, clamped at both ends. */
const BAND_SIZE = 200
const MIN_BAND = 600
const MAX_BAND = 2200

const ALL_BANDS: number[] = []
for (let b = MIN_BAND; b <= MAX_BAND; b += BAND_SIZE) ALL_BANDS.push(b)

/** Bands whose own rating range overlaps a tier's window. */
function bandsCovering(lo: number, hi: number): number[] {
  return ALL_BANDS.filter((b) => {
    // The top band is open-ended: everything at 2200+ lands in it.
    const top = b === MAX_BAND ? Infinity : b + BAND_SIZE - 1
    return top >= lo && b <= hi
  })
}

interface Problem {
  check: string
  where: string
  detail: string
}

const problems: Problem[] = []
const fail = (check: string, where: string, detail: string) =>
  problems.push({ check, where, detail })

/* ------------------------------------------------------------- structure */

const seenIds = new Set<string>()
for (const t of ALL_TIERS) {
  if (seenIds.has(t.id)) fail('structure', t.id, 'duplicate tier id')
  seenIds.add(t.id)

  if (t.band[0] > t.band[1]) {
    fail('structure', t.id, `band is inverted: [${t.band[0]}, ${t.band[1]}]`)
  }
  if (!Number.isInteger(t.clear.solved) || t.clear.solved <= 0) {
    fail('structure', t.id, `clear.solved must be a positive integer, got ${t.clear.solved}`)
  }
  if (!(t.clear.accuracy > 0 && t.clear.accuracy <= 1)) {
    fail('structure', t.id, `clear.accuracy must be in (0, 1], got ${t.clear.accuracy}`)
  }
  if (t.themes.length === 0) fail('structure', t.id, 'tier has no themes')
}

for (const p of PILLARS) {
  const tiers = tiersFor(p.id)
  tiers.forEach((t, i) => {
    if (t.index !== i + 1) {
      fail('structure', t.id, `index ${t.index} breaks the 1..n run for ${p.id} (expected ${i + 1})`)
    }
  })
}

/* ------------------------------------------------------------------ ramp */

for (let i = 1; i < TACTICS_TIERS.length; i++) {
  const prev = TACTICS_TIERS[i - 1]!
  const cur = TACTICS_TIERS[i]!
  if (cur.clear.solved < prev.clear.solved) {
    fail(
      'ramp',
      cur.id,
      `clears at ${cur.clear.solved} but the easier ${prev.id} needs ${prev.clear.solved}`,
    )
  }
}

/* --------------------------------------------------------------- backing */

for (const t of ALL_TIERS) {
  const motifs = puzzleThemes(t)
  if (motifs.length === 0 && !isExerciseBacked(t)) {
    fail('backing', t.id, 'neither puzzle-backed nor exercise-backed')
  }
}

/* ----------------------------------------------------------------- stock */

/** Distinct puzzles per band carrying at least one of a set of motifs. */
const bandThemes = new Map<number, string[][]>()
function loadBandThemes(band: number): string[][] {
  const hit = bandThemes.get(band)
  if (hit) return hit
  const rows = JSON.parse(
    readFileSync(resolve(PUZZLE_DIR, `band-${band}.json`), 'utf8'),
  ) as RawPuzzle[]
  const themes = rows.map((r) => r.t.split(' ').filter(Boolean))
  bandThemes.set(band, themes)
  return themes
}

function stockIn(band: number, motifs: string[]): number {
  const want = new Set(motifs)
  let n = 0
  for (const themes of loadBandThemes(band)) {
    if (themes.some((t) => want.has(t))) n++
  }
  return n
}

interface StockLine {
  tier: Tier
  band: number
  have: number
  need: number
}

const stockReport: StockLine[] = []

for (const t of ALL_TIERS) {
  const motifs = puzzleThemes(t)
  if (motifs.length === 0) continue // exercise-backed; nothing to stock

  for (const band of bandsCovering(t.band[0], t.band[1])) {
    const have = stockIn(band, motifs)
    const need = t.clear.solved
    stockReport.push({ tier: t, band, have, need })
    if (have < need) {
      fail(
        'stock',
        t.id,
        `band ${band} has ${have} puzzles carrying [${motifs.join(', ')}] but the tier needs ${need} to clear`,
      )
    }
  }
}

/* ---------------------------------------------------------------- report */

console.log(`Tiers:      ${ALL_TIERS.length} across ${PILLARS.length} pillars`)
console.log(`Puzzle-backed: ${ALL_TIERS.filter((t) => puzzleThemes(t).length > 0).length}`)
console.log(`Exercise-backed: ${ALL_TIERS.filter((t) => isExerciseBacked(t)).length}`)
console.log(`Stock checks: ${stockReport.length}`)

// The tightest margin is the interesting number — it says how close the ladder
// is to outrunning the corpus, which is what a future gate rise would hit.
const tightest = [...stockReport].sort((a, b) => a.have / a.need - b.have / b.need).slice(0, 5)
console.log('\nTightest stock margins:')
for (const s of tightest) {
  console.log(
    `  ${s.tier.id.padEnd(14)} band ${String(s.band).padStart(4)}  ${String(s.have).padStart(5)} available / ${s.need} needed`,
  )
}

if (problems.length === 0) {
  console.log('\n✓ ladder clean — structure, ramp, backing and stock all pass')
  process.exit(0)
}

console.log(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
for (const p of problems) {
  console.log(`  [${p.check}] ${p.where}: ${p.detail}`)
}
process.exit(1)
