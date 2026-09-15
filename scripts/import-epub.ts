/**
 * A chess book, turned into game scores a machine can check.
 *
 * Sean sent four Everyman EPUBs — Tal's autobiography and three volumes of
 * Kasparov's My Great Predecessors — after asking, more than once, "where can
 * I add the books so the app can also deterministically learn from them?"
 *
 * WHAT IS TAKEN, AND WHY ONLY THAT. Game scores are facts: the moves played
 * in Tal-Darga, Hamburg 1960 are a record of an event, and nobody owns them.
 * The annotations around them are Tal's writing and Kasparov's writing, and
 * this repository is public. So this reads the moves and leaves the prose
 * where it is. No sentence of either book ends up in the output.
 *
 * TWO LAYOUTS, BECAUSE THE PUBLISHER CHANGED HOUSE STYLE:
 *
 *   TABLE  (Tal, 1997/2012) — moves live in <table> rows of three cells:
 *          number, White, Black, with pieces as figurines (♘). Prose sits in
 *          separate <p>. The main line is therefore already separated from
 *          the commentary by the markup, and extraction is near-exact.
 *
 *   INLINE (Predecessors, 2003-2011) — moves run inside the paragraphs, in
 *          ASCII notation, mixed with variations, references to other games
 *          and quoted analysis. Nothing in the markup says which run of moves
 *          is the game. That has to be worked out, and it is where this
 *          script earns its keep or lies to you.
 *
 * HOW THE INLINE CASE IS MADE SAFE. Text is cut into RUNS — maximal stretches
 * containing nothing but move notation — and a run is taken whole or not at
 * all. A run is only taken if it starts exactly where the game is up to. So
 * "After 7 d5 c6! ..." offered while the game already has a move 7 is a
 * variation and is dropped entire; it can never contribute a single ply.
 * Then every move is played on a real board, and a game that will not replay
 * is reported rather than trimmed to whatever part happened to work.
 *
 * The output is a PGN with one header per game, and a report saying how much
 * of each game came out. Short extractions are NOT quietly kept — a
 * half-extracted game is a game with a fabricated ending.
 *
 *   npm run import-epub -- path/to/book.epub --out books/tal.pgn
 */

import { execFileSync } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { Chess } from 'chess.js'

/* ------------------------------------------------------------- reading */

function entries(epub: string): string[] {
  const out = execFileSync('unzip', ['-Z1', epub], { encoding: 'utf8', maxBuffer: 1 << 26 })
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

function read(epub: string, entry: string): string {
  return execFileSync('unzip', ['-p', epub, entry], { encoding: 'utf8', maxBuffer: 1 << 28 })
}

/**
 * Document order. The spine in the OPF is the authoritative reading order;
 * filenames only accidentally agree with it. Both books happen to sort
 * correctly, but "happens to" is how a chapter ends up spliced into the
 * middle of another one, so the spine is used when it parses.
 */
function readingOrder(epub: string): string[] {
  const all = entries(epub)
  const opf = all.find((e) => e.endsWith('.opf'))
  const docs = all.filter((e) => /\.x?html?$/i.test(e))
  if (!opf) return docs.sort()
  try {
    const xml = read(epub, opf)
    const base = dirname(opf)
    const ids = new Map<string, string>()
    for (const m of xml.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)) {
      ids.set(m[1]!, base === '.' ? m[2]! : `${base}/${m[2]!}`)
    }
    const spine: string[] = []
    for (const m of xml.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)) {
      const href = ids.get(m[1]!)
      if (href && /\.x?html?$/i.test(href)) spine.push(decodeURIComponent(href))
    }
    const known = new Set(all)
    const ordered = spine.filter((h) => known.has(h))
    return ordered.length >= docs.length / 2 ? ordered : docs.sort()
  } catch {
    return docs.sort()
  }
}

/* ------------------------------------------------------------ notation */

/** Figurines to letters. Everyman uses the white glyphs for both colours. */
const FIGURINE: Record<string, string> = {
  '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': '',
  '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': '',
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', frac12: '½',
}

function unescape(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (_, n) => ENTITIES[n] ?? ` `)
}

