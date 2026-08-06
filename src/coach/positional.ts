/**
 * Positional training positions, for the coached play-out runner.
 *
 * The positional tiers (tiers.ts) declare concept keys — outpost, open-file,
 * weak-square, prophylaxis — but until this file existed they had no content
 * behind them, so the whole positional pillar was a set of labels with nothing
 * to practise. The BACKLOG called this out: "the remaining tiers now get a free
 * board with the question pinned above it, which is honest but not graded."
 *
 * The design here is deliberately NOT a "find the move" puzzle. A positional
 * idea is understood by PLAYING it — you install the knight on the outpost and
 * then feel, over the next several moves, why the square is worth a pawn. So
 * each position names a `keyMove` (the thematic idea) and then hands you into a
 * play-out against the engine, with the coach showing the idea as it happens.
 *
 * On correctness — the hard-won lesson from endgames.ts applies double here. A
 * FEN that is legal but slightly wrong (a bishop one square off) teaches a
 * false habit and marks you down for playing correctly. Two defences:
 *
 *   1. Positions are sourced from REAL, named games and opening theory, not
 *      hand-composed. A Sveshnikov on the board is a Sveshnikov — there is no
 *      transcription to get wrong.
 *   2. Every position is checked by scripts/verify-positional.ts before it
 *      ships: the FEN is legal, the keyMove is legal, and — playing the keyMove
 *      out — the engine agrees it is sound (within a spread of its own best
 *      move). The engine cannot certify "this is an outpost"; that judgement is
 *      cross-checked by the council (Codex + Gemini) at build time.
 *
 * The teaching prose is the app's own wording of the idea. No book text is
 * reproduced — the concept comes out of My System, the sentences are ours.
 */

export interface PositionalPosition {
  id: string
  /** Concept keys, matching the `themes` on the positional tiers. */
  concepts: string[]
  /** Where the idea comes from — book/chapter or game. Shown as provenance. */
  source: string
  fen: string
  /** Which side you play. The engine plays the other. */
  youPlay: 'w' | 'b'
  /**
   * The thematic move, in UCI. This is the idea the position exists to teach —
   * finding it is step one, playing on from it is where the understanding is.
   */
  keyMove: string
  /** The same move in SAN, for display and coaching text. */
  keySan: string
  name: string
  /** Why this idea matters — the teaching, shown after the move is found. */
  why: string
  /** The idea, available on request. Never shown unasked. */
  hint: string
  /**
   * What you are trying to show over the play-out, in one line. Shown as the
   * goal while you play on against the engine after the key move.
   */
  plan: string
  /** Your moves in the play-out phase before the drill is scored complete. */
  playCap: number
}

/*
 * Every FEN below is a real position (opening theory or a named game), so there
 * is nothing to mis-transcribe. Verified by scripts/verify-positional.ts: legal,
 * key move legal, and the key move sound at depth against the engine's own best.
 */
export const POSITIONAL: PositionalPosition[] = [
  /* --------------------------------------------------- outpost: the d5 hole */
  {
    id: 'outpost-sveshnikov-d5',
    concepts: ['outpost', 'weak-square', 'open-file'],
    source: 'Sicilian Sveshnikov — the classic d5 outpost (My System: The Open File §6)',
    // Sveshnikov main line after 1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3
    // e5 6.Ndb5 d6 7.Bg5 a6 8.Na3 b5. White to move plants a knight on d5.
    fen: 'r1bqkb1r/5ppp/p1np1n2/1p2p1B1/4P3/N1N5/PPP2PPP/R2QKB1R w KQkq - 0 9',
    youPlay: 'w',
    keyMove: 'c3d5',
    keySan: 'Nd5',
    name: 'Plant the knight on the hole',
    why: 'Black played …e5 to gain space, and it cost him the d5 square forever — his c-pawn is long gone and the e-pawn can never come back, so no black pawn can ever attack d5 again. That is a permanent hole, and a knight planted there radiates into f6, e7 and c7, deep in Black\'s camp. Nd5 does not fear the trade either: after …Nxd5 exd5 the recapture hits the c6-knight with tempo and clamps the square with a pawn instead, leaving the d6-pawn backward and the c8-bishop cramped. That is exactly why Black often declines and plays …Be7 — the knight on d5 is too good to allow.',
    hint: 'You want the d5 square, permanently. Which piece can sit there where no pawn can ever chase it off?',
    plan: 'Occupy d5 and keep it. Every trade that keeps a white piece or pawn on d5 is fine — the square is the advantage.',
    playCap: 10,
  },
]

/** Positions matching any of these concept keys. */
export function positionalFor(concepts: string[]): PositionalPosition[] {
  if (concepts.length === 0) return []
  const want = new Set(concepts)
  return POSITIONAL.filter((p) => p.concepts.some((c) => want.has(c)))
}

export function positionalById(id: string): PositionalPosition | undefined {
  return POSITIONAL.find((p) => p.id === id)
}

/** Concept keys that actually have a position behind them. */
export const BACKED_POSITIONAL_CONCEPTS = new Set(POSITIONAL.flatMap((p) => p.concepts))
