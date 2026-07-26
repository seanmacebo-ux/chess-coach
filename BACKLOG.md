# Backlog

What's built, what's next, and how each thing was proved. Nothing moves to
DONE on my say-so — every line there names the check that passed.

Last updated 2026-07-26.

---

## Done — and how it was verified

| Item | Verified by |
|---|---|
| Play a game vs a rated, styled bot | Played in a real browser on the live site |
| 28,800 puzzles, 9 bands, 59 motifs | Build log: 6,057,356 scanned → 291,058 passed → 28,800 shipped |
| **Whole corpus sandboxed** | `npm run sandbox:puzzles` — 28,800 scanned, 0 structural failures |
| **Puzzle solutions spot-checked** | Engine sample at depth 16: 225 checked, 0 questionable |
| Puzzle player | Browser session drove puzzles end to end |
| **Three tries per puzzle** | Browser: 3 pips render, reveal logs "Logged as missed" |
| **Categories named before you solve** | Browser: "Checkmate patterns" strip above the board |
| **All 59 motifs labelled** | Was 24 of 59 — a third of puzzles ended with an empty sentence |
| History screen | Browser session: attempts recorded and shown |
| Post-game analysis + mistake logging | `tsc` clean; wired and committed |
| **16 endgame positions** | `npm run verify:endgames` — all 16 match at depth 26 |
| **Endgame play-out mode** | Browser: Lucena loads, engine defends, goal stated |
| **18 boards across 8 materials** | Browser: `feTurbulence` confirmed in the computed image; walnut grain visible |
| **Live theme preview** | Browser: real pieces on the chosen material before you pick |
| **Openings with rationale** | All 10 lines replayed through chess.js — every one playable |
| **Openings on a step-through board** | Browser: 12 move buttons, 32 pieces, Italian steps correctly |
| **Decay monitor** | Browser: trends section renders, day-one verdict appears |
| **`loosePieces`** | 4 asserted cases incl. defended-vs-undefended |
| **Spot the loose piece drill** | Browser: "Scan 1 of 5", picked a8, "Right. a8 was the only one hanging" |
| Offline / installable | Service worker precaches; asset routes all 200 |
| Elo sandbox | Caught 3 bugs in itself, then 3 real ones in the app |
| Maia exported + shrunk | fp16 46.7MB, 8/8 positions identical to PyTorch |

## What the sandboxes actually caught

Worth keeping, because the point of a harness is that it finds things.

**Endgames — 3 of 16 wrong.** Lucena and Philidor were *illegal positions*: the
side not to move was already in check. chess.js loads that happily and
Stockfish refuses it, which surfaced as a confusing "engine returned no line".
The trébuchet was not a mutual zugzwang at all — replaced by searching for a
real one and confirming it loses for whoever has to move.

**Puzzles — 218 reported, all 218 my fault.** 148 were en passant: flipping the
side to move without clearing the ep square makes a legal FEN throw, and the
catch reported it as broken. 70 were `mateIn5`, which is a bucket for "five or
more" in the Lichess taxonomy rather than an exact count. The corpus was clean
the whole time. The same ep bug was latent in the endgame verifier.

**Trends section hid on day one.** Gated on a category having data, so when
every category was untested the whole thing vanished — including the "breadth
first" verdict, which is exactly the advice that applies then.

**One constant made a layer untestable.** `uci.ts` read `import.meta.env` at
module scope, so importing `exercises.ts` outside the browser threw. Pure board
logic downstream of it could not be checked in Node at all. Now lazy.

## Next

**1. Blunder check — implemented, NOT browser-verified.** The prompt, the
engine gate, the take-back and the `loosePieces` logic behind it are all in and
type-check, and `loosePieces` is asserted. What is unproven is the prompt
actually appearing after a move, because synthetic pointer events do not reach
chessground under the automation harness — the board stayed at 8 pawns with no
last-move square. Needs a hand check, or a harness that can drive the board.
*Check: turn it on, play e4, confirm the prompt appears and take-back works.*

**2. Maia in the browser.** Model is ready (fp16, 46.7MB, 8/8 parity). Port the
encoder to TypeScript, wire `onnxruntime-web`, cache in IndexedDB, drop behind
the existing `Opponent` interface.
*Check: same FEN in browser and Python gives the same move.*

**3. Candidate moves** (Kotov). Name 2-4 options *before* any evaluation, score
on overlap with the engine's top N — trains looking wider, not deeper.

**4. Threat-detection drill.** `buildThreatExercise` exists in `exercises.ts`
and still nothing calls it. Null-move the position, ask what they would play.
Needs the engine per position, so it is slower than the scan and wants its own
loading treatment rather than being bolted onto it.

**5. Rate my moves in a game.** Per-move grading shown live rather than only in
the post-game summary.

**6. chess.com game import.** Public API needs no key. Only pays off once there
are rated games on the account.

**7. Positional and strategy playgrounds.** Currently questions-to-ask, which is
honest but not interactive. Would need a curated position set with graded
answers — the same treatment the endgames got.

## Known problems

- **Bot ratings are still ~50% of target ACPL** and 1000/1200 is
  non-monotonic. Not being tuned further — Maia replaces the model. See
  `FINDINGS.md`.
- **`tactics-1` and `tactics-4` both clear at 20 solved.** Polgár's ramp is 306
  mate-in-ones to 3,412 mate-in-twos — roughly 10×. The ratio is wrong.
- **Scoring fields don't sync.** `attempts`, `hintUsed` and `points` are on the
  local row but not in the Supabase schema, so they stay on one device until a
  migration adds them.
- **Six concept keys still have no position.** `mate-staircase`, `triangulation`,
  `outflanking`, `two-weaknesses`, `conversion`, `fortress`. The tiers exist;
  the drills do not.
