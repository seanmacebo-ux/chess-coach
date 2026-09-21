# What I found, in plain language

Every claim here has a file behind it. Numbers come from `calibration/` — those
are raw output, not summaries, so you can check them yourself.

---

## 1. Three of the eleven bots were the same bot

*(This section used to say something else. What it said is at the bottom, with
what was wrong with it, because a findings document that quietly rewrites its
own history is not one.)*

Bots are measured by **ACPL** — average centipawn loss. A centipawn is 1/100th
of a pawn, so losing 100 centipawns a move means handing over a pawn a move.
Lower is stronger.

Every bot's rating was snapped to the nearest of eight fixed "bands" before its
settings were looked up. The roster does not use those eight values — it spaces
eleven bots about 150 apart. So the ladder collapsed:

```
Bud 350, Kit 550, Pip 800   ->  all band 800, byte for byte identical
Nadia 950, Walter 1100      ->  both band 1000
Darius 1550, Ren 1700       ->  both band 1600
```

Eleven opponents. Seven strengths. And the three at the bottom were one bot
wearing three faces — which is why the weakest thing in the app was an 800 aimed
at a player rated 316, and why ten attempts at scholar's mate against "Bud" all
failed.

Settings now interpolate, so a 1100 bot is genuinely between the 1000 and the
1200 and a 350 bot is a 350 bot.

## 2. The ladder descends now, and here are the numbers

Self-play, referee at depth 14, with a 95% interval on every reading — because
the interval is the whole point. Per-move loss is violently skewed and a mean
over a few hundred moves carries enough noise to make two identical answers look
like a trend. This project chased that three times.

```
         target    before           after            moves
  350      210     226.5 +/- 17     (unchanged)       763
  550      180     154.1 +/- 18 ->  197.1 +/- 17      711
  800      150     139.8 +/- 13     (unchanged)       582
 1400       75      87.4 +/- 10 ->   72.9 +/-  6      755
```

Only the two that sat outside their intervals were changed. The other two are
already consistent with their targets, and nudging a reading that is already
consistent is exactly the mistake that was made three times before.

The ladder: **226 -> 197 -> 140 -> 73**. Before the fix above, the first three
of those were one number.

## 3. What a bad move looks like now

A weakened engine can only be wrong at random, and that is what this one did:
the "blunder" path played a uniformly random legal move. Nobody has ever shuffled
a rook to h2 for no reason. It reads as a bug, not a mistake — which is most of
what "the bots feel wrong" actually means.

Human errors are not noise. They are the output of a cheaper policy: look at what
a move wins right now, do not look at the answer. So that is what the path plays
now. It takes the free queen, grabs the defended pawn, gives the pointless check
— blunders that look purposeful right up until the refutation.

That policy was measured on its own, and the number is useful in itself:

```
uniformly random legal move    345.8 +/- 20 acpl    something hanging 53% of the time
one-ply greedy                 221.0 +/- 18 acpl    something hanging 32% of the time
```

So a player who looks exactly one move ahead is a 221-acpl player. The bottom of
the ladder is now built out of that: Bud is mostly a one-ply player, Kit is part
of one, Pip is mostly the search. That is a description of how beginners actually
improve, and it gives the three of them different characters rather than three
settings of one dial.

**Maia is still the better answer** — a program trained on millions of real human
games at each rating errs where humans err, which no amount of this gets you. But
the claim that this model could not be tuned into a working ladder was wrong, and
the ladder above is the disproof.

## 3a. What this section used to say, and why it was wrong

It said the bots measured at about half their labelled ACPL, that 1000 lost more
than 1200, that "every time I tuned one band into place the one next to it fell
out", and that this was "the signature of a model with the wrong shape" fixable
only by replacing it with Maia.

The measurements were real. The diagnosis was wrong. Non-monotonic bands and
tuning that would not converge are also exactly what you get when several bots
resolve to the same settings and the tuner is aiming at readings with intervals
wider than the differences it is chasing. Both of those were true and neither was
the model's shape.

It is left here because being wrong about a cause for months is the more useful
finding.

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
npm run verify:policy               # is the ladder a ladder? (seconds, no engine)
npm run diag:bots -- --bands 350,550,800,1400 --games 8
                                    # the table in section 2, with intervals
npm run diag:floor                  # the two policies in section 3
npm run calibrate -- --games 4      # the slower run: ladder, head-to-heads, styles
cat calibration/history.jsonl       # every run, so you can see drift
npm run puzzles                     # rebuild the puzzle set from source
```

`verify:policy` is the one worth running first. It walks the roster in order and
insists every bot is a different and harder opponent than the one below it —
which nothing had ever checked, and is how three bots stayed identical for
months.
