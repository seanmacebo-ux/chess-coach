/**
 * What to do once the opening is over.
 *
 * WHY THIS EXISTS. Sean asked for it twice — "teaching me openings and how to
 * play the middlegame", "think like the chess.com app" — and until now the app
 * stopped exactly where the difficulty starts. You could learn twelve moves of
 * the Italian, play them perfectly, and then be handed a board with no idea
 * what the next move is for. That is the universal complaint about opening
 * study and it is entirely fair: a line without a plan is a phone number.
 *
 * WHAT A PLAN IS HERE. Not a slogan. Each entry names:
 *
 *   the structure   — what the pawns look like, because the pawns decide what
 *                     the pieces are for
 *   their plan      — what the opponent is trying to do, first, because a plan
 *                     that ignores theirs is a wish
 *   your plan       — three ordered steps, in words
 *   the moves       — those steps executed, one at a time, with the reason
 *
 * EVERY POSITION IS REACHED, NOT INVENTED. A plan does not carry a FEN. It
 * carries the id of an opening line already in `openings.ts`, and the position
 * is derived by replaying it. Two things fall out of that. The middlegame you
 * are shown is the one that follows the opening you actually trained, so the
 * two halves join up. And if an opening line is ever edited, the plan built on
 * it either still replays or fails the verifier — it cannot quietly drift onto
 * a position nobody checked.
 *
 * VERIFICATION. `npm run verify:middlegame` replays every plan and puts each of
 * YOUR moves to Stockfish: a plan move that loses more than a pawn against the
 * engine's choice fails the run. This matters more here than anywhere else in
 * the app, because plan-shaped prose is the easiest thing in chess to write
 * convincingly and wrongly. "Swing the queen to h3 and hit h7" reads as
 * teaching whether or not the move is any good.
 *
 * WHAT IS NOT HERE YET. Six plans, drawn from the openings that ship. The
 * Carlsbad minority attack, the isolated queen's pawn, and the good-knight
 * versus bad-bishop endgame conversions are the obvious next three, and they
 * are absent rather than half-written.
 */

import { Chess } from 'chess.js'
import { openingById, type Side } from './openings'

/** One step of the plan, in words, before any move is played. */
export interface PlanStep {
  /** Four or five words. This is the thing to remember. */
  label: string
  /** Why that step, and what it depends on. */
  detail: string
}

export interface PlanMove {
  san: string
  /**
   * Present on your moves, absent on the opponent's. The trainer only asks for
   * moves that carry a reason — that is what makes it a plan rather than a
   * sequence to memorise.
   */
  why?: string
}

export interface MiddlegamePlan {
  id: string
  name: string
  /** Which side you are playing. */
  side: Side
  /** The rating window this is genuinely the right lesson for. */
  band: [number, number]
  /** The opening line that produces the position. Replayed to get the FEN. */
  from: { openingId: string; lineId: string }
  /** What the pawns look like, in one line. */
  structure: string
  /** What the opponent wants. Stated first, deliberately. */
  theirPlan: string
  /** Your plan, in order. Three steps. */
  steps: PlanStep[]
  /** The plan executed. Alternates sides, starting from whoever is to move. */
  moves: PlanMove[]
  /** The one sentence to carry into your own games. */
  takeaway: string
}

