/**
 * Turning a perfect engine into a believable 1400.
 *
 * Naive weakening (`UCI_LimitStrength`) produces a bot that plays four
 * grandmaster moves then hangs a rook for no reason. Humans don't fail like
 * that — they play slightly-off moves constantly and catastrophically-off
 * moves rarely.
 *
 * Style re-weights the same candidate pool rather than changing its strength.
 * Two bots at 1400 shed a similar number of centipawns per move; style decides
 * which moves they shed them on. That keeps strength and personality
 * independent, which is the whole point — you can face an aggressive 1400 and
 * a solid 1400 and lose to both for completely different reasons.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT NO LONGER SAYS IT.
 *
 * For a long time the answer here was a WIDE candidate pool — 800 chose among
 * twenty-eight engine moves — with temperature deciding how far down the list
 * the bot reached. The reasoning was sound and the measurement behind it was
 * real: sampling uniformly over a strong engine's top ten is still too strong,
 * because all ten are decent, and no temperature fixes a pool with no bad
 * moves in it. If the only way to make a bad move is to pick one off a list,
 * the list has to contain bad moves.
 *
 * That premise is what changed. engine/vision.ts gives the policy a second
 * way to make a bad move, and a truer one: play a move whose refutation you
 * did not see. A bad move no longer has to be fetched from the twenty-eighth
 * slot of a list nobody would consider — it can be the second move you looked
 * at, which you played because you missed the knight coming back.
 *
 * And the wide pool was doing damage that was invisible until something
 * measured the right thing. scripts/diag-punish.ts sat every band down to one
 * fixed exam of positions where a capture wins a piece and is the engine's own
 * best move by two clear pawns. The 800 took it 21.3% of the time — less often
 * than the 550 — because with twenty-eight candidates at temperature 286, a
 * move two pawns better than the alternatives gets twice the weight of any ONE
 * of twenty-seven others, and loses to the crowd. A wide pool does not only
 * let a bot find bad moves; it stops it finding obvious good ones.
 *
 * ONE DIAL NOW: SIGHT. The long note above ANCHORS has the calibration data
 * that forced it, including the ladder in which four rungs out of seven were
 * clean sweeps and 1400 and 1600 turned out to be the same opponent. The
 * short version: depth and multipv now only FIND candidate moves, temperature
 * only breaks ties between moves that look equally fine, the one-ply share
 * supplies the bottom of the ladder, and every mistake above that comes from
 * not seeing what the move allows.
 *
 * CALIBRATION HONESTY. The targets are drawn from published rating-band
 * averages, and the numbers in ANCHORS are a starting point rather than a
 * result. scripts/tune-sight.ts measures what each band actually sheds over a
 * fixed position set — running THIS policy, not a model of it, which is the
 * mistake its predecessor made — and scripts/calibrate.ts plays whole games
 * and decides. calibrate has overruled this table three times.
 *
 * And the table is not the last word at runtime either. `bandProfile` applies
 * whatever calibration.ts has measured from games actually played. The
 * correction is bounded, damped, needs a real sample before it does anything,
 * and never reads the RESULT of a game — only the bot's own move quality. It
 * now moves SIGHT rather than temperature, because a correction applied to a
 * knob that no longer drives strength would quietly do nothing.
 */

import { Chess } from 'chess.js'
import type { Band, Line, Style, UciMove } from './types'
import { BANDS, lineScore, nearestBand } from './types'
import { factorFor, registerTargets } from './calibration'
import { isBlindTo, seesReply, shapeOfReply } from './vision'

export interface BandProfile {
  band: Band
  /** Average centipawn loss we're aiming to reproduce. */
  targetAcpl: number
  /**
   * THE STRENGTH DIAL: how reliably this rating sees a refutation coming,
   * before the shape of the move is taken into account. 0..1.
   *
   * Everything else in this interface is support. See the note above ANCHORS
   * for why strength is one monotone parameter now instead of four that
   * fought each other.
   */
  sight: number
  /**
   * Softmax temperature, in centipawns.
   *
   * Small and nearly flat across the ladder now. It decides WHICH of several
   * moves that look equally fine gets played — it is not where mistakes come
   * from any more.
   */
  temperature: number
  /**
   * Share of moves taken from the one-ply policy — looking at what a move
   * wins and never at the answer.
   *
   * Kept because it is a real description of a beginner and it is the only
   * thing with enough headroom to reach 210 acpl, but it now falls smoothly
   * instead of dropping thirteenfold in one step at 800.
   */
  naiveShare: number
  /** Search depth for candidate generation. */
  depth: number
  /** How many candidates to consider — the shortlist. */
  multipv: number
}

/**
 * THE BUG THIS TABLE USED TO HAVE, WHICH WAS THE WHOLE PROBLEM.
 *
 * These numbers were keyed by Band, and Band is one of eight fixed values.
 * Every opponent's rating was snapped to the nearest one with nearestBand()
 * before anything was looked up. The roster does not use those eight values
 * — it spaces eleven bots about 150 apart — so the snapping quietly collapsed
 * the ladder:
 *
 *     Bud 350, Kit 550 and Pip 800  →  all band 800, byte for byte identical
 *     Nadia 950 and Walter 1100     →  both band 1000
 *     Darius 1550 and Ren 1700      →  both band 1600
 *
 * Eleven opponents, seven strengths, and the three at the bottom were one bot
 * wearing three faces. Worse: the weakest thing in the app was an 800 aimed
 * at a player rated 316. The roster's own header notices the closed door and
 * adds Bud and Kit to open it — and they snapped straight back to 800, so the
 * fix was a rename. Sean's read of this was "the bots we are using are not
 * right", and he was describing something real and precise.
 *
 * So the table is now ANCHORS and everything between them is interpolated.
 * A 1100 bot is genuinely between the 1000 and the 1200; a 350 bot is a 350
 * bot. Bands survive only where they belong — calibration measures per band,
 * because a learned correction needs a sample to learn from and continuous
 * ratings would never accumulate one.
 *
 * THE BOTTOM THREE, AND HOW THEY WERE SET.
 *
 * They were first guessed — 320 acpl for the 350 bot — and self-play
 * measured 178.8, with the 350 and the 550 landing on the same number inside
 * their intervals. Raising temperature moved neither, which is the signature
 * of a saturated knob.
 *
 * So scripts/diag-floor.ts measured the two policies that bracket everything
 * a bot can be:
 *
 *     uniformly random legal move   345.8 acpl, something hanging 53% of the time
 *     one-ply greedy (see naiveMove) 221.0 acpl, something hanging 32% of the time
 *
 * That settles two arguments at once. 320 was NOT impossible — but it is 92%
 * of the way to moving at random, and a 350-rated person is nothing like a
 * random mover. They develop pieces, they castle eventually, they take what
 * is free. What they do not do is look at the reply, and that player has now
 * been measured: 221.
 *
 * So the bottom of the ladder is built out of that policy rather than out of
 * temperature. Bud is mostly a one-ply player, Kit is part of one, Pip is
 * mostly the search — which is a description of how beginners actually
 * improve, and it gives the three of them genuinely different characters
 * rather than three settings of the same dial.
 */
