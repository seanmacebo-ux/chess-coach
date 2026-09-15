/**
 * Tal's sacrifices, turned into drills the engine has checked.
 *
 * The books gave up 366 master games (data/pgn). A game score on its own
 * teaches nothing — it is 80 moves of somebody else's chess. What a 600-rated
 * player can actually use out of Tal is the thing Tal is FOR: the moment a
 * piece is offered and the offer is correct.
 *
 * THE SAME RULE THE REVIEW USES. A position becomes a drill only if the move
 * played there would be rated 'brilliant' by src/coach/report.ts — material
 * given up, still the engine's first choice, still not losing, and the only
 * move that does it. Nothing here has its own private idea of brilliance;
 * mining and praise share one definition, so a drill is teaching exactly the
 * thing the app will later congratulate.
 *
 * CHEAP FILTER, THEN EXPENSIVE PROOF. isSacrifice() is pure board logic and
 * costs nothing, so it runs on all 27,000 plies; only what survives it goes
 * to a depth-14 multipv-3 search. Searching everything would take a day and
 * find the same positions.
 *
 * WHAT COMES OUT is a position, the move, and the attribution — players,
 * event, year. No annotation, no prose: see scripts/import-epub.ts on why
 * this repository takes the moves and leaves the writing alone.
 *
 *   npm run mine-sacrifices -- --depth 14 [--file tal-life-and-games.pgn]
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

import { NodeEngine } from './lib/engine-node'
import { lineScore } from '../src/engine/types'
import { isSacrifice, rateMove } from '../src/coach/report'
import type { MoveAssessment } from '../src/coach/analysis'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PGN = join(root, 'data/pgn')
const OUT = join(root, 'src/content/sacrifices.ts')

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) ? v : fallback
}
const DEPTH = arg('depth', 14)
const ONLY = (() => {
  const i = process.argv.indexOf('--file')
  return i >= 0 ? process.argv[i + 1] : null
})()

/** Cap on how many plies into a game to look. Openings are theory, not finds. */
const FROM_PLY = 12

export interface MinedSacrifice {
  /** Position with the sacrifice still to be played. */
  fen: string
  /** The move, in both notations. */
  san: string
  uci: string
  white: string
  black: string
  event: string
  year: string
  moveNo: number
  /** Whose move it is, for the prompt. */
  side: 'w' | 'b'
  /** Evaluation after the sacrifice, from the sacrificer's side. */
  cp: number
  /** How far behind the second-best move was, in centipawns. */
  margin: number
}

async function main() {
  const files = (await readdir(PGN))
    .filter((f) => f.endsWith('.pgn') && (!ONLY || f === ONLY))
    .sort()

  const engine = new NodeEngine()
  await engine.init()

  const found: MinedSacrifice[] = []
  let games = 0
  let candidates = 0
  let searched = 0
  const started = Date.now()

  for (const f of files) {
    const text = await readFile(join(PGN, f), 'utf8')
    for (const block of text.split(/\n(?=\[Event )/).filter((b) => b.trim())) {
      const head = (k: string) => new RegExp(`\\[${k} "([^"]*)"\\]`).exec(block)?.[1] ?? ''
      const replay = new Chess()
      try { replay.loadPgn(block) } catch { continue }
      const history = replay.history({ verbose: true })
      if (history.length < 20) continue
      games++

      const board = new Chess()
      for (let ply = 0; ply < history.length; ply++) {
        const h = history[ply]!
        const fen = board.fen()
        const uci = `${h.from}${h.to}${h.promotion ?? ''}`

        /*
         * The free filter. Almost every ply fails it, which is the point —
         * 27,000 positions become a few hundred without the engine waking up.
         */
        if (ply >= FROM_PLY && isSacrifice(fen, uci)) {
          candidates++
          const a = await engine.analyse(fen, { depth: DEPTH, multipv: 3 })
          searched++
          const best = a.lines[0]
          if (best) {
            const bestCp = lineScore(best)
            const played = a.lines.find((l) => l.pv?.[0] === uci)
            const others = a.lines.filter((l) => l.pv?.[0] !== uci)
            const alts = a.lines
              .map((l) => ({
                san: l.pv?.[0] ?? '',
                cp: lineScore(l),
                played: l.pv?.[0] === uci,
              }))
              .filter((x) => x.san)

            if (played) {
              /*
               * Rated by the app's own rule, not by a copy of it. Everything
               * the rating needs is here: the position, the move, what the
               * engine wanted, and the alternatives it saw.
               */
              const playedCp = lineScore(played)
              const assessment: MoveAssessment = {
                ply, fen, san: h.san, uci,
                lossCp: Math.max(0, bestCp - playedCp),
                cpBest: bestCp, cpPlayed: playedCp,
                severity: 'best', bestUci: a.bestMove, bestSan: null,
                tag: null, phase: 'middlegame', alts,
              }
              if (rateMove(assessment) === 'brilliant') {
                const secondBest = others.length ? Math.max(...others.map(lineScore)) : -100000
                found.push({
                  fen, san: h.san, uci,
                  white: head('White'), black: head('Black'),
                  event: head('Event'),
                  year: (/\b(1[89]\d\d|20\d\d)\b/.exec(head('Date') + ' ' + head('Event')) ?? ['????'])[0]!,
                  moveNo: Math.floor(ply / 2) + 1,
                  side: h.color,
                  cp: Math.round(playedCp),
                  margin: Math.round(playedCp - secondBest),
                })
              }
            }
          }
        }
        board.move({ from: h.from, to: h.to, promotion: h.promotion })
      }

      if (games % 10 === 0) {
        const mins = ((Date.now() - started) / 60000).toFixed(1)
        console.log(`  ${games} games · ${candidates} offers · ${searched} searched · ${found.length} kept · ${mins}m`)
      }
    }
  }

  found.sort((a, b) => b.margin - a.margin)

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, render(found), 'utf8')
  console.log(
    `\n${games} games · ${candidates} material offers · ${found.length} verified sacrifices\n→ ${OUT}`,
  )
  process.exit(0)
}

function render(rows: MinedSacrifice[]): string {
  return `/**
 * GENERATED by scripts/mine-sacrifices.ts — do not edit by hand.
 *
 * Positions from master games in which a piece or pawn was offered and the
 * engine agrees it was both the best move and the only one. Mined with the
 * same rule src/coach/report.ts uses to award "Brilliant", at depth ${DEPTH}.
 *
 * Only the game scores and the attribution are taken from the books; the
 * annotations are their authors' and stay in the books.
 */

export interface Sacrifice {
  fen: string
  san: string
  uci: string
  white: string
  black: string
  event: string
  year: string
  moveNo: number
  side: 'w' | 'b'
  /** Evaluation after the sacrifice, in centipawns, from the mover's side. */
  cp: number
  /** How far behind the engine's second choice was. Bigger = more forced. */
  margin: number
}

export const SACRIFICES: Sacrifice[] = ${JSON.stringify(rows, null, 2)}
`
}

void main()
