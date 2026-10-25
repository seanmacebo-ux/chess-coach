/**
 * Is the record right?
 *
 * It is one number on a tile, which is exactly why it has to be exact. A
 * scoreline that is wrong by one is worse than no scoreline: it is the kind
 * of error nobody reports and everybody stops trusting.
 *
 *   npm run verify:headtohead
 */

import { form, records, recordVs, scoreline, standing } from '../src/coach/headtohead'
import { BOTS, nearestBot } from '../src/engine/roster'
import { botForToday } from '../src/coach/session'
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
const inOrder = recordVs(ordered, 'nadia')
check('the most recent result comes first', inOrder.recent[0] === 'win', inOrder.recent.join(','))
check('the oldest comes last',
      inOrder.recent[inOrder.recent.length - 1] === 'loss', inOrder.recent.join(','))
check('lastPlayed is the latest game', inOrder.lastPlayed === '2026-02-03T00:00:00.000Z',
      String(inOrder.lastPlayed))

/* Rows arriving out of order must still sort. */
const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!]
check('out-of-order rows are sorted before being read',
      recordVs(shuffled, 'nadia').recent.join(',') === inOrder.recent.join(','),
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

/*
 * `form` exists so Today can show a chip AND a line without saying the same
 * thing twice. The rule it has to keep: whenever there is a score to show,
 * form must not repeat it.
 */
{
  const scored = [
    game({ botId: 'pip', result: 'win' }),
    game({ botId: 'pip', result: 'loss' }),
    game({ botId: 'pip', result: 'loss' }),
  ]
  const rec = recordVs(scored, 'pip')
  check('form never repeats the scoreline', !String(form(rec) ?? '').includes(scoreline(rec)!),
        `${scoreline(rec)} / ${form(rec)}`)
  check('an unplayed bot says so', form(recordVs([], 'pip')) === 'You have never played them.',
        String(form(recordVs([], 'pip'))))
  const allLosses = recordVs(
    [game({ botId: 'pip', result: 'loss' }), game({ botId: 'pip', result: 'loss' })], 'pip')
  check('never beaten is said plainly', form(allLosses) === 'Never beaten them.',
        String(form(allLosses)))
}

/*
 * Today names a bot, and Play resolves that bot back from its RATING — the
 * slider is a number, so nearestBot() is the only way back. That round trip
 * is only lossless while no two bots share a rating, and nothing else in the
 * app would notice if two ever did: Today would describe one opponent, Play
 * would hand you another, and the opening book would belong to whichever the
 * reduce() happened to keep.
 */
const elos = BOTS.map((b) => b.elo)
check(
  'no two bots share a rating',
  new Set(elos).size === elos.length,
  `${elos.length} bots, ${new Set(elos).size} distinct ratings`,
)
const roundTrip = BOTS.filter((b) => nearestBot(b.elo).id !== b.id)
check(
  'every bot survives the rating round trip Play does',
  roundTrip.length === 0,
  roundTrip.map((b) => `${b.id}@${b.elo} -> ${nearestBot(b.elo).id}`).join(', '),
)

/*
 * And the opponent Today picks has to BE one of them, at their own rating.
 * This is the check that would have caught the thing it replaces: Today
 * asked for round(rating/100)*100, which at 870 is 900, and the roster has
 * nobody at 900 at all — so the bot you were told about and the bot Play
 * resolved from that number could differ, book and all.
 */
for (const rating of [200, 316, 420, 600, 800, 870, 1000, 1337, 1600, 2000, 2600]) {
  for (const style of ['human', 'tactical', 'aggressive', 'positional', 'solid'] as const) {
    const bot = botForToday(rating, style)
    check(
      `${rating} / ${style} picks a real bot at its own rating`,
      BOTS.some((b) => b.id === bot.id && b.elo === bot.elo && b.style === bot.style),
      `${bot.id}@${bot.elo}`,
    )
  }
}

/*
 * Reach, not style, is the hard constraint. A 500 asking for a tactical bot
 * gets the nearest bot in range even if the only tactical one is 1700 —
 * otherwise "play to your weakness" quietly becomes "play someone 1200
 * points above you", which is the opposite of coaching.
 */
const tooFar = [200, 420, 600, 800, 1000].filter(
  (r) => Math.abs(botForToday(r, 'tactical').elo - r) > 400,
)
check(
  'the style preference never reaches past your rating',
  tooFar.length === 0,
  tooFar.map((r) => `${r} -> ${botForToday(r, 'tactical').elo}`).join(', '),
)

/* And it is a test rather than a mirror: at or above you wherever the roster
   can manage it. */
const below = [350, 550, 800, 950, 1100, 1250, 1400].filter(
  (r) => botForToday(r, 'human').elo < r,
)
check('the opponent is at or above your rating', below.length === 0, below.join(', '))

console.log(fail === 0 ? '\n✓ the record says what actually happened' : `\n✗ ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
