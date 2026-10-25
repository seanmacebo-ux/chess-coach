/**
 * Is the record right?
 *
 * It is one number on a tile, which is exactly why it has to be exact. A
 * scoreline that is wrong by one is worse than no scoreline: it is the kind
 * of error nobody reports and everybody stops trusting.
 *
 *   npm run verify:headtohead
 */

import { records, recordVs, scoreline, standing } from '../src/coach/headtohead'
import type { GameRow } from '../src/data/db'

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
  if (!cond) fail++
}

let n = 0
function game(over: Partial<GameRow> = {}): GameRow {
  n++
  return {
    playedAt: `2026-01-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    humanColour: 'w',
    opponentElo: 950,
    opponentStyle: 'aggressive',
    botId: 'nadia',
    result: 'win',
    reason: 'checkmate',
    pgn: '1. e4 e5',
    acpl: null,
    performanceRating: null,
    analysedAt: null,
    ...over,
  }
}

/* ------------------------------------------------------- the counting - */

const mixed = [
  game({ result: 'win' }),
  game({ result: 'loss' }),
  game({ result: 'win' }),
  game({ result: 'draw' }),
  game({ result: 'win' }),
]
const nadia = recordVs(mixed, 'nadia')
check('every game is counted once', nadia.played === 5, String(nadia.played))
check('wins, losses and draws add up to the games played',
      nadia.wins + nadia.losses + nadia.draws === nadia.played,
      `${nadia.wins}/${nadia.losses}/${nadia.draws}`)
check('the wins are right', nadia.wins === 3, String(nadia.wins))
check('the losses are right', nadia.losses === 1, String(nadia.losses))
check('the draws are right', nadia.draws === 1, String(nadia.draws))

/* Two bots must not bleed into each other. */
const two = [...mixed, game({ botId: 'walter', result: 'loss' }), game({ botId: 'walter', result: 'loss' })]
check("one bot's games stay that bot's", recordVs(two, 'nadia').played === 5)
check('and the other gets its own', recordVs(two, 'walter').losses === 2)
check('a bot never played is 0-0, not missing',
      recordVs(two, 'orion').played === 0 && recordVs(two, 'orion').botId === 'orion')

/* ------------------------------------------------------ what is excluded */

/*
 * Rows written before botId existed have none, and chess.com imports are
 * somebody else's games entirely. Either one leaking in would quietly
 * inflate a record the user is supposed to be able to trust.
 */
const dirty = [
  game({ result: 'win' }),
  game({ botId: undefined, result: 'win' }),
  game({ botId: 'nadia', opponentStyle: 'chess.com · magnus', result: 'win' }),
]
check('a game with no bot id is not counted', recordVs(dirty, 'nadia').played === 1,
      String(recordVs(dirty, 'nadia').played))
check('an imported chess.com game is not counted',
      recordVs(dirty, 'nadia').wins === 1, String(recordVs(dirty, 'nadia').wins))

/* --------------------------------------------------------- the form --- */

/*
 * `recent` is newest-first, and getting that backwards would report a
 * winning streak to somebody on a losing one — the most demoralising
 * possible off-by-one.
 */
const ordered = [
  game({ result: 'loss', playedAt: '2026-02-01T00:00:00.000Z' }),
  game({ result: 'win', playedAt: '2026-02-02T00:00:00.000Z' }),
  game({ result: 'win', playedAt: '2026-02-03T00:00:00.000Z' }),
]
const form = recordVs(ordered, 'nadia')
check('the most recent result comes first', form.recent[0] === 'win', form.recent.join(','))
check('the oldest comes last', form.recent[form.recent.length - 1] === 'loss', form.recent.join(','))
check('lastPlayed is the latest game', form.lastPlayed === '2026-02-03T00:00:00.000Z',
      String(form.lastPlayed))

/* Rows arriving out of order must still sort. */
const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!]
check('out-of-order rows are sorted before being read',
      recordVs(shuffled, 'nadia').recent.join(',') === form.recent.join(','),
      recordVs(shuffled, 'nadia').recent.join(','))

/* The form line is capped so a hundred games do not become a hundred pips. */
const many = Array.from({ length: 40 }, () => game({ result: 'win' }))
check('the form line is capped', recordVs(many, 'nadia').recent.length === 5,
      String(recordVs(many, 'nadia').recent.length))
check('...but the totals are not', recordVs(many, 'nadia').wins === 40)

/* ------------------------------------------------------ what it says -- */

check('no games means no scoreline', scoreline(recordVs([], 'nadia')) === null)
check('a clean record reads as two numbers',
      scoreline(recordVs([game({ result: 'win' }), game({ result: 'loss' })], 'nadia')) === '1-1')
check('draws only appear when there are some',
      scoreline(nadia) === '3-1-1', String(scoreline(nadia)))

check('never played says so', standing(recordVs([], 'orion')).includes('never played'))
check('never beaten is said plainly',
      standing(recordVs([game({ result: 'loss' }), game({ result: 'loss' })], 'nadia'))
        .includes('never beaten'),
      standing(recordVs([game({ result: 'loss' }), game({ result: 'loss' })], 'nadia')))
check('never lost is said too',
      standing(recordVs([game({ result: 'win' }), game({ result: 'win' })], 'nadia'))
        .includes('never lost'))

{
  // A run is only a run at two or more, and it must read the right way round.
  const losing = recordVs([
    game({ result: 'win', playedAt: '2026-03-01T00:00:00.000Z' }),
    game({ result: 'loss', playedAt: '2026-03-02T00:00:00.000Z' }),
    game({ result: 'loss', playedAt: '2026-03-03T00:00:00.000Z' }),
    game({ result: 'loss', playedAt: '2026-03-04T00:00:00.000Z' }),
  ], 'nadia')
  check('a losing run is reported as losses, not wins',
        standing(losing).includes('3 losses in a row'), standing(losing))
}
{
  const alternating = recordVs([
    game({ result: 'loss', playedAt: '2026-04-01T00:00:00.000Z' }),
    game({ result: 'win', playedAt: '2026-04-02T00:00:00.000Z' }),
    game({ result: 'loss', playedAt: '2026-04-03T00:00:00.000Z' }),
    game({ result: 'win', playedAt: '2026-04-04T00:00:00.000Z' }),
  ], 'nadia')
  check('no run is claimed when there is not one',
        !/in a row/.test(standing(alternating)), standing(alternating))
}

/* A row with no playedAt must not throw — restored backups carry them. */
check('an undated row does not crash the sort',
      recordVs([game({ playedAt: undefined as unknown as string })], 'nadia').played === 1)

check('records() and recordVs() agree',
      records(mixed).get('nadia')?.wins === recordVs(mixed, 'nadia').wins)

console.log(fail === 0 ? '\n✓ the record says what actually happened' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
