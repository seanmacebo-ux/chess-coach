# Books

Drop book files here — PDF, EPUB, PGN, photographed pages, anything.

**They will not be committed.** `.gitignore` covers `books/*` except this file.
That is on purpose, and it is the one thing to understand before you upload
anything:

> **`seanmacebo-ux/chess-coach` is a PUBLIC repository.**
> A book committed here is a book published to the internet under your name.

Everything in this folder is a working copy for extracting content from. What
gets committed is what comes *out* of a book, not the book.

## What already came out of the books

This is the part worth being clear about, because it is easy to think none of
it landed. All of the following is in the repo and running in the app:

| Source | What it became | Where |
| --- | --- | --- |
| Silman, *Reassess Your Chess* / *Endgame Course* | Rating-banded imbalance lessons, and the endgame ladder ordered by what actually decides games at each band | `src/content/lessons.ts`, `src/coach/endgames.ts` |
| Polgár, *Chess: 5334 Problems* | The mate-pattern ratio the tactics tiers are weighted by | `src/coach/tiers.ts` |
| Kotov, *Think Like a Grandmaster* | The candidate-move trainer — list them, order them, then calculate | `src/ui/screens/CandidateRunner.tsx`, `src/coach/drills.ts` |
| Nunn, *Secrets of Practical Chess* | "Loose pieces drop off" — the loose-piece scan | `src/coach/drills.ts` |

27 lessons carry a source line. That is the pattern to keep: a book goes in
this folder, the idea comes out into `src/content/`, and the idea is what ships.

## Where the books themselves can live

Three options, in the order I would pick them.

1. **A second, private repo.** `seanmacebo-ux/chess-books`, private, books
   committed normally. Nothing about it touches this repo — no submodule, no
   link. It is a shelf that happens to be in git, which means it is backed up
   and versioned and does not disappear when a container is reclaimed. This is
   the one I would do.
2. **Make this repo private.** Works, and keeps everything in one place. Costs
   you something: GitHub Pages from a private repo needs a paid plan, and the
   site is currently served from this repo for free.
3. **Not in git at all.** Any drive that syncs. Fine for storage; you lose the
   history, and you lose the ability to point a session at them.

## A note on where they went last time

Books were previously dropped into `scripts/raw/`, which is also gitignored.
When the container was reclaimed they went with it, because ignored files exist
only on the machine that made them. That is not a bug to fix — the ignore is
correct while this repo is public. It is the reason option 1 exists.