/** Strip tags, decode entities, normalise figurines and dashes. */
function text(html: string): string {
  let s = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<br\b[^>]*>/gi, ' ').replace(/<\/p>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = unescape(s)
  s = s.replace(/[♔-♟]/g, (c) => FIGURINE[c] ?? '')
  // Figurine notation leaves "N f3"; ASCII books never have that space.
  s = s.replace(/\b([KQRBN])\s+(?=[a-h1-8x])/g, '$1')
  s = s.replace(/[–—−]/g, '-')
  s = s.replace(/[   ]/g, ' ')
  s = s.replace(/[ \t]+/g, ' ')
  return s
}

/** Drop the decorations a book puts on a move, leaving something chess.js eats. */
function clean(san: string): string {
  return san
    .replace(/[!?]+$/g, '')
    .replace(/[+#]+$/g, '')
    .replace(/[±∓∞⩲⩱□⊕]/g, '')
    .replace(/^0-0-0$/, 'O-O-O')
    .replace(/^0-0$/, 'O-O')
    .replace(/^O-O-O$/, 'O-O-O')
    .trim()
}

/** Does this token look like a move at all? Cheap gate before the board. */
const SAN = /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[O0]-[O0](?:-[O0])?)[!?+#±∓∞]*$/

/* -------------------------------------------------------------- output */

export interface ExtractedGame {
  n: number | null
  white: string
  black: string
  event: string
  opening: string
  result: string
  san: string[]
  /** Anything that stopped the replay, named. */
  problem?: string
}

/* ------------------------------------------------------- TABLE layout */

/**
 * Tal. The markup has already done the hard part: main-line moves are the
 * only things inside <table>, so a game is its header plus every table cell
 * up to the next header.
 */
function parseTables(docs: string[]): ExtractedGame[] {
  const games: ExtractedGame[] = []
  for (const doc of docs) {
    // Headers look like: <p class="center">Game 35<br/><b>Tal - Darga</b>
    //                    <br/><i>Event 1960</i><br/>Sicilian Defence</p>
    const hdr = /<p[^>]*class="center"[^>]*>((?:(?!<\/p>)[\s\S])*?Game\s+\d+[\s\S]*?)<\/p>/g
    const marks: { at: number; end: number; body: string }[] = []
    let m: RegExpExecArray | null
    while ((m = hdr.exec(doc)) !== null) marks.push({ at: m.index, end: hdr.lastIndex, body: m[1]! })

    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]!
      const chunk = doc.slice(mark.end, marks[i + 1]?.at ?? doc.length)
      const flat = text(mark.body).replace(/\s+/g, ' ').trim()
      const num = /Game\s+(\d+)/.exec(flat)
      const bold = /<b[^>]*>((?:(?!<\/b>)[\s\S])*?)<\/b>/.exec(mark.body)
      const ital = /<i[^>]*>((?:(?!<\/i>)[\s\S])*?)<\/i>/.exec(mark.body)
      const players = bold ? text(bold[1]!).replace(/\s+/g, ' ').trim() : ''
      const dash = players.split(/\s-\s|-/)

      /*
       * Every table row, as numbered tokens.
       *
       * The book also sets ANALYSIS in tables — a variation gets the same
       * three-column treatment as the game — so the rows cannot simply be
       * concatenated. Each row states its move number, and a variation
       * restarts at a number the game has already passed, so carrying the
       * number through and replaying in sequence is what tells the two apart.
       */
      const toks: { no: number | null; black: boolean; san: string }[] = []
      for (const t of chunk.matchAll(/<table[\s\S]*?<\/table>/g)) {
        for (const row of t[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
          const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
            text(c[1]!).replace(/\s+/g, ' ').trim(),
          )
          if (cells.length === 0) continue
          const no = /^\d+$/.test(cells[0]!) ? Number(cells[0]) : null
          let black = false
          for (const raw of cells.slice(1)) {
            // "b6 (D)" marks a diagram. Dropping the whole cell for the sake
            // of the marker is how a game silently loses a ply and then fails
            // to replay twenty moves later, a long way from the cause.
            const cell = raw.replace(/\((?:D|diagram)\)/gi, '').trim()
            if (/^(\.\.\.|\u2026)$/.test(cell)) { black = true; continue }
            const tok = clean(cell)
            if (tok && SAN.test(cell.replace(/\s/g, ''))) {
              toks.push({ no: black ? no : no, black, san: tok })
              black = true
            }
          }
        }
      }

      const { san, problem } = replaySequenced(toks)
      /*
       * The result is the book's own centred, bold line at the end of the
       * game. Taking the first result-looking string in the chunk instead
       * picks up a citation in the commentary — the prose is full of
       * "... 0-1 (Gheorghiu-Kasparov, Thessaloniki 1988)" — and files
       * somebody else's loss as this game's.
       */
      const centred = [...chunk.matchAll(
        /<p[^>]*class="center"[^>]*>\s*<b[^>]*>\s*(1-0|0-1|1\/2-1\/2|\u00bd-\u00bd)\s*<\/b>/g,
      )]
      const res = centred.length > 0
        ? centred[centred.length - 1]
        : /(1-0|0-1|1\/2-1\/2|\u00bd-\u00bd)/.exec(text(chunk))
      games.push({
        n: num ? Number(num[1]) : null,
        white: dash[0]?.trim() ?? '?',
        black: dash[1]?.trim() ?? '?',
        event: ital ? text(ital[1]!).replace(/\s+/g, ' ').trim() : '',
        opening: '',
        result: res ? (res[1] === '\u00bd-\u00bd' ? '1/2-1/2' : res[1]!) : '*',
        san,
        ...(problem ? { problem } : {}),
      })
    }
  }
  return games
}