export const PLANS: MiddlegamePlan[] = [
  {
    id: 'italian-slow-break',
    name: 'Italian — build, then break with d4',
    side: 'white',
    band: [300, 1300],
    from: { openingId: 'italian', lineId: 'italian-main' },
    structure:
      'Symmetrical, closed centre. Both sides have pawns on e4/e5 and d3/d6, and nothing can be taken.',
    theirPlan:
      'Mirror you, and wait. Black is doing exactly what you are doing, so whoever completes their set-up first gets to choose when the position opens.',
    steps: [
      {
        label: 'Rook to e1 first',
        detail:
          'The break is d4. Before you play it, put the rook behind the e-pawn so that when the centre opens the file is already yours.',
      },
      {
        label: 'Knight to f1, then g3',
        detail:
          'The b1-knight has nowhere good on c3 — it would block the c-pawn that supports d4. Nbd2–f1–g3 takes four moves and ends up on the square that actually matters.',
      },
      {
        label: 'Keep the light bishop, then push',
        detail:
          'If they offer a trade with ...Be6, retreat to b3 rather than take. That bishop is aimed at f7 and is the reason opening the centre works for you.',
      },
    ],
    moves: [
      { san: 'Re1', why: 'Behind the e-pawn, before the file exists. This is the move people play last and should play first.' },
      { san: 'Re8' },
      { san: 'Nbd2', why: 'Not Nc3 — that knight would sit in front of the c-pawn you need for d4. Route it the long way instead.' },
      { san: 'h6' },
      { san: 'Nf1', why: 'Step two of the journey. Slow, and the position is closed enough to afford it.' },
      { san: 'Be6' },
      { san: 'Bb3', why: 'The trade offer, declined. Their bishop cost them a move to offer it; yours keeps aiming at f7.' },
      { san: 'Qd7' },
      { san: 'Ng3', why: 'Arrived. The knight covers f5 and h5, so the kingside is safe enough to open the centre.' },
      { san: 'Rad8' },
      { san: 'd4', why: 'Now. Every piece is on its square and the rook is already on the file that is about to open.' },
    ],
    takeaway:
      'In a closed position the pawn break is the last move of the plan, not the first. Get the pieces where the break will need them, then break.',
  },

  {
    id: 'london-kingside',
    name: 'London — cement the knight, then aim at h7',
    side: 'white',
    band: [400, 1400],
    from: { openingId: 'london', lineId: 'london-main' },
    structure:
      'Pawns on d4 and e3 against d5 and e6. A closed centre with your dark bishop already outside the pawn chain on f4 — the whole point of the London.',
    theirPlan:
      'Break on the queenside with ...c5 and ...cxd4, and get counterplay down the c-file. They are not slow; they are pointed the other way.',
    steps: [
      {
        label: 'Castle before anything',
        detail:
          'You have the attack, so you can afford to spend one move on safety and they cannot punish you for it. Attacking with the king in the middle is how attacks turn into losses.',
      },
      {
        label: 'Knight to e5, then f4 behind it',
        detail:
          'e5 is the outpost this whole opening exists to reach — no black pawn can ever attack it. f4 makes it permanent, but the bishop is standing on f4, so it has to step aside to g3 first.',
      },
      {
        label: 'Queen to c2, behind the bishop',
        detail:
          'c2, d3 and h7 are the same diagonal. Queen behind bishop means two attackers on h7, and only the king defends it.',
      },
    ],
    moves: [
      { san: 'Nc6' },
      { san: 'O-O', why: 'One move, and now nothing you do next can rebound onto your own king.' },
      { san: 'b6' },
      { san: 'Ne5', why: 'The outpost. No black pawn can ever attack this square — check it: neither the d- nor the f-pawn can reach d6 or f6 to hit it.' },
      { san: 'Bb7' },
      {
        san: 'Bg3',
        /*
         * This move exists because the verifier refused the plan without it.
         * "Ne5 and f4" is the London scheme everybody quotes, and f4 is illegal
         * — the bishop went to f4 on move two and is still sitting there. The
         * step is not a detour; it is the move the slogan leaves out.
         */
        why: 'The pawn wants f4 and the bishop is standing on it. g3 is the same diagonal, one square back, and out of the way.',
      },
      { san: 'Rc8' },
      { san: 'f4', why: 'Now it goes. The knight on e5 is cemented — it can only ever be traded, never chased.' },
      { san: 'Nd7' },
      { san: 'Qc2', why: 'Behind the bishop on the b1–h7 diagonal. Two pieces now aim at h7 and only the king defends it.' },
    ],
    takeaway:
      'Attacks are aimed at a square, not at a king. Pick the weak square first — usually h7 or f7 — then count attackers against defenders.',
  },

  {
    id: 'caro-advance-base',
    name: 'Caro-Kann Advance — attack the base of the chain',
    side: 'black',
    band: [500, 1500],
    from: { openingId: 'caro-kann', lineId: 'caro-advance' },
    structure:
      'White has a pawn chain c-d-e running to e5. Yours runs the other way. Your light bishop is outside the chain on f5, which is the whole reason to play this line.',
    theirPlan:
      'Use the space the e5-pawn gives them to play on the kingside — pieces to g5, h4, sometimes a pawn to g4 hitting your bishop.',
    steps: [
      {
        label: 'Hit the base, not the head',
        detail:
          'A pawn chain is only as strong as its bottom pawn. e5 is defended by d4, and d4 is defended by c3. So the target is d4, and c5 is how you reach it.',
      },
      {
        label: 'Knight to g6 via e7',
        detail:
          'f5 is the natural square for this knight and your own bishop is already standing on it, so the route is e7–g6. From g6 the knight hits e5 — the head of the chain — which means the pieces holding d4 up cannot also be defending e5.',
      },
      {
        label: 'Then the queen, then take',
        detail:
          'Only once two pieces already hit d4 does taking on d4 win anything. Trade the pawns off first and their space advantage goes with it.',
      },
    ],
    moves: [
      { san: 'c3' },
      { san: 'Nge7', why: 'Heading for g6, not for a nice square. The knight has one job here.' },
      { san: 'Na3' },
      { san: 'Ng6', why: 'Hits e5. Their pawn chain now has both ends under fire, and the pieces defending one cannot cover the other.' },
      { san: 'Nc2' },
      { san: 'Be7', why: 'Development that costs nothing, while they spend moves shuffling the knight to defend d4.' },
      { san: 'a3' },
      { san: 'O-O', why: 'King safe before the position opens. You are about to trade in the centre and you want to have finished this first.' },
      { san: 'b4' },
      { san: 'cxd4', why: 'Now — with the knight and bishop already pointing at it. Trading here removes the pawn that holds their whole chain up.' },
      { san: 'cxd4' },
      { san: 'Qb6', why: 'Third attacker, and it hits b4 at the same time. The chain has no base left to stand on.' },
    ],
    takeaway:
      'Against a pawn chain, attack the bottom pawn. Count how many pieces hit it before you take anything.',
  },

  {
    id: 'scandi-solid',
    name: 'Scandinavian — finish, then point at h2',
    side: 'black',
    band: [300, 1200],
    from: { openingId: 'scandinavian', lineId: 'scandi-main' },
    structure:
      'You have pawns on c6 and e6 with the light bishop already outside them on f5. Solid, slightly less space, no weaknesses.',
    theirPlan:
      'Use the extra move and the centre pawn on d4 to develop faster and open lines while your queen is still exposed.',
    steps: [
      {
        label: 'Get the queen off the diagonal',
        detail:
          'On a5 she is doing a job and also asking to be hit by Bd2 or Nd5 or b4. Moving her to c7 costs a move and removes every one of those ideas.',
      },
      {
        label: 'Finish developing before anything else',
        detail:
          'You are the side with slightly less space. The side with less space wants trades and safety, not a plan — the plan comes after the last piece is out.',
      },
      {
        label: 'Bishop to d6, aiming at h2',
        detail:
          'With the queen on c7 behind it, the bishop on d6 makes a battery pointing at h2. That is the one real attacking idea this structure offers, and it appears for free.',
      },
    ],
    moves: [
      { san: 'O-O' },
      { san: 'e6', why: 'Opens the f8-bishop. Not ...e5 — that would give up d5 and leave the c6-pawn doing nothing.' },
      { san: 'Bd2' },
      { san: 'Qc7', why: 'Off the pin before it happens, onto the square where she will support the bishop coming to d6.' },
      { san: 'Rfe1' },
      { san: 'Nbd7', why: 'The last minor piece out, and it defends the f6-knight while it is there.' },
      { san: 'Ne5' },
      { san: 'Bd6', why: 'Battery complete. Queen on c7, bishop on d6, both pointing at h2 — and it hits the knight that just landed on e5 on the way.' },
    ],
    takeaway:
      'With less space, develop everything and keep the structure clean. The attacking chance appears on its own once the pieces are out.',
  },

  {
    id: 'london-kid-centre',
    name: 'London vs King’s Indian — take the centre, keep the bishop',
    side: 'white',
    band: [500, 1500],
    from: { openingId: 'london', lineId: 'london-kid' },
    structure:
      'They have fianchettoed on g7 and will play ...e5 to hit your d4-pawn. Your dark bishop is on f4, outside the chain, staring down the same diagonal their bishop wants.',
    theirPlan:
      'Play ...e5. If you let them push past to e4 they get space and the g7-bishop comes alive down the long diagonal.',
    steps: [
      {
        label: 'Castle, then claim c4',
        detail:
          'c4 gives you the broad centre and takes d5 away from their knight. It is also the move that makes ...e5 a trade rather than a gain of space.',
      },
      {
        label: 'Meet ...e5 by taking',
        detail:
          'Do not push d5 and do not allow ...e4. Take, so the position opens while your pieces are the developed ones.',
      },
      {
        label: 'Retreat the bishop to h2, never trade it',
        detail:
          'Their whole set-up is built around the g7-bishop. Yours is the piece that opposes it. Bh2 keeps it on the same diagonal, out of reach, and is why this bishop went to f4 on move two.',
      },
    ],
    moves: [
      { san: 'Nbd7' },
      { san: 'O-O', why: 'Before the centre opens, not after. Everything else in this plan involves trading in the middle.' },
      { san: 'Re8' },
      { san: 'c4', why: 'The broad centre. Now d5 is covered and their knight has no outpost to jump to.' },
      { san: 'e5' },
      { san: 'dxe5', why: 'Take. Pushing past would hand them a protected pawn on e4 and open the diagonal for the g7-bishop.' },
      { san: 'dxe5' },
      { san: 'Bh2', why: 'The move the whole opening was for. Same diagonal, out of reach, still opposing their best piece — and it can never be traded off.' },
    ],
    takeaway:
      'Against a fianchetto, work out which of your pieces opposes their best one, and then arrange never to trade it.',
  },

  {
    id: 'scotch-regroup',
    name: 'Scotch — provoke, retreat, castle',
    side: 'white',
    band: [900, 1700],
    from: { openingId: 'scotch', lineId: 'scotch-main' },
    structure:
      'Open centre, symmetrical pawns, every piece with somewhere to go. The kind of position where a single slow move costs you the initiative.',
    theirPlan:
      'Their queen is out early on f6 and their pieces are aimed at your kingside. If you drift they get ...Ne5, ...Qg6 and real pressure before you have castled.',
    steps: [
      {
        label: 'Provoke with Bc4',
        detail:
          'The bishop hits f7 and asks a question. They almost have to answer with ...Ne5, which uses up a move and puts the knight where you can hit it later.',
      },
      {
        label: 'Retreat, without embarrassment',
        detail:
          'Be2 looks like an admission. It is not — they have spent a move on ...Ne5 and you have spent one going back, so nothing is lost, and their knight is now the piece with a problem.',
      },
      {
        label: 'Castle, then regroup the knight',
        detail:
          'Only once the king is safe does Nd2 make sense. From d2 the knight covers e4 and c4, both squares their pieces want.',
      },
    ],
    moves: [
      { san: 'Bc4', why: 'Aimed at f7 the moment the queen leaves it undefended. Not an attack yet — a question they have to answer.' },
      { san: 'Ne5' },
      { san: 'Be2', why: 'Back. They used a move to push you and you used a move to step aside, so the count is level and their knight is misplaced.' },
      { san: 'Qg6' },
      { san: 'O-O', why: 'With their queen on g6 and the centre open, this stops being optional. Safety first, then plan.' },
      { san: 'd6' },
      { san: 'Nd2', why: 'Covers e4 and c4 — the two squares their knight and bishop are eyeing. Defensive, and it frees the c1-bishop.' },
    ],
    takeaway:
      'Being made to retreat is not losing time if they spent a move making you do it. Count the moves rather than the feeling.',
  },
]

