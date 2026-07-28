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
| Whole corpus sandboxed | `npm run sandbox:puzzles` — 28,800 scanned, 0 structural failures |
| Puzzle solutions spot-checked | Engine sample at depth 16: 225 checked, 0 questionable |
| Puzzle player | Browser session drove puzzles end to end |
| Three tries per puzzle | Browser: 3 pips render, reveal logs "Logged as missed" |
| Categories named before you solve | Browser: "Checkmate patterns" strip above the board |
| All 59 motifs labelled | Was 24 of 59 — a third of puzzles ended with an empty sentence |
| History screen | Browser session: attempts recorded and shown |
| Post-game analysis + mistake logging | `tsc` clean; wired and committed |
| 20 endgame positions | `npm run verify:endgames` — all 20 match at depth 26 |
| Endgame play-out mode | Browser: Lucena loads, engine defends, goal stated |
| 18 boards across 8 materials | Browser: `feTurbulence` confirmed in the computed image |
| Live theme preview | Browser: real pieces on the chosen material before you pick |
| Openings on a playable board | Browser: 3 variations, drag d2-d4, "off book — the book move was e4" |
| **27 opening lines, all checked** | `npm run verify:openings` — 27/27 legal, every ends-claim holds at depth 18 |
| Decay monitor | Browser: trends section renders, day-one verdict appears |
| `loosePieces` | 4 asserted cases incl. defended-vs-undefended |
| Spot the loose piece drill | Browser: "Scan 1 of 5", picked a8, "Right. a8 was the only one hanging" |
| Read the threat drill | Browser: built 5 in under a second, picked a1, "Yes. They play Qxa1+" |
| Candidate moves drill | Browser: picked 3, scored 0 of 3, engine's three shown with evals |
| **Blunder check** | Browser: toggled on, played e4, prompt appeared; take-back cleared the move; commit let the bot reply; b5-b6 reported "Your piece on b6 is attacked and nothing defends it" |
| **Tier ladder sandboxed** | `npm run sandbox:tiers` — 43 tiers, 43 stock checks, structure/ramp/backing/stock all pass |
| **Scoring fields sync** | Migration `20260728000000_scoring_fields`; push and pull both map all three |
| Offline / installable | Service worker precaches; asset routes all 200 |
| Elo sandbox | Caught 3 bugs in itself, then 3 real ones in the app |

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

**A verification script that did not exist.** `openings.ts` carried a header
saying its lines were "checked by scripts/verify-openings.ts". There was no
such file. That is worse than having no check: the *claim* of verification was
doing the job of verification. Writing it found four things immediately —

- The **Fried Liver** was written up as "a piece down and completely winning".
  Stockfish says **+0.96**. It is taught as crushing almost everywhere and it
  is worth about a pawn; Black holds with ...Ncb4. Added an `edge` band rather
  than widening `winning` until the claim fitted.
- The trap entry for the same line claimed winning at **+1.10**. Same fix.
- A QGD line offered as a playable "sideline" was **+1.38 for White** — it is
  the tempting move that loses, and is now labelled as one.
- Legal's Mate "declined" line was **illegal**: it played `Nxc6` with no knight
  able to reach c6. Replaced with the line that actually refutes the trap, and
  the engine confirms **-5.08** for the side that tried it.

**A wrong reason attached to a right move.** The Scholar's Mate defence said
...Nf6 gives f7 "a second defender". A knight on f6 does not defend f7 — it
blocks the f-file between the queen on f3 and the target. Blocking and
defending are different jobs, and teaching the wrong one produces a habit that
fails in the next position.

**Two tactics tiers were the same amount of work.** `tactics-1` (spot a hanging
piece, mate in one) and `tactics-4` (mate in two) both cleared at 20 solved.
Polgár gives 306 mate-in-ones against 3,412 mate-in-twos. Gates now scale with
the plies you have to see, and `sandbox:tiers` checks every gate against the
puzzles that actually exist in each band — raising one above stock would make a
tier silently unclearable rather than erroring.

**"Pointer events don't reach chessground" was wrong.** The blunder check sat
unverified for a week on that conclusion. The board is a `<cg-board>` custom
element with **no class attribute**, so a `.cg-board` selector matched nothing
and the harness reported the board as undriveable. With a tag selector it
drives fine, and the whole check verified in minutes.

## Next

**1. Maia in the browser.** The model is NOT ready — that entry was wrong. The
exported artifact lived in a gitignored `scripts/raw/` and did not survive its
container, and the "fp16 46.7MB" figure does not describe this network at all:
Maia is 6 blocks × 64 filters, about 868K parameters, so roughly **1.7MB** in
fp16. Re-derivable from scratch, and the groundwork is done —

- Weights fetch from `CSSLab/maia-chess/maia_weights/maia-{1100,1500,1900}.pb.gz`
  (1.3MB each), INPUT_CLASSICAL_112_PLANE / SE / POLICY_CONVOLUTION / VALUE_WDL.
- BN folding confirmed from lc0's `network_legacy.cc`: `gamma *= 1/sqrt(stddiv +
  1e-5)`, `mean -= bias`, `w *= gamma`, `bias = -gamma*mean + beta`. The
  `bn_stddivs` field holds variance, not standard deviation.
- Knight promotion shares the plain move's policy index (`as_packed_int`).
- `kConvPolicyMap` is 4672 = 73×64, indexed `plane*64 + from_square`.
- Decision: **pure-TS forward pass, not onnxruntime-web.** 35M MACs per
  position is fine in typed arrays, and ort-web would add ~10MB of wasm to an
  offline-first PWA to run a 1.7MB net.

*Check: same FEN in the browser and in the numpy reference gives the same move.*

**2. Bot ratings.** ~50% of target ACPL and 1000/1200 is non-monotonic. Not
being tuned further — Maia replaces the model. See `FINDINGS.md`.

**3. More positional drills.** Both concept pillars have one real drill each.
The remaining tiers (open files, weak squares, space, prophylaxis) now get a
free board with the question pinned above it, which is honest but not graded.
Grading them needs a curated position set with worked answers, the same
treatment the endgames got.

**4. Rate my moves in a game.** Per-move grading shown live rather than only in
the post-game summary.

**5. chess.com game import.** Public API needs no key. Only pays off once there
are rated games on the account.

## Known problems

- **Scoring fields sync but the migration is unapplied.** The SQL is committed;
  it has not been run against the live project.
- **Two concept keys still have no drill.** `triangulation`, and
  `insufficient-material` which is a quiz tier and needs a different runner
  rather than a position.
- **"Two pawns beats one" is not automatically true.** The first version of
  `two-pawns-convert` had the defending king opposing and the engine called it
  dead level. Worth keeping as a note, because it is a real trap: the majority
  only converts when their king cannot get back in time.
- **The main bundle is 684KB.** Over Vite's warning threshold, no code-splitting
  yet.
