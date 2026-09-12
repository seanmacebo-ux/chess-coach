/**
 * The generated opening tree, loaded on demand.
 *
 * Built by scripts/build-opening-tree.ts and shipped as public/book/tree.json
 * — 46KB, fetched once and cached by the service worker like the puzzle
 * bands, so it costs nothing until the first opening game and works offline
 * after that.
 *
 * WHY IT EXISTS. The hand-written repertoire in openings.ts is one fixed
 * sequence per line, so the coached game lost the book the instant either
 * side played something off-script — which at 700 is move three of every
 * game. This is keyed by POSITION instead, so a deviation finds the new
 * position rather than falling off the end.
 */

export interface TreeNode {
  fen: string
  play: string
  uci: string
  does: string[]
  costs: string[]
  opening: string
  line: string
  moveNo: number
  book: boolean
}

let cache: Map<string, TreeNode> | null = null
let inflight: Promise<Map<string, TreeNode>> | null = null

/**
 * Positions are matched WITHOUT the move clocks.
 *
 * The same position reached by a different move order has different halfmove
 * and fullmove counters, and keying on the full FEN would miss every
 * transposition — which is most of what a tree is for.
 */
function key(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

export async function loadTree(): Promise<Map<string, TreeNode>> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}book/tree.json`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { nodes: TreeNode[] }
      cache = new Map(data.nodes.map((n) => [key(n.fen), n]))
    } catch {
      // No tree is a degraded coached game, not a broken one — the loop
      // still works, it just has no book move to point at.
      cache = new Map()
    }
    return cache
  })()
  return inflight
}

/** The move to play in this position, if the tree knows one. */
export function lookup(tree: Map<string, TreeNode>, fen: string): TreeNode | null {
  return tree.get(key(fen)) ?? null
}
