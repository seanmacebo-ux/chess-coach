/**
 * Colour maths, so "you can read it" is a measurement rather than a hope.
 *
 * WHY THIS EXISTS. The board coordinates sit on the frame, and the frame is
 * derived from each board's own dark square. That is thirty-two different
 * backgrounds for one text colour, and the rule that set it carried a comment
 * claiming "a light tone always reads". Computed, the worst case was 2.30:1
 * on Parchment — about the contrast of light grey on white.
 *
 * Nobody had done the arithmetic because CSS cannot do it. `color-mix` will
 * blend two colours but it cannot ask how light the result is, so a colour
 * chosen in the stylesheet cannot react to the theme. The theme layer can, so
 * the decision moved here and the stylesheet consumes the answer.
 *
 * WCAG 2.1 relative luminance throughout.
 */

export type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

export function rgbToHex(rgb: Rgb): string {
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** What `color-mix(in srgb, colour <pct>%, #000)` produces. */
export function mixBlack(rgb: Rgb, pct: number): Rgb {
  return rgb.map((c) => c * pct) as Rgb
}

/** ...and toward white. */
export function mixWhite(rgb: Rgb, pct: number): Rgb {
  return rgb.map((c) => c * pct + 255 * (1 - pct)) as Rgb
}

/** Small text. These labels are 10px, so AA rather than AA-large. */
export const MIN_CONTRAST = 4.5

/**
 * The frame colour the stylesheet actually paints, for a given dark square.
 *
 * It is a gradient between 80% and 86% of the dark square toward black. 86%
 * is the lighter end, so that is the one a label has to survive — a worst
 * case, not an average.
 */
export function frameColour(darkSquare: string): Rgb {
  return mixBlack(hexToRgb(darkSquare), 0.86)
}

/**
 * A label colour that is guaranteed to be readable on `frame`.
 *
 * `preferred` is the board's own coordinate tone, used when it clears the bar
 * so the labels keep the board's character. When it does not — which is every
 * pale board, whose frame is mid-tone rather than dark — it falls back to
 * plain white or plain black, whichever the frame is further from.
 *
 * White scores (1.05)/(L+0.05) and black scores (L+0.05)/0.05, and they cross
 * at L = 0.179 where both are 4.58:1. That is the CEILING on what any flat
 * text colour can guarantee against an arbitrary background — you cannot go
 * lighter than white or darker than black — so 4.58 is as strong a promise as
 * this shape of fix can make. Eight-bit rounding of the frame takes the true
 * floor to 4.49, which verify:contrast measures by brute force rather than
 * taking this comment's word for it.
 *
 * Every board that actually ships clears 4.5 (worst: Steel, 4.55). A pale
 * board simply gets dark lettering, which is what a real board with pale trim
 * has anyway.
 */
export function labelOn(frame: Rgb, preferred: Rgb): Rgb {
  if (contrast(preferred, frame) >= MIN_CONTRAST) return preferred
  const white: Rgb = [255, 255, 255]
  const black: Rgb = [0, 0, 0]
  return contrast(white, frame) >= contrast(black, frame) ? white : black
}

/** The coordinate colour for one board, as a hex string. */
export function coordColourFor(board: { dark: string; coordDark: string }): string {
  const frame = frameColour(board.dark)
  // Lifted toward white first: the published tone is meant for a full-strength
  // dark square, and the frame is darker than that, so a little more light
  // keeps the board's character on more of the set.
  return rgbToHex(labelOn(frame, mixWhite(hexToRgb(board.coordDark), 0.45)))
}
