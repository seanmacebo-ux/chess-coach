/**
 * Exercise coach/record.ts against a real IndexedDB, in a real browser.
 *
 * WHY A PAGE AND NOT A NODE TEST. The recorder writes through Dexie, and Dexie
 * needs IndexedDB. Faking it would test a fake. Playing a whole game through
 * the UI to reach the same three lines takes twenty minutes of engine time and
 * tests the bot's move choice more than it tests the save. This loads the same
 * module the app loads, in the same environment, and calls it directly.
 *
 * Built and driven by `npm run check:record`.
 */

import { Chess } from 'chess.js'
import { recordFinishedGame, outcomeOf } from '../../src/coach/record'
import { db, getProfile, saveProfile } from '../../src/data/db'

const out = document.getElementById('out')!
const lines: string[] = []
const log = (s: string) => {
  lines.push(s)
  out.textContent = lines.join('\n')
}

async function main() {
  /* Fool's mate: the fastest legal finish there is, so the fixture is a real
     game rather than a hand-made PGN string. */
  const g = new Chess()
  for (const san of ['f3', 'e5', 'g4', 'Qh4#']) g.move(san)

  const outcome = outcomeOf(g, 'w')
  log(`outcome        ${JSON.stringify(outcome)}`)
  if (!outcome || outcome.result !== 'loss' || outcome.reason !== 'checkmate') {
    throw new Error('outcomeOf got the result wrong for a game White lost')
  }
  // The same position from Black's side must read the other way, or the three
  // callers would disagree about who won depending on which one saved it.
  const flipped = outcomeOf(g, 'b')
  log(`outcome (black) ${JSON.stringify(flipped)}`)
  if (flipped?.result !== 'win') throw new Error('outcomeOf is not symmetric')

  await saveProfile({ rating: 800, ratingDeviation: 250 })
  const before = await getProfile()
  const gamesBefore = await db.games.count()
  log(`before         rating ${before.rating}, ${gamesBefore} games`)

  const res = await recordFinishedGame({
    pgn: g.pgn(),
    humanColour: 'w',
    result: outcome.result,
    reason: outcome.reason,
    opponentElo: 1200,
    opponentStyle: 'human',
    source: 'opening-trainer',
  })

  const after = await getProfile()
  const games = await db.games.toArray()
  const saved = games[games.length - 1]!
  log(`after          rating ${after.rating} (delta ${res.delta}), ${games.length} games`)
  log(`row            ${saved.result} vs ${saved.opponentElo}, reason "${saved.reason}", pgn ${saved.pgn.length} chars`)
  log(`analysed       ${saved.analysedAt === null ? 'no (correct — analyse was not asked for)' : 'YES (wrong)'}`)
  log(`assessments    ${res.assessments === undefined ? 'absent (correct)' : 'present (wrong)'}`)

  if (games.length !== gamesBefore + 1) throw new Error('game row was not written')
  if (saved.result !== 'loss') throw new Error('wrong result stored')
  if (saved.pgn !== g.pgn()) throw new Error('pgn was not stored verbatim')
  if (saved.analysedAt !== null) throw new Error('analysis ran when it was not asked for')
  if (res.assessments !== undefined) throw new Error('assessments returned without analyse')
  // Losing to a 1200 from 800 is the expected result, so the drop is small but
  // must be a drop. A rating that does not move is the bug this whole module
  // exists to fix.
  if (!(after.rating < before.rating)) throw new Error('rating did not fall after a loss')
  if (after.rating !== before.rating + res.delta) throw new Error('delta does not match the stored rating')

  log('\nOK')
}

main().catch((err) => {
  log(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
})