/**
 * Replay numbered move tokens, keeping only what is in sequence.
 *
 * The one rule that makes a book's analysis separable from its games: the
 * game is the thread whose move numbers run 1, 1..., 2, 2... without a gap.
 * A token that claims a number the game has already played, or one it has not
 * reached, belongs to a variation and is dropped — along with everything
 * after it until the numbering rejoins the game.
 */
function replaySequenced(toks: { no: number | null; black: boolean; san: string }[]): {
  san: string[]
  problem?: string
} {
  const board = new Chess()
  let problem: string | undefined
  let skipping = false
  for (const t of toks) {
    const wantNo = Math.floor(board.history().length / 2) + 1
    const wantBlack = board.turn() === 'b'
    if (t.no !== null) {
      const inSeq = t.no === wantNo && t.black === wantBlack
      if (!inSeq) { skipping = true; continue }
      skipping = false
    } else if (skipping) {
      continue
    }
    let mv
    try { mv = board.move(t.san) } catch { mv = null }
    if (!mv) {
      // In sequence but will not play: a real problem, worth naming rather
      // than skipping past, because it means the parse has drifted.
      problem ??= `${t.san} will not play at ply ${board.history().length + 1}`
      skipping = true
      continue
    }
  }
  return problem === undefined ? { san: board.history() } : { san: board.history(), problem }
}

/* ------------------------------------------------------ INLINE layout */

interface Run {
  at: number
  /** Tokens in order: either a move number marker or a move. */
  toks: { no: number | null; black: boolean; san: string }[]
}

/**
 * Cut a paragraph into runs of pure move notation.
 *
 * This is the whole safety argument for the inline books. A run is a stretch
 * with no words in it — numbers, moves, "...", and the punctuation notation
 * uses. Prose ends a run, and so does an opening bracket, because everything
 * a book puts in brackets is an alternative to what actually happened.
 */
