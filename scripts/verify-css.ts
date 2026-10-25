/**
 * Does the design system hold?
 *
 * This repo verifies chess facts to three decimal places and verified its
 * design not at all — which is why an audit found, in one stylesheet:
 *
 *   - TWO bare `:root` blocks, 3700 lines apart, the second silently
 *     re-declaring --bg, --surface, --surface-hi and --border with different
 *     values. The palette you read at the top of the file was not the palette
 *     that shipped.
 *   - `.card` setting a tuned two-layer shadow, then a later rule re-setting
 *     it to var(--e2) at equal specificity — so the dark-mode inset was dead
 *     code while light mode's higher-specificity copy still won. Cards were
 *     shadowed differently per theme by accident.
 *   - The six pillar colours typed out FOUR times, three of them as raw hex,
 *     with no light-mode variant anywhere.
 *   - `background: var(--dot, var(--muted))` — `--muted` has never existed in
 *     this file, so an untoned dot rendered with no background at all.
 *   - 806 raw px against 125 token uses; 45% of type off-scale across 25
 *     extra sizes.
 *
 * Every one of those is a BUG rather than a matter of taste, and every one is
 * mechanically detectable. So: detect them. The point is not tidiness, it is
 * that a system nobody checks drifts, and this file is where the drift gets
 * caught before it ships.
 *
 *   npm run verify:css
 */

import { readFileSync } from 'node:fs'

const PATH = 'src/styles/app.css'
const src = readFileSync(PATH, 'utf8')

/*
 * Comments are blanked rather than removed, so every offset still maps to the
 * line it came from — a verifier that reports the wrong line number costs more
 * time than it saves.
 */
const bare = (() => {
  const out = src.split('')
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === '/' && out[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? out.length : end + 2
      for (let j = i; j < stop; j++) if (out[j] !== '\n') out[j] = ' '
      i = stop - 1
    }
  }
  return out.join('')
})()

const lineOf = (offset: number): number => bare.slice(0, offset).split('\n').length

let fail = 0
const problems: string[] = []
function check(ok: boolean, message: string): void {
  if (ok) return
  fail++
  problems.push(message)
}

console.log(`${PATH} — ${src.split('\n').length} lines\n`)

/* ---------------------------------------------------------------- 1. one :root
 *
 * A bare `:root` is the token layer. There is one. Re-pointing per theme is a
 * QUALIFIED :root — :root:not([data-theme='dark']) inside a media query, or
 * :root[data-theme='…'] — and those are allowed because they cannot be
 * mistaken for the definition.
 */
