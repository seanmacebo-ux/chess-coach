/**
 * Local-first sync.
 *
 * IndexedDB stays the source of truth. Supabase is a mirror so the same
 * profile follows Sean between his phone and his work machine, and so a
 * cleared browser cache stops meaning a wiped training history.
 *
 * Three rules this is built on:
 *
 *   NEVER BLOCK. Every function swallows network failure and reports it
 *   rather than throwing. Offline, on a plane, or with Supabase down, the app
 *   behaves exactly as it does today. Sync is additive; the moment it becomes
 *   load-bearing the app gets worse.
 *
 *   APPEND-MOSTLY DATA IS EASY. Games, mistakes and puzzle attempts are only
 *   ever written once, so `local_id` uniqueness makes push idempotent — a
 *   re-sync updates in place instead of duplicating.
 *
 *   MUTABLE DATA NEEDS A CLOCK. Profile and tier progress change over time and
 *   can genuinely conflict across devices, so those merge on `updated_at`,
 *   newest wins. For rating specifically that's the honest answer: whichever
 *   device you played on most recently knows best.
 */

import { db, getProfile, saveProfile } from './db'
import { currentAuth, getSupabase } from './supabase'

export interface SyncResult {
  ok: boolean
  pushed: number
  pulled: number
  error?: string
  /** Sync was skipped because nobody is signed in. Not a failure. */
  skipped?: boolean
}

const IDLE: SyncResult = { ok: true, pushed: 0, pulled: 0, skipped: true }

/* ------------------------------------------------------------------ push */

async function pushTables(userId: string): Promise<number> {
  const sb = getSupabase()
  let pushed = 0

  const [games, mistakes, attempts, tiers, profile] = await Promise.all([
    db.games.toArray(),
    db.mistakes.toArray(),
    db.puzzleAttempts.toArray(),
    db.tierProgress.toArray(),
    getProfile(),
  ])

  if (games.length) {
    const { error } = await sb.from('games').upsert(
      games.map((g) => ({
        user_id: userId,
        local_id: g.id,
        played_at: g.playedAt,
        human_colour: g.humanColour,
        opponent_elo: g.opponentElo,
        opponent_style: g.opponentStyle,
        result: g.result,
        reason: g.reason,
        pgn: g.pgn,
        acpl: g.acpl,
        performance_rating: g.performanceRating,
        analysed_at: g.analysedAt,
      })),
      { onConflict: 'user_id,local_id' },
    )
    if (error) throw new Error(`games: ${error.message}`)
    pushed += games.length
  }

  if (mistakes.length) {
    const { error } = await sb.from('mistakes').upsert(
      mistakes.map((m) => ({
        user_id: userId,
        local_id: m.id,
        game_id: m.gameId,
        source: m.source ?? 'game',
        ply: m.ply,
        fen: m.fen,
        san: m.san,
        best_san: m.bestSan,
        loss_cp: m.lossCp,
        severity: m.severity,
        tag: m.tag,
        phase: m.phase,
        at: m.at,
      })),
      { onConflict: 'user_id,local_id' },
    )
    if (error) throw new Error(`mistakes: ${error.message}`)
    pushed += mistakes.length
  }

  if (attempts.length) {
    const { error } = await sb.from('puzzle_attempts').upsert(
      attempts.map((a) => ({
        user_id: userId,
        local_id: a.id,
        puzzle_id: a.puzzleId,
        themes: a.themes,
        rating: a.rating,
        correct: a.correct,
        ms: a.ms,
        tier_id: a.tierId,
        at: a.at,
      })),
      { onConflict: 'user_id,local_id' },
    )
    if (error) throw new Error(`attempts: ${error.message}`)
    pushed += attempts.length
  }

  if (tiers.length) {
    const { error } = await sb.from('tier_progress').upsert(
      tiers.map((t) => ({
        user_id: userId,
        tier_id: t.id,
        solved: t.solved,
        correct: t.correct,
        cleared: t.cleared,
        cleared_at: t.clearedAt,
        updated_at: t.updatedAt,
      })),
      { onConflict: 'user_id,tier_id' },
    )
    if (error) throw new Error(`tiers: ${error.message}`)
    pushed += tiers.length
  }

  const { error: pErr } = await sb.from('profiles').upsert(
    {
      user_id: userId,
      rating: profile.rating,
      rating_deviation: profile.ratingDeviation,
      streak: profile.streak,
      last_session_date: profile.lastSessionDate,
      updated_at: profile.updatedAt,
    },
    { onConflict: 'user_id' },
  )
  if (pErr) throw new Error(`profile: ${pErr.message}`)
  pushed += 1

  return pushed
}

/* ------------------------------------------------------------------ pull */

