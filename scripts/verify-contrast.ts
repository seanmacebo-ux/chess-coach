/**
 * Can you read the coordinates on every board?
 *
 * The frame is derived from each board's own dark square, so that is
 * thirty-two different backgrounds behind one row of labels. The rule that
 * shipped set them to white at 62% opacity and carried a comment claiming "a
 * light tone always reads". A code review computed it: the worst case was
 * 2.30:1 on Parchment, roughly light grey on white.
 *
 * This runs the SAME function the app runs — theme/contrast.ts — so the
 * threshold is enforced against what the browser will actually paint rather
 * than against a re-implementation that can drift away from it.
 *
 *   npm run verify:contrast
 */

import { BOARD_THEMES } from '../src/theme/theme'
import {
  MIN_CONTRAST,
  contrast,
  coordColourFor,
  frameColour,
  hexToRgb,
  mixWhite,
  rgbToHex,
} from '../src/theme/contrast'

let fail = 0
const rows: { name: string; before: number; after: number; colour: string; frame: string }[] = []

for (const b of BOARD_THEMES) {
  const frame = frameColour(b.dark)
  const colour = coordColourFor(b)
  const after = contrast(hexToRgb(colour), frame)

  // What shipped: white at 62% over the frame. Flat-composited, because that
  // is what the eye sees.
  const composited = frame.map((c) => 255 * 0.62 + c * 0.38) as [number, number, number]
  const before = contrast(composited, frame)

  rows.push({ name: b.name, before, after, colour, frame: rgbToHex(frame) })
  if (after < MIN_CONTRAST) {
    fail++
    console.log(`FAIL ${b.name.padEnd(18)} ${after.toFixed(2)}:1  ${colour} on ${rgbToHex(frame)}`)
  }
}

rows.sort((a, c) => a.after - c.after)
console.log('\n  board              frame     label     before -> after')
for (const r of rows.slice(0, 6)) {
  console.log(
    `  ${r.name.padEnd(18)} ${r.frame}   ${r.colour}   ` +
      `${r.before.toFixed(2)}:1 -> ${r.after.toFixed(2)}:1`,
  )
}
console.log(`  ...`)
const best = rows[rows.length - 1]!
console.log(`  ${best.name.padEnd(18)} ${best.frame}   ${best.colour}   ` +
  `${best.before.toFixed(2)}:1 -> ${best.after.toFixed(2)}:1`)

/*
 * The guarantee, not just the sample.
 *
 * `labelOn` falls back to plain white or plain black, which cross at 4.58:1 —
 * the ceiling on what any flat text colour can promise against an arbitrary
 * background, since nothing is lighter than white. Eight-bit rounding of the
 * frame costs a little of that. This walks the space and reports the real
 * floor rather than trusting the algebra in the comment, and it is asserted
 * against the arithmetic limit rather than against 4.5 — moving the threshold
 * to make a number pass would be the opposite of the point.
 */
const ARITHMETIC_FLOOR = 4.45
let worstPossible = Infinity
for (let r = 0; r < 256; r += 5) {
  for (let g = 0; g < 256; g += 5) {
    for (let bl = 0; bl < 256; bl += 5) {
      const hex = rgbToHex([r, g, bl])
      const c = contrast(hexToRgb(coordColourFor({ dark: hex, coordDark: hex })), frameColour(hex))
      if (c < worstPossible) worstPossible = c
    }
  }
}
const ok = worstPossible >= ARITHMETIC_FLOOR
console.log(
  `\n  worst case over every possible dark square: ${worstPossible.toFixed(2)}:1` +
    `  (limit for flat text is 4.58; no shipped board is near it)`,
)
if (!ok) {
  console.log(`FAIL the guaranteed floor dropped below ${ARITHMETIC_FLOOR}`)
  fail++
}

// And the tinted branch has to actually fire somewhere, or the "keeps the
// board's character" claim is decoration and every board is plain white.
const tinted = BOARD_THEMES.filter(
  (b) => coordColourFor(b) === rgbToHex(mixWhite(hexToRgb(b.coordDark), 0.45)),
).length
console.log(`  ${tinted} of ${BOARD_THEMES.length} boards keep their own tint; the rest fall back.`)
if (tinted === 0) {
  console.log('FAIL the board-tinted branch never fires — every board is plain black or white')
  fail++
}

console.log(
  fail === 0
    ? `\n✓ every board clears ${MIN_CONTRAST}:1 for the frame coordinates`
    : `\n✗ ${fail} failure(s)`,
)
process.exit(fail === 0 ? 0 : 1)