const bareRoots = [...bare.matchAll(/(^|\n)\s*:root\s*\{/g)].map((m) => lineOf(m.index! + 1))
console.log(`1. bare :root blocks: ${bareRoots.length} (line ${bareRoots.join(', ')})`)
check(
  bareRoots.length === 1,
  `${bareRoots.length} bare :root blocks (lines ${bareRoots.join(', ')}) — a second one` +
    ` re-declares the palette out of sight of the first. Qualify it, or merge it.`,
)

/* ------------------------------------------------- 2. the token layer boundary
 *
 * Everything above the universal selector is the token layer; below it is
 * components. A raw hex below the line is a palette entry with no name and no
 * light-mode variant.
 *
 * #000 and #fff are exempt: in `color-mix(… , #000)` and in a mask gradient
 * they are arithmetic, not colour choices.
 */
const boundary = bare.indexOf('\n* {')
check(boundary > 0, 'cannot find the `* {` reset that separates tokens from components')
const MECHANICAL = /^#(?:000|fff|000000|ffffff)$/i
const strayHex = [...bare.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
  .filter((m) => m.index! > boundary && !MECHANICAL.test(m[0]))
  .map((m) => `${m[0]} at line ${lineOf(m.index!)}`)
console.log(`2. raw hex below the token layer: ${strayHex.length}`)
check(
  strayHex.length === 0,
  `raw hex outside the token layer — these never re-point for light mode:\n     ` +
    strayHex.join('\n     '),
)

/* -------------------------------------------------------------- 3. type scale
 *
 * Every font-size is a step on the scale. One decorative glyph is not text and
 * says so on its own line; the budget is there so "off-scale" cannot quietly
 * become the way sizes are set.
 */
const OFF_SCALE_BUDGET = 1
const sizes = [...bare.matchAll(/font-size:\s*([^;]+);/g)]
const offScale: string[] = []
let excused = 0
for (const m of sizes) {
  const value = m[1].trim()
  if (/^var\(--t-/.test(value) || value === 'inherit' || value.endsWith('%')) continue
  const line = lineOf(m.index!)
  if (/\/\* off-scale:/.test(src.split('\n')[line - 1] ?? '')) {
    excused++
    continue
  }
  offScale.push(`${value} at line ${line}`)
}
console.log(
  `3. font-size: ${sizes.length} declarations, ${offScale.length} off the scale,` +
    ` ${excused} excused (budget ${OFF_SCALE_BUDGET})`,
)
check(
  offScale.length === 0,
  `font-size off the type scale — add a token or mark it ` +
    `\`/* off-scale: why */\`:\n     ` + offScale.join('\n     '),
)
check(
  excused <= OFF_SCALE_BUDGET,
  `${excused} off-scale exceptions, budget is ${OFF_SCALE_BUDGET}. Raising the` +
    ` budget is a decision, not a fix — take it deliberately.`,
)

/* ------------------------------------------------------------ 4. corner ramp */
const radii = [...bare.matchAll(/border-radius:\s*([^;]+);/g)]
const strayRadii = radii
  .filter((m) => {
    const v = m[1].trim()
    if (v === '50%' || v === '0' || v === 'inherit') return false
    // Every length in the value has to be a token, a percentage, or inside a
    // calc() that is itself anchored on a token.
    return !v
      .split(/\s+/)
      .every((part) => /var\(--radius/.test(part) || /^(0|50%|100%)$/.test(part) || /^calc\(/.test(v))
  })
  .map((m) => `${m[1].trim()} at line ${lineOf(m.index!)}`)
console.log(`4. border-radius: ${radii.length} declarations, ${strayRadii.length} off the ramp`)
check(strayRadii.length === 0, `border-radius off the corner ramp:\n     ` + strayRadii.join('\n     '))

/* ------------------------------------------------------- 5. the spacing ratchet
 *
 * Spacing is the one dimension that is not clean, and pretending otherwise
 * would be the kind of claim this file exists to stop. 221 declarations sat
 * off the 4pt grid; what is left are negative offsets, which a token cannot
 * express without a calc() noisier than the number it replaces, and one
 * alignment constant.
 *
 * So: a ratchet rather than a rule. The count may fall and may not rise.
 */
/*
 * Nine: eight negative offsets — half-pixel centring and the negative margins
 * that pull a grid's gutters back off its edges, which `calc(var(--s1) * -1)`
 * makes longer rather than clearer — and one 54px indent that aligns a
 * continuation under a move list.
 */
const SPACING_BUDGET = 9
const spacingProps = /(?:^|[;{\s])((?:padding|margin|gap|row-gap|column-gap)(?:-top|-right|-bottom|-left)?):\s*([^;}]+)[;}]/g
const rawSpacing: string[] = []
for (const m of bare.matchAll(spacingProps)) {
  const value = m[2].trim()
  if (/\(/.test(value)) continue // calc()/var()/env() — the var() case is the point
  if (!/-?\d*\.?\d+px/.test(value)) continue
  rawSpacing.push(`${m[1]}: ${value} at line ${lineOf(m.index!)}`)
}
console.log(`5. raw-px spacing: ${rawSpacing.length} declarations (budget ${SPACING_BUDGET})`)
check(
  rawSpacing.length <= SPACING_BUDGET,
  `${rawSpacing.length} raw-px spacing declarations against a budget of ` +
    `${SPACING_BUDGET}. The ratchet only turns one way:\n     ` + rawSpacing.join('\n     '),
)

/* ------------------------------------------------------- 6. a component, twice
 *
 * Two selectors with the same declarations are one component built twice, and
 * the copies drift: `.act-stat*` and `.them-stat*` differed by 0.01em of
 * letter-spacing and nothing else, `.rchip` was a whole rating chip with no
 * markup behind it.
 *
 * Three declarations is the floor — below that, two rules agreeing is a
 * coincidence rather than a component.
 *
 * Bodies made ONLY of layout are exempt, and that is a judgement rather than
 * a loophole: `display: flex; flex-direction: column; gap: var(--s2)` is a
 * shape, and eight unrelated components wanting the same shape is not
 * duplication in any sense worth fixing — collapsing them would couple a
 * progress panel to a game-review panel because both happen to stack. What
 * makes a repeat a COMPONENT is that it also decides typography or colour,
 * and that is the line drawn here. (The layout shapes do want a real stack
 * utility with a gap modifier, which is a markup change across thirteen
 * components and therefore its own pass.)
 */
const LAYOUT_ONLY = new Set([
  'display',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'gap',
  'row-gap',
  'column-gap',
  'align-content',
  'align-items',
  'align-self',
  'justify-content',
  'justify-items',
  'justify-self',
  'grid',
  'grid-auto-flow',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'order',
])
const isShape = (body: string): boolean =>
  body
    .split(';')
    .map((d) => d.split(':')[0]?.trim())
    .filter(Boolean)
    .every((prop) => LAYOUT_ONLY.has(prop!))
const rules: { selector: string; body: string; line: number }[] = []
{
  let depth = 0
  let selStart = 0
  const stack: { selector: string; bodyStart: number }[] = []
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i]
    if (c === '{') {
      const selector = bare.slice(selStart, i).trim()
      stack.push({ selector, bodyStart: i + 1 })
      depth++
      selStart = i + 1
    } else if (c === '}') {
      const open = stack.pop()
      depth--
      if (open && !open.selector.startsWith('@')) {
        const body = bare.slice(open.bodyStart, i)
        // Only leaf rules: a body containing another block is a nesting
        // context, and its "declarations" are someone else's.
        if (!body.includes('{')) {
          rules.push({
            selector: open.selector.replace(/\s+/g, ' '),
            body: body
              .split(';')
              .map((d) => d.trim())
              .filter(Boolean)
              .join('; '),
            line: lineOf(open.bodyStart),
          })
        }
      }
      selStart = i + 1
    }
    void depth
  }
}
const byBody = new Map<string, { selector: string; line: number }[]>()
let shapes = 0
for (const r of rules) {
  if (r.body.split(';').length < 3) continue
  if (isShape(r.body)) {
    shapes++
    continue
  }
  const key = r.body
  if (!byBody.has(key)) byBody.set(key, [])
  byBody.get(key)!.push({ selector: r.selector, line: r.line })
}
const twins = [...byBody.values()].filter((g) => g.length > 1)
console.log(
  `6. leaf rules: ${rules.length}, ${shapes} layout-only (exempt),` +
    ` components built twice: ${twins.length}`,
)
check(
  twins.length === 0,
  `the same component, built more than once — merge, or give the copies a` +
    ` reason to differ:\n     ` +
    twins
      .map((g) => g.map((x) => `${x.selector} (line ${x.line})`).join('  ==  '))
      .join('\n     '),
)

/* ----------------------------------------------------- 7. every var() resolves
 *
 * This is the one that found a real rendering bug: `var(--dot, var(--muted))`
 * on `.tone-dot`. `--muted` is not a token in this file and never was, so an
 * untoned dot had no background whatsoever — invisible, silently, for as long
 * as the rule existed.
 *
 * A var() with a fallback is still checked, because a fallback nobody chose is
 * not a fallback.
 */
const RUNTIME = new Set([
  '--board-bg',
  '--coord-dark',
  '--coord-frame',
  '--coord-light',
  '--page-bg',
  '--sq-dark',
  '--sq-light',
  '--sq-lastmove',
  '--sq-selected',
])
const defined = new Set<string>([...bare.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
const undef = new Map<string, number>()
for (const m of bare.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  const name = m[1]
  if (defined.has(name) || RUNTIME.has(name)) continue
  if (!undef.has(name)) undef.set(name, lineOf(m.index!))
}
console.log(`7. custom properties: ${defined.size} defined, ${undef.size} referenced but never set`)
check(
  undef.size === 0,
  `var() names that nothing defines — these render as nothing at all:\n     ` +
    [...undef].map(([n, l]) => `${n} (first used line ${l})`).join('\n     '),
)

/* ------------------------------------------------- 8. box-shadow, set once
 *
 * The `.card` collision again, generalised: box-shadow is not additive, so a
 * second rule at equal specificity REPLACES the whole shadow list rather than
 * adding to it. Two unqualified rules setting box-shadow on the same simple
 * selector means one of them is dead, and which one is dead can differ
 * between themes.
 */
const shadowOwners = new Map<string, number[]>()
for (const r of rules) {
  if (!/(^|;\s*)box-shadow:/.test(r.body)) continue
  for (const sel of r.selector.split(',').map((x) => x.trim())) {
    // Only simple, unqualified class selectors: a :hover or a theme-qualified
    // rule is meant to override, and does so deliberately.
    if (!/^\.[a-z][a-z0-9-]*$/.test(sel)) continue
    if (!shadowOwners.has(sel)) shadowOwners.set(sel, [])
    shadowOwners.get(sel)!.push(r.line)
  }
}
const collisions = [...shadowOwners].filter(([, lines]) => lines.length > 1)
console.log(`8. simple selectors setting box-shadow more than once: ${collisions.length}`)
check(
  collisions.length === 0,
  `box-shadow set twice at the same specificity — the earlier list is dead,` +
    ` per theme:\n     ` +
    collisions.map(([sel, lines]) => `${sel} at lines ${lines.join(', ')}`).join('\n     '),
)

/* --------------------------------------------------- 9. a theme is complete
 *
 * Light mode is not an inversion, so every token the dark block defines and
 * that carries a colour has to be re-pointed in BOTH light blocks — the media
 * query for people whose system says light, and the [data-theme] attribute
 * for people who chose it. A token re-pointed in one and not the other is a
 * colour that changes depending on HOW you asked for light mode.
 */
const blockAt = (startIndex: number): string => {
  let depth = 0
  for (let i = startIndex; i < bare.length; i++) {
    if (bare[i] === '{') depth++
    else if (bare[i] === '}') {
      depth--
      if (depth === 0) return bare.slice(startIndex, i)
    }
  }
  return ''
}
const namesIn = (block: string): Set<string> =>
  new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))

const darkTokens = namesIn(blockAt(bare.indexOf(':root {')))
const mediaLight = namesIn(blockAt(bare.indexOf(":root:not([data-theme='dark']) {")))
const attrLight = namesIn(blockAt(bare.indexOf(":root[data-theme='light'] {")))
const asymmetric = [...mediaLight].filter((n) => !attrLight.has(n))
const asymmetric2 = [...attrLight].filter((n) => !mediaLight.has(n))
console.log(
  `9. tokens: ${darkTokens.size} dark, ${mediaLight.size} via media query,` +
    ` ${attrLight.size} via [data-theme]`,
)
check(
  asymmetric.length === 0 && asymmetric2.length === 0,
  `the two light blocks disagree — a colour would change depending on how you` +
    ` asked for light mode:\n     ` +
    [
      ...asymmetric.map((n) => `${n}: in the media query, missing from [data-theme]`),
      ...asymmetric2.map((n) => `${n}: in [data-theme], missing from the media query`),
    ].join('\n     '),
)

/* ----------------------------------------------------------------- verdict */
if (fail === 0) {
  console.log('\n✓ one token layer, one definition per thing, every var() resolves')
} else {
  console.log('')
  for (const p of problems) console.log(`FAIL ${p}`)
  console.log(`\n✗ ${fail} failure(s)`)
}
process.exit(fail === 0 ? 0 : 1)
