/**
 * What to say at each move of a line, and why.
 *
 * HAND-WRITTEN ON PURPOSE. The obvious shortcut is to generate this — "develops
 * a piece", "controls the centre", "castles" — and it is worse than saying
 * nothing. A sentence attached to every move that could be attached to any move
 * is noise, and noise is what teaches people to stop reading the coaching
 * entirely. So a ply gets a line here only when there is something specific to
 * say about THAT move in THAT position, and the trainer shows nothing when
 * there is not.
 *
 * Keyed by opening, then line, then ply index into `line.moves` (0-based, so
 * ply 0 is White's first move). Both sides' moves get commentary: knowing why
 * your opponent is playing what they are playing is most of what makes an
 * opening make sense, and "they will hit your bishop here" is the difference
 * between memorising and understanding.
 *
 * Coverage is deliberately partial. The beginner lines carry the most, because
 * that is who is training them; the deep theoretical lines carry the least,
 * because at that level the moves stop having one-sentence reasons.
 */

export interface CoachNote {
  /** One sentence. What this move does, or what to watch for next. */
  why: string
}

type ByPly = Record<number, CoachNote>
type ByLine = Record<string, ByPly>

const COACHING: Record<string, ByLine> = {
  italian: {
    'italian-main': {
      0: { why: 'Best first move there is. It takes the centre and opens lines for both the queen and the light-squared bishop in one go.' },
      1: { why: 'They mirror you. Now neither side owns the centre outright and the fight is about who develops better.' },
      2: { why: 'Knight out, and it already attacks the e5 pawn. Develop toward the centre — a knight on the rim covers half as many squares.' },
      3: { why: 'They defend e5 with the knight. Note they defended by developing rather than by pushing a pawn — that is the habit to copy.' },
      4: { why: 'The whole point of the Italian. The bishop stares down the a2-g8 diagonal at f7, which is defended by the king and nothing else.' },
      5: { why: 'They mirror again, aiming at your f2. Same idea, same weak square — now you both have something to watch.' },
      6: { why: 'Quiet, and the most important move so far. It prepares d4 so you can build the big centre without losing the bishop to a knight coming to b4.' },
      7: { why: 'They develop and hit your e4 pawn. You are not in trouble; you just have to notice it.' },
      8: { why: 'Defends e4 solidly. d3 rather than d4 because your king is still in the middle — open the position after castling, not before.' },
      9: { why: 'They defend e5 the same way. The position is symmetrical and quiet, which is exactly what you want at this stage.' },
      10: { why: 'King safe. This is the move a lot of players delay one move too long and then regret for the rest of the game.' },
      11: { why: 'They castle too. Now the opening is over and you have what you came for: everything developed, king safe, and d4 ready when you want it.' },
    },
    'italian-two-knights': {
      4: { why: 'Bishop to c4 again, aiming at f7.' },
      5: { why: 'They develop the knight instead of the bishop — and this is the moment the game changes. f7 is now defended only by the king, and they have not covered it.' },
      6: { why: 'Ng5 goes straight for f7. It looks crude and it is completely sound; both your bishop and knight now hit the same square.' },
      7: { why: 'The only good answer. They hit the centre rather than defending f7 passively — remember this if you are ever on the other side.' },
      8: { why: 'You take, and now the tension is at its highest. What they do here decides the whole game.' },
      9: { why: 'The right move. The knight hits your bishop on c4 and refuses to walk into the attack. Now compare it with the Fried Liver line.' },
      10: { why: 'Check first, so you keep the initiative rather than just retreating the bishop.' },
      13: { why: 'Their pawns are wrecked on the queenside, which is your long-term compensation for giving the pawn back.' },
      14: { why: 'Bishop tucks away safely. You are level here — a real game rather than a refutation, which is the honest verdict on the Two Knights.' },
    },
    'italian-fried-liver': {
      9: { why: 'This is the mistake. Recapturing with the knight looks completely natural and loses the game to a move most people have never seen.' },
      10: { why: 'The sacrifice. A knight for a pawn, and the point is not material at all — it is that the black king is about to be standing in the open on move six.' },
      11: { why: 'Forced. Declining loses the knight on d5 for nothing.' },
      12: { why: 'Check, and it hits the knight on d5 at the same time. The king cannot go back because the queen covers the escape.' },
      13: { why: 'The king has to walk forward to defend the knight. A king on e6 on move seven is not a position anyone wants to defend.' },
      14: { why: 'The last piece joins. Worth knowing exactly what this is worth: about +1, not a forced win — Black survives with ...Ncb4. It is the best practical try in the opening and it is not a refutation.' },
    },
  },

  'scholars-mate': {
    'scholars-defence': {
      0: { why: 'Their first move, and yours to answer.' },
      1: { why: 'You take your share of the centre. Nothing unusual yet.' },
      2: { why: 'Bishop to c4 — watch it. It is now pointing at f7, the one square only your king defends.' },
      3: { why: 'Develop and defend e5. Good move, and it does not yet address the bishop.' },
      4: { why: 'Here it comes. The queen joins the bishop and both now hit f7. This threatens mate in one, right now.' },
      5: { why: 'The move. It attacks the queen AND blocks the h5-f7 diagonal in one go — a defensive move that gains time is always the one to look for.' },
      6: { why: 'The queen steps aside and keeps aiming at f7 — but down the f-FILE now, not the diagonal.' },
      7: { why: 'The knight does not defend f7. It BLOCKS the f-file between their queen and the target, which is a different job entirely. Getting this reason right is the whole lesson.' },
    },
    'scholars-mate-line': {
      4: { why: 'Queen and bishop both hit f7. This is mate in one and you have one move to deal with it.' },
      5: { why: 'The losing move. It develops a piece and completely ignores the threat — which is how almost every beginner game is lost.' },
      6: { why: 'Mate. The queen takes on f7 defended by the bishop on c4, the king cannot take it, and it has no square to run to. Deal with the threat first, develop second.' },
    },
  },

  'fried-liver': {
    'fried-defence': {
      5: { why: 'You develop the knight. Perfectly natural, and it invites the most dangerous attack you will meet under 1600.' },
      6: { why: 'Ng5. Both their pieces now hit f7 and there is a real threat. Do not panic and do not defend passively.' },
      7: { why: 'The move. Hit the centre — this is a counter-attack, not a defence, and passive moves lose here.' },
      8: { why: 'They take the pawn. Now comes the only move in the whole repertoire genuinely worth memorising exactly.' },
      9: { why: 'Na5, hitting the bishop on c4. NOT Nxd5, which loses to Nxf7. The knight is offside for a few moves and you are completely fine.' },
      10: { why: 'Check, keeping the initiative while the bishop retreats.' },
      15: { why: 'And ...h6 kicks the knight away. The storm is over and you have the bishop pair.' },
    },
    'fried-punish': {
      9: { why: 'This is the move that loses. It is the natural recapture and it is why the previous line exists.' },
      10: { why: 'Nxf7. Your king is about to be dragged into the open with three pieces coming at it.' },
      13: { why: 'The king has to step up to e6 to hold the knight. This is not a position you can defend at any level, whatever the engine says about it.' },
    },
  },

  london: {
    'london-main': {
      0: { why: 'd4 rather than e4. Slower, and it leads to the same structure almost every game — which is the entire reason to play it.' },
      2: { why: 'The one move the London gets right that most d4 systems get wrong: the bishop comes OUTSIDE the pawn chain before e3 locks it in.' },
      4: { why: 'Now e3. The bishop is already out, so shutting the diagonal costs nothing.' },
      8: { why: 'Bishop to d3, aiming down the b1-h7 diagonal at h7. That battery is where your attack comes from.' },
      10: { why: 'Knight to d2 rather than c3, so the c-pawn is free to come to c3 and hold d4.' },
      12: { why: 'And c3. The setup is complete: six moves, roughly any order, against almost anything.' },
    },
    'london-kid': {
      3: { why: 'They fianchetto instead of playing ...d5. Your plan changes here — the g6 pawn has closed the diagonal your bishop wanted.' },
      8: { why: 'Be2, not Bd3. The b1-h7 diagonal is blocked, so the bishop takes a modest square instead of a useless one.' },
      10: { why: 'h3 before they get ...Nh5 in. Small move, and it is the difference between keeping your good bishop and losing it.' },
    },
  },

  scandinavian: {
    'scandi-main': {
      1: { why: 'Straight at the centre on move one. You get the same first three moves against 1.e4 for the rest of your life.' },
      3: { why: 'Recapture with the queen. Yes it comes out early — that is the price of the opening, and knowing where it is safe is the skill.' },
      4: { why: 'They develop with tempo on your queen. Expect this; it is not a surprise, it is the deal.' },
      5: { why: 'Qa5 is the square. Off the d-file, out of the way of the knights, and awkward to attack again.' },
      9: { why: '...c6 first. It gives the queen a retreat square and prepares the bishop to come out.' },
      11: { why: 'And the bishop gets OUT to f5 before ...e6 shuts it in. Play these two in the wrong order and you have a worse French.' },
    },
  },

  'legal-mate': {
    'legal-mate-line': {
      5: { why: 'Their bishop pins your knight to the queen. The pin looks binding. It is not.' },
      8: { why: 'Nxe5, ignoring the pin entirely. You are offering the queen because mate is faster than she is.' },
      9: { why: 'They take the queen. Now count what you have left: two bishops and a knight, all pointing at a king that cannot move.' },
      10: { why: 'Bxf7+ drags the king to e7 — the only square.' },
      12: { why: 'Nd5 is mate. Three minor pieces, no queen. Worth knowing mostly so you never fall for the reverse.' },
    },
    'legal-declined': {
      7: { why: 'They played ...Nc6 instead of ...g6, so e5 is defended. Everything changes here.' },
      8: { why: 'Nxe5 now just loses. Check that e5 is undefended before you touch the knight — this is the whole reason it is a pattern to recognise rather than a plan to aim for.' },
      11: { why: 'A queen and a knight for a bishop and a pawn. You are simply losing.' },
    },
  },
}

/** The note for one ply, or null when there is nothing specific worth saying. */
export function coachFor(openingId: string, lineId: string, ply: number): CoachNote | null {
  return COACHING[openingId]?.[lineId]?.[ply] ?? null
}

/** How many plies of a line carry commentary — used to show coverage honestly. */
export function coachedPlies(openingId: string, lineId: string): number {
  return Object.keys(COACHING[openingId]?.[lineId] ?? {}).length
}