/* ------------------------------------------------------------------ */

/**
 * The position a plan starts from, by replaying its opening line.
 *
 * Throws rather than returning null. A plan pointing at a line that no longer
 * exists is a content bug, and the verifier and the app should both fall over
 * loudly rather than render an empty board.
 */
export function planBase(plan: MiddlegamePlan): { fen: string; history: string[] } {
  const opening = openingById(plan.from.openingId)
  if (!opening) throw new Error(`plan ${plan.id}: no opening "${plan.from.openingId}"`)
  const line = opening.lines.find((l) => l.id === plan.from.lineId)
  if (!line) throw new Error(`plan ${plan.id}: no line "${plan.from.lineId}"`)

  const board = new Chess()
  for (const san of line.moves) {
    const m = board.move(san)
    if (!m) throw new Error(`plan ${plan.id}: opening line move "${san}" is illegal`)
  }
  return { fen: board.fen(), history: line.moves }
}

/** Plans at or below a rating first, then the ones above, all of them shown. */
export function plansFor(rating: number): MiddlegamePlan[] {
  const within = (p: MiddlegamePlan) => rating >= p.band[0] && rating <= p.band[1]
  const below = (p: MiddlegamePlan) => rating > p.band[1]
  return [...PLANS.filter(within), ...PLANS.filter(below), ...PLANS.filter((p) => !within(p) && !below(p))]
}

/** The middlegame that follows a given opening — used for the handoff. */
export function plansForOpening(openingId: string): MiddlegamePlan[] {
  return PLANS.filter((p) => p.from.openingId === openingId)
}

export function planById(id: string): MiddlegamePlan | undefined {
  return PLANS.find((p) => p.id === id)
}
