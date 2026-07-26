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
  {
    id: 'marble',
    name: 'Marble',
    light: '#E9E5DC',
    dark: '#9A9187',
    lastMove: 'rgba(255, 226, 120, 0.5)',
    selected: 'rgba(255, 226, 120, 0.7)',
    coordLight: '#9A9187',
    coordDark: '#E9E5DC',
  },
  {
    id: 'ink',
    name: 'Ink',
    light: '#D8DEE4',
    dark: '#3C5470',
    lastMove: 'rgba(255, 214, 102, 0.45)',
    selected: 'rgba(255, 214, 102, 0.65)',
    coordLight: '#3C5470',
    coordDark: '#D8DEE4',
  },
  {
    id: 'moss',
    name: 'Moss',
    light: '#DDE3CE',
    dark: '#61785A',
    lastMove: 'rgba(247, 236, 116, 0.5)',
    selected: 'rgba(247, 236, 116, 0.7)',
    coordLight: '#61785A',
    coordDark: '#DDE3CE',
  },
  {
    id: 'rose',
    name: 'Rose',
    light: '#F0DFDD',
    dark: '#A96F6B',
    lastMove: 'rgba(255, 232, 130, 0.5)',
    selected: 'rgba(255, 232, 130, 0.7)',
    coordLight: '#A96F6B',
    coordDark: '#F0DFDD',
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

/**
 * Piece sets.
 *
 * Only permissively-licensed sets are shipped. Most of the best-looking
 * lichess sets (maestro, staunty, california, cardinal, anarcandy...) are
 * CC BY-NC-SA — non-commercial only. They'd be fine for personal use, but
 * Sean deliberately took the MIT path on the engine to keep future options
 * open, and quietly baking a non-commercial restriction into the art would
 * undo that decision without him knowing.
 */
export const PIECE_SETS: PieceSet[] = [
  {
    id: 'cburnett',
    name: 'Classic',
    dir: 'cburnett',
    credit: 'cburnett by Colin M.L. Burnett — GPLv2+',
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    dir: 'fantasy',
    credit: 'Fantasy by Maurizio Monge — MIT',
  },
  {
    id: 'celtic',
    name: 'Celtic',
    dir: 'celtic',
    credit: 'Celtic by Maurizio Monge — MIT',
  },
  {
    id: 'spatial',
    name: 'Spatial',
    dir: 'spatial',
    credit: 'Spatial by Maurizio Monge — MIT',
  },
  {
    id: 'chessnut',
    name: 'Chessnut',
    dir: 'chessnut',
    credit: 'Chessnut by Alexis Luengas — Apache 2.0',
  },
  {
    id: 'rhosgfx',
    name: 'Bold',
    dir: 'rhosgfx',
    credit: 'RhosGFX — CC0 (public domain)',
  },
]

/* ------------------------------------------------------------------ */
/* Backgrounds                                                         */
/* ------------------------------------------------------------------ */

export interface Background {
  id: string
  name: string
  group: 'Neutral' | 'Colour' | 'Nature' | 'Chess'
  /** CSS background value. Uses theme tokens so it adapts to light/dark. */
  css: string
}

/**
 * Backgrounds are generated in CSS, not shipped as images.
 *
 * Three reasons that's the right call here rather than laziness: nothing to
 * download so the PWA stays installable over mobile data, nothing to license
 * so there's no repeat of the piece-set problem, and they can reference the
 * theme tokens directly — so every one of these works in light AND dark
 * without a second variant.
 *
 * All are deliberately low-contrast. This sits behind a chess board you stare
 * at for fifteen minutes; a busy background is actively hostile.
 */
export const BACKGROUNDS: Background[] = [
  { id: 'plain', name: 'Plain', group: 'Neutral', css: 'var(--bg)' },
  {
    id: 'vignette',
    name: 'Vignette',
    group: 'Neutral',
    css: 'radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--surface) 70%, transparent), var(--bg) 70%)',
  },
  {
    id: 'paper',
    name: 'Paper',
    group: 'Neutral',
    css: `repeating-linear-gradient(0deg, color-mix(in srgb, var(--border) 22%, transparent) 0 1px, transparent 1px 26px),
          repeating-linear-gradient(90deg, color-mix(in srgb, var(--border) 22%, transparent) 0 1px, transparent 1px 26px),
          var(--bg)`,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    group: 'Colour',
    css: 'linear-gradient(170deg, color-mix(in srgb, #6d4b8f 26%, var(--bg)), var(--bg) 55%, color-mix(in srgb, #b4653a 20%, var(--bg)))',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    group: 'Colour',
    css: 'linear-gradient(165deg, color-mix(in srgb, #2b6b83 30%, var(--bg)), var(--bg) 60%)',
  },
  {
    id: 'ember',
    name: 'Ember',
    group: 'Colour',
    css: 'radial-gradient(100% 70% at 50% 100%, color-mix(in srgb, #c25a2a 26%, var(--bg)), var(--bg) 65%)',
  },
  {
    id: 'forest',
    name: 'Forest',
    group: 'Nature',
    css: `radial-gradient(90% 60% at 20% 0%, color-mix(in srgb, #3f6b3a 28%, transparent), transparent 70%),
          radial-gradient(80% 60% at 90% 30%, color-mix(in srgb, #2c5230 24%, transparent), transparent 70%),
          var(--bg)`,
  },
  {
    id: 'stone',
    name: 'Stone',
    group: 'Nature',
    css: `repeating-linear-gradient(115deg, color-mix(in srgb, var(--surface) 55%, transparent) 0 3px, transparent 3px 9px),
          var(--bg)`,
  },
  {
    id: 'topo',
    name: 'Contours',
    group: 'Nature',
    css: `repeating-radial-gradient(circle at 30% 20%, transparent 0 22px, color-mix(in srgb, var(--border) 30%, transparent) 22px 23px),
          var(--bg)`,
  },
  {
    id: 'squares',
    name: 'Chequered',
    group: 'Chess',
    css: `repeating-conic-gradient(color-mix(in srgb, var(--surface) 45%, transparent) 0% 25%, transparent 0% 50%) 0 / 56px 56px,
          var(--bg)`,
  },
  {
    id: 'diagonal',
    name: 'Diagonals',
    group: 'Chess',
    css: `repeating-linear-gradient(45deg, color-mix(in srgb, var(--surface) 50%, transparent) 0 2px, transparent 2px 18px),
          var(--bg)`,
  },
]

export function backgroundById(id: string): Background {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]!
}

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
export function applyTheme(board: BoardTheme, pieces: PieceSet, background?: Background): void {
  const root = document.documentElement
  root.style.setProperty('--board-bg', boardBackground(board))
  if (background) root.style.setProperty('--page-bg', background.css)
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
  background: string
}

const KEY = 'cc.theme'
const DEFAULT: ThemeChoice = { board: 'green', pieces: 'cburnett', background: 'vignette' }

export function loadTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<ThemeChoice>
    // Each field validated independently — an unknown id (a set removed for
    // licensing, say) falls back on its own rather than resetting everything.
    return {
      board: BOARD_THEMES.some((t) => t.id === parsed.board) ? parsed.board! : DEFAULT.board,
      pieces: PIECE_SETS.some((p) => p.id === parsed.pieces) ? parsed.pieces! : DEFAULT.pieces,
      background: BACKGROUNDS.some((b) => b.id === parsed.background)
        ? parsed.background!
        : DEFAULT.background,
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

export function resolveTheme(choice: ThemeChoice): {
  board: BoardTheme
  pieces: PieceSet
  background: Background
} {
  return {
    board: BOARD_THEMES.find((t) => t.id === choice.board) ?? BOARD_THEMES[0]!,
    pieces: PIECE_SETS.find((p) => p.id === choice.pieces) ?? PIECE_SETS[0]!,
    background: backgroundById(choice.background),
  }
}
