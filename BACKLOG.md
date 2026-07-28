# Backlog

What's built, what's next, and how each thing was proved. Nothing moves to
DONE on my say-so — every line there names the check that passed.

Last updated 2026-07-28.

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
| **Blunder check** | `npm run verify:blunder` — 14 checks in a real browser, all passed |
| **A harness that can drive the board** | Same run: real mouse drags reach chessground, position read back from the DOM |
| **Tactics ramp reflects real volume** | `npm run verify:ladder` — 11 checks; the flat ramp is now a named regression |
| **Puzzle scoring syncs** | `npm run verify:sync` — 13 checks; drift checker fails when the fields are removed |
| **Live move grading** | `npm run verify:live` — 8 checks; a hung bishop grades as a blunder, and stays silent during the blunder check |
| **Learn is modules you click into** | `npm run verify:learn` — 11 checks; system back goes up a level, not out of the app |
| **20 endgame positions** | `npm run verify:endgames` — all 20 match at depth 26 |
| **Endgame play-out mode** | Browser: Lucena loads, engine defends, goal stated |
| **18 boards across 8 materials** | Browser: `feTurbulence` confirmed in the computed image; walnut grain visible |
| **Live theme preview** | Browser: real pieces on the chosen material before you pick |
| **Openings with rationale** | All 10 lines replayed through chess.js — every one playable |
| **Openings on a step-through board** | Browser: 12 move buttons, 32 pieces, Italian steps correctly |
| **Decay monitor** | Browser: trends section renders, day-one verdict appears |
| **`loosePieces`** | 4 asserted cases incl. defended-vs-undefended |
| **Spot the loose piece drill** | Browser: "Scan 1 of 5", picked a8, "Right. a8 was the only one hanging" |
| **Read the threat drill** | `npm run sandbox:drills` — 8/8 built, every answer confirmed at depth 18 |
| **Candidate moves drill** | Browser: picked 3, scored 0 of 3, engine's three shown with evals |
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

**A forced mate displayed as "+996.0".** `lineScore` maps mates onto ±100,000
so they sort correctly, which is right for ranking and nonsense to show a
human. Caught in the browser on the candidate-move drill.

**One constant made a layer untestable.** `uci.ts` read `import.meta.env` at
module scope, so importing `exercises.ts` outside the browser threw. Pure board
logic downstream of it could not be checked in Node at all. Now lazy.

**The sync layer was silently dropping three columns.** `attempts`, `hintUsed`
and `points` had been on the local puzzle row for months and never left the
device — sync.ts maps every column by hand and nothing compared that mapping
against the migrations. There was no symptom: points earned on the phone were
simply absent on the desktop. `verify:sync` now diffs both directions, and the
silent one — a column in the schema that nothing sends — is the half that
matters. Confirmed by deleting the fields again and watching it fail.

**Every Learn navigation pushed two history entries.** The `pushState` call
sat inside a `setPath` updater, and React calls updaters twice under
StrictMode because they are supposed to be pure. The screen looked perfect;
the back button just needed two presses per level, the first popping a
duplicate with no visible effect. Nothing but a real browser was ever going to
find that, and on an installed PWA the symptom is the app closing when you
meant to go up.

**The threat drill could be solved without looking at the board.** Its answer
was the square their move LANDS on; its decoys were squares their pieces were
STANDING on. Different kinds of thing, and visibly so — five options held one
of their pieces and the sixth did not, so the answer was always the odd one
out. Options are now their ranked candidate moves in SAN, which removes the
tell and lets the prompt say "what would they play" and mean it.

**And the shipped drill was less validated than the audited one.** The
stability re-search that drops questions where a deeper search disagrees sat
behind `if (engine)`, and the browser calls the builder without one — so it
only ever ran in the sandbox. Replaced by requiring a clear margin between
their best two threats, which comes free from the search already being run and
behaves identically in both places. It is also the more honest test: two
threats within a whisker means the question has no single right answer.

**Live grading called a hung bishop "Good move."** The first design avoided a
second engine search by reporting a bound: every move on the engine's shortlist
beat yours, so the loss is at least the gap to the worst of them. True, and
useless — the top twelve moves in a quiet position sit within about 30cp of
each other, so the bound came out at 30 and landed in the "good" band. A figure
that is honest about its own imprecision is still a lie when the label on it is
wrong. Off-shortlist moves now get the second search; it is rare by
construction, because falling outside the top twelve is what a bad move does.

**The board harness reported a position that cannot exist.** Its first run
failed two checks, both looking like take-back was broken. Neither was: reads
were landing inside chessground's 180ms move animation, and one caught a black
pawn mid-flight through e7-e5 and recorded it on **e6** — a position no legal
game contains. Reads now settle on observed stability before asserting.
`reducedMotion` does not fix this; chessground's animation is its own config
value, not a CSS transition, so the browser preference never reaches it.

## Next

**1. Maia in the browser.** Model is ready (fp16, 46.7MB, 8/8 parity). Port the
encoder to TypeScript, wire `onnxruntime-web`, cache in IndexedDB, drop behind
the existing `Opponent` interface.
*Check: same FEN in browser and Python gives the same move.*

**2. chess.com game import.** Public API needs no key. Only pays off once there
are rated games on the account.

**3. More positional drills.** Both concept pillars now have one real drill
each — loose pieces under Position, threat-reading under Strategy. The
remaining tiers (open files, weak squares, space, prophylaxis) are still
questions-to-ask, which is honest but not interactive. They would need a
curated position set with graded answers, the same treatment the endgames got.

## Known problems

- **Bot ratings are still ~50% of target ACPL** and 1000/1200 is
  non-monotonic. Not being tuned further — Maia replaces the model. See
  `FINDINGS.md`.
- **The scoring migration has not been applied to the live database.**
  `20260728000000_puzzle_attempt_scoring.sql` is written and the client now
  sends the three columns, but it has only been checked against the DDL in the
  repo — there were no credentials here to run it. It must land before a client
  carrying this change syncs, or PostgREST rejects the whole puzzle-attempt
  upsert. Nullable and `if not exists`, so applying it twice is harmless.
- **Two concept keys still have no drill.** `triangulation`, and
  `insufficient-material` which is a quiz tier and needs a different runner
  rather than a position.
- **"Two pawns beats one" is not automatically true.** The first version of
  `two-pawns-convert` had the defending king opposing and the engine called it
  dead level. Worth keeping as a note, because it is a real trap: the majority
  only converts when their king cannot get back in time.
