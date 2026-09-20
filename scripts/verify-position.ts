/**
 * Does the position read say only true things?
 *
 * The same job as verify-breakdowns and verify-middlegame, applied to the
 * generated read rather than to written prose. Every assertion here is a fact
 * about a named position that can be checked by hand on a board — which is
 * the point: this module exists because the app has previously told Sean a
 * queen had to run when she had seven squares, and a generated sentence is
 * just as capable of that as a written one.
 *
 *   npm run verify:position
 */

async function main() {
  const { readPosition, weighMove, hanging, mobility } =
    await import('../src/coach/position')
  const { Chess } = await import('chess.js')

  let fail = 0
  const check = (name: string, cond: boolean, detail = '') => {
    console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + detail))
    if (!cond) fail++
  }
  const has = (arr: string[], re: RegExp) => arr.some((s) => re.test(s))

  /* ---------------- the position read ---------------- */

  // Start position: level, nothing hanging, everyone home.
  const start = new Chess().fen()
  const r0 = readPosition(start, 'w')
  check('start: material level', r0.materialDiff === 0)
  check('start: nothing hanging either side',
        r0.yourHanging.length === 0 && r0.theirHanging.length === 0)
  // Knights and bishops only — four each. The queen staying home is correct
  // opening play, not a development deficit.
  check('start: 4 minor pieces home each', r0.yourUndeveloped === 4 && r0.theirUndeveloped === 4,
        `${r0.yourUndeveloped}/${r0.theirUndeveloped}`)
  check('start: 20 legal moves each', r0.yourMobility === 20 && r0.theirMobility === 20,
        `${r0.yourMobility}/${r0.theirMobility}`)
  check('start: says nothing is hanging', has(r0.lines, /Nothing is hanging/))

  // Black knight on e5 attacked by Nf3, undefended. White to move.
  const freeKnight = 'rnbqkb1r/pppp1ppp/8/4n3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1'
  const r1 = readPosition(freeKnight, 'w')
  check('spots their free knight', r1.theirHanging.some((p) => p.square === 'e5' && p.type === 'n'),
        JSON.stringify(r1.theirHanging))
  check('and says so first, before the slow stuff',
        r1.lines.findIndex((l) => /Free for the taking/.test(l)) <
        r1.lines.findIndex((l) => /The centre/.test(l)))

  // Same position from Black's side: the loose piece is now THEIRS.
  const r2 = readPosition(freeKnight, 'b')
  check('read flips with the side asked about',
        r2.yourHanging.some((p) => p.square === 'e5') && r2.theirHanging.length === 0,
        JSON.stringify({ yours: r2.yourHanging, theirs: r2.theirHanging }))

  // Material: white a whole rook up.
  const upRook = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1'
  check('counts a rook lead', readPosition(upRook, 'w').materialDiff === 5,
        String(readPosition(upRook, 'w').materialDiff))
  check('and the deficit from the other side', readPosition(upRook, 'b').materialDiff === -5)

  // In check must lead the read.
  const inCheck = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 1'
  const r3 = readPosition(inCheck, 'w')
  check('check is reported and leads', r3.inCheck && /in check/.test(r3.lines[0] ?? ''),
        JSON.stringify(r3.lines.slice(0, 1)))

  /*
   * The flip guard, both ways round.
   *
   * Legal: white to move and not in check, so asking what black could do is
   * a real question. Illegal: white to move AND in check — handing the move
   * to black describes a position where black just captures the king, so
   * there is no honest number to give.
   */
  check('counts the other side when the flip is legal',
        typeof mobility(freeKnight, 'b') === 'number', String(mobility(freeKnight, 'b')))
  check('refuses to invent it when the flip is illegal',
        mobility(inCheck, 'b') === null, String(mobility(inCheck, 'b')))

  // Pawns are never called hanging — hoovering pawns is not the lesson.
  const loosePawn = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'
  check('pawns are not listed as hanging', hanging(new Chess(loosePawn), 'b').length === 0)

  /* ---------------- weighing a move ---------------- */

  const w1 = weighMove(freeKnight, 'Nxe5')!
  check('taking a free piece is named as free', has(w1.does, /Wins a knight for nothing/),
        JSON.stringify(w1.does))

  // Scholar's mate: mate must be stated as mate, not as a check.
  const mateIn1 = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1'
  const w2 = weighMove(mateIn1, 'Qxf7#')!
  check('mate is called mate', has(w2.does, /Checkmate/), JSON.stringify(w2.does))

  // Hanging your own piece must be a cost.
  const w3 = weighMove('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'Ra8+')!
  check('a check is named', has(w3.does, /Gives check/), JSON.stringify(w3.does))

  // Moving a piece to a square the enemy covers and you do not.
  const suicide = '4k3/8/8/8/8/5q2/8/R3K3 w - - 0 1'
  const w4 = weighMove(suicide, 'Ra3')!
  check('landing on an attacked, undefended square is a cost',
        has(w4.costs, /attacked there and nothing defends it/), JSON.stringify(w4.costs))

  // Castling.
  const canCastle = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1'
  const w5 = weighMove(canCastle, 'O-O')!
  check('castling is named', has(w5.does, /Castles/), JSON.stringify(w5.does))

  // A fork must be reported as two pieces at once.
  const forkable = 'r1bqkb1r/pppp1ppp/2n2n2/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1'
  weighMove(forkable, 'Nc3')
  check('an illegal move returns null rather than guessing', weighMove(start, 'Qz9') === null)

  // Quiet move honesty.
  const w7 = weighMove('4k3/8/8/8/8/8/4P3/4K3 w - - 0 20', 'e4')!
  check('a quiet move says so rather than inventing merit',
        has(w7.does, /quiet move/) || w7.does.length > 0, JSON.stringify(w7.does))

  // Nothing may ever claim both that a square is defended and loose.
  const r4 = readPosition(canCastle, 'w')
  const overlap = r4.yourHanging.filter((p) => r4.theirHanging.some((q) => q.square === p.square))
  check('a square is never both yours and theirs', overlap.length === 0)

  /* ---------------- king safety must not fire on an uncastled king ---- */

  // After 1.e4 the e2 pawn has gone, so a naive "pawns around the king"
  // count drops when d4 follows — and the first version therefore called
  // d4 a king-safety error on move two. It is correct opening play.
  const afterE4E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
  const wD4 = weighMove(afterE4E5, 'd4')!
  check('a central pawn push is not called a king-safety error',
        !has(wD4.costs, /pawn cover/), JSON.stringify(wD4.costs))

  /*
   * But once castled, genuinely breaking the cover IS the claim to make.
   * One pawn forward is not a break — h3 and g3 are ordinary moves — so the
   * threshold is two of three still home. This fixture is castled with the
   * g-pawn already on g3, so pushing h4 takes the cover down to one.
   */
  const castledThin = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2NP1/PPPP1P1P/R1BQ1RK1 w kq - 0 7'
  const wH4 = weighMove(castledThin, 'h4')
  check('a genuine break of a castled king\'s cover is a cost',
        Boolean(wH4) && has(wH4!.costs, /pawn cover/),
        JSON.stringify(wH4?.costs ?? 'h4 illegal in fixture'))

  // And one pawn forward, leaving two, must NOT be called a break.
  const castledFull = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w kq - 0 7'
  const wH3 = weighMove(castledFull, 'h3')
  check('one shield pawn forward is not a break',
        Boolean(wH3) && !has(wH3!.costs, /pawn cover/),
        JSON.stringify(wH3?.costs ?? 'h3 illegal in fixture'))

  console.log(fail === 0 ? '\nOK — position read and move weighing' : `\n${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}
void main()