/*
 * THE CLIFF AT 800, AND WHAT IT DOES TO THE LADDER.
 *
 * `blunderChance` is the share of moves taken from the one-ply policy, and it
 * falls 0.45 -> 0.29 -> 0.022 across the bottom three bands. That is a
 * thirteenfold drop in one step, and it has a consequence nobody looked for
 * until scripts/diag-punish.ts measured it: naiveMove GRABS MATERIAL, because
 * faceValue is what it maximises. So the two weakest bots in the roster have
 * a greedy reflex and the 800 does not.
 *
 * Measured, on one fixed exam of positions where taking is the engine's own
 * best move and beats everything else by two pawns:
 *
 *     350   22.5%   [15-33]
 *     550   28.7%   [20-39]
 *     800   21.3%   [14-31]     <-- below both bots beneath it
 *    1100   41.3%   [31-52]
 *    1400   58.8%   [48-69]
 *    2200   80.0%   [70-87]
 *
 * The rung is real rather than noise, and it points at something larger than
 * one anchor being wrong. At 800 every move comes from a softmax at
 * temperature 286 across 28 candidates, and a capture that is 200cp better
 * than the alternatives only gets exp(200/286) = twice the weight of any one
 * of them. Spread over twenty-seven others, the free piece loses most of the
 * time — which is what the 21.3% is.
 *
 * But nobody considers twenty-eight moves. The wide candidate list is a
 * device for letting a softmax reach a bad move, and engine/vision.ts now
 * does that job properly by modelling what a player at this rating does not
 * SEE. The two mechanisms are redundant, and the softmax one is the one that
 * also throws away moves a player would obviously find.
 *
 * The fix this points to is to narrow the softmax to a shortlist and let
 * blindness supply the errors — the same argument vision.ts makes, applied to
 * the other half of the policy. It would move every band's acpl and so needs
 * a full recalibration behind it, which is why it is written down here rather
 * than done in passing.
 */
interface Anchor extends Omit<BandProfile, 'band'> {
  elo: number
}

/*
 * MEASURED IN SELF-PLAY (npm run diag:bots), referee depth 14. The interval
 * is what decides whether a number moves — this file's history is three
 * rounds of tuning on differences smaller than the noise.
 *
 *          target    before          after the change      moves
 *    350      210    226.5 +/- 17    (unchanged)            763
 *    550      180    154.1 +/- 18 -> 197.1 +/- 17           711
 *    800      150    139.8 +/- 13    (unchanged)            582
 *   1400       75     87.4 +/- 10 ->  72.9 +/-  6           755
 *
 * Only the two outside their intervals moved: 550's one-ply share 0.18 ->
 * 0.29, and 1400's temperature 157 -> 138. Both now contain their target,
 * and 1400 is dead on it. 350 and 800 sit at or inside their intervals and
 * were left alone, because nudging a reading that is already consistent with
 * its target is exactly the mistake this file has made three times.
 *
 * And the thing that was actually broken is now true: the ladder descends.
 *
 *    226 -> 197 -> 140 -> 73 acpl
 *
 * Before the band-snapping fix, 350, 550 and 800 were the same number,
 * because they were the same bot.
 *
 * THEN THE OPENING BOOK LANDED, AND IT MOVED ONE OF THEM.
 *
 * engine/book.ts gives every bot a repertoire, which means some of its moves
 * are now DECIDED rather than sampled — and a decided move sheds nothing.
 * Re-measured with the book in play (diag:bots runs it by default; pass
 * --no-book for the policy alone):
 *
 *          target    without book     with book        verdict
 *    350      210    226.5 +/- 17 ->  241.4 +/- 20     overlapping, no change
 *    800      150    139.8 +/- 13 ->  164.0 +/- 15     barely overlapping
 *   1400       75     72.9 +/-  6 ->   64.6 +/-  7     STRONGER, target now outside
 *
 * 1400 is the one to look at. Sofia carries nine to eleven plies of sound
 * theory, which in a ninety-ply game is about 11% of her moves at near-zero
 * loss — almost exactly the 11% drop. The weak bots have two-to-five-ply
 * books and did not move.
 *
 * It is deliberately NOT tuned away, for two reasons. The sample is six
 * games, and tuning on six games is the mistake recorded three paragraphs
 * up. And there is a real question underneath it: a 1400 who has memorised
 * eleven moves of the Queen's Gambit IS still a 1400, so a lower acpl may be
 * the correct reading of the same playing strength rather than a drift in
 * it. ACPL is a proxy; scripts/calibrate.ts measures RESULTS and is the
 * thing that settles this one. Run that before touching 1400's temperature.
 */
