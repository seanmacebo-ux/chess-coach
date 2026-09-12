/**
 * Is every node in the shipped opening tree actually playable?
 *
 * The tree is generated, which is exactly why it needs checking: a generator
 * bug does not look like a bug, it looks like confident advice. This walks
 * every node in public/book/tree.json and asserts the things that would be
 * invisible in the app and wrong on the board.
 *
 *   npm run verify:tree
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'

import type { TreeNode } from '../src/content/tree'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const raw = await readFile(join(root, 'public', 'book', 'tree.json'), 'utf8')
  const data = JSON.parse(raw) as { nodes: TreeNode[]; config: unknown }
  const nodes = data.nodes

  const problems: string[] = []
  const seen = new Set<string>()

  for (const n of nodes) {
    const where = `${n.opening}/${n.line} move ${n.moveNo} (${n.play})`

    // The position must load.
    let chess: Chess
    try {
      chess = new Chess(n.fen)
    } catch (err) {
      problems.push(`${where}: position will not load — ${String(err)}`)
      continue
    }

    // The move must be legal here. This is the one that would hand him an
    // arrow pointing at a move he cannot make.
    let mv
    try {
      mv = chess.move(n.play)
    } catch {
      mv = null
    }
    if (!mv) {
      problems.push(`${where}: "${n.play}" is not legal in this position`)
      continue
    }

    // The UCI the board draws must be the same move as the SAN it names.
    const uci = `${mv.from}${mv.to}${mv.promotion ?? ''}`
    if (uci !== n.uci) {
      problems.push(`${where}: uci ${n.uci} does not match san ${n.play} (${uci})`)
    }

    // Every node has to say something, or the panel renders empty.
    if (n.does.length === 0) problems.push(`${where}: no reasons given`)
    if (n.costs.length === 0) problems.push(`${where}: no costs given`)

    /*
     * A king-safety claim before anyone has castled is the specific fiction
     * that shipped once already: after 1.e4 the e2 square is empty, so a
     * naive shield count called 2.d4 an attack on his own king.
     */
    const castled = n.fen.includes('KQ') || n.fen.includes('kq')
    if (n.moveNo <= 6 && n.costs.some((c) => /pawn cover/.test(c))) {
      problems.push(`${where}: claims a king-safety cost on move ${n.moveNo}`)
    }
    void castled

    // Duplicate positions mean the map silently drops one of them.
    const key = n.fen.split(' ').slice(0, 4).join(' ')
    if (seen.has(key)) problems.push(`${where}: duplicate position`)
    seen.add(key)
  }

  const book = nodes.filter((n) => n.book).length
  console.log(`  nodes            ${nodes.length}`)
  console.log(`   written book    ${book}`)
  console.log(`   generated       ${nodes.length - book}`)
  console.log(`  unique positions ${seen.size}`)
  console.log('')

  if (problems.length > 0) {
    for (const p of problems.slice(0, 25)) console.log('  FAIL ' + p)
    if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more`)
    console.log(`\n${problems.length} problems`)
    process.exit(1)
  }
  console.log('OK — every node loads, is legal, matches its own UCI, and explains itself')
}

void main()
