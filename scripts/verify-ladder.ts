/**
 * Structural checks on the tier ladder.
 *
 * The ladder is plain data, which makes it easy to edit and easy to break in
 * ways nothing notices — a tier with an empty theme list still renders, still
 * gets served, and quietly trains nothing. These are the invariants that were
 * only ever enforced by reading the file carefully.
 *
 * The tactics ramp gets its own checks because it was wrong. Every tier
 * defaulted to 20 solved, so mate-in-one and mate-in-two cleared on identical
 * effort despite Polgár's book carrying 306 of the first and 3,412 of the
 * second. A flat ramp is the regression; these assert it stays un-flat.
 *
 * Run: npm run verify:ladder
 */

import {
  ALL_TIERS,
  PILLARS,
  TACTICS_TIERS,
  isExerciseBacked,
  puzzleThemes,
  tierById,
  tiersAtRating,
} from '../src/coach/tiers'
import { assert, assertEqual, runChecks } from './lib/browser'

function solvedFor(id: string): number {
  const tier = tierById(id)
  if (!tier) throw new Error(`no tier ${id}`)
  return tier.clear.solved
}

async function main(): Promise<void> {
  const ok = await runChecks('tier ladder', [
    [
      'every tier id is unique',
      () => {
        const seen = new Map<string, number>()
        for (const t of ALL_TIERS) seen.set(t.id, (seen.get(t.id) ?? 0) + 1)
        const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id)
        assertEqual(dupes, [], 'duplicated tier ids')
      },
    ],
    [
      'every band is the right way round',
      () => {
        const bad = ALL_TIERS.filter((t) => t.band[0] > t.band[1]).map((t) => t.id)
        assertEqual(bad, [], 'tiers whose band low exceeds its high')
      },
    ],
    [
      'every tier is clearable, and none demands perfection',
      () => {
        const bad = ALL_TIERS.filter(
          (t) => t.clear.solved < 1 || t.clear.accuracy <= 0 || t.clear.accuracy > 1,
        ).map((t) => `${t.id} (${t.clear.solved} @ ${t.clear.accuracy})`)
        assertEqual(bad, [], 'unclearable tiers')
      },
    ],
    [
      'every tier names something to train',
      () => {
        const empty = ALL_TIERS.filter((t) => t.themes.length === 0).map((t) => t.id)
        assertEqual(empty, [], 'tiers with no themes')
      },
    ],
    [
      'no dead zone — every rating from 600 to 2200 has a tier to be on',
      () => {
        const dead: number[] = []
        for (let r = 600; r <= 2200; r += 25) if (tiersAtRating(r).length === 0) dead.push(r)
        assertEqual(dead, [], 'ratings with nothing available')
      },
    ],
    [
      'every pillar is represented in the ladder',
      () => {
        const missing = PILLARS.filter((p) => !ALL_TIERS.some((t) => t.pillar === p.id)).map(
          (p) => p.id,
        )
        assertEqual(missing, [], 'pillars with no tiers')
      },
    ],
    [
      'a puzzle-kind tier either has corpus stock or is knowingly exercise-backed',
      () => {
        // Not a tautology: it asserts the two helpers agree, which is what the
        // session picker relies on when it decides whether to ask for puzzles.
        const inconsistent = ALL_TIERS.filter(
          (t) => isExerciseBacked(t) !== (puzzleThemes(t).length === 0),
        ).map((t) => t.id)
        assertEqual(inconsistent, [], 'tiers where stock and backing disagree')
      },
    ],

    /* ------------------------------------------------ the tactics ramp */

    [
      'the tactics ramp is not flat (the regression)',
      () => {
        const thresholds = TACTICS_TIERS.map((t) => t.clear.solved)
        const distinct = new Set(thresholds)
        assert(
          distinct.size > 1,
          `every tactics tier clears at the same count (${thresholds.join(', ')}) — ` +
            'mate-in-one and mate-in-two are not the same amount of work',
        )
      },
    ],
    [
      'mate in two costs meaningfully more than mate in one',
      () => {
        const one = solvedFor('tactics-1')
        const two = solvedFor('tactics-4')
        // Polgár's volume ratio is roughly 10x; the ladder compresses that for
        // climbability, but the ORDER is the part that must survive.
        assert(two >= one * 3, `tactics-1 asks ${one}, tactics-4 asks ${two} — ratio too shallow`)
      },
    ],
    [
      'the ladder still opens on a short rung',
      () => {
        // The day-one tier has to be finishable, or the ramp fix has just made
        // the front door worse than the problem it solved.
        const first = solvedFor('tactics-1')
        assert(first <= 25, `tactics-1 asks ${first}, which is too long a first rung`)
      },
    ],
    [
      'no tactics tier is an unclimbable wall',
      () => {
        // Eight puzzles a day is the default session. Anything past ~2 weeks on
        // a single rung stalls the four pillars gated behind it.
        const wall = TACTICS_TIERS.filter((t) => t.clear.solved > 112).map(
          (t) => `${t.id} (${t.clear.solved} = ${Math.ceil(t.clear.solved / 8)} days)`,
        )
        assertEqual(wall, [], 'tiers needing more than 14 days at 8 puzzles/day')
      },
    ],
  ])

  process.exitCode = ok ? 0 : 1
}

await main()
