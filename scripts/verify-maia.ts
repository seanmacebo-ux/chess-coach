/**
 * Verify the TS Maia forward pass against lc0's confirmed output.
 *
 * The expected numbers below were captured from the real lc0 engine (v0.32.1,
 * eigen backend, `go nodes 1`, VerboseMoveStats + UCI_ShowWDL) running the same
 * maia-1500 weights. If the TS port matches these to within tolerance, it plays
 * identically to Leela. Run: `npm run verify:maia`.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadMaiaNet } from '../src/engine/maia/net'
import { maiaForward } from '../src/engine/maia/forward'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bytes = new Uint8Array(gunzipSync(readFileSync(join(root, 'public/maia/maia-1500.pb.gz'))))
const net = loadMaiaNet(bytes)

interface Case {
  name: string
  fen: string
  wdl: [number, number, number]
  moves: Record<string, number> // uci -> lc0 P%
}

const CASES: Case[] = [
  {
    name: 'startpos',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    wdl: [50.0, 3.8, 46.2],
    moves: { e2e4: 50.2, d2d4: 23.3, c2c4: 5.0, g1f3: 4.3, e2e3: 3.6, d2d3: 1.2 },
  },
  {
    name: 'after 1.e4 e5 2.Nf3 (black to move)',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    wdl: [44.0, 4.0, 52.0],
    moves: { b8c6: 32.8, d7d6: 24.7, g8f6: 14.8, f8c5: 8.3, d8f6: 3.0 },
  },
]

const TOL = 0.6 // percentage points
let failures = 0

for (const c of CASES) {
  const { ranked, wdl } = maiaForward(net, c.fen)
  const pct = (x: number) => +(x * 100).toFixed(1)
  const byMove = new Map(ranked.map((r) => [r.uci, pct(r.p)]))
  console.log(`\n${c.name}`)
  console.log(`  WDL  got ${pct(wdl[0])}/${pct(wdl[1])}/${pct(wdl[2])}  exp ${c.wdl.join('/')}`)
  for (let i = 0; i < 3; i++) {
    if (Math.abs(pct(wdl[i]) - c.wdl[i]) > TOL) {
      console.log(`  ✗ WDL[${i}] off by ${(pct(wdl[i]) - c.wdl[i]).toFixed(1)}`)
      failures++
    }
  }
  for (const [mv, exp] of Object.entries(c.moves)) {
    const got = byMove.get(mv) ?? 0
    const ok = Math.abs(got - exp) <= TOL
    console.log(`  ${ok ? '✓' : '✗'} ${mv}: got ${got.toFixed(1)}%  exp ${exp}%`)
    if (!ok) failures++
  }
}

if (failures) {
  console.error(`\nFAIL: ${failures} mismatch(es) vs lc0.`)
  process.exit(1)
}
console.log('\nPASS: TS Maia forward matches lc0 on all cases.')