/*
 * ONE DIAL, AND WHY THE LADDER NEEDED REBUILDING AROUND IT.
 *
 * The old table moved four things at once — temperature, multipv, depth and
 * the one-ply share — and the calibration harness measured what that produced:
 *
 *      800 vs 1000   1000 won 6-0
 *     1000 vs 1200   1200 won 6-0
 *     1200 vs 1400   1400 scored 67%
 *     1400 vs 1600   1600 scored 50%   <-- the same opponent twice
 *     1600 vs 1800   1800 won 6-0
 *     1800 vs 2000   2000 scored 83%
 *     2000 vs 2200   2200 won 6-0
 *
 * A 200-point step should score about 76%. Four of seven rungs were clean
 * sweeps and one was a coin toss: a dial with cliffs AND a dead zone, which
 * is what "the difficulty levels don't work well" feels like from the other
 * side of the board.
 *
 * The cause was the knobs fighting. Temperature stopped falling above 1400
 * and began RISING (138 -> 153 -> 165) because multipv was shrinking at the
 * same time and the two had been tuned against each other; that crossover is
 * exactly where 1400 and 1600 collapsed into one bot. At the bottom the
 * one-ply share fell thirteenfold in a single step and took the ladder's
 * biggest cliff with it.
 *
 * So strength is ONE monotone parameter now: SIGHT, how reliably this rating
 * sees the refutation of a move it is considering. The rest stop being error
 * sources:
 *
 *   DEPTH is no longer a handicap. A weak human does not search shallowly and
 *   accurately — they search selectively and miss things, which is what sight
 *   models. Searching at depth 8 and being blind is a far better description
 *   of a beginner than searching at depth 4 and being sharp, and it has a
 *   second benefit the old table could not have: at depth 4 only 56-82% of
 *   lines came back with a pv[1] at all, so the refutation the whole model
 *   rests on was missing a third of the time at the bands that needed it most.
 *
 *   MULTIPV is the shortlist, and it is flat. Nobody considers thirty-four
 *   moves. A person looks at a handful and asks "does this work?" — and the
 *   answer to THAT is what they get wrong. The wide candidate list was only
 *   ever a device for letting a softmax reach a bad move; sight does that job
 *   properly, and without also throwing away moves a player would obviously
 *   find. It is what made the 800 punish free material less often than the
 *   550 (21.3% against 28.7%).
 *
 *   TEMPERATURE is small and nearly flat. It decides which of several moves
 *   that look equally fine gets played. That is all it was ever good for.
 *
 *   THE ONE-PLY SHARE survives, because looking at what a move wins and never
 *   at the answer IS what a beginner does, and at 221 acpl measured it is the
 *   only thing with the headroom to reach the 350's target. It now falls
 *   smoothly instead of off a cliff.
 *
 * The sight column starts from vision.ts's own curve and is tuned against
 * measurement from there; scripts/tune-sight.ts is the instrument.
 */
/*
 * THE MEASUREMENTS THAT SET THIS TABLE.
 *
 * Round one of the rebuilt design measured, over tune-sight's fixed position
 * set: 800 at 114.8 against a 150 target, 1400 at 72.5 against 75, 2200 at
 * 38.1 against 30. Strictly ordered — the first time this ladder had been —
 * but too strong at the bottom and too weak at the top, so the bands sat
 * closer together than their labels claimed.
 *
 * Round two dropped temperature and steepened sight: 119.7 / 87.6 / 77.5 /
 * 71.4 / 53.8 / 43.1 / 31.1 / 21.8. Still ordered, spread now a factor of
 * 5.5 where the targets want 5.0, and uniformly about 17% too strong.
 *
 * Then one knob at a time at band 800, which is the only way this file has
 * ever learned anything true about itself. Sight, with everything else held:
 *
 *     0.05  128.6     0.50  119.7     0.80   92.3
 *     0.20  129.2     0.65  103.6     0.95   74.0
 *     0.35  120.6
 *
 * Fifty-five centipawns of range — but look at which END. Sight can make a
 * band much STRONGER and tops out around 129 when the bot is effectively
 * blind, which is below the 150 the 800 is supposed to shed. You cannot
 * reach the bottom of this ladder by taking sight away, because a bot
 * choosing among six engine-ranked moves has no move bad enough to find.
 *
 * Temperature, same band, everything else held:
 *
 *      40  108.1     100  124.0     190  137.3
 *      70  116.8     140  134.6     250  138.4
 *
 * So the honest shape of this design is NOT the one dial it was pitched as.
 * It is three, and what matters is that they are monotone and do not fight:
 *
 *   AT THE BOTTOM, error is sloppiness among plausible moves plus one-ply
 *   greed. Temperature and naiveShare carry it. That is also a fair
 *   description of the player — a 400 is not someone with sharp judgement
 *   and a blind spot, they are loose about everything.
 *
 *   AT THE TOP, every candidate is good and the softmax is sharp, so the only
 *   way left to lose centipawns is to miss what a move allows. Sight carries
 *   it, and has to, because temperature that low cannot generate the error.
 *
 * That is a model of how people actually improve rather than one parameter
 * scaled, and the ladder it produces is ordered, which the old four-knob
 * table never was.
 *
 * THE RULE THAT REPLACED "ONE DIAL": every column below is monotone in
 * rating, and verify:policy fails if one stops being. Non-monotonicity is
 * what put 1400 and 1600 at 50% against each other; having more than one
 * parameter never was.
 */
