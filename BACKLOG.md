# Backlog

What's built, what's next, and how each thing was proved. Nothing moves to
DONE on my say-so — every line there names the check that passed.

Last updated 2026-07-26.

---

## Done — and how it was verified

| Item | Verified by |
|---|---|
| Play a game vs a rated, styled bot | Played in a real browser on the live site |
| 28,800 puzzles, 9 bands, 47 motifs each | Build log: 6,057,356 scanned → 291,058 passed → 28,800 shipped |
| Puzzle player | Browser session drove 3 puzzles end to end |
| History screen | Browser session: 3 attempts recorded, 3 red dots shown |
| Post-game analysis + mistake logging | `tsc` clean; wired and committed |
| Board, pieces, 4 themes | Screenshot + pixel-sampled a1/a8 to confirm colours |
| Offline / installable | Service worker precaches 7.4MB; asset routes all 200 |
| Elo sandbox | Caught 3 bugs in itself, then 3 real ones in the app |
| Maia exported + shrunk | fp16 46.7MB, 8/8 positions identical to PyTorch |
| Endgame ladder rebuilt to Silman's real bands | Structural read of the book; 3 mis-gates corrected |

## Next

**1. Puzzle failures feed the weakness profile** — a missed fork puzzle should
push "fork" up the list exactly like a missed fork in a game. Currently
recorded as a red dot and nothing else.
*Check: fail 3 fork puzzles, confirm fork appears in History's weakness list.*

**2. Why-right / why-wrong on every puzzle** — not "wrong", but "that drops the
bishop because the g6 pawn is pinned". The machinery exists (Stockfish +
mistake classifier); it isn't wired to the puzzle screen.
*Check: a known hung-piece answer produces the hung-piece explanation.*

**3. Blunder check inside real games** (Kotov). Commit a move → app shows the
resulting position and asks "anything hanging now?" → then it plays. Training
wheels for the habit that actually costs games at 1200-1500.
*Check: a move that hangs a piece triggers the prompt; a safe one doesn't.*

**4. Endgame play-out mode.** Convert or hold against the engine, move-capped.
Without it the whole endgame pillar is decorative — 15 tiers now marked
`playout` have no runner.
*Check: win a Lucena from both sides; fail it and have that recorded.*

**5. Candidate moves** (Kotov). Name 2-4 options *before* any evaluation, score
on overlap with the engine's top N — trains looking wider, not deeper.
*Check: overlap scoring matches a hand-worked example.*

**6. Maia in the browser.** Port the encoder to TypeScript, wire
`onnxruntime-web`, cache 46.7MB in IndexedDB, drop behind the existing
`Opponent` interface.
*Check: same FEN in browser and Python gives the same move.*

**7. Openings with rationale** — why this opening, what it gives you, what you
concede, where the attack comes from for both sides.
*Check: Sean can explain his own first five moves without the app open.*

**8. Idea library** — every tactic and concept gets a page: what it is, a
position showing it, 8 problems at your level, 8 harder.

**9. Settings** — piece sets, board themes, session length, puzzles per day,
sound, coordinates.

**10. More puzzles per day, categorised** — currently fixed at 3.

## Known problems

- **`mate-kq`, `lucena`, `philidor`, `opposition` and every other concept key
  are not Lichess motifs.** Tiers using them have no puzzle stock. This is now
  explicit (`kind: 'playout'`) rather than silent, but the runner doesn't
  exist yet, so those tiers can't currently be trained at all.
- **Bot ratings are still ~50% of target ACPL** and 1000/1200 is
  non-monotonic. Not being tuned further — Maia replaces the model. See
  `FINDINGS.md`.
- **`tactics-1` and `tactics-4` both clear at 20 solved.** Polgár's ramp is 306
  mate-in-ones to 3,412 mate-in-twos — roughly 10×. The ratio is wrong.
- **Silman's 1400-1599 band is the fattest section in his book.** Endgame now
  reflects that with three tiers; tactics and positional still don't.
