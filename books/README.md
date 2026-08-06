# Books

**Put them here.** `books/` in the repo root. PDF, EPUB, PGN, photographed
pages — anything. Then say so, and I'll read them.

That works immediately. What it does not do is survive, and the difference
matters enough to be the rest of this file.

## Two different things

**Using them in a session.** Drop a file in `books/`, tell me it is there, I
read it and work from it. Nothing else needed. This is the answer most of the
time.

**Using them in EVERY session.** Needs the files to be in git, and that is
where it stops being simple:

> **`seanmacebo-ux/chess-coach` is a PUBLIC repository.**
> A book committed here is a book published to the internet under your name.

So `.gitignore` covers `books/*` — everything except this file. Not to stop you
using the folder. To stop a drag-and-drop turning into a publication.

Sessions run in a container that gets reclaimed when it goes idle, and ignored
files live only on the machine that made them. That is exactly what happened
last time: books went into `scripts/raw/`, also ignored, and went with the
container.

## Making them permanent

Pick one.

**1. A private repo. Recommended.** Make `seanmacebo-ux/chess-books`, private,
and commit the books there normally. Nothing links it to this repo. Then in any
session: *"add my chess-books repo"* — I can attach a private repo you own and
read from it. Books backed up and versioned, app repo still public and still
deploying free.

**2. Make this repo private.** One place for everything. Costs you: GitHub
Pages from a private repo needs a paid plan, and the site is served from this
repo for free right now.

**3. Don't persist them.** Upload per session, and let me extract what matters
into `src/content/` — which is what already happened, and the extracted version
is the part the app actually runs on.

## What already came out of the books

Worth being clear about, because it is easy to assume none of it landed:

| Source | What it became | Where |
| --- | --- | --- |
| Silman, *Reassess Your Chess* / *Endgame Course* | Rating-banded imbalance lessons; the endgame ladder ordered by what decides games at each band | `src/content/lessons.ts`, `src/coach/endgames.ts` |
| Polgár, *Chess: 5334 Problems* | The mate-pattern ratio the tactics tiers are weighted by | `src/coach/tiers.ts` |
| Kotov, *Think Like a Grandmaster* | The candidate-move trainer — list them, order them, then calculate | `src/ui/screens/CandidateRunner.tsx`, `src/coach/drills.ts` |
| Nunn, *Secrets of Practical Chess* | "Loose pieces drop off" — the loose-piece scan | `src/coach/drills.ts` |

27 lessons carry a source line. That is the pattern to keep: the book goes in
this folder, the idea comes out into `src/content/`, and the idea is what ships.