/*
 * ROUND FOUR: TUNED AGAINST THE HEAD-TO-HEAD, BECAUSE NOTHING CHEAPER WORKS.
 *
 * The thirty-game ladder on round three's table:
 *
 *     800 vs 1000  87%     1400 vs 1600  68%     2000 vs 2200  68%
 *    1000 vs 1200  73%     1600 vs 1800  73%
 *    1200 vs 1400  93%     1800 vs 2000  73%
 *
 * Two rungs too wide, two clearing separation by three Elo. And no fast proxy
 * predicts which: neither the acpl ratio nor the blunder rate nor the rate of
 * 400cp moves lines up with those scores, because tune-sight's positions come
 * from random play and nothing in a fixed position set captures one bad move
 * dragging a whole game somewhere worse. So the changes below are each aimed
 * at a measured rung and are checked by replaying that rung:
 *
 *   1400 sight 0.77 -> 0.71. It was the largest sight step on the ladder,
 *   0.13, and sat between the widest rung (93% from 1200) and one of the two
 *   narrowest (68% to 1600). One move closes the first and opens the second.
 *
 *   2200 sight 0.95 -> 0.975. 68% from 2000 with a floor of +3.
 *
 * Round four's thirty-game results on those changes: 350 vs 550 67%,
 * 550 vs 800 80%, 800 vs 1000 78%, 1200 vs 1400 82%, 1400 vs 1600 55%,
 * 2000 vs 2200 75%. Chaining the rungs into rough Elo puts 1400 too close to
 * 1600 and too far from 1200 — one cause, so one fix: 1400 down again, 0.71 ->
 * 0.67. Kit up a little (sight 0.42, one-ply 0.33) to open Bud -> Kit (67%)
 * and ease Kit -> Pip (80%).
 *
 * Round five: 350 vs 550 87% (overshot), 550 vs 800 78%, 1200 vs 1400 82%
 * (UNCHANGED — the same 24.5/30 as round four), 1400 vs 1600 65%.
 *
 * The unchanged rung is informative. calibrate seeds every game, so a change
 * that alters few decisions in those thirty games replays the same thirty
 * results, and taking sight from 0.71 to 0.67 evidently altered few. At 1400
 * sight is a weak lever on who wins, so the 1400 moves on temperature
 * instead — 54 -> 64, still strictly between 1200's 72 and 1600's 52 so the
 * column stays monotone. Kit goes to the midpoint of the two settings tried.
 *
 * Then the whole ladder on a fresh, untuned set of games (--seed 1), pooled
 * with the earlier set wherever a rung's two bands had not changed between:
 *
 *     350 vs  550   70.8%  (60)     1400 vs 1600   73.0%  (60)
 *     550 vs  800   76.7%  (60)     1600 vs 1800   73.0%  (60)
 *     800 vs 1000   81.7%  (60)     1800 vs 2000   75.8%  (60)
 *    1000 vs 1200   90.0%  (30)     2000 vs 2200   77.5%  (60)
 *    1200 vs 1400   65.8%  (60)
 *
 * The fresh games were worth running: Kit vs Pip read 88% on the tuned set
 * and 65% on the fresh one, and pooled sits on target — the "slightly wide"
 * rung was the particular thirty games. The two misses that survived share a
 * cause, 1200 placed too high, so 1200 alone moves: temperature 72 -> 82,
 * still strictly between 1000's 95 and 1400's 64.
 *
 *   350 and 550 sight down to 0.30 and 0.38. Below about 0.35 sight barely
 *   moves the search path (the band-800 sweep: 128.6 at 0.05, 129.2 at 0.20),
 *   so this is nearly free in centipawns — but naiveMove now has to NOTICE a
 *   capture at this sight, and the bottom of the ladder took free material at
 *   a flat 41 / 37.5 / 37.5 because the one-ply policy never missed one.
 */
const ANCHORS: Anchor[] = [
  { elo: 350, targetAcpl: 210, sight: 0.3, naiveShare: 0.46, temperature: 190, depth: 8, multipv: 6 },
  { elo: 550, targetAcpl: 180, sight: 0.4, naiveShare: 0.345, temperature: 160, depth: 8, multipv: 6 },
  { elo: 800, targetAcpl: 150, sight: 0.48, naiveShare: 0.26, temperature: 130, depth: 9, multipv: 6 },
  { elo: 1000, targetAcpl: 120, sight: 0.56, naiveShare: 0.14, temperature: 95, depth: 9, multipv: 6 },
  { elo: 1200, targetAcpl: 95, sight: 0.64, naiveShare: 0.06, temperature: 82, depth: 10, multipv: 6 },
  { elo: 1400, targetAcpl: 75, sight: 0.67, naiveShare: 0.02, temperature: 64, depth: 10, multipv: 6 },
  { elo: 1600, targetAcpl: 60, sight: 0.83, naiveShare: 0.01, temperature: 52, depth: 11, multipv: 6 },
  { elo: 1800, targetAcpl: 48, sight: 0.9, naiveShare: 0.005, temperature: 46, depth: 11, multipv: 6 },
  { elo: 2000, targetAcpl: 38, sight: 0.93, naiveShare: 0.002, temperature: 40, depth: 12, multipv: 6 },
  { elo: 2200, targetAcpl: 30, sight: 0.975, naiveShare: 0.001, temperature: 36, depth: 13, multipv: 6 },
]

/** Linear between a and b at position t in [0,1]. */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Geometric between a and b — the right shape for a scale parameter.
 *
 * Temperature and blunder chance both span more than an order of magnitude
 * across the ladder, and halfway between 0.14 and 0.004 is not 0.072: a bot
 * at the midpoint should be about as far from each end in ratio, not in
 * subtraction. Linear interpolation of blunderChance would leave a 1000-rated
 * bot blundering at nearly the rate of a 350.
 */
const glerp = (a: number, b: number, t: number) =>
  a > 0 && b > 0 ? a * Math.pow(b / a, t) : lerp(a, b, t)

/** The two anchors an Elo falls between, and how far along it sits. */
function bracket(elo: number): { lo: Anchor; hi: Anchor; t: number } {
  const first = ANCHORS[0]!
  const last = ANCHORS[ANCHORS.length - 1]!
  if (elo <= first.elo) return { lo: first, hi: first, t: 0 }
  if (elo >= last.elo) return { lo: last, hi: last, t: 0 }
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const lo = ANCHORS[i]!
    const hi = ANCHORS[i + 1]!
    if (elo <= hi.elo) return { lo, hi, t: (elo - lo.elo) / (hi.elo - lo.elo) }
  }
  return { lo: last, hi: last, t: 0 }
}

/*
 * The targets above are what each band is SUPPOSED to shed. calibration.ts
 * measures what it actually sheds in real games and hands back a multiplier;
 * registering them here rather than importing PROFILES over there keeps the
 * two modules from forming a load-time cycle.
 */
registerTargets(
  Object.fromEntries(
    BANDS.map((b) => [b, ANCHORS.find((a) => a.elo === b)?.targetAcpl ?? 0]),
  ) as Record<Band, number>,
)

/**
 * The opponent a given rating should be, at that rating and not at the
 * nearest of eight.
 */
