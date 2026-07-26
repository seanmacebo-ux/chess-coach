/**
 * Carve a shippable puzzle set out of the Lichess database.
 *
 * Input:  scripts/raw/lichess_db_puzzle.csv.zst  (~302MB, 6.05M puzzles, CC0)
 * Output: public/puzzles/band-<n>.json           (~25k puzzles total, ~3MB)
 *
 * Three things this does that a naive `head -25000` wouldn't:
 *
 *   1. QUALITY GATE. Keeps only puzzles that lots of people have actually
 *      solved (NbPlays) and liked (Popularity), with a settled rating
 *      (RatingDeviation). The long tail of the database is noisy.
 *
 *   2. THEME BALANCE. Round-robins across tactical motifs when filling each
 *      band, so we don't end up with 3,000 back-rank mates and nine forks.
 *      Weakness-targeting only works if every theme has stock to draw from.
 *
 *   3. BAND SHARDING. One file per 200 Elo. The app fetches the two or three
 *      bands around your rating, not all nine.
 *
 * Note on the Lichess format: `FEN` is the position BEFORE the opponent's
 * move, and Moves[0] IS that move. The puzzle the user sees starts after
 * Moves[0] is applied; the solution is Moves[1], [3], [5]... We keep the raw
 * form and let the client apply it, so nothing is lost in translation here.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'scripts', 'raw', 'lichess_db_puzzle.csv.zst')
const OUT = join(root, 'public', 'puzzles')

/* -------------------------------------------------------------- tuning */

const BAND_SIZE = 200
const BAND_MIN = 600
const BAND_MAX = 2400 // exclusive upper edge
const PER_BAND = 3200 // ~28.8k total across 9 bands

const MIN_POPULARITY = 80 // -100..100, community upvote score
const MIN_PLAYS = 400
const MAX_RD = 90 // rating deviation; lower = better settled

/**
 * Themes that describe WHAT YOU MUST SEE. These are what we balance across
 * and what the weakness profile targets.
 */
const MOTIFS = new Set([
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection',
  'attraction', 'clearance', 'interference', 'xRayAttack', 'zugzwang',
  'hangingPiece', 'trappedPiece', 'sacrifice', 'quietMove', 'defensiveMove',
  'capturingDefender', 'intermezzo', 'attackingF2F7', 'exposedKing',
  'kingsideAttack', 'queensideAttack', 'advancedPawn', 'promotion',
  'underPromotion', 'enPassant', 'castling', 'backRankMate', 'smotheredMate',
  'anastasiaMate', 'arabianMate', 'bodenMate', 'doubleBishopMate',
  'dovetailMate', 'hookMate', 'killBoxMate', 'vukovicMate',
  'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'rookEndgame', 'pawnEndgame', 'queenEndgame', 'bishopEndgame',
  'knightEndgame', 'queenRookEndgame',
])

/**
 * Themes that describe difficulty, phase or provenance rather than content.
 * Useful metadata, useless as a training category.
 */
const NON_MOTIF = new Set([
  'short', 'long', 'veryLong', 'oneMove', 'crushing', 'advantage', 'equality',
  'mate', 'opening', 'middlegame', 'endgame', 'master', 'masterVsMaster',
  'superGM', 'playerGames',
])

/* -------------------------------------------------------------- helpers */

const bandOf = (rating) => Math.floor(rating / BAND_SIZE) * BAND_SIZE

/** Pick the most specific motif to file this puzzle under. */
function primaryMotif(themes) {
  const motifs = themes.filter((t) => MOTIFS.has(t))
  if (motifs.length === 0) return null
  // "fork + mateIn2" is more useful filed under fork than under mateIn2.
  const nonMate = motifs.filter((t) => !t.startsWith('mateIn'))
  return (nonMate.length > 0 ? nonMate : motifs)[0]
}

/**
 * CSV split that respects quoted fields. The Lichess export rarely quotes,
 * but OpeningTags can contain commas, so we can't just split(',').
 */
