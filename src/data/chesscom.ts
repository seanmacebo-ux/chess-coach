/**
 * Import a real rating from chess.com, so the app stops guessing.
 *
 * RECONSTRUCTED — see coach/rating.ts for why these files had to be rebuilt.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The starting rating was the most
 * expensive number in the app. It shipped at 1400 for a player who plays around
 * 420, and nothing announced the mismatch — it simply mis-aimed every
 * recommendation at once: puzzles served at 1250-1550, the Scotch and the
 * Caro-Kann offered as a repertoire, Lucena and Philidor unlocked, and "spot
 * what is hanging" filed as already behind him when his games show it is
 * exactly where he is. One wrong number, every surface wrong.
 *
 * The default is now 800, but a default is still a guess. This replaces it with
 * a measurement.
 *
 * The public API needs no key and no auth. It does require a User-Agent on some
 * endpoints, and it 404s rather than erroring for an unknown user, which is why
 * "not found" is a normal result here rather than a thrown error.
 *
 * WHICH RATING. Rapid first, then blitz, then bullet, then daily. Rapid is the
 * closest thing to the game this app trains for — you have time to do the
 * things it teaches — and bullet ratings are systematically higher and measure
 * something else. `describeImport` always says which one it used, because
 * silently picking a number out of four and presenting it as "your rating" is
 * how you get a user who does not trust the app.
 */

import { db, type GameRow } from './db'

export type TimeClass = 'rapid' | 'blitz' | 'bullet' | 'daily'

/** Preference order. Rapid is the closest match to what the app trains. */
const PREFERENCE: TimeClass[] = ['rapid', 'blitz', 'bullet', 'daily']

const LABEL: Record<TimeClass, string> = {
  rapid: 'rapid',
  blitz: 'blitz',
  bullet: 'bullet',
  daily: 'daily',
}

export interface ChessComImport {
  username: string
  /** The account exists. */
  found: boolean
  /** Every rating the account has, for the note. */
  ratings: Partial<Record<TimeClass, number>>
  /** The one to calibrate from, or null when there is nothing usable. */
  calibration: { rating: number; from: TimeClass; games: number } | null
}

interface StatsBlock {
  last?: { rating?: number }
  record?: { win?: number; loss?: number; draw?: number }
}

interface StatsResponse {
  chess_rapid?: StatsBlock
  chess_blitz?: StatsBlock
  chess_bullet?: StatsBlock
  chess_daily?: StatsBlock
}

const KEY_OF: Record<TimeClass, keyof StatsResponse> = {
  rapid: 'chess_rapid',
  blitz: 'chess_blitz',
  bullet: 'chess_bullet',
  daily: 'chess_daily',
}

/** Below this many games a rating is still settling and is not worth importing. */
const MIN_GAMES = 5