export function profileFor(elo: number): BandProfile {
  const { lo, hi, t } = bracket(elo)
  const base: Omit<BandProfile, 'band'> = {
    targetAcpl: Math.round(lerp(lo.targetAcpl, hi.targetAcpl, t)),
    // Linear: sight is a probability between two probabilities, not a scale
    // parameter, and halfway between 0.46 and 0.98 really is 0.72.
    sight: lerp(lo.sight, hi.sight, t),
    temperature: Math.round(glerp(lo.temperature, hi.temperature, t)),
    naiveShare: glerp(lo.naiveShare, hi.naiveShare, t),
    depth: Math.round(lerp(lo.depth, hi.depth, t)),
    multipv: Math.round(lerp(lo.multipv, hi.multipv, t)),
  }
  // Calibration still works in bands, because a learned correction needs a
  // sample and continuous ratings would spread one too thin to ever act on.
  const band = nearestBand(elo)
  // Everything the app has learned about this band from games actually
  // played. 1 until a band has a real sample, so day one is unchanged.
  const factor = factorFor(band)
  return {
    band,
    ...base,
    /*
     * The learned correction now moves SIGHT, because sight is what strength
     * is. Multiplying temperature was the right lever when temperature was
     * the error source; it is not any more, and a correction applied to a
     * knob that no longer drives strength would quietly do nothing.
     *
     * Inverted, because the factor is "shed more" and sight is "err less":
     * a band measured too strong gets factor > 1 and should SEE less.
     */
    sight: Math.max(0.2, Math.min(0.995, base.sight / Math.max(0.5, factor))),
    temperature: Math.round(base.temperature * factor),
    /*
     * The one-ply path is the knob with real headroom — the softmax can only
     * ever be as loose as the candidate pool — so it carries the correction
     * too, at half strength.
     *
     * The ceiling used to be a third of moves, on the grounds that past that
     * a bot stops reading as a weak human and starts reading as broken. That
     * was true of the old path, which played a uniformly random legal move.
     * It is not true of this one: looking exactly one move ahead IS what a
     * beginner does, and a bot that does it most of the time reads as a
     * beginner rather than as a fault. Measured at 221 acpl on its own, which
     * is a real player and not noise.
     */
    naiveShare: Math.min(0.6, base.naiveShare * (1 + (factor - 1) * 0.5)),
  }
}

/**
  * Kept for the band-keyed harnesses (calibrate, tune-sight, measure-acpl),
 * which iterate BANDS and mean exactly those values. Identical to profileFor
 * at every band, because every band is an anchor.
 */
export const bandProfile = profileFor

/* ------------------------------------------------------------------ */
/* Move features                                                       */
/* ------------------------------------------------------------------ */

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

export interface MoveFeatures {
  uci: UciMove
  isCapture: boolean
  givesCheck: boolean
  isPromotion: boolean
  capturedValue: number
  movedValue: number
  /** Chebyshev distance from the destination square to the enemy king (0-7). */
  distToEnemyKing: number
  /** Does this move get closer to the enemy king than it started? */
  approachesKing: boolean
  isPawnMove: boolean
  /** No capture, no check, no promotion. */
  isQuiet: boolean
  /** Leaving the back rank in the opening. */
  isDeveloping: boolean
  /** Queen leaving home before move 8 — the classic beginner sin. */
  isEarlyQueenSortie: boolean
  /** Heavy piece landing on a file with no friendly pawn. */
  toOpenFile: boolean
  /** Gives up material on the spot (captures less than it risks, or is a pure offer). */
  isSacrificial: boolean
}

function fileOf(sq: string): number {
  return sq.charCodeAt(0) - 97
}
function rankOf(sq: string): number {
  return Number(sq[1]) - 1
}
function chebyshev(a: string, b: string): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)))
}

function findKing(chess: Chess, color: 'w' | 'b'): string | null {
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) return sq.square
    }
  }
  return null
}

/** True if `color` has a pawn anywhere on the file containing `sq`. */
function hasFriendlyPawnOnFile(chess: Chess, sq: string, color: 'w' | 'b'): boolean {
  const f = fileOf(sq)
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'p' && cell.color === color && fileOf(cell.square) === f) {
        return true
      }
    }
  }
  return false
}

/**
 * Describe one candidate move. Returns null if the move is illegal in `fen`
 * (which can happen if the engine and the board have drifted apart).
 */
export function describeMove(fen: string, uci: UciMove): MoveFeatures | null {
  const chess = new Chess(fen)
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci.length > 4 ? uci[4] : undefined

  const legal = chess
    .moves({ verbose: true })
    .find((m) => m.from === from && m.to === to && (!promotion || m.promotion === promotion))
  if (!legal) return null

  const mover = chess.turn()
  const enemy = mover === 'w' ? 'b' : 'w'
  const enemyKing = findKing(chess, enemy)
  const moveNumber = Number(fen.split(' ')[5] ?? 1)

  const movedValue = VALUE[legal.piece] ?? 0
  const capturedValue = legal.captured ? (VALUE[legal.captured] ?? 0) : 0

  chess.move({ from, to, promotion })
  const givesCheck = chess.isCheck()
  chess.undo()

  const distBefore = enemyKing ? chebyshev(from, enemyKing) : 8
  const distAfter = enemyKing ? chebyshev(to, enemyKing) : 8

  const isCapture = Boolean(legal.captured)
  const isPromotion = Boolean(legal.promotion)
  const homeRank = mover === 'w' ? 0 : 7

  // Cheap sacrifice heuristic: we're a heavy piece moving into a square the
  // enemy attacks, taking less than we're worth. Not SEE, but it catches the
  // shape of an offer without a second engine call per candidate.
  const isSacrificial =
    movedValue >= 300 && capturedValue < movedValue - 100 && chess.isAttacked(to as never, enemy)

  return {
    uci,
    isCapture,
    givesCheck,
    isPromotion,
    capturedValue,
    movedValue,
    distToEnemyKing: distAfter,
    approachesKing: distAfter < distBefore,
    isPawnMove: legal.piece === 'p',
    isQuiet: !isCapture && !givesCheck && !isPromotion,
    isDeveloping: rankOf(from) === homeRank && legal.piece !== 'k' && moveNumber <= 12,
    isEarlyQueenSortie: legal.piece === 'q' && rankOf(from) === homeRank && moveNumber < 8,
    toOpenFile:
      (legal.piece === 'r' || legal.piece === 'q') && !hasFriendlyPawnOnFile(chess, to, mover),
    isSacrificial,
  }
}

/* ------------------------------------------------------------------ */
/* Style                                                               */
/* ------------------------------------------------------------------ */

/**
 * Multiplier applied to a candidate's sampling weight. 1.0 is neutral.
 * Kept deliberately mild — style should colour the choice, not override
 * strength. Anything past ~2x and a "tactical" 1400 starts playing like a
 * 900 who only knows how to give check.
 */