async function pullTables(): Promise<number> {
  const sb = getSupabase()
  let pulled = 0

  const [remoteGames, remoteMistakes, remoteAttempts, remoteTiers, remoteProfile] =
    await Promise.all([
      sb.from('games').select('*'),
      sb.from('mistakes').select('*'),
      sb.from('puzzle_attempts').select('*'),
      sb.from('tier_progress').select('*'),
      sb.from('profiles').select('*').maybeSingle(),
    ])

  // Append-only tables: pull means "add what this device has never seen".
  // Matched on the natural identity of the row, not local_id — that's
  // device-specific and would collide across machines.
  if (remoteGames.data?.length) {
    const seen = new Set((await db.games.toArray()).map((g) => `${g.playedAt}|${g.pgn.length}`))
    const fresh = remoteGames.data.filter((r) => !seen.has(`${r.played_at}|${r.pgn.length}`))
    if (fresh.length) {
      await db.games.bulkAdd(
        fresh.map((r) => ({
          playedAt: r.played_at,
          humanColour: r.human_colour,
          opponentElo: r.opponent_elo,
          opponentStyle: r.opponent_style,
          result: r.result,
          reason: r.reason,
          pgn: r.pgn,
          acpl: r.acpl,
          performanceRating: r.performance_rating,
          analysedAt: r.analysed_at,
        })),
      )
      pulled += fresh.length
    }
  }

  if (remoteMistakes.data?.length) {
    const seen = new Set((await db.mistakes.toArray()).map((m) => `${m.at}|${m.fen}|${m.ply}`))
    const fresh = remoteMistakes.data.filter((r) => !seen.has(`${r.at}|${r.fen}|${r.ply}`))
    if (fresh.length) {
      await db.mistakes.bulkAdd(
        fresh.map((r) => ({
          gameId: r.game_id,
          source: r.source,
          ply: r.ply,
          fen: r.fen,
          san: r.san,
          bestSan: r.best_san,
          lossCp: r.loss_cp,
          severity: r.severity,
          tag: r.tag,
          phase: r.phase,
          at: r.at,
        })),
      )
      pulled += fresh.length
    }
  }

  if (remoteAttempts.data?.length) {
    const seen = new Set((await db.puzzleAttempts.toArray()).map((a) => `${a.puzzleId}|${a.at}`))
    const fresh = remoteAttempts.data.filter((r) => !seen.has(`${r.puzzle_id}|${r.at}`))
    if (fresh.length) {
      await db.puzzleAttempts.bulkAdd(
        fresh.map((r) => ({
          puzzleId: r.puzzle_id,
          themes: r.themes,
          rating: r.rating,
          correct: r.correct,
          ms: r.ms,
          tierId: r.tier_id,
          at: r.at,
        })),
      )
      pulled += fresh.length
    }
  }

  // Tier progress is mutable — newest write wins per tier.
  if (remoteTiers.data?.length) {
    for (const r of remoteTiers.data) {
      const local = await db.tierProgress.get(r.tier_id)
      if (!local || Date.parse(r.updated_at) > Date.parse(local.updatedAt)) {
        await db.tierProgress.put({
          id: r.tier_id,
          solved: r.solved,
          correct: r.correct,
          cleared: r.cleared,
          clearedAt: r.cleared_at,
          updatedAt: r.updated_at,
        })
        pulled += 1
      }
    }
  }

  // Same for the profile. Whichever device played most recently knows best.
  const rp = remoteProfile.data
  if (rp) {
    const local = await getProfile()
    if (Date.parse(rp.updated_at) > Date.parse(local.updatedAt)) {
      await saveProfile({
        rating: rp.rating,
        ratingDeviation: rp.rating_deviation,
        streak: rp.streak,
        lastSessionDate: rp.last_session_date,
      })
      pulled += 1
    }
  }

  return pulled
}

/* ------------------------------------------------------------------ api */

let inFlight: Promise<SyncResult> | null = null

/**
 * Push local changes up, then pull anything this device hasn't seen.
 *
 * Push first on purpose: if two devices have diverged, the local work is
 * safely stored before anything merges back down.
 *
 * Concurrent calls share one run — the app triggers this from several places
 * (sign-in, tab focus, end of session) and overlapping syncs would duplicate.
 */
export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight

  inFlight = (async (): Promise<SyncResult> => {
    try {
      const auth = await currentAuth()
      if (!auth.signedIn || !auth.userId) return IDLE

      const pushed = await pushTables(auth.userId)
      const pulled = await pullTables()
      return { ok: true, pushed, pulled }
    } catch (err) {
      // Deliberately not rethrown. A failed sync is a status line, never a
      // broken app.
      return {
        ok: false,
        pushed: 0,
        pulled: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Fire-and-forget, for call sites that shouldn't wait (end of a game). */
export function syncInBackground(): void {
  void syncNow()
}