export async function fetchChessComProfile(username: string): Promise<ChessComImport> {
  const user = username.trim().toLowerCase().replace(/^@/, '')
  if (!user) throw new Error('Enter a chess.com username.')
  if (!/^[a-z0-9_-]{3,25}$/.test(user)) {
    throw new Error('That does not look like a chess.com username.')
  }

  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`, {
    headers: { Accept: 'application/json' },
  })

  // 404 is "no such user", which is a normal answer to a typo rather than a
  // failure of the request.
  if (res.status === 404) {
    return { username: user, found: false, ratings: {}, calibration: null }
  }
  if (!res.ok) {
    throw new Error(`chess.com returned ${res.status}. Try again in a moment.`)
  }

  const data = (await res.json()) as StatsResponse
  const ratings: Partial<Record<TimeClass, number>> = {}
  let calibration: ChessComImport['calibration'] = null

  for (const tc of PREFERENCE) {
    const block = data[KEY_OF[tc]]
    const rating = block?.last?.rating
    if (typeof rating !== 'number') continue
    ratings[tc] = rating

    const rec = block?.record
    const games = (rec?.win ?? 0) + (rec?.loss ?? 0) + (rec?.draw ?? 0)
    // First usable one in preference order wins; later ones are still recorded
    // so the note can mention them.
    if (!calibration && games >= MIN_GAMES) {
      calibration = { rating, from: tc, games }
    }
  }

  return { username: user, found: true, ratings, calibration }
}

/**
 * What the import did, in one sentence.
 *
 * Always names the time control and the sample it came from. A number with no
 * provenance is exactly the problem this feature exists to solve, and replacing
 * one unexplained rating with another unexplained rating would be no better
 * than the 1400 it is fixing.
 */
export function describeImport(result: ChessComImport): string {
  if (!result.found) {
    return `No chess.com account called "${result.username}". Check the spelling — it is the name in your profile URL.`
  }

  if (!result.calibration) {
    const any = Object.keys(result.ratings).length
    return any === 0
      ? `Found ${result.username}, but the account has no rated games yet. Nothing to import.`
      : `Found ${result.username}, but no time control has ${MIN_GAMES} rated games behind it yet. A rating that new would be a guess too.`
  }

  const { rating, from, games } = result.calibration
  const others = PREFERENCE.filter((tc) => tc !== from && result.ratings[tc] !== undefined)
    .map((tc) => `${LABEL[tc]} ${result.ratings[tc]}`)
    .join(', ')

  const base = `Imported ${rating} from your ${LABEL[from]} rating, over ${games} games.`
  return others ? `${base} (Also saw ${others} — rapid is the closest match to what this trains.)` : base
}

/* ================================================================== */
/* Games                                                               */
/* ================================================================== */

/**
 * Import the games you actually played, so the coach reviews real chess.
 *
 * Everything the app knew until now came from games against its own bots — and
 * those bots do not play like the people you lose to. The weakness profile,
 * the ladder ordering and every recommendation downstream were all learned
 * from a synthetic opponent, which is a coach studying footage of a different
 * player.
 *
 * NOT VERIFIED AGAINST THE LIVE API. The container this was written in cannot
 * reach api.chess.com — the network policy denies it — so the endpoint shapes
 * below are from the public API documentation and the response handling is
 * defensive rather than confirmed. It runs in the browser, where the API is
 * reachable and sends permissive CORS headers. Treat the first real import as
 * the test; every field access here tolerates a missing value rather than
 * throwing, so a shape surprise degrades to "fewer games imported" instead of
 * a broken screen.
 */

export interface ChessComGame {
  /** Game page on chess.com, and the natural unique id. */
  url: string
  pgn: string
  /** Seconds since epoch, when the game ended. */
  endTime: number
  timeClass: TimeClass
  rated: boolean
  /** Which colour you had. */
  colour: 'w' | 'b'
  yourRating: number
  opponent: string
  opponentRating: number
  result: 'win' | 'loss' | 'draw'
  /** How it ended, in chess.com's vocabulary. */
  reason: string
}

interface RawSide {
  username?: string
  rating?: number
  result?: string
}

interface RawGame {
  url?: string
  pgn?: string
  end_time?: number
  time_class?: string
  rated?: boolean
  rules?: string
  white?: RawSide
  black?: RawSide
}

/**
 * chess.com reports the result per side. Only "win" is a win; everything else
 * is a loss or a draw, and the draw list is the part that is easy to get wrong
 * — treating "stalemate" or "repetition" as a loss would quietly bias every
 * statistic the app derives.
 */
const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  'timevsinsufficient',
  '50move',
])

/** Plain-English endings, since chess.com's tokens leak into the UI. */
const REASON_TEXT: Record<string, string> = {
  win: 'won',
  checkmated: 'checkmated',
  resigned: 'resigned',
  timeout: 'lost on time',
  abandoned: 'abandoned',
  agreed: 'draw agreed',
  repetition: 'draw by repetition',
  stalemate: 'stalemate',
  insufficient: 'insufficient material',
  timevsinsufficient: 'timeout vs insufficient material',
  '50move': 'fifty-move rule',
}

function normalise(raw: RawGame, user: string): ChessComGame | null {
  // Only standard chess. Bughouse and the variants share the endpoint and
  // would poison the analysis — chess.js cannot even load some of them.
  if ((raw.rules ?? 'chess') !== 'chess') return null
  if (!raw.pgn || !raw.url || typeof raw.end_time !== 'number') return null

  const whiteName = (raw.white?.username ?? '').toLowerCase()
  const blackName = (raw.black?.username ?? '').toLowerCase()
  const colour: 'w' | 'b' = whiteName === user ? 'w' : blackName === user ? 'b' : 'w'
  // If neither side matches, this is not their game — do not guess.
  if (whiteName !== user && blackName !== user) return null

  const you = colour === 'w' ? raw.white : raw.black
  const them = colour === 'w' ? raw.black : raw.white
  const yourResult = you?.result ?? ''

  const result: 'win' | 'loss' | 'draw' =
    yourResult === 'win' ? 'win' : DRAW_RESULTS.has(yourResult) ? 'draw' : 'loss'

  const theirResult = them?.result ?? ''
  const reason =
    result === 'win'
      ? `opponent ${REASON_TEXT[theirResult] ?? theirResult}`
      : (REASON_TEXT[yourResult] ?? yourResult)

  const tc = raw.time_class
  const timeClass: TimeClass =
    tc === 'rapid' || tc === 'blitz' || tc === 'bullet' || tc === 'daily' ? tc : 'rapid'

  return {
    url: raw.url,
    pgn: raw.pgn,
    endTime: raw.end_time,
    timeClass,
    rated: raw.rated ?? false,
    colour,
    yourRating: you?.rating ?? 0,
    opponent: them?.username ?? 'unknown',
    opponentRating: them?.rating ?? 0,
    result,
    reason: reason || 'game over',
  }
}

export interface GameFetchOptions {
  /** Stop after this many games, newest first. */
  max?: number
  /** Only rated games. Unrated games are practice and skew the profile. */
  ratedOnly?: boolean
}

/**
 * The most recent games, newest first.
 *
 * Walks the monthly archives backwards rather than fetching everything: an
 * account with three years of history is dozens of megabytes, and the coach
 * only ever asks about recent form — the weakness profile already halves the
 * weight of anything older than three weeks.
 */
export async function fetchRecentGames(
  username: string,
  opts: GameFetchOptions = {},
): Promise<ChessComGame[]> {
  const { max = 20, ratedOnly = true } = opts
  const user = username.trim().toLowerCase().replace(/^@/, '')
  if (!user) throw new Error('Enter a chess.com username.')

  const archiveRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
    { headers: { Accept: 'application/json' } },
  )
  if (archiveRes.status === 404) throw new Error(`No chess.com account called "${user}".`)
  if (!archiveRes.ok) throw new Error(`chess.com returned ${archiveRes.status}.`)

  const { archives } = (await archiveRes.json()) as { archives?: string[] }
  if (!archives?.length) return []

  const out: ChessComGame[] = []
  // Newest month first, and stop as soon as we have enough.
  for (const url of [...archives].reverse()) {
    if (out.length >= max) break
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) continue
    const { games } = (await res.json()) as { games?: RawGame[] }
    if (!games?.length) continue

    const month = games
      .map((g) => normalise(g, user))
      .filter((g): g is ChessComGame => g !== null)
      .filter((g) => (ratedOnly ? g.rated : true))
      .sort((a, b) => b.endTime - a.endTime)

    out.push(...month)
  }

  return out.slice(0, max)
}

/**
 * Store imported games, skipping ones already held.
 *
 * Deduped on the chess.com URL, which is the only genuinely unique id these
 * have. `playedAt` alone is not safe — bullet games finish in the same second
 * — and matching on PGN length would collide across short games.
 *
 * `acpl` is left null: importing is instant and analysing is not, so the games
 * arrive un-analysed and get reviewed on demand. Importing twenty games and
 * making you wait through twenty engine passes to see any of them would be the
 * wrong trade.
 */
export async function importGames(
  games: ChessComGame[],
): Promise<{ added: number; skipped: number }> {
  const existing = await db.games.toArray()
  // The URL is stored in the PGN's [Link ...] header by chess.com, so the
  // existing rows can be checked without a schema change.
  const seen = new Set(existing.map((g) => linkOf(g.pgn)).filter(Boolean))

  const fresh = games.filter((g) => !seen.has(g.url))
  if (fresh.length > 0) {
    const rows: GameRow[] = fresh.map((g) => ({
      playedAt: new Date(g.endTime * 1000).toISOString(),
      humanColour: g.colour,
      opponentElo: g.opponentRating,
      opponentStyle: `chess.com · ${g.opponent}`,
      result: g.result,
      reason: g.reason,
      pgn: g.pgn,
      acpl: null,
      performanceRating: null,
      analysedAt: null,
    }))
    await db.games.bulkAdd(rows)
  }
  return { added: fresh.length, skipped: games.length - fresh.length }
}

/** The chess.com game URL out of a PGN's [Link "..."] header, if present. */
export function linkOf(pgn: string): string | null {
  const m = /\[Link "([^"]+)"\]/.exec(pgn)
  return m?.[1] ?? null
}
