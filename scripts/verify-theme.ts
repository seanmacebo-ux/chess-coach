/**
 * Does every board and piece set on the picker actually exist and work?
 *
 * The picker is generated from data, and data can name a folder that is not
 * there. A set whose files are missing does not error — it renders an empty
 * square where a knight should be, and the person choosing it concludes the
 * app is broken rather than that one set is.
 *
 * That is not hypothetical. Ten sets were added from lichess in one pass and
 * one of them, `disguised`, is stored there as SYMLINKS: the fetch returned
 * twelve files containing the text "w.svg" instead of twelve SVGs, and every
 * byte of it looked like a successful download. This check is what caught it.
 *
 *   npm run verify:theme
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOARD_THEMES, BOARD_GROUPS, PIECE_SETS, PIECE_GROUPS, BACKGROUNDS, PRESETS,
} from '../src/theme/theme'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PIECES = join(root, 'public/piece')
const CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']

let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) { console.log('  FAIL ' + name + '  → ' + detail); fail++ }
}

async function main() {
  /* ------------------------------------------------------- piece files */
  const onDisk = new Set(await readdir(PIECES))
  for (const set of PIECE_SETS) {
    if (!onDisk.has(set.dir)) {
      check(`${set.id} has a folder`, false, `public/piece/${set.dir} is missing`)
      continue
    }
    for (const code of CODES) {
      let body = ''
      try {
        body = await readFile(join(PIECES, set.dir, `${code}.svg`), 'utf8')
      } catch {
        check(`${set.id}/${code}`, false, 'file missing')
        continue
      }
      // A symlink fetched over HTTP arrives as its TARGET PATH in plain text.
      check(`${set.id}/${code} is an SVG`, body.trimStart().startsWith('<svg'),
            `starts with ${JSON.stringify(body.slice(0, 24))}`)
      check(`${set.id}/${code} is not empty`, body.length > 80, `${body.length} bytes`)
    }
  }

  /* ------------------------------------------------------- unused files */
  const declared = new Set(PIECE_SETS.map((p) => p.dir))
  for (const dir of onDisk) {
    check(`public/piece/${dir} is on the picker`, declared.has(dir),
          'folder exists but no PieceSet names it — dead weight in the build')
  }

  /* ----------------------------------------------------------- grouping */
  const grouped = PIECE_GROUPS.flatMap((g) => g.sets.map((s) => s.id))
  check('every set appears in exactly one group',
        new Set(grouped).size === grouped.length && grouped.length === PIECE_SETS.length,
        `${grouped.length} grouped vs ${PIECE_SETS.length} sets`)
  const boardsGrouped = BOARD_GROUPS.flatMap((g) => g.themes.map((t) => t.id))
  check('every board appears in a finish group',
        boardsGrouped.length === BOARD_THEMES.length,
        `${boardsGrouped.length} of ${BOARD_THEMES.length}`)

  /* --------------------------------------------------------- unique ids */
  for (const [what, ids] of [
    ['board', BOARD_THEMES.map((t) => t.id)],
    ['piece set', PIECE_SETS.map((p) => p.id)],
    ['background', BACKGROUNDS.map((b) => b.id)],
  ] as const) {
    check(`${what} ids are unique`, new Set(ids).size === ids.length,
          ids.filter((v, i) => ids.indexOf(v) !== i).join(', '))
  }

  /* ------------------------------------------------------------ presets */
  const boardIds = new Set(BOARD_THEMES.map((t) => t.id))
  const pieceIds = new Set(PIECE_SETS.map((p) => p.id))
  const bgIds = new Set(BACKGROUNDS.map((b) => b.id))
  for (const p of PRESETS) {
    check(`preset "${p.name}" names a real board`, boardIds.has(p.choice.board), p.choice.board)
    check(`preset "${p.name}" names a real piece set`, pieceIds.has(p.choice.pieces), p.choice.pieces)
    check(`preset "${p.name}" names a real background`, bgIds.has(p.choice.background), p.choice.background)
  }

  /* ---------------------------------------------------------- licensing */
  for (const set of PIECE_SETS) {
    // Every set carries its origin and terms. A set with no credit line is a
    // set nobody can check, which is how someone else's art ends up shipped.
    check(`${set.id} states its licence`, /—/.test(set.credit) && set.credit.length > 12,
          set.credit)
  }

  console.log(
    fail === 0
      ? `\n✓ ${BOARD_THEMES.length} boards, ${PIECE_SETS.length} piece sets ` +
        `(${PIECE_SETS.length * 12} files), ${BACKGROUNDS.length} backgrounds, ` +
        `${PRESETS.length} presets — all present and accounted for`
      : `\n✗ ${fail} FAILED`,
  )
  process.exit(fail === 0 ? 0 : 1)
}

void main()
