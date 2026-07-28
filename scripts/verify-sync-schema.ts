/**
 * Does the sync layer agree with the database schema?
 *
 * This check exists because of a specific bug. `attempts`, `hintUsed` and
 * `points` sat on the local puzzle-attempt row for months and never reached
 * the server: sync.ts maps every column by hand, and nothing compared that
 * mapping against the migrations. Points earned on the phone were simply
 * invisible on the desktop, and nothing failed — which is the worst version of
 * a bug, because there is no symptom to chase.
 *
 * Hand-maintained lists drift. The fix is not to be more careful; it is to
 * make drift a failing check. Two directions matter and they catch different
 * things:
 *
 *   SENDING A COLUMN THAT DOES NOT EXIST is loud — PostgREST rejects the whole
 *   upsert, so one stray field takes games and mistakes down with it.
 *
 *   NOT SENDING A COLUMN THAT DOES EXIST is silent, and is the bug we actually
 *   had. It is the more important half.
 *
 * Run: npm run verify:sync
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SERVER_OWNED, TO_REMOTE } from '../src/data/sync'
import { assert, runChecks } from './lib/browser'

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url).pathname

/**
 * Read the schema out of the migrations.
 *
 * Applying them to a real Postgres would be stronger, and is not possible here
 * without a live database. What this does instead is read the same DDL the
 * database will be built from — so it can drift from a *deployed* database
 * that never had the migration applied, but not from the repo's declared
 * schema. The failure it is designed to catch lives in the repo either way.
 */
async function schemaColumns(): Promise<Map<string, Set<string>>> {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
  const tables = new Map<string, Set<string>>()

  for (const file of files) {
    const sql = stripComments(await readFile(join(MIGRATIONS, file), 'utf8'))

    // create table [if not exists] public.<name> ( ... );
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\s*\);/gi
    for (const m of sql.matchAll(createRe)) {
      const table = m[1]!
      const cols = tables.get(table) ?? new Set<string>()
      for (const line of m[2]!.split('\n')) {
        const col = /^\s*([a-z_][a-z0-9_]*)\s+\S/i.exec(line)
        // "unique (...)", "primary key (...)" and friends are constraints, not
        // columns, and they parse as a leading identifier if you let them.
        if (col && !isConstraintWord(col[1]!)) cols.add(col[1]!)
      }
      tables.set(table, cols)
    }

    // alter table public.<name> add column [if not exists] <col> ...
    const alterRe = /alter\s+table\s+public\.(\w+)([\s\S]*?);/gi
    for (const m of sql.matchAll(alterRe)) {
      const table = m[1]!
      const cols = tables.get(table) ?? new Set<string>()
      const addRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
      for (const a of m[2]!.matchAll(addRe)) cols.add(a[1]!)
      tables.set(table, cols)
    }
  }

  return tables
}

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}

function isConstraintWord(word: string): boolean {
  return ['unique', 'primary', 'foreign', 'constraint', 'check'].includes(word.toLowerCase())
}

/* --------------------------------------------- synthetic local rows */

/**
 * One fully-populated row per table.
 *
 * Every optional field is SET here on purpose. Leaving one undefined would
 * make its key vanish from the mapper's output and the check would report a
 * column as unsynced when it is merely absent from this fixture — a false
 * alarm that trains people to ignore the check.
 */
const NOW = '2026-07-28T00:00:00.000Z'