export function styleWeight(f: MoveFeatures, style: Style): number {
  let w = 1

  switch (style) {
    case 'human':
      return 1

    /*
     * AGGRESSIVE IS ABOUT THE KING, NOT ABOUT CAPTURING.
     *
     * Measured, not guessed: scripts/verify-style.ts found this style and
     * `tactical` choosing the same move 88% of the time, with identical
     * character (53% forcing, 47% quiet). Both tables boosted checks by ~1.85
     * and captures by ~1.5 and penalised quiet moves by ~0.68; the only
     * differences were king-proximity here and promotion/sacrifice there, and
     * promotions and sacrifices barely occur in a middlegame. Five styles,
     * two of them the same bot with two names — which is exactly what "our
     * bots are too simple" feels like from the other side of the board.
     *
     * So the two are separated by WHAT THEY WANT rather than by how hard they
     * want it. This one wants to get at the king: proximity dominates, and a
     * capture is only interesting if it happens near the king. A rook taking
     * a pawn on the queenside is not an attack.
     */
    case 'aggressive':
      if (f.distToEnemyKing <= 2) w *= 2.2
      else if (f.distToEnemyKing <= 3) w *= 1.5
      if (f.approachesKing) w *= 1.7
      if (f.givesCheck) w *= 1.5
      // Captures on their own are not the point, and the far side of the
      // board is the opposite of the point.
      if (f.isCapture && f.distToEnemyKing <= 3) w *= 1.3
      if (f.isCapture && f.distToEnemyKing >= 5) w *= 0.8
      if (f.isPawnMove && f.approachesKing) w *= 1.4
      if (f.isQuiet && f.distToEnemyKing >= 4) w *= 0.6
      break

    case 'solid':
      if (f.isSacrificial) w *= 0.45
      if (f.isCapture && f.capturedValue >= f.movedValue) w *= 1.3
      if (f.isQuiet) w *= 1.25
      if (f.givesCheck && !f.isCapture) w *= 0.8
      if (f.isEarlyQueenSortie) w *= 0.5
      break

    case 'positional':
      if (f.isQuiet) w *= 1.45
      if (f.toOpenFile) w *= 1.35
      if (f.isDeveloping) w *= 1.3
      if (f.isEarlyQueenSortie) w *= 0.45
      if (f.isCapture) w *= 0.85
      if (f.isSacrificial) w *= 0.7
      break

    /*
     * TACTICAL IS ABOUT COMPLICATION, ANYWHERE ON THE BOARD.
     *
     * The other half of the split above. This one will take on any square,
     * offer material, and push a pawn through — it does not care where the
     * king is, which is precisely what separates it from `aggressive`. Trading
     * heavy pieces off is the one thing it will not do, because a queenless
     * position has nothing left to calculate.
     */
    case 'tactical':
      if (f.isSacrificial) w *= 2.1
      if (f.isCapture) w *= 1.7
      if (f.isPromotion) w *= 1.9
      if (f.givesCheck) w *= 1.35
      // An even trade of big pieces kills the position it wants to live in.
      if (f.isCapture && f.movedValue >= 5 && f.capturedValue >= 5) w *= 0.6
      if (f.isQuiet) w *= 0.6
      break
  }

  return w
}

/**
 * Expected centipawn loss for a given temperature and weight set.
 * Monotonically increasing in `t` — flatter distribution, worse average move.
 */
function expectedLoss(losses: number[], styleW: number[], t: number): number {
  let num = 0
  let den = 0
  for (let i = 0; i < losses.length; i++) {
    const w = Math.exp(-(losses[i] ?? 0) / t) * (styleW[i] ?? 1)
    num += w * (losses[i] ?? 0)
    den += w
  }
  return den > 0 ? num / den : 0
}

/**
 * Find the temperature at which the style-weighted distribution sheds the
 * SAME expected centipawns as the unstyled one at the band temperature.
 *
 * Why this exists: calibration caught style acting as a stealth difficulty
 * setting. At 1400, "tactical" scored 88% against "human" of the same band
 * with a LOWER acpl (37.7 vs ~44.5), because boosting checks and captures
 * boosts move classes that are frequently just good. Aggressive did the same
 * at 75%. A style that quietly makes the bot stronger corrupts every
 * downstream training signal — you'd think you were beating a 1400 when you
 * were beating a 1250.
 *
 * Bisection is cheap here: no engine calls, ~24 iterations over at most a
 * dozen candidates.
 */
