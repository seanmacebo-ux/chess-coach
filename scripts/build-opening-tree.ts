/**
 * An opening TREE, generated and engine-checked.
 *
 * THE PROBLEM. src/content/openings.ts holds hand-written lines, and the
 * writing is good — every line has a `when` and an `answer` explaining the
 * idea. But each line is ONE FIXED SEQUENCE. The coached game matches your
 * game against it ply by ply and the moment either side plays something not
 * on that list you are out of book, with nothing. At 700 that happens on
 * move three, every game. The depth Sean is missing is not more theory, it is
 * COVERAGE: what to do when they play the other thing.
 *
 * WHAT THIS DOES. Starting from each repertoire line, it walks forward. At
 * your moves it follows the book. At THEIR moves it asks the engine for the
 * plausible replies — not every legal move, the ones a real opponent might
 * actually choose — and for each of those it computes your answer and stores
 * it. The result is a tree keyed by position, so the book survives contact.
 *
 * WHY NOT A MASTER DATABASE. chess.com and lichess answer this with millions
 * of games, which is better data and not available offline in a phone app.
 * An engine-generated tree is a different and defensible thing: every branch
 * is checked rather than popular, and it ships as a file that works on a
 * train.
 *
 * WHAT MAKES IT TEACHABLE. Every node carries the REASONS for the move, from
 * coach/position.ts — what it does and what it costs, computed from the
 * board. That is the part a games database cannot give you: chess.com tells
 * you 62% of players go here, which is a fact about players, not about chess.
 *
 *   npm run build:tree -- --plies 10 --breadth 3 --depth 14
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

import { NodeEngine } from './lib/engine-node'
import { bandProfile, weighCandidates } from '../src/engine/policy'
import { OPENINGS } from '../src/content/openings'
import { weighMove } from '../src/coach/position'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

/** How deep to go, in plies from the start of the line. */
const PLIES = arg('plies', 10)
/** How many opponent replies to cover at each of their turns. */
const BREADTH = arg('breadth', 3)
const DEPTH = arg('depth', 14)
/**
 * Which rating band of opponent to cover the replies of.
 *
 * THE FIRST VERSION GOT THIS WRONG and a browser test caught it: it covered
 * the ENGINE's top three replies, then a coached game against an 800 bot went
 * off-tree on move two. Of course it did — an 800 does not play the engine's
 * top three. The replies worth covering are the ones the opponents he
 * actually faces would choose, which is a different distribution entirely,
 * and the app already models it: policy.ts is what the bots play from.
 */
const OPPONENT_ELO = arg('opponent-elo', 800)
/** A reply whose weight is this fraction of the most likely one is covered. */
const REPLY_SHARE = 0.12

export interface TreeNode {
  /** Position with YOU to move. */
  fen: string
  /** What to play, in SAN. */
  play: string
  /** UCI, so the board can draw it without re-parsing. */
  uci: string
  /** Why, computed from the board — never prose. */
  does: string[]
  costs: string[]
  /** Which opening and line this came from. */
  opening: string
  line: string
  /** Full move number, for display. */
  moveNo: number
  /** True when this is the hand-written book move rather than an engine answer. */
  book: boolean
}

