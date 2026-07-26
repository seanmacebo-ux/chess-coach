/**
 * Board and piece theming.
 *
 * The board is drawn as a generated SVG data URI rather than a shipped PNG.
 * Three reasons: it stays crisp at any board size (phones vary wildly),
 * switching themes is instant with zero network cost, and — the reason this
 * file got rewritten — the MATERIAL can be generated too.
 *
 * On finishes: a chess board that is two flat colours reads as a diagram.
 * Real sets are wood, stone, marble, slate. Those are all just structured
 * noise, and SVG generates noise natively via feTurbulence, so the whole
 * texture layer costs a few hundred bytes of markup instead of a megabyte of
 * PNGs — and it recolours for free, so one wood filter serves walnut, oak,
 * rosewood and ebony.
 *
 * Piece CSS is injected at runtime instead of living in a stylesheet, because
 * the asset path depends on import.meta.env.BASE_URL — which differs between
 * local dev ('/') and GitHub Pages ('/chess-coach/'). Hardcoding it breaks one
 * of the two environments, and relative URLs from a bundled stylesheet are
 * fragile once Vite hashes the CSS into /assets/.
 */

/**
 * The material the board is made of.
 *
 * `flat` is not a lesser option — the classic green/buff board is flat vinyl
 * and that is exactly what most people picture. It stays the default.
 */
export type Finish = 'flat' | 'wood' | 'stone' | 'marble' | 'slate' | 'canvas' | 'metal' | 'glass'

interface FinishSpec {
  label: string
  /** feTurbulence base frequency, "x y". Asymmetry is what makes grain. */
  freq: string
  octaves: number
  type: 'fractalNoise' | 'turbulence'
  /**
   * How far the grain pushes away from neutral. The overlay blend means 0.5
   * grey is a no-op, so this is literally "how much contrast the material has".
   */
  strength: number
  /** Diagonal sheen, 0-1. Only polished materials get one. */
  sheen: number
}

const FINISHES: Record<Finish, FinishSpec> = {
  // No texture at all. Vinyl tournament board.
  flat: { label: 'Flat', freq: '0', octaves: 1, type: 'fractalNoise', strength: 0, sheen: 0 },
  // Long streaks: slow variation across x, fast across y, so the noise bands
  // into lines. This single spec is what makes all four wood boards look sawn.
  wood: { label: 'Wood', freq: '0.004 0.09', octaves: 4, type: 'fractalNoise', strength: 0.5, sheen: 0.06 },
  // Coarse and isotropic — no direction, just mottling.
  stone: { label: 'Stone', freq: '0.016', octaves: 5, type: 'fractalNoise', strength: 0.42, sheen: 0 },
  // Low frequency with high octaves gives the big soft cloud shapes that read
  // as veining rather than dirt.
  marble: { label: 'Marble', freq: '0.005', octaves: 6, type: 'fractalNoise', strength: 0.55, sheen: 0.1 },
  // Fine, faintly directional — riven slate splits along a plane.
  slate: { label: 'Slate', freq: '0.05 0.02', octaves: 3, type: 'fractalNoise', strength: 0.3, sheen: 0 },
  // Tight and square-ish in both axes: a weave.
  canvas: { label: 'Canvas', freq: '0.5 0.5', octaves: 1, type: 'turbulence', strength: 0.22, sheen: 0 },
  // Brushed: very fast in x, very slow in y = hairline horizontal strokes.
  metal: { label: 'Brushed', freq: '0.5 0.003', octaves: 2, type: 'fractalNoise', strength: 0.24, sheen: 0.16 },
  // No grain — glass is defined entirely by its highlight.
  glass: { label: 'Glass', freq: '0', octaves: 1, type: 'fractalNoise', strength: 0, sheen: 0.3 },
}

export interface BoardTheme {
  id: string
  name: string
  light: string
  dark: string
  finish: Finish
  /** Last-move highlight. Warm yellow reads as "this just happened". */
  lastMove: string
  /** Selected-square tint. */
  selected: string
  /** Coordinate label colour on light and dark squares respectively. */
  coordLight: string
  coordDark: string
}

/**
 * Board themes, grouped by material.
 *
 * Existing ids are preserved even where the name changed (`wood` is now
 * "Walnut") — loadTheme() drops any id it doesn't recognise, so renaming an id
 * would silently reset the board of anyone already using it.
 */
