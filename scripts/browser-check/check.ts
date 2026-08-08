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
import { fetchRecentGames, importGames } from '../../src/data/chesscom'
import { computeWeaknesses } from '../../src/coach/profile'
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

  /*
   * And the path the Play tab actually uses.
   *
   * The original check covered `analyse: false` only — which is what the two
   * trainers pass. The Play tab passes `analyse: true`, and that branch does
   * three more things: runs the engine, writes the mistakes, and returns the
   * assessments the review screen is drawn from. None of it was covered, which
   * is a hole exactly where the post-game review lives.
   */
  const g2 = new Chess()
  for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']) g2.move(san)
  const before2 = await getProfile()
  const mistakesBefore = await db.mistakes.count()

  const res2 = await recordFinishedGame(
    {
      pgn: g2.pgn(),
      humanColour: 'w',
      result: 'win',
      reason: 'checkmate',
      opponentElo: 800,
      opponentStyle: 'human',
      source: 'play',
    },
    { analyse: true, onProgress: (done, total) => log(`  analysing ${done}/${total}`) },
  )

  const saved2 = (await db.games.toArray()).at(-1)!
  log(`analysed row   acpl ${saved2.acpl}, perf ${saved2.performanceRating}, at ${saved2.analysedAt ? 'set' : 'NULL'}`)
  log(`assessments    ${res2.assessments?.length ?? 'none'} moves returned`)
  log(`mistakes       +${(await db.mistakes.count()) - mistakesBefore} rows`)

  if (!res2.assessments || res2.assessments.length === 0) {
    throw new Error('analyse:true returned no assessments — the review screen would have nothing to draw')
  }
  if (saved2.analysedAt === null) throw new Error('analyse:true did not mark the game analysed')
  if (saved2.acpl === null) throw new Error('analyse:true did not store acpl')
  // Every assessment must be one of YOUR moves. Analysing the wrong side is the
  // failure that produces a review full of moves you did not play.
  if (res2.assessments.length !== 4) {
    throw new Error(`expected 4 white moves assessed, got ${res2.assessments.length}`)
  }
  const after2 = await getProfile()
  if (!(after2.rating > before2.rating)) throw new Error('rating did not rise after a win')

  /*
   * The chess.com import, end to end, against a stubbed API.
   *
   * This path has NEVER been exercised. It was written and reconstructed from
   * call sites, and api.chess.com is unreachable from the build sandbox, so
   * the first time it would have run for real is on Sean's phone — which is
   * the worst place to discover a parsing bug.
   *
   * fetch is stubbed with the actual shape chess.com returns: an archives
   * index, then a month of games with the per-side result strings and the
   * [Link] header that dedup depends on.
   */
  const realFetch = globalThis.fetch
  const mkGame = (n: number, youWhite: boolean, yourResult: string, theirResult: string) => ({
    url: `https://www.chess.com/game/live/${n}`,
    rules: 'chess',
    rated: true,
    time_class: 'rapid',
    end_time: 1_780_000_000 + n,
    white: { username: youWhite ? 'dugnificent' : 'someone', result: youWhite ? yourResult : theirResult, rating: 316 },
    black: { username: youWhite ? 'someone' : 'dugnificent', result: youWhite ? theirResult : yourResult, rating: 402 },
    pgn: `[Event "Live Chess"]\n[Link "https://www.chess.com/game/live/${n}"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`,
  })

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/games/archives')) {
      return new Response(JSON.stringify({ archives: ['https://api.chess.com/pub/player/dugnificent/games/2026/08'] }), { status: 200 })
    }
    if (url.includes('/games/2026/08')) {
      return new Response(JSON.stringify({
        games: [
          mkGame(1, true, 'win', 'checkmated'),
          mkGame(2, false, 'resigned', 'win'),
          mkGame(3, true, 'stalemate', 'stalemate'),
          // must be dropped: a variant
          { ...mkGame(4, true, 'win', 'resigned'), rules: 'bughouse' },
          // must be dropped: not their game
          { ...mkGame(5, true, 'win', 'resigned'), white: { username: 'other', result: 'win' }, black: { username: 'nobody', result: 'resigned' } },
        ],
      }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  try {
    const games = await fetchRecentGames('dugnificent', { max: 20 })
    log(`\nchess.com     fetched ${games.length} games (expect 3 — variant and not-mine dropped)`)
    if (games.length !== 3) throw new Error(`fetchRecentGames returned ${games.length}, expected 3`)

    const results = games.map((g) => g.result).sort().join(',')
    log(`results       ${results} (expect draw,loss,win)`)
    if (results !== 'draw,loss,win') throw new Error(`results wrong: ${results}`)

    const gamesBefore = await db.games.count()
    const first = await importGames(games)
    log(`import        added ${first.added}, skipped ${first.skipped}`)
    if (first.added !== 3) throw new Error(`expected 3 added, got ${first.added}`)
    if ((await db.games.count()) !== gamesBefore + 3) throw new Error('rows not written')

    // Importing the same games again must add nothing — dedup on the [Link]
    // header. Without this, every import doubles your history.
    const second = await importGames(games)
    log(`re-import     added ${second.added}, skipped ${second.skipped} (expect 0 added)`)
    if (second.added !== 0) throw new Error(`re-import added ${second.added}, dedup is broken`)

    const w = await computeWeaknesses(5)
    log(`weaknesses    ${w.length} tags from the mistake log`)
  } finally {
    globalThis.fetch = realFetch
  }

  log('\nOK')
}

main().catch((err) => {
  log(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
})