async function main() {
  const engine = new NodeEngine()
  await engine.init()

  const nodes = new Map<string, TreeNode>()
  let searches = 0

  /** Your answer in this position: the engine's, checked and explained. */
  const answerFor = async (fen: string): Promise<{ san: string; uci: string } | null> => {
    const analysis = await engine.analyse(fen, { depth: DEPTH, multipv: 1 })
    searches++
    const uci = analysis.bestMove
    if (!uci) return null
    const probe = new Chess(fen)
    try {
      const mv = probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      return mv ? { san: mv.san, uci } : null
    } catch {
      return null
    }
  }

  /**
   * Positions are keyed WITHOUT the move clocks, matching how the app looks
   * them up. Keying on the full FEN here let the same position arrive twice
   * by different move orders — a transposition — and the app, keying on four
   * fields, then silently picked whichever the Map happened to hold. Which
   * advice you got depended on generation order, which is no way to run a
   * book.
   */
  const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

  const record = (
    fen: string,
    san: string,
    uci: string,
    opening: string,
    line: string,
    book: boolean,
  ) => {
    if (nodes.has(key(fen))) return
    const w = weighMove(fen, san)
    if (!w) return
    nodes.set(key(fen), {
      fen,
      play: san,
      uci,
      does: w.does,
      costs: w.costs,
      opening,
      line,
      moveNo: Number(fen.split(' ')[5] ?? 1),
      book,
    })
  }

  for (const opening of OPENINGS) {
    if (opening.kind !== 'repertoire') continue
    const you = opening.side === 'white' ? 'w' : 'b'

    for (const line of opening.lines) {
      /*
       * Walk the written line. At each of YOUR turns the book move is the
       * node. At each of THEIRS, branch: follow the written reply, and also
       * cover the other plausible replies with an engine answer.
       */
      const board = new Chess()
      for (let ply = 0; ply < Math.min(line.moves.length, PLIES); ply++) {
        const san = line.moves[ply]!
        const fen = board.fen()
        const toMove = board.turn()

        if (toMove === you) {
          const probe = new Chess(fen)
          let uci = ''
          try {
            const mv = probe.move(san)
            if (mv) uci = `${mv.from}${mv.to}${mv.promotion ?? ''}`
          } catch {
            break
          }
          if (!uci) break
          record(fen, san, uci, opening.name, line.name, true)
        } else {
          /*
           * Their turn. Ask for a wide candidate set, then rank it the way an
           * opponent at OPPONENT_ELO actually would — the same weighting the
           * bots play from — and cover the ones they are genuinely likely to
           * choose rather than the ones the engine likes best.
           */
          const profile = bandProfile(OPPONENT_ELO)
          const analysis = await engine.analyse(fen, {
            depth: DEPTH,
            multipv: Math.max(profile.multipv, BREADTH + 2),
          })
          searches++
          const likely = weighCandidates(fen, analysis.lines, OPPONENT_ELO, 'human')
          const top = likely[0]?.weight ?? 0
          const covering = likely
            .filter((c) => top === 0 || c.weight >= top * REPLY_SHARE)
            .slice(0, BREADTH)

          for (const cand of covering) {
            const probe = new Chess(fen)
            let replySan: string | null = null
            try {
              replySan =
                probe.move({
                  from: cand.uci.slice(0, 2), to: cand.uci.slice(2, 4), promotion: cand.uci[4],
                })?.san ?? null
            } catch {
              replySan = null
            }
            // The written reply is already handled by walking the line.
            if (!replySan || replySan === san) continue

            const answer = await answerFor(probe.fen())
            if (answer) {
              record(probe.fen(), answer.san, answer.uci, opening.name, line.name, false)
            }
          }
        }

        try {
          board.move(san)
        } catch {
          break
        }
      }
      process.stdout.write(`  ${opening.name} / ${line.name}: ${nodes.size} nodes\r`)
    }
    console.log(`  ${opening.name.padEnd(28)} ${nodes.size} nodes so far`)
  }

  const out = {
    generatedAt: new Date().toISOString(),
    config: { plies: PLIES, breadth: BREADTH, depth: DEPTH, opponentElo: OPPONENT_ELO },
    nodes: [...nodes.values()],
  }
  await mkdir(join(root, 'public', 'book'), { recursive: true })
  const file = join(root, 'public', 'book', 'tree.json')
  await writeFile(file, JSON.stringify(out))

  const bookNodes = out.nodes.filter((n) => n.book).length
  console.log('')
  console.log(`  positions covered   ${out.nodes.length}`)
  console.log(`   of which book      ${bookNodes}`)
  console.log(`   engine answers     ${out.nodes.length - bookNodes}`)
  console.log(`  engine searches     ${searches}`)
  console.log(`  written             public/book/tree.json`)
}

void main()
