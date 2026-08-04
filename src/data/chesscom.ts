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