export const BOARD_THEMES: BoardTheme[] = [
  /* ---- flat ---- */
  {
    id: 'green', name: 'Tournament', finish: 'flat',
    light: '#EBECD0', dark: '#779556',
    lastMove: 'rgba(247, 236, 116, 0.55)', selected: 'rgba(247, 236, 116, 0.75)',
    coordLight: '#779556', coordDark: '#EBECD0',
  },
  {
    id: 'blue', name: 'Cool', finish: 'flat',
    light: '#DEE3E6', dark: '#8CA2AD',
    lastMove: 'rgba(255, 236, 130, 0.5)', selected: 'rgba(255, 236, 130, 0.7)',
    coordLight: '#8CA2AD', coordDark: '#DEE3E6',
  },
  {
    id: 'ink', name: 'Ink', finish: 'flat',
    light: '#D8DEE4', dark: '#3C5470',
    lastMove: 'rgba(255, 214, 102, 0.45)', selected: 'rgba(255, 214, 102, 0.65)',
    coordLight: '#3C5470', coordDark: '#D8DEE4',
  },

  /* ---- wood ---- */
  {
    id: 'wood', name: 'Walnut', finish: 'wood',
    light: '#E3C79C', dark: '#8B5A34',
    lastMove: 'rgba(255, 233, 127, 0.55)', selected: 'rgba(255, 233, 127, 0.75)',
    coordLight: '#8B5A34', coordDark: '#E3C79C',
  },
  {
    id: 'oak', name: 'Oak', finish: 'wood',
    light: '#F1DEB8', dark: '#B98B54',
    lastMove: 'rgba(255, 233, 127, 0.55)', selected: 'rgba(255, 233, 127, 0.75)',
    coordLight: '#A87B45', coordDark: '#F1DEB8',
  },
  {
    id: 'rosewood', name: 'Rosewood', finish: 'wood',
    light: '#E8C8B4', dark: '#9C4B3C',
    lastMove: 'rgba(255, 226, 140, 0.5)', selected: 'rgba(255, 226, 140, 0.72)',
    coordLight: '#9C4B3C', coordDark: '#E8C8B4',
  },
  {
    id: 'ebony', name: 'Ebony', finish: 'wood',
    light: '#CDBFA4', dark: '#463629',
    lastMove: 'rgba(238, 209, 108, 0.45)', selected: 'rgba(238, 209, 108, 0.68)',
    coordLight: '#463629', coordDark: '#CDBFA4',
  },

  /* ---- stone ---- */
  {
    id: 'basalt', name: 'Basalt', finish: 'stone',
    light: '#BAB5AD', dark: '#4C4A47',
    lastMove: 'rgba(230, 205, 115, 0.45)', selected: 'rgba(230, 205, 115, 0.65)',
    coordLight: '#4C4A47', coordDark: '#BAB5AD',
  },
  {
    id: 'sandstone', name: 'Sandstone', finish: 'stone',
    light: '#EBE0C9', dark: '#A98F65',
    lastMove: 'rgba(255, 232, 130, 0.5)', selected: 'rgba(255, 232, 130, 0.7)',
    coordLight: '#8E7748', coordDark: '#EBE0C9',
  },

  /* ---- marble ---- */
  {
    id: 'marble', name: 'Marble', finish: 'marble',
    light: '#EFECE4', dark: '#9A9187',
    lastMove: 'rgba(255, 226, 120, 0.5)', selected: 'rgba(255, 226, 120, 0.7)',
    coordLight: '#9A9187', coordDark: '#EFECE4',
  },
  {
    id: 'verde', name: 'Verde', finish: 'marble',
    light: '#DFE6D8', dark: '#5C7361',
    lastMove: 'rgba(247, 236, 116, 0.5)', selected: 'rgba(247, 236, 116, 0.7)',
    coordLight: '#5C7361', coordDark: '#DFE6D8',
  },
  {
    id: 'rose', name: 'Rosa', finish: 'marble',
    light: '#F2E2E0', dark: '#A96F6B',
    lastMove: 'rgba(255, 232, 130, 0.5)', selected: 'rgba(255, 232, 130, 0.7)',
    coordLight: '#A96F6B', coordDark: '#F2E2E0',
  },

  /* ---- slate ---- */
  {
    id: 'night', name: 'Night', finish: 'slate',
    light: '#C7C1B8', dark: '#43413D',
    lastMove: 'rgba(220, 200, 110, 0.45)', selected: 'rgba(220, 200, 110, 0.65)',
    coordLight: '#43413D', coordDark: '#C7C1B8',
  },
  {
    id: 'slate', name: 'Slate', finish: 'slate',
    light: '#C4CACE', dark: '#46535C',
    lastMove: 'rgba(240, 218, 120, 0.45)', selected: 'rgba(240, 218, 120, 0.65)',
    coordLight: '#46535C', coordDark: '#C4CACE',
  },

  /* ---- woven / brushed / polished ---- */
  {
    id: 'moss', name: 'Moss', finish: 'canvas',
    light: '#DDE3CE', dark: '#61785A',
    lastMove: 'rgba(247, 236, 116, 0.5)', selected: 'rgba(247, 236, 116, 0.7)',
    coordLight: '#61785A', coordDark: '#DDE3CE',
  },
  {
    id: 'linen', name: 'Linen', finish: 'canvas',
    light: '#EEE8DB', dark: '#A79E8C',
    lastMove: 'rgba(255, 232, 130, 0.5)', selected: 'rgba(255, 232, 130, 0.7)',
    coordLight: '#8C8371', coordDark: '#EEE8DB',
  },
  {
    id: 'steel', name: 'Steel', finish: 'metal',
    light: '#D7DBDE', dark: '#767F86',
    lastMove: 'rgba(255, 226, 120, 0.45)', selected: 'rgba(255, 226, 120, 0.65)',
    coordLight: '#5F686E', coordDark: '#D7DBDE',
  },
  {
    id: 'glass', name: 'Glass', finish: 'glass',
    light: '#DEE9EE', dark: '#6E93A6',
    lastMove: 'rgba(255, 236, 130, 0.5)', selected: 'rgba(255, 236, 130, 0.7)',
    coordLight: '#4E7284', coordDark: '#DEE9EE',
  },
]