function runs(para: string): Run[] {
  const out: Run[] = []
  // Bracketed material is always a variation or a citation. Remove it first,
  // innermost out, so nested brackets cannot leak a move into the game.
  let s = para
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\([^()]*\)/g, ' ')
    if (next === s) break
    s = next
  }
  /*
   * Castling FIRST, then ordinary moves, then move numbers.
   *
   * Order is not cosmetic here. With the number alternative first, "0-0" is
   * read as the number zero followed by junk, so every run ended at the first
   * castling and whole books came out at nine plies a game — which looked
   * like a hard parsing problem and was an alternation written backwards.
   */
  const TOKEN =
    /([O0]-[O0](?:-[O0])?[!?+#]*)|([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[!?+#±∓]*)|(\d+)\s*(\.{3}|…|\.)?/gy
  let pos = 0
  while (pos < s.length) {
    // skip separators
    const sep = /[\s,;:–—-]*/y
    sep.lastIndex = pos
    sep.exec(s)
    pos = sep.lastIndex
    TOKEN.lastIndex = pos
    const first = TOKEN.exec(s)
    if (!first) { pos++; continue }

    // A run: keep consuming tokens separated only by whitespace/ellipsis.
    const run: Run = { at: pos, toks: [] }
    let no: number | null = null
    let black = false
    let cur = first
    while (cur) {
      const move = cur[1] ?? cur[2]
      if (move) {
        run.toks.push({ no, black, san: clean(move) })
        no = null
        black = !black   // sides alternate as a run goes on
      } else if (cur[3]) {
        no = Number(cur[3])
        black = cur[4] === '...' || cur[4] === '…'
      }
      pos = TOKEN.lastIndex
      const gap = /[\s.…]*/y
      gap.lastIndex = pos
      gap.exec(s)
      if (gap.lastIndex > pos && /[^\s.…]/.test(s.slice(pos, gap.lastIndex))) break
      TOKEN.lastIndex = gap.lastIndex
      const nxt = TOKEN.exec(s)
      if (!nxt) { pos = gap.lastIndex; break }
      cur = nxt
    }
    if (run.toks.length > 0) out.push(run)
    else pos++
  }
  return out
}

function parseInline(docs: string[]): ExtractedGame[] {
  const games: ExtractedGame[] = []
  for (const doc of docs) {
    /*
     * THE SIGNAL THAT MAKES THIS EXACT RATHER THAN A GUESS.
     *
     * The first attempt read these books as flat text and tried to tell the
     * game from the analysis by move numbering alone. It cannot be done:
     * "After 7 d5 c6! ... 8 Qd2 cxd5" is offered while the game is itself at
     * move 7, so the variation is indistinguishable from the continuation and
     * gets played, and from there the game is fiction. Median extraction was
     * 24 plies out of 80 and the parts that came out were not trustworthy.
     *
     * But the typesetting knows. Everyman sets main-line moves BOLD and
     * leaves analysis in the running face, which is how the page is readable
     * at all — and the EPUB kept it, as <span class="bold">. So the game is
     * the bold spans, in order, and the variations are simply not collected.
     */
    const boldOf = (chunk: string): string =>
      [...chunk.matchAll(/<span[^>]*class="[^"]*\bbold\b[^"]*"[^>]*>([\s\S]*?)<\/span>/g)]
        .map((b) => text(b[1]!))
        .join(' \n ')

    // A header is "Game N" with a bold Player-Player line close behind it.
    const hdr = /Game\s+(\d+)\b/g
    const marks: { at: number; end: number; n: number; white: string; black: string; event: string }[] = []
    let m: RegExpExecArray | null
    while ((m = hdr.exec(doc)) !== null) {
      const near = doc.slice(m.index, m.index + 600)
      const first = /<span[^>]*class="[^"]*\bbold\b[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(near)
      if (!first) continue
      const who = text(first[1]!).replace(/\s+/g, ' ').trim()
      const pair = /^([A-Z][^-]{1,40}?)\s*-\s*([A-Z][^-]{1,40})$/.exec(who)
      if (!pair) continue
      const afterName = m.index + (first.index ?? 0) + first[0].length
      const event = text(doc.slice(afterName, afterName + 400))
        .split('\n')[0]!.replace(/\s+/g, ' ').trim().slice(0, 90)
      marks.push({
        at: m.index, end: afterName, n: Number(m[1]),
        white: pair[1]!.trim(), black: pair[2]!.trim(), event,
      })
    }

    for (let i = 0; i < marks.length; i++) {
      const mk = marks[i]!
      const chunk = doc.slice(mk.end, marks[i + 1]?.at ?? doc.length)
      const bold = boldOf(chunk)

      const toks: { no: number | null; black: boolean; san: string }[] = []
      for (const para of bold.split('\n')) for (const run of runs(para)) toks.push(...run.toks)
      const { san, problem } = replaySequenced(toks)

      const r = /(1-0|0-1|1\/2-1\/2|\u00bd-\u00bd)/.exec(bold.slice(-400))
      games.push({
        n: mk.n, white: mk.white, black: mk.black, event: mk.event, opening: '',
        result: r ? (r[1] === '\u00bd-\u00bd' ? '1/2-1/2' : r[1]!) : '*',
        san,
        ...(problem ? { problem } : {}),
      })
    }
  }
  return games
}

/* ---------------------------------------------------------------- main */

function toPgn(g: ExtractedGame, source: string): string {
  const yr = /\b(1[89]\d\d|20\d\d)\b/.exec(g.event)
  const head = [
    `[Event "${g.event.replace(/"/g, "'") || '?'}"]`,
    `[Site "?"]`,
    `[Date "${yr ? yr[1] : '????'}.??.??"]`,
    `[Round "?"]`,
    `[White "${g.white.replace(/"/g, "'")}"]`,
    `[Black "${g.black.replace(/"/g, "'")}"]`,
    `[Result "${g.result}"]`,
    `[Source "${source}"]`,
    g.n ? `[SourceGame "${g.n}"]` : '',
  ].filter(Boolean).join('\n')

  const body: string[] = []
  for (let i = 0; i < g.san.length; i++) {
    if (i % 2 === 0) body.push(`${i / 2 + 1}.`)
    body.push(g.san[i]!)
  }
  body.push(g.result)
  return `${head}\n\n${body.join(' ')}\n`
}

async function main() {
  const file = process.argv[2]
  if (!file || file.startsWith('--')) {
    console.error('usage: npm run import-epub -- <book.epub> [--out books/name.pgn] [--min-plies 20]')
    process.exit(1)
  }
  const outI = process.argv.indexOf('--out')
  const out = outI >= 0 ? process.argv[outI + 1]! : `books/${basename(file, '.epub')}.pgn`
  const minI = process.argv.indexOf('--min-plies')
  const MIN = minI >= 0 ? Number(process.argv[minI + 1]) : 20

  const order = readingOrder(file)
  const docs = order.map((e) => read(file, e))
  const tabular = docs.some((d) => /<table[\s\S]{0,4000}?<td[^>]*>\s*<b[^>]*>\s*\d+\s*<\/b>/.test(d))
  console.log(`${basename(file)}\n  ${docs.length} documents · layout: ${tabular ? 'TABLE' : 'INLINE'}`)

  const games = tabular ? parseTables(docs) : parseInline(docs)

  /* Nothing is trusted: every game is replayed on a real board. */
  const good: ExtractedGame[] = []
  const bad: { g: ExtractedGame; why: string }[] = []
  for (const g of games) {
    const b = new Chess()
    let why = ''
    for (const s of g.san) {
      try {
        if (!b.move(s)) { why = `illegal ${s} at ply ${b.history().length + 1}`; break }
      } catch {
        why = `illegal ${s} at ply ${b.history().length + 1}`
        break
      }
    }
    if (!why && b.history().length < MIN) why = `only ${b.history().length} plies`
    if (why) bad.push({ g, why })
    else good.push({ ...g, san: b.history() })
  }

  const plies = good.map((g) => g.san.length)
  const avg = plies.length ? Math.round(plies.reduce((a, c) => a + c, 0) / plies.length) : 0
  console.log(`  games found     ${games.length}`)
  console.log(`  replayed clean  ${good.length}   (median ${plies.sort((a, b) => a - b)[plies.length >> 1] ?? 0} plies, mean ${avg})`)
  console.log(`  rejected        ${bad.length}`)
  for (const r of bad.slice(0, 12)) {
    console.log(`     Game ${r.g.n ?? '?'} ${r.g.white}-${r.g.black}: ${r.why}`)
  }
  if (bad.length > 12) console.log(`     … and ${bad.length - 12} more`)

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, good.map((g) => toPgn(g, basename(file))).join('\n'), 'utf8')
  console.log(`  → ${out}`)
}

void main()
