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
  }
}

export const db = new CoachDb()

const DEFAULT_PROFILE: ProfileRow = {
  id: 1,
  rating: 1400,
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