const ROWS = {
  games: {
    id: 1,
    playedAt: NOW,
    humanColour: 'w' as const,
    opponentElo: 1400,
    opponentStyle: 'solid',
    result: 'win' as const,
    reason: 'Checkmate — white wins',
    pgn: '1. e4 e5',
    acpl: 42,
    performanceRating: 1450,
    analysedAt: NOW,
  },
  mistakes: {
    id: 1,
    gameId: 1,
    source: 'game' as const,
    ply: 7,
    fen: 'startpos',
    san: 'Nf3',
    bestSan: 'd4',
    lossCp: 120,
    severity: 'mistake' as const,
    tag: null,
    phase: 'opening' as const,
    at: NOW,
  },
  puzzle_attempts: {
    id: 1,
    puzzleId: 'abc123',
    themes: 'fork pin',
    rating: 1500,
    correct: true,
    ms: 4200,
    tierId: 'tactics-2',
    at: NOW,
    attempts: 2,
    hintUsed: false,
    points: 7,
  },
  tier_progress: {
    id: 'tactics-2',
    solved: 12,
    correct: 10,
    cleared: false,
    clearedAt: null,
    updatedAt: NOW,
  },
  profiles: {
    id: 1,
    rating: 1400,
    ratingDeviation: 250,
    updatedAt: NOW,
    lastSessionDate: null,
    streak: 3,
  },
}

async function main(): Promise<void> {
  const schema = await schemaColumns()
  const checks: Array<[string, () => void]> = []

  checks.push([
    'the migrations parse into the five expected tables',
    () => {
      const found = [...schema.keys()].sort()
      assert(
        ['games', 'mistakes', 'profiles', 'puzzle_attempts', 'tier_progress'].every((t) =>
          found.includes(t),
        ),
        `parsed tables: ${found.join(', ')}`,
      )
    },
  ])

  for (const table of Object.keys(TO_REMOTE) as (keyof typeof TO_REMOTE)[]) {
    const mapper = TO_REMOTE[table] as (row: unknown, userId: string) => Record<string, unknown>
    const sent = new Set(Object.keys(mapper(ROWS[table], 'user-1')))
    const columns = schema.get(table)
    const owned = new Set(SERVER_OWNED[table] ?? [])

    checks.push([
      `${table}: every column the client sends exists in the schema`,
      () => {
        assert(columns, `no table ${table} in the migrations`)
        const unknown = [...sent].filter((c) => !columns.has(c))
        assert(
          unknown.length === 0,
          `would be rejected by PostgREST, taking the whole upsert with it: ${unknown.join(', ')}`,
        )
      },
    ])

    checks.push([
      `${table}: every column in the schema is actually synced`,
      () => {
        assert(columns, `no table ${table} in the migrations`)
        const stranded = [...columns].filter((c) => !sent.has(c) && !owned.has(c))
        assert(
          stranded.length === 0,
          `written locally and never sent — the exact shape of the scoring bug: ${stranded.join(', ')}`,
        )
      },
    ])
  }

  // The regression itself, named. If someone drops these from the mapper the
  // generic checks above catch it, but a check that names the original bug
  // survives refactors of the checker.
  checks.push([
    'puzzle scoring specifically: attempts, hint_used and points travel',
    () => {
      const sent = TO_REMOTE.puzzle_attempts(ROWS.puzzle_attempts, 'user-1')
      assert(sent.attempts === 2, `attempts: ${String(sent.attempts)}`)
      assert(sent.hint_used === false, `hint_used: ${String(sent.hint_used)}`)
      assert(sent.points === 7, `points: ${String(sent.points)}`)
    },
  ])

  checks.push([
    'an unscored row sends null rather than claiming zero',
    () => {
      const sparse = { ...ROWS.puzzle_attempts }
      delete (sparse as Partial<typeof sparse>).attempts
      delete (sparse as Partial<typeof sparse>).hintUsed
      delete (sparse as Partial<typeof sparse>).points
      const sent = TO_REMOTE.puzzle_attempts(sparse, 'user-1')
      assert(sent.attempts === null, `attempts: ${String(sent.attempts)}`)
      assert(sent.hint_used === null, `hint_used: ${String(sent.hint_used)}`)
      assert(sent.points === null, `points: ${String(sent.points)}`)
    },
  ])

  const ok = await runChecks('sync layer vs database schema', checks)
  process.exitCode = ok ? 0 : 1
}

await main()
