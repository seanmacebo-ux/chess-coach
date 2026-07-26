/**
 * Board and piece theming.
 *
 * The board is drawn as a generated SVG data URI rather than a shipped PNG.
 * Two reasons: it stays crisp at any board size (phones vary wildly), and
 * switching themes is instant with zero network cost.
 *
 * Piece CSS is injected at runtime instead of living in a stylesheet, because
 * the asset path depends on import.meta.env.BASE_URL — which differs between
 * local dev ('/') and GitHub Pages ('/chess-coach/'). Hardcoding it breaks one
 * of the two environments, and relative URLs from a bundled stylesheet are
 * fragile once Vite hashes the CSS into /assets/.
 */

export interface BoardTheme {
  id: string
  name: string
  light: string
  dark: string
  /** Last-move highlight. Warm yellow reads as "this just happened". */
  lastMove: string
  /** Selected-square tint. */
  selected: string
  /** Coordinate label colour on light and dark squares respectively. */
  coordLight: string
  coordDark: string
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'green',
    name: 'Green',
    light: '#EBECD0',
    dark: '#779556',
    lastMove: 'rgba(247, 236, 116, 0.55)',
    selected: 'rgba(247, 236, 116, 0.75)',
    coordLight: '#779556',
    coordDark: '#EBECD0',
  },
  {
    id: 'wood',
    name: 'Wood',
    light: '#E8D0AA',
    dark: '#B58863',
    lastMove: 'rgba(255, 233, 127, 0.55)',
    selected: 'rgba(255, 233, 127, 0.75)',
    coordLight: '#B58863',
    coordDark: '#E8D0AA',
  },
  {
    id: 'blue',
    name: 'Blue',
    light: '#DEE3E6',
    dark: '#8CA2AD',
    lastMove: 'rgba(255, 236, 130, 0.5)',
    selected: 'rgba(255, 236, 130, 0.7)',
    coordLight: '#8CA2AD',
    coordDark: '#DEE3E6',
  },
  {
    id: 'night',
    name: 'Night',
    light: '#C7C1B8',
    dark: '#4A4844',
    lastMove: 'rgba(220, 200, 110, 0.45)',
    selected: 'rgba(220, 200, 110, 0.65)',
    coordLight: '#4A4844',
    coordDark: '#C7C1B8',
  },
]

export interface PieceSet {
  id: string
  name: string
  /** Folder under public/piece/. */
  dir: string
  /** Required by the licence — surfaced in the About screen. */
  credit: string
}

export const PIECE_SETS: PieceSet[] = [
  {
    id: 'cburnett',
    name: 'Classic',
    dir: 'cburnett',
    credit: 'cburnett by Colin M.L. Burnett — CC BY-SA 3.0',
  },
]

/* ------------------------------------------------------------------ */

const ROLES = [
  ['pawn', 'P'],
  ['knight', 'N'],
  ['bishop', 'B'],
  ['rook', 'R'],
  ['queen', 'Q'],
  ['king', 'K'],
] as const

/** Build the 8x8 checkerboard as an inline SVG data URI. */
export function boardBackground(theme: BoardTheme): string {
  // One 2x2-square tile, repeated by background-size. Smaller payload than
  // emitting all 64 rects and identical output.
  //
  // Orientation matters: the tile's top-left corner lands on a8, and a8 is a
  // LIGHT square in real chess (a1 and h8 are dark). So the dark squares go
  // top-right and bottom-left of the tile, not on the diagonal from origin.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" shape-rendering="crispEdges">` +
    `<rect width="2" height="2" fill="${theme.light}"/>` +
    `<rect x="1" y="0" width="1" height="1" fill="${theme.dark}"/>` +
    `<rect x="0" y="1" width="1" height="1" fill="${theme.dark}"/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const STYLE_ID = 'cc-theme'

/**
 * Apply a theme by writing CSS custom properties and regenerating the piece
 * rules. Safe to call on every change — it replaces the single style element
 * rather than accumulating them.
 */
export function applyTheme(board: BoardTheme, pieces: PieceSet): void {
  const root = document.documentElement
  root.style.setProperty('--board-bg', boardBackground(board))
  root.style.setProperty('--sq-light', board.light)
  root.style.setProperty('--sq-dark', board.dark)
  root.style.setProperty('--sq-lastmove', board.lastMove)
  root.style.setProperty('--sq-selected', board.selected)
  root.style.setProperty('--coord-light', board.coordLight)
  root.style.setProperty('--coord-dark', board.coordDark)

  const base = import.meta.env.BASE_URL
  const rules: string[] = []
  for (const [role, letter] of ROLES) {
    for (const [colour, prefix] of [
      ['white', 'w'],
      ['black', 'b'],
    ] as const) {
      rules.push(
        `.cg-wrap piece.${role}.${colour}{background-image:url("${base}piece/${pieces.dir}/${prefix}${letter}.svg")}`,
      )
    }
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = rules.join('\n')
}

/* ------------------------------------------------------------------ */

export interface ThemeChoice {
  board: string
  pieces: string
}

const KEY = 'cc.theme'
const DEFAULT: ThemeChoice = { board: 'green', pieces: 'cburnett' }

export function loadTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<ThemeChoice>
    return {
      board: BOARD_THEMES.some((t) => t.id === parsed.board) ? parsed.board! : DEFAULT.board,
      pieces: PIECE_SETS.some((p) => p.id === parsed.pieces) ? parsed.pieces! : DEFAULT.pieces,
    }
  } catch {
    return DEFAULT
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice))
  } catch {
    /* private browsing — theme just won't persist */
  }
}

export function resolveTheme(choice: ThemeChoice): { board: BoardTheme; pieces: PieceSet } {
  return {
    board: BOARD_THEMES.find((t) => t.id === choice.board) ?? BOARD_THEMES[0]!,
    pieces: PIECE_SETS.find((p) => p.id === choice.pieces) ?? PIECE_SETS[0]!,
  }
}