function styleNeutralTemperature(losses: number[], styleW: number[], t0: number): number {
  const target = expectedLoss(
    losses,
    losses.map(() => 1),
    t0,
  )
  if (!(target > 0)) return t0

  let lo = t0 / 8
  let hi = t0 * 8
  let t = t0
  for (let k = 0; k < 24; k++) {
    t = (lo + hi) / 2
    if (expectedLoss(losses, styleW, t) < target) lo = t
    else hi = t
  }
  return Math.max(5, t)
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export interface Candidate {
  uci: UciMove
  /** Centipawns worse than the engine's best move. Always >= 0. TRUE loss. */
  loss: number
  weight: number
  features: MoveFeatures | null
  /**
   * The bot could not see this move's refutation, so it looks fine to it.
   *
   * `loss` stays the truth — it is what the diagnostics measure and what the
   * coach would report. This flag is why the weight disagrees with it.
   */
  blind?: boolean
}

export type Rng = () => number

/**
 * Score every candidate line, apply band temperature and style, and return
 * the weighted pool. Exported separately from `chooseMove` so the UI can show
 * "here's what it was considering and why" — useful for the coach view.
 */
/**
 * How close a move the bot cannot refute looks to the best one.
 *
 * Not equal to it: a blind candidate should be competitive with the engine's
 * choice, not preferred over it, or every bot would play nothing but moves it
 * has misjudged.
 */
const BLIND_RESIDUAL_CP = 12

/**
 * How many moves the bot actually weighs up before it commits.
 *
 * Blindness applies to these and no further, and the reason is a measurement.
 * Applied to every candidate, band 800 shed 252.9 acpl against a 150 target
 * and punished free material 8.4% of the time — WORSE than the 350, which is
 * the non-monotonic failure the whole model exists to remove.
 *
 * The cause is that multipv is 28 at that band. Blinding a third of
 * twenty-eight candidates lifts nearly ten moves to within twelve centipawns
 * of the best, and a softmax over ten equals is close to a coin.
 *
 * But nobody considers twenty-eight moves. A person shortlists a handful and
 * then asks "does this work?" — and the answer to THAT is what they get
 * wrong. The wide candidate list was only ever a device for letting a softmax
 * reach a bad move; blindness does that job properly, so it should operate
 * where a person's attention actually is.
 */
const SHORTLIST = 5

export function weighCandidates(
  fen: string,
  lines: Line[],
  elo: number,
  style: Style,
  /**
   * Supplied by the move-choosing path, withheld by `explain`.
   *
   * With it, candidates whose refutation this rating would miss are re-scored
   * as the bot sees them. Without it the function is pure and returns the
   * engine's truth, which is what the coach view wants — it should show what
   * the position IS, not what the bot hallucinated about it.
   */
  rng?: Rng,
  /**
   * Force part of the profile, for the tuner.
   *
   * Deliberately a parameter rather than a module-level switch: the tuner has
   * to run THE policy, not a copy of it, and the last tuner's fatal flaw was
   * that it reasoned about an analytic model instead. Nothing in the app
   * passes this.
   */
  override?: { sight?: number; temperature?: number },
): Candidate[] {
  if (lines.length === 0) return []

  const banded = bandProfile(elo)
  const profile =
    override === undefined
      ? banded
      : {
          ...banded,
          ...(override.sight === undefined ? {} : { sight: override.sight }),
          ...(override.temperature === undefined ? {} : { temperature: override.temperature }),
        }
  const t0 = Math.max(10, profile.temperature)

  const scored = lines
    .filter((l) => l.pv.length > 0)
    .map((l) => ({ uci: l.pv[0] as UciMove, score: lineScore(l), reply: l.pv[1] }))

  if (scored.length === 0) return []

  const best = Math.max(...scored.map((s) => s.score))
  // The truth, kept whatever the bot believes — diagnostics measure this.
  const losses = scored.map((s) => Math.max(0, best - s.score))

  /*
   * WHAT THE BOT THINKS IT IS CHOOSING BETWEEN.
   *
   * For each candidate, `reply` is the refutation the engine already found.
   * Roll against whether a player at this rating would see it; when they
   * would not, the move is lifted to just under the best, because "I cannot
   * see what is wrong with this" is exactly what that means.
   *
   * Lifting rather than modelling what the refutation WINS is deliberate: a
   * fork, a discovered attack, a back-rank mate and a plain recapture all go
   * through the same line, because the only question asked is whether they
   * would have spotted that move.
   */
  const blind: boolean[] = scored.map(() => false)
  /*
   * The moves actually under consideration, by true score. Blindness applies
   * to these; everything further down the list is not misjudged, it is simply
   * never looked at, and temperature already decides how far down the bot
   * reaches.
   */
  const shortlist = new Set(
    scored
      .map((s, i) => ({ i, score: s.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORTLIST)
      .map((x) => x.i),
  )
  const perceived = scored.map((s, i) => {
    if (!rng || !shortlist.has(i)) return s.score
    const board = new Chess(fen)
    let dest: string
    try {
      const m = board.move({ from: s.uci.slice(0, 2), to: s.uci.slice(2, 4), promotion: s.uci[4] })
      if (!m) return s.score
      dest = m.to
    } catch {
      return s.score
    }
    if (!isBlindTo(board.fen(), s.reply, dest, profile.sight, rng)) return s.score
    blind[i] = true
    return Math.max(s.score, best - BLIND_RESIDUAL_CP)
  })
  const perceivedLoss = perceived.map((p) => Math.max(0, best - p))

  const features = scored.map((s) => describeMove(fen, s.uci))
  const styleW = features.map((f) => (f ? styleWeight(f, style) : 1))

  // Style decides WHICH of the equally-costly moves gets played, never how
  // costly the move is. Re-solving temperature enforces that rather than
  // assuming it — see styleNeutralTemperature.
  const t = style === 'human' ? t0 : styleNeutralTemperature(perceivedLoss, styleW, t0)

  return scored.map(({ uci }, i) => ({
    uci,
    loss: losses[i] ?? 0,
    weight: Math.exp(-(perceivedLoss[i] ?? 0) / t) * (styleW[i] ?? 1),
    features: features[i] ?? null,
    blind: blind[i],
  }))
}

function sample(candidates: Candidate[], rng: Rng): Candidate | null {
  const total = candidates.reduce((s, c) => s + c.weight, 0)
  if (!(total > 0)) return candidates[0] ?? null
  let r = rng() * total
  for (const c of candidates) {
    r -= c.weight
    if (r <= 0) return c
  }
  return candidates[candidates.length - 1] ?? null
}

/**
 * How much a move is worth to somebody who is not looking at the reply.
 *
 * Deliberately crude, because the whole point is the crudeness. Material on
 * the square is most of it; a check and a promotion read as progress; moving
 * forwards feels like doing something and retreating feels like giving up.
 * Nothing here asks what happens next, which is exactly the mistake being
 * modelled.
 */
function faceValue(m: {
  captured?: string
  promotion?: string
  san: string
  from: string
  to: string
  color: 'w' | 'b'
}): number {
  let v = m.captured ? (VALUE[m.captured] ?? 0) : 0
  if (m.promotion) v += 800
  if (m.san.includes('#')) v += 2000
  else if (m.san.includes('+')) v += 80
  const forward = (rankOf(m.to) - rankOf(m.from)) * (m.color === 'w' ? 1 : -1)
  v += forward * 12
  return v
}

/**
 * Spread over face value rather than winner-takes-all.
 *
 * At 220 a hanging queen (900) outweighs a quiet move by e^4 ≈ 55, so it is
 * taken nearly always; two captures of similar size stay a real choice. Make
 * it much smaller and the bot becomes a deterministic material-grabber, which
 * is a different and equally inhuman thing.
 */
const NAIVE_TEMPERATURE = 220

/**
 * The move a one-ply player picks here.
 *
 * Exported so the diagnostics can characterise it on its own, away from the
 * search: "what does this policy shed, and how often does it hang something"
 * is a question about this function alone.
 */
export function naiveMove(fen: string, rng: Rng, sight?: number): UciMove | null {
  const board = new Chess(fen)
  const moves = board.moves({ verbose: true })
  if (moves.length === 0) return null

  /*
   * A ONE-PLY PLAYER STILL HAS TO NOTICE THE CAPTURE.
   *
   * Without `sight` this function sees every capture on the board, because
   * faceValue reads `captured` straight off the move list — and that made it
   * the best free-material spotter in the roster's bottom half. On a fixed
   * exam of positions where taking a piece wins two clear pawns, Bud (350)
   * took it 41.3% of the time, Kit (550) 37.5% and Pip (800) 37.5%: flat,
   * with the weakest bot on top, because Bud runs this policy on 46% of his
   * moves and this policy never misses.
   *
   * A real beginner misses free pieces constantly — that is most of what
   * being a beginner IS. So when a sight is given, each capture and each
   * check is noticed with the same probability vision.ts uses for seeing a
   * reply coming, shaped the same way: a knight capture from across the
   * board is the classic one to overlook, a pawn taking the piece in front
   * of it is not. An unnoticed capture is still a legal move, it just looks
   * like the quiet move it would otherwise be.
   *
   * Optional so the diagnostics can still characterise the policy on its own.
   */
  const noticed = (m: (typeof moves)[number]): boolean => {
    if (sight === undefined) return true
    if (!m.captured && !m.san.includes('+') && !m.san.includes('#')) return true
    const uci = `${m.from}${m.to}${m.promotion ?? ''}` as UciMove
    // Describing the move from the position it is played in; '' as the
    // destination so it is never mistaken for a recapture.
    return rng() < seesReply(shapeOfReply(fen, uci, ''), sight)
  }
  const value = (m: (typeof moves)[number]): number =>
    noticed(m) ? faceValue(m) : faceValue({ ...m, captured: undefined, san: m.san.replace(/[+#]/g, '') })

  const weights = moves.map((m) => Math.exp(value(m) / NAIVE_TEMPERATURE))
  const total = weights.reduce((a, c) => a + c, 0)
  if (!(total > 0) || !Number.isFinite(total)) {
    // A forced mate makes faceValue large enough to overflow the exponential
    // in principle; fall back rather than return null and lose the turn.
    const m = moves[Math.floor(rng() * moves.length)]!
    return `${m.from}${m.to}${m.promotion ?? ''}`
  }

  let r = rng() * total
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i] ?? 0
    if (r <= 0) {
      const m = moves[i]!
      return `${m.from}${m.to}${m.promotion ?? ''}`
    }
  }
  const m = moves[moves.length - 1]!
  return `${m.from}${m.to}${m.promotion ?? ''}`
}

/**
 * Pick the move this opponent actually plays.
 *
 * `rng` is injectable so simulations are reproducible — the same seed replays
 * the same game, which is what makes "run this position 30 times" meaningful
 * rather than noise.
 */
export function chooseMove(
  fen: string,
  lines: Line[],
  elo: number,
  style: Style,
  rng: Rng = Math.random,
): UciMove | null {
  return chooseMoveDetailed(fen, lines, elo, style, rng).uci
}

/** Where a chosen move came from. Diagnostics need to tell these apart. */
export interface Choice {
  uci: UciMove | null
  /**
   * 'pool' — sampled from the engine's shortlist by the softmax.
   * 'wild' — the blunder path: a legal move the engine never shortlisted.
   * 'forced' — one legal move, or nothing to choose from.
   */
  source: 'pool' | 'wild' | 'forced'
  /** Centipawns worse than best, for pool picks. Unknown for wild ones. */
  loss: number | null
  /** How far apart best and worst candidate were — the room style had. */
  spread: number
  candidates: number
}

/**
 * chooseMove with its reasoning attached.
 *
 * Split out because "the bot played a bad move" and "the bot played an absurd
 * move" have different causes and different fixes, and from the outside they
 * are indistinguishable. The softmax reaching a loose move and the blunder
 * path firing a random one both show up as a large centipawn loss; only one
 * of them looks like a human.
 */
export function chooseMoveDetailed(
  fen: string,
  lines: Line[],
  elo: number,
  style: Style,
  rng: Rng = Math.random,
  /** Tuner seam — see weighCandidates. Nothing in the app passes this. */
  override?: { sight?: number; temperature?: number },
): Choice {
  const candidates = weighCandidates(fen, lines, elo, style, rng, override)
  const spread =
    candidates.length > 1 ? Math.max(...candidates.map((c) => c.loss)) : 0
  const none: Choice = { uci: null, source: 'forced', loss: null, spread: 0, candidates: 0 }
  if (candidates.length === 0) return none

  const profile = bandProfile(elo)

  // The one-ply path — what used to be called the blunder path.
  //
  // FIRST VERSION sampled uniformly from the multipv candidates, i.e. from
  // the engine's top eight moves, all of which are fine. A no-op, and
  // calibration proved it: at 1400 with blunderChance 0.08, only 2.4% of
  // moves shed 200cp.
  //
  // SECOND VERSION sampled uniformly from every legal move the shortlist did
  // not contain. That produced losses — and produced them in the wrong shape.
  // A uniformly random legal move is a rook shuffling to h2 for no reason.
  // Nobody has ever played that. Human errors are not noise; they are the
  // output of a cheaper policy. A beginner looks one ply deep, takes the
  // biggest thing on offer, gives the check, pushes the pawn — and simply
  // does not see the reply. That is why their blunders look purposeful right
  // up until the refutation.
  //
  // So this now plays the move a one-ply player would pick: weighted by what
  // it wins THIS move with no thought at all for the answer. It is allowed to
  // land on a good move, because sometimes the greedy move is the right one
  // and pretending otherwise is its own kind of tell.
  if (rng() < profile.naiveShare) {
    const naive = naiveMove(fen, rng, profile.sight)
    if (naive) {
      return { uci: naive, source: 'wild', loss: null, spread, candidates: candidates.length }
    }
  }

  const picked = sample(candidates, rng)
  return {
    uci: picked?.uci ?? null,
    source: candidates.length === 1 ? 'forced' : 'pool',
    loss: picked?.loss ?? null,
    spread,
    candidates: candidates.length,
  }
}

/**
 * Deterministic RNG (mulberry32) for reproducible simulation runs.
 * Same seed in, same game out.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
