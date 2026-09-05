# Books

## Put them here

Drop the files in this folder — `books/`. Nothing else to configure.

**This repository is PUBLIC**, so everything in here except this README is
gitignored. A committed PDF is a published PDF, and that is not yours to do
with someone else's book. Files you put here stay on your machine.

If you would rather they lived somewhere permanent, there is a private repo,
`seanmacebo-ux/chess-books`. And if git is being git, the simplest path that
has always worked: **send the file in the chat** and it gets committed for you.

## What actually happens to them — the honest version

A PDF in a folder teaches the app nothing. There is no mechanism by which a
file changes how the app plays or what it serves. The app is code and
structured data, and a book becomes app behaviour only when its content is
turned into that data — everything in `src/content/` got there this way.

There are two routes in, and only one of them is deterministic.

### 1. Positions — a machine can do this

Run:

    npm run import-book -- books/your-file.epd

Formats it reads:

| Format | What it is | What it gives |
|---|---|---|
| `.epd` | The standard study format: a position plus `bm` (best move) and an `id` | Position **and** the book's answer |
| `.fen` | Bare positions, one per line | Positions; the engine supplies the answer |
| `.pgn` | Games or annotated studies | Every mainline position past `--from-move` |

Nothing is taken on trust:

- every position is parsed and dropped if it is not legal
- every claimed move is played to confirm it exists in that position
- every position is searched, and the book's move is compared against the
  engine's

Positions that verify are written to `books/imported/<name>.json` with **the
book's move** — not the engine's. Positions that do not verify are kept in the
same file under `rejected`, with the reason, because a book is usually right
and an OCR slip usually is not, and the difference is worth reading before
anything is discarded.

Import a set and you get a count of each: agreed, disagreed, illegal move,
illegal position.

Note this is where content *stops* until someone moves it. The imported JSON
is not yet served by the app — promoting verified positions into
`src/coach/endgames.ts`, `src/coach/positional.ts` or the puzzle corpus is a
deliberate step, so nothing reaches training without being looked at.

### 2. Ideas — a person has to do this

Silman's imbalances, Kotov's candidate moves, Nunn's loose pieces: that is
prose, and no script converts an argument into a drill. Someone reads it and
encodes it as a lesson, a plan, or a breakdown.

That someone has previously written chess that was not on the board, and you
caught it. Which is why `scripts/verify-*.ts` exists: every move named in
prose is played against the real position, and every counting claim ("she has
seven moves") is counted. The verifiers do not care where a claim came from —
a book, or an invention — only whether the board agrees.

## What each book is actually for

| Book | Feeds |
|---|---|
| Silman, *Reassess Your Chess* | imbalances → `src/coach/positional.ts`, middlegame plans |
| Polgár, *5334 Problems* | mate and tactic positions → puzzle corpus (`.epd` imports cleanly) |
| Kotov, *Think Like a Grandmaster* | candidate-move method → the Kotov trainer, coached-game loop |
| Nunn, *Understanding Chess Middlegames* | loose pieces, plans → `src/content/middlegame.ts` |
| Dvoretsky, *Endgame Manual* | theoretical endings → `src/coach/endgames.ts` |
