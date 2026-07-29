/**
 * Local store. Everything stays on the device — there is no server, and the
 * training data is the whole value of the app, so it should not need one.
 *
 * The schema is shaped around one question: "what does Sean keep getting
 * wrong?" That means mistakes are first-class rows, not a blob hanging off a
 * game record, because they get queried by tag and by recency constantly.
 */

import Dexie, { type Table } from 'dexie'
import type { MistakeTag, Phase, Severity } from '../coach/analysis'

export interface GameRow {
  id?: number
  /** ISO-8601 UTC. */
  playedAt: string
  humanColour: 'w' | 'b'
  opponentElo: number
  opponentStyle: string
  result: 'win' | 'loss' | 'draw'
  reason: string
  pgn: string
  /** Null until the post-game analysis pass has run. */
  acpl: number | null
  performanceRating: number | null
  analysedAt: string | null
}

export interface MistakeRow {
  id?: number
  /** 0 when the mistake came from a puzzle rather than a game. */
  gameId: number
  /** Where it came from. Absent on rows written before this field existed. */
  source?: 'game' | 'puzzle'
  ply: number
  fen: string
  san: string
  bestSan: string | null
  lossCp: number
  severity: Severity
  tag: MistakeTag | null
  phase: Phase
  /** ISO-8601 UTC — denormalised from the game so recency queries stay cheap. */
  at: string
}

export interface PuzzleAttemptRow {
  id?: number
  puzzleId: string
  /** Space-separated Lichess motifs, as shipped in the band files. */
  themes: string
  rating: number
  correct: boolean
  /** Milliseconds to first move. */
  ms: number
  /** Which tier served this puzzle, if any. */
  tierId: string | null
  at: string

  /*
   * Scoring fields. All optional, and deliberately so — rows written before
   * scoring existed stay valid, and Dexie needs no version bump because none
   * of these is an index (only the keys in .stores() are).
   *
   * Not yet synced: sync.ts maps every column by hand, so these stay on the
   * device until the Supabase migration adds them. That is the right order —
   * a column that exists locally and not remotely loses nothing, whereas the
   * reverse throws on every push.
   */

  /** How many goes it took. 1 = first time. */
  attempts?: number
  /** Whether the idea was revealed before solving. Costs points. */
  hintUsed?: boolean
  /** Points earned, after deductions. */
  points?: number
  /**
   * Solved with a move the stored Lichess line does not list, which the engine
   * judged equal or better (see coach/adjudicate.ts). Worth keeping separate
   * from plain `correct`: "found the book move" and "found a different move
   * that also wins" are the same score and different evidence, and if the
   * adjudicator is ever too generous this column is where it shows up.
   */
  alternative?: boolean
}

export interface TierProgressRow {
  /** Tier id, e.g. "tactics-3". */
  id: string
  solved: number
  correct: number
  cleared: boolean
  clearedAt: string | null
  updatedAt: string
}

/**
 * One rating per pillar, so "how am I doing at endgames" has an answer.
 *
 * Until this table existed there was exactly ONE number in the app — the
 * global `profile.rating` — and it moved only when a game against a bot
 * finished. Every puzzle, drill, scan and endgame play-out changed nothing at
 * all. That left the Learn screen unable to answer the only question it exists
 * to answer: am I getting better, and at which part.
 *
 * Rating rather than accuracy, because accuracy on its own is meaningless
 * without difficulty. Eight from ten on 500-rated puzzles and eight from ten
 * on 1200-rated ones are not the same event, and a percentage cannot tell them
 * apart.
 *
 * `history` is a capped trail on the row rather than a separate table. The only
 * question ever asked of it is "which way has this moved lately", which needs a
 * few dozen points rather than an audit log — and keeping it here means reading
 * a section's whole story is a single primary-key get.
 *
 * Local-only for now: sync.ts maps every Supabase column by hand, so this table
 * stays on the device until a migration adds it. Same trade as the scoring
 * fields above, and in the same direction — a local column with no remote
 * counterpart loses nothing, whereas the reverse throws on every push.
 */
export interface SectionRatingRow {
  /** Pillar id — 'tactics', 'endgame', 'positional', 'strategy', 'opening'. */
  section: string
  rating: number
  /** Glicko deviation. Grows while a section is idle, shrinks as you play it. */
  rd: number
  played: number
  correct: number
  /** ISO-8601 UTC of the last attempt. Null before the first one. */
  updatedAt: string | null
  /** Capped trail of {at, rating}, newest last. Feeds the trend arrow. */
  history: { at: string; rating: number }[]
}

/** Single-row table; id is always 1. */
export interface ProfileRow {
  id: number
  rating: number
  /** Uncertainty around `rating`, Glicko-style. Shrinks as games accumulate. */
  ratingDeviation: number
  updatedAt: string
  /** Day-streak bookkeeping. */
  lastSessionDate: string | null
  streak: number
}

export class CoachDb extends Dexie {
  games!: Table<GameRow, number>
  mistakes!: Table<MistakeRow, number>
  puzzleAttempts!: Table<PuzzleAttemptRow, number>
  tierProgress!: Table<TierProgressRow, string>
  profile!: Table<ProfileRow, number>
  sectionRatings!: Table<SectionRatingRow, string>

  constructor() {
    super('chess-coach')
    this.version(1).stores({
      games: '++id, playedAt, result, analysedAt',
      // The two hot queries are "recent mistakes" and "mistakes by tag", so
      // both get an index plus a compound for the combination.
      mistakes: '++id, gameId, tag, severity, at, [tag+at]',
      puzzleAttempts: '++id, puzzleId, tierId, correct, at',
      tierProgress: 'id, cleared',
      profile: 'id',
    })
    // v2 adds one store and changes nothing else, so Dexie needs no upgrade
    // function — existing rows in the v1 stores are carried across untouched.
    // Only the primary key is declared: every field on the row is read by
    // primary-key get, never queried, so an index would cost writes and buy
    // nothing.
    this.version(2).stores({
      sectionRatings: 'section',
    })
  }
}

export const db = new CoachDb()

/*
 * The starting rating was 1400 and it was the most expensive number in the
 * app. The player it shipped for plays at about 420, and nothing anywhere
 * announced the mismatch — it simply mis-aimed every recommendation at once:
 * puzzles served at 1250-1550, the Scotch and the Caro-Kann offered as a
 * repertoire, Lucena and Philidor unlocked, and "spot what is hanging" filed
 * as already behind him when his actual games show it is exactly where he is.
 *
 * 800 is the bottom of "has played some chess" and a far safer place to be
 * wrong, because being under-rated costs you easy puzzles for a session or two
 * while being over-rated costs you every recommendation until someone notices.
 *
 * This only affects a FRESH install. A device with an existing profile row
 * keeps whatever it already stored, so correcting a device that has already
 * booted needs the chess.com import in Settings — see data/chesscom.ts.
 */
const DEFAULT_PROFILE: ProfileRow = {
  id: 1,
  rating: 800,
  ratingDeviation: 250,
  updatedAt: new Date(0).toISOString(),
  lastSessionDate: null,
  streak: 0,
}

export async function getProfile(): Promise<ProfileRow> {
  const existing = await db.profile.get(1)
  if (existing) return existing
  await db.profile.put(DEFAULT_PROFILE)
  return DEFAULT_PROFILE
}

export async function saveProfile(patch: Partial<ProfileRow>): Promise<ProfileRow> {
  const current = await getProfile()
  const next = { ...current, ...patch, id: 1, updatedAt: new Date().toISOString() }
  await db.profile.put(next)
  return next
}
