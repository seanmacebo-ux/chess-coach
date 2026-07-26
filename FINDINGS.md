# What I found, in plain language

Every claim here has a file behind it. Numbers come from `calibration/` — those
are raw output, not summaries, so you can check them yourself.

---

## 1. The bots aren't the strength the label says

I made the bots play each other hundreds of times and measured how much they
throw away per move. That measure is called **ACPL** — average centipawn loss.
A centipawn is 1/100th of a pawn. Lose 100 centipawns and you effectively
handed over a pawn.

Real humans lose roughly this much per move:

| Rating | Centipawns lost per move |
|--------|--------------------------|
| 800    | ~150 |
| 1200   | ~95  |
| 1400   | ~75  |
| 1800   | ~48  |

Our bots measured about **half** of that, meaning they play noticeably
*stronger* than their labels.

```
 800   should be 150   measured  70.4
1000   should be 120   measured  90.5
1200   should be  95   measured  59.9
1400   should be  75   measured  42.8
1600   should be  60   measured  33.2
2200   should be  30   measured  12.8
```

**Worse:** 1000 loses *more* than 1200 does. The weaker bot plays worse than the
stronger bot's target. That ordering is impossible if the model were sound, and
the head-to-head backs it up — 1000 vs 1200 finished dead level at 50%.

Raw data: `calibration/report-*.json`, section `bands` and `pairings`.

## 2. Chess.com has the same problem

Their bots are a very strong engine (Komodo) told to make mistakes on purpose.
That's why their bots feel odd: three brilliant moves, then a queen hangs for no
reason. A "1200 bot" there doesn't play like a 1200 human either.

I built mine the same way. So mine inherited the same flaw. Copying them harder
doesn't fix it.

## 3. Why it can't be tuned away

A strong engine can only be wrong *randomly*. Real people are wrong
*systematically* — they miss backward knight moves, miss long retreats, over-value
checks, don't see quiet defensive resources. Our model only knows "how good is
this move", so it can't reproduce any of that.

Every time I tuned one rating band into place, the one next to it fell out. That's
the signature of a model with the wrong shape, not a knob set slightly wrong.

**The fix is Maia** — a program trained on millions of real human games at each
rating, so it errs where humans err. Export and verification in progress.

## 4. Bugs the testing caught

None of these were found by reading the code. All of them came from measuring.

- **The blunder code never blundered.** It was told to occasionally "pick a random
  move", but it picked randomly from the engine's eight *best* moves — all of
  which are fine. It looked correct and did nothing for the entire build.
- **Two personalities were secretly stronger.** "Tactical" beat the same-rated
  normal bot 88% of the time. Boosting checks and captures boosts moves that are
  often just good, so style was quietly a difficulty setting. You'd have thought
  you were beating a 1400 while beating a 1250.
- **The board was upside down.** Wrong corner dark. Caught by sampling pixels,
  not by looking.
- **The test harness had three bugs of its own** before it could measure anything
  honestly — including one where every matchup returned exactly 50% because
  unfinished games were all scored as draws.

## 5. The puzzles

28,800 of them, filtered out of Lichess's public database of 6,057,356.

```
scanned    6,057,356 puzzles
passed quality gate  291,058     (enough people solved it, rating settled)
shipped               28,800     (3,200 per rating band, 9 bands)
motifs per band          44-48
```

They're CC0 — public domain, free to use. Each one is tagged with what it
teaches and how hard it is. Build script: `scripts/build-puzzles.mjs`.

## 6. The books

Four downloaded, then all twelve. What comes out of them is the **teaching
order** — which idea before which, and at what level you're ready for it. Not
their text or diagrams.

Silman's endgame course is the useful one because it states its levels outright:
learn these things at this rating, stop there. That structure is what the tier
ladder copies.

---

## How to check any of this yourself

```bash
npm run calibrate -- --games 4      # re-run the bot strength test
cat calibration/history.jsonl       # every run, so you can see drift
npm run puzzles                     # rebuild the puzzle set from source
```