/** Grouped for the picker, so materials sit together rather than in one wall. */
export const BOARD_GROUPS: { finish: Finish; label: string; themes: BoardTheme[] }[] = (
  ['flat', 'wood', 'stone', 'marble', 'slate', 'canvas', 'metal', 'glass'] as Finish[]
)
  .map((f) => ({
    finish: f,
    label: FINISHES[f].label,
    themes: BOARD_THEMES.filter((t) => t.finish === f),
  }))
  .filter((g) => g.themes.length > 0)

export interface PieceSet {
  id: string
  name: string
  /** Folder under public/piece/. */
  dir: string
  /** One line on what it actually looks like — the swatch is 44px. */
  blurb: string
  /** Required by the licence — surfaced in Settings. */
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
    id: 'cburnett', name: 'Classic', dir: 'cburnett',
    blurb: 'The Staunton shape everyone pictures. Clean at any size.',
    credit: 'cburnett by Colin M.L. Burnett — GPLv2+',
  },
  {
    id: 'chessnut', name: 'Chessnut', dir: 'chessnut',
    blurb: 'Rounder, heavier, warmer. Reads well on wood.',
    credit: 'Chessnut by Alexis Luengas — Apache 2.0',
  },
  {
    id: 'fantasy', name: 'Fantasy', dir: 'fantasy',
    blurb: 'Carved and ornate. Best on stone and marble.',
    credit: 'Fantasy by Maurizio Monge — MIT',
  },
  {
    id: 'celtic', name: 'Celtic', dir: 'celtic',
    blurb: 'Knotwork detailing. Busy up close, distinctive at a glance.',
    credit: 'Celtic by Maurizio Monge — MIT',
  },
  {
    id: 'spatial', name: 'Spatial', dir: 'spatial',
    blurb: 'Flat geometric shapes. The most legible set on a phone.',
    credit: 'Spatial by Maurizio Monge — MIT',
  },
  {
    id: 'rhosgfx', name: 'Bold', dir: 'rhosgfx',
    blurb: 'Thick outlines, high contrast. Made for small screens.',
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
    id: 'vignette', name: 'Vignette', group: 'Neutral',
    css: 'radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--surface) 70%, transparent), var(--bg) 70%)',
  },
  {
    id: 'paper', name: 'Paper', group: 'Neutral',
    css: `repeating-linear-gradient(0deg, color-mix(in srgb, var(--border) 22%, transparent) 0 1px, transparent 1px 26px),
          repeating-linear-gradient(90deg, color-mix(in srgb, var(--border) 22%, transparent) 0 1px, transparent 1px 26px),
          var(--bg)`,
  },
  {
    id: 'linen-bg', name: 'Linen', group: 'Neutral',
    css: `repeating-linear-gradient(90deg, color-mix(in srgb, var(--border) 26%, transparent) 0 1px, transparent 1px 4px),
          repeating-linear-gradient(0deg, color-mix(in srgb, var(--border) 20%, transparent) 0 1px, transparent 1px 4px),
          var(--bg)`,
  },
  {
    id: 'dusk', name: 'Dusk', group: 'Colour',
    css: 'linear-gradient(170deg, color-mix(in srgb, #6d4b8f 26%, var(--bg)), var(--bg) 55%, color-mix(in srgb, #b4653a 20%, var(--bg)))',
  },
  {
    id: 'ocean', name: 'Ocean', group: 'Colour',
    css: 'linear-gradient(165deg, color-mix(in srgb, #2b6b83 30%, var(--bg)), var(--bg) 60%)',
  },
  {
    id: 'ember', name: 'Ember', group: 'Colour',
    css: 'radial-gradient(100% 70% at 50% 100%, color-mix(in srgb, #c25a2a 26%, var(--bg)), var(--bg) 65%)',
  },
  {
    id: 'aurora', name: 'Aurora', group: 'Colour',
    css: `radial-gradient(70% 50% at 15% 10%, color-mix(in srgb, #2f8f7a 26%, transparent), transparent 70%),
          radial-gradient(60% 50% at 85% 25%, color-mix(in srgb, #5a4b9c 26%, transparent), transparent 70%),
          radial-gradient(80% 40% at 50% 95%, color-mix(in srgb, #2a6b83 20%, transparent), transparent 70%),
          var(--bg)`,
  },
  {
    id: 'plum', name: 'Plum', group: 'Colour',
    css: 'linear-gradient(200deg, color-mix(in srgb, #7d3f63 28%, var(--bg)), var(--bg) 62%)',
  },
  {
    id: 'forest', name: 'Forest', group: 'Nature',
    css: `radial-gradient(90% 60% at 20% 0%, color-mix(in srgb, #3f6b3a 28%, transparent), transparent 70%),
          radial-gradient(80% 60% at 90% 30%, color-mix(in srgb, #2c5230 24%, transparent), transparent 70%),
          var(--bg)`,
  },
  {
    id: 'stone', name: 'Stone', group: 'Nature',
    css: `repeating-linear-gradient(115deg, color-mix(in srgb, var(--surface) 55%, transparent) 0 3px, transparent 3px 9px),
          var(--bg)`,
  },
  {
    id: 'topo', name: 'Contours', group: 'Nature',
    css: `repeating-radial-gradient(circle at 30% 20%, transparent 0 22px, color-mix(in srgb, var(--border) 30%, transparent) 22px 23px),
          var(--bg)`,
  },
  {
    id: 'dunes', name: 'Dunes', group: 'Nature',
    css: `repeating-radial-gradient(ellipse 180% 40% at 50% 120%, color-mix(in srgb, #a98f65 20%, transparent) 0 30px, transparent 30px 62px),
          var(--bg)`,
  },
  {
    id: 'canopy', name: 'Canopy', group: 'Nature',
    css: `repeating-conic-gradient(from 15deg at 30% 40%, color-mix(in srgb, #3f6b3a 16%, transparent) 0% 6%, transparent 6% 14%),
          var(--bg)`,
  },
  {
    id: 'squares', name: 'Chequered', group: 'Chess',
    css: `repeating-conic-gradient(color-mix(in srgb, var(--surface) 45%, transparent) 0% 25%, transparent 0% 50%) 0 / 56px 56px,
          var(--bg)`,
  },
  {
    id: 'diagonal', name: 'Diagonals', group: 'Chess',
    css: `repeating-linear-gradient(45deg, color-mix(in srgb, var(--surface) 50%, transparent) 0 2px, transparent 2px 18px),
          var(--bg)`,
  },
  {
    id: 'files', name: 'Files', group: 'Chess',
    css: `repeating-linear-gradient(90deg, color-mix(in srgb, var(--surface) 60%, transparent) 0 34px, transparent 34px 68px),
          var(--bg)`,
  },
  {
    id: 'knight', name: 'Knight moves', group: 'Chess',
    // The L-shape, tiled: a 2x1 offset lattice.
    css: `repeating-conic-gradient(from 0deg at 25% 25%, color-mix(in srgb, var(--surface) 40%, transparent) 0% 12%, transparent 12% 50%) 0 / 72px 36px,
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

/**
 * Draw the board as an inline SVG data URI, texture and all.
 *
 * `squares` exists because the same generator serves the real 8x8 board and
 * the 44px picker swatches — a full board shrunk to 44px is unreadable mush,
 * so swatches ask for 2. Everything else (colours, grain, sheen) is identical,
 * which is the point: the swatch shows the material, not an approximation.
 *
 * Implementation notes worth keeping:
 *
 *   color-interpolation-filters="sRGB" is not optional. The SVG default is
 *   linearRGB, and every one of these textures comes out grey and washed out
 *   without it.
 *
 *   The grain is blended in OVERLAY against a neutral 0.5 grey, not multiplied.
 *   Multiply can only darken, which makes wood look like a stain rather than a
 *   grain; overlay pushes both ways around neutral, so `strength` reads as
 *   "how much contrast this material has" and 0 is genuinely a no-op.
 *
 *   stitchTiles="stitch" keeps the noise seamless, which matters because the
 *   swatch variant tiles.
 */
export function boardBackground(theme: BoardTheme, squares = 8): string {
  const spec = FINISHES[theme.finish]
  const cell = 100
  const size = squares * cell
  const hasGrain = spec.strength > 0
  const hasSheen = spec.sheen > 0

  // Seed off the id so each theme's grain pattern is its own, but stable
  // across reloads — a board that reshuffles its wood on every render is
  // quietly unsettling.
  const seed = [...theme.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7)

  // Overlay blend is a no-op at 0.5 grey. Averaging the turbulence channels
  // and then contracting toward 0.5 by `strength` gives exactly that knob:
  //   out = 0.5 + strength * (mean(rgb) - 0.5)
  const a = (spec.strength / 3).toFixed(4)
  const b = (0.5 - 0.5 * spec.strength).toFixed(4)

  const defs: string[] = []

  defs.push(
    `<pattern id="sq" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">` +
      `<rect width="${cell * 2}" height="${cell * 2}" fill="${theme.light}"/>` +
      `<rect x="${cell}" y="0" width="${cell}" height="${cell}" fill="${theme.dark}"/>` +
      `<rect x="0" y="${cell}" width="${cell}" height="${cell}" fill="${theme.dark}"/>` +
      `</pattern>`,
  )

  if (hasGrain) {
    defs.push(
      `<filter id="fin" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="${spec.type}" baseFrequency="${spec.freq}" numOctaves="${spec.octaves}" seed="${seed}" stitchTiles="stitch" result="t"/>` +
        `<feColorMatrix in="t" type="matrix" values="${a} ${a} ${a} 0 ${b} ${a} ${a} ${a} 0 ${b} ${a} ${a} ${a} 0 ${b} 0 0 0 0 1" result="grain"/>` +
        `<feBlend in="grain" in2="SourceGraphic" mode="overlay"/>` +
        `</filter>`,
    )
  }

  if (hasSheen) {
    defs.push(
      `<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0%" stop-color="#fff" stop-opacity="${spec.sheen}"/>` +
        `<stop offset="45%" stop-color="#fff" stop-opacity="0"/>` +
        `<stop offset="100%" stop-color="#000" stop-opacity="${(spec.sheen * 0.7).toFixed(3)}"/>` +
        `</linearGradient>`,
    )
  }

  const body =
    `<rect width="${size}" height="${size}" fill="url(#sq)"${hasGrain ? ' filter="url(#fin)"' : ''} shape-rendering="crispEdges"/>` +
    (hasSheen ? `<rect width="${size}" height="${size}" fill="url(#sheen)"/>` : '')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`

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

  const rules: string[] = [pieceRules(pieces)]

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = rules.join('\n')
}

/** The `.cg-wrap piece` rules for a set. Split out so previews can reuse it. */
function pieceRules(pieces: PieceSet): string {
  const base = import.meta.env.BASE_URL
  const out: string[] = []
  for (const [role, letter] of ROLES) {
    for (const [colour, prefix] of [
      ['white', 'w'],
      ['black', 'b'],
    ] as const) {
      out.push(
        `.cg-wrap piece.${role}.${colour}{background-image:url("${base}piece/${pieces.dir}/${prefix}${letter}.svg")}`,
      )
    }
  }
  return out.join('\n')
}

/** Path to one piece image — used by the previews and the set picker. */
export function pieceSrc(set: PieceSet, code: string): string {
  return `${import.meta.env.BASE_URL}piece/${set.dir}/${code}.svg`
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