function splitCsv(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

/* -------------------------------------------------------------- main */

console.log(`reading ${SRC}`)

const zstd = spawn('zstd', ['-dc', SRC], { stdio: ['ignore', 'pipe', 'inherit'] })
zstd.on('error', (err) => {
  console.error(`FAILED to spawn zstd — is it installed? ${err.message}`)
  process.exit(1)
})

const rl = createInterface({ input: zstd.stdout, crlfDelay: Infinity })

/** band -> motif -> puzzles[] */
const buckets = new Map()
let seen = 0
let kept = 0
let header = true

for await (const line of rl) {
  if (header) { header = false; continue }
  if (!line) continue
  seen++

  const f = splitCsv(line)
  if (f.length < 8) continue

  const [id, fen, moves, ratingS, rdS, popS, playsS, themesS, , openingS] = f
  const rating = Number(ratingS)
  if (!Number.isFinite(rating) || rating < BAND_MIN || rating >= BAND_MAX) continue
  if (Number(rdS) > MAX_RD) continue
  if (Number(popS) < MIN_POPULARITY) continue
  if (Number(playsS) < MIN_PLAYS) continue

  const themes = themesS.split(' ').filter(Boolean)
  const motif = primaryMotif(themes)
  if (!motif) continue

  const band = bandOf(rating)
  let byMotif = buckets.get(band)
  if (!byMotif) { byMotif = new Map(); buckets.set(band, byMotif) }
  let arr = byMotif.get(motif)
  if (!arr) { arr = []; byMotif.set(motif, arr) }

  // Hard cap per motif per band so one motif can't eat the whole quota even
  // before the round-robin runs. 4x headroom over the even share.
  const cap = Math.ceil((PER_BAND / 12) * 4)
  if (arr.length >= cap) continue

  arr.push({
    i: id,
    f: fen,
    m: moves,
    r: rating,
    t: themes.filter((x) => !NON_MOTIF.has(x)).join(' '),
    o: openingS || '',
  })
  kept++

  if (seen % 1_000_000 === 0) {
    console.log(`  scanned ${(seen / 1e6).toFixed(0)}M, pooled ${kept}`)
  }
}

const exit = await new Promise((r) => zstd.on('close', r))
if (exit !== 0) {
  console.error(`zstd exited ${exit}`)
  process.exit(1)
}

console.log(`scanned ${seen} rows, pooled ${kept} candidates`)

await mkdir(OUT, { recursive: true })

const index = { bands: [], themes: {}, total: 0, builtFrom: 'lichess_db_puzzle (CC0)' }

for (const band of [...buckets.keys()].sort((a, b) => a - b)) {
  const byMotif = buckets.get(band)
  const pools = [...byMotif.entries()].map(([motif, arr]) => ({ motif, arr, idx: 0 }))

  // Round-robin across motifs until the band quota is full.
  const picked = []
  let progress = true
  while (picked.length < PER_BAND && progress) {
    progress = false
    for (const p of pools) {
      if (picked.length >= PER_BAND) break
      if (p.idx < p.arr.length) {
        picked.push(p.arr[p.idx++])
        progress = true
      }
    }
  }

  picked.sort((a, b) => a.r - b.r)
  await writeFile(join(OUT, `band-${band}.json`), JSON.stringify(picked))

  const themeCounts = {}
  for (const p of picked) {
    for (const t of p.t.split(' ')) {
      if (MOTIFS.has(t)) themeCounts[t] = (themeCounts[t] ?? 0) + 1
    }
  }
  index.bands.push({ band, count: picked.length, themes: themeCounts })
  index.total += picked.length

  for (const [t, n] of Object.entries(themeCounts)) {
    index.themes[t] = (index.themes[t] ?? 0) + n
  }

  console.log(`  band ${band}: ${picked.length} puzzles, ${Object.keys(themeCounts).length} motifs`)
}

await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
console.log(`\nwrote ${index.total} puzzles across ${index.bands.length} bands -> public/puzzles/`)
