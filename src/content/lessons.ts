/**
 * Concept cards.
 *
 * These teach the IDEAS behind the books on Sean's shelf. Chess concepts are
 * not copyrightable; an author's prose is. So every card below is written
 * from scratch, credits whose idea it is, and points at a drill rather than a
 * page. Nothing here reproduces book text, diagrams or annotations.
 *
 * Gated by rating for the same reason the tier ladder is: `My System` and
 * `Think Like a Grandmaster` are 1700+ books, and serving their ideas to a
 * 1200 is exactly how the app becomes the overwhelming thing it exists to
 * avoid. The band on each card is a hard gate, not a suggestion.
 */

import type { Pillar } from '../coach/tiers'

export interface Lesson {
  id: string
  title: string
  pillar: Pillar
  /** Rating window. Hard gate. */
  band: [number, number]
  /** One line, shown on the card face. */
  hook: string
  /** The idea. Our words. */
  body: string
  /** Whose idea, and where it comes from. */
  source: string
  /** What to actually do about it, on the board, today. */
  practice: string
  /** Ties the card to tiers and to the weakness profile. */
  themes: string[]
}

export const LESSONS: Lesson[] = [
  /* --------------------------------------------------------- absolute
   * Written for someone who knows how the pieces move and nothing else.
   * No jargon, no assumed vocabulary — every term used is defined in the
   * card itself. These exist because the rest of the set quietly assumes
   * you already know what "development" or "an outpost" means.
   */
  {
    id: 'what-pieces-are-worth',
    title: 'What the pieces are worth',
    pillar: 'tactics',
    band: [600, 1000],
    hook: 'Pawn 1, knight and bishop 3, rook 5, queen 9.',
    body: 'These numbers are not rules, they are a rough exchange rate. They tell you that giving up a rook to win a bishop is a bad deal even though both feel like "a piece". Most games at the start are decided by nothing more than who came out ahead on this count. Before any trade, add up what you give and what you get.',
    source: 'The standard relative-value scale, in every beginner text since Staunton.',
    practice: 'For one game, say the numbers out loud before every capture.',
    themes: ['piece-safety', 'hangingPiece'],
  },
  {
    id: 'count-the-defenders',
    title: 'Count before you take',
    pillar: 'tactics',
    band: [600, 1100],
    hook: 'Two of yours attacking one of theirs is good. One against two is not.',
    body: 'Before capturing anything, count how many of your pieces attack that square and how many of theirs defend it. If they have more defenders than you have attackers, taking loses material — you win one piece and then lose two. This single count prevents more early-game disasters than any tactic you will ever learn.',
    source: 'Basic exchange counting; the foundation under all tactical calculation.',
    practice: 'Every capture this game: count attackers, count defenders, then decide.',
    themes: ['piece-safety', 'capturingDefender'],
  },
  {
    id: 'castle-early',
    title: 'Castle early',
    pillar: 'opening',
    band: [600, 1100],
    hook: 'It does two jobs in one move and beginners keep skipping it.',
    body: 'Castling tucks your king behind a wall of pawns in the corner and brings a rook toward the middle where it does something. A king left in the centre gets attacked down open lines, and the attack usually arrives before you have finished getting ready. If you are unsure what to do in the first ten moves and you have not castled yet, castle.',
    source: 'Classical opening principle — king safety before ambition.',
    practice: 'Castle inside the first ten moves, every game, for a week.',
    themes: ['opening-principles', 'development'],
  },
  {
    id: 'one-move-each',
    title: 'Move each piece once first',
    pillar: 'opening',
    band: [600, 1100],
    hook: 'Three pieces out beats one piece out three times.',
    body: 'At the start, every move should bring a new piece into the game. Moving the same knight four times means you have one active piece and they have four. Chess at the beginning is a race to get everybody working, and the player who wins that race usually gets the attack for free.',
    source: 'Classical development principle.',
    practice: 'Count your developed pieces versus theirs at move ten.',
    themes: ['development', 'opening-principles'],
  },
  {
    id: 'what-checkmate-needs',
    title: 'What checkmate actually requires',
    pillar: 'tactics',
    band: [600, 1000],
    hook: 'The king must not be able to move, block, or capture.',
    body: 'Check means the king is attacked. Checkmate means it is attacked and there is no way out — it cannot step away, nothing can block the attack, and nothing can capture the attacker. When you think you have mate, test all three. When you are in check, look for all three. Most missed mates and most missed escapes come from checking only one.',
    source: 'The definition itself; stated this way it becomes a checklist.',
    practice: 'On every check, name all three escapes before you move.',
    themes: ['mateIn1', 'mateIn2', 'backRankMate'],
  },
  {
    id: 'stalemate-trap',
    title: 'Stalemate steals wins',
    pillar: 'endgame',
    band: [600, 1100],
    hook: 'If they cannot move and are NOT in check, it is a draw. You just lost half a point.',
    body: 'When you are winning easily it is tempting to take everything and shepherd the king around. But if the opponent ends up with no legal move and no check on them, the game is drawn no matter how far ahead you are. Beginners throw away won games this way constantly. When ahead, always leave them a legal move, and give check when you deliver mate.',
    source: 'The stalemate rule; the most common way a winning beginner ends up with a draw.',
    practice: 'Practise king and queen against a lone king until you never stalemate.',
    themes: ['mate-kq', 'mate-kr'],
  },
  {
    id: 'the-box-mate',
    title: 'Mating with the queen: the box',
    pillar: 'endgame',
    band: [600, 1000],
    hook: 'Shrink the box. Bring the king. Do not rush.',
    body: 'With a queen against a lone king, use the queen to draw a box the enemy king cannot leave, and make the box smaller a step at a time. Do not try to mate with the queen alone — walk your own king up to help. The mate comes when the enemy king is on the edge with your king facing it. Slowly is faster here, because rushing produces stalemate.',
    source: 'Standard basic-mate technique, the first endgame in every rating-banded course.',
    practice: 'Mate from ten random starting positions without a single stalemate.',
    themes: ['mate-kq'],
  },
  {
    id: 'centre-pawns',
    title: 'Why the middle matters',
    pillar: 'opening',
    band: [600, 1100],
    hook: 'A knight in the centre reaches eight squares. In the corner, two.',
    body: 'Pieces control more squares from the middle of the board than from the edge, and controlling squares is how you restrict what the other player is allowed to do. That is the whole reason the opening is a fight over four central squares. Put a pawn there, aim your pieces at it, and keep your knights off the rim.',
    source: 'Classical centre control; the reason behind the first-move conventions.',
    practice: 'Count how many squares each of your knights attacks. Move the worst one.',
    themes: ['centre', 'development', 'opening-principles'],
  },

  /* ---------------------------------------------------------- safety */
  {
    id: 'loose-pieces',
    title: 'Loose pieces drop off',
    pillar: 'positional',
    band: [600, 1400],
    hook: 'Most games below 1600 are decided by an undefended piece, not a clever plan.',
    body: 'Before every move, find every one of your pieces that nothing is defending. An undefended piece is not merely at risk from a direct attack — it is what makes forks, pins and skewers work at all. A knight fork only wins material because one of the two targets was loose. Fix the loose piece and half the tactics against you stop existing.',
    source: 'A long-standing coaching maxim, popularised as "loose pieces drop off" by John Nunn.',
    practice: 'Play a game where, before each move, you name every undefended piece you own.',
    themes: ['piece-safety', 'hangingPiece'],
  },
  {
    id: 'checks-captures-threats',
    title: 'Checks, captures, threats',
    pillar: 'tactics',
    band: [600, 1500],
    hook: 'A blunder-check that takes ten seconds and saves whole games.',
    body: 'Before you commit a move, list the forcing moves available to your opponent after it: every check, every capture, every direct threat. Forcing moves are the ones that win games, and they are a short list — usually three or four. You are not calculating deeply here, you are refusing to be surprised.',
    source: 'Standard tactical discipline, taught in essentially every coaching tradition.',
    practice: "For one whole game, don't touch a piece until you've named their checks and captures.",
    themes: ['threat-detection', 'fork', 'piece-safety'],
  },

  /* ---------------------------------------------------------- opening */
  {
    id: 'opening-purpose',
    title: 'The opening has three jobs',
    pillar: 'opening',
    band: [600, 1300],
    hook: 'Not memorisation. Development, the centre, and a safe king.',
    body: 'Every good opening move does at least one of three things: develops a piece toward the centre, fights for central squares, or makes your king safe. Moves that do none of those are usually a wasted tempo, however clever they look. This is why moving the same piece twice or chasing an early check tends to backfire — you spend time and gain nothing.',
    source: 'Classical opening principles, systematised in the nineteenth century and taught since.',
    practice: 'Play ten moves and score each: did it develop, fight for the centre, or castle?',
    themes: ['opening-principles', 'development', 'centre'],
  },
  {
    id: 'early-queen',
    title: 'Why the early queen sortie fails',
    pillar: 'opening',
    band: [600, 1300],
    hook: 'She is the most valuable piece, which makes her the easiest to chase.',
    body: 'Bringing the queen out early feels aggressive, and against a weak opponent it sometimes wins immediately. Against anyone else it loses time: every minor piece your opponent develops can attack her, and she must run. They develop with tempo, you develop nothing. Aggression is fine — but aim it with pieces that cannot be harassed by pawns and knights.',
    source: "Classical opening principle; the Scholar's Mate refutation is the standard teaching example.",
    practice: 'Play a game where the queen does not leave the first two ranks before move twelve.',
    themes: ['opening-principles', 'development'],
  },

  /* ---------------------------------------------------------- endgame */
  {
    id: 'endgame-first',
    title: 'Learn endgames in rating order',
    pillar: 'endgame',
    band: [600, 2200],
    hook: 'The single most useful idea in your book stack.',
    body: 'Endgame knowledge should be acquired in strict order of what you will actually face. At your level that is: basic mates, then king and pawn, then the two rook-endgame positions everyone must know. Everything beyond that is wasted study until the earlier material is automatic. Knowing an obscure bishop ending while fumbling king and pawn is backwards, and it is the most common way players waste study time.',
    source: "The rating-banded structure of Jeremy Silman's Complete Endgame Course.",
    practice: 'Do not open a rook-ending chapter until king and queen mates are automatic.',
    themes: ['mate-kq', 'mate-kr', 'pawnEndgame'],
  },
  {
    id: 'opposition',
    title: 'The opposition',
    pillar: 'endgame',
    band: [900, 1500],
    hook: 'In king-and-pawn endings, whoever must move first usually gives way.',
    body: 'When the two kings face each other with one square between them, whoever is on move has to step aside. That single idea decides an enormous proportion of pawn endings. Winning the opposition is often the entire content of a won endgame, and losing it turns a win into a draw with no visible blunder anywhere.',
    source: "Fundamental endgame theory; the standard treatment is in Silman's endgame course.",
    practice: 'Set up king and pawn versus king and win it from both sides until it is automatic.',
    themes: ['opposition', 'pawnEndgame', 'key-squares'],
  },
  {
    id: 'lucena-philidor',
    title: 'The two rook endings you cannot skip',
    pillar: 'endgame',
    band: [1200, 1800],
    hook: 'Rook endings are the most common endgame. Two positions cover most of them.',
    body: 'The Lucena position is the winning technique when you have a rook and pawn against a rook and the pawn is close to promoting. The Philidor position is the drawing technique for the defender. Between them they resolve a large share of practical rook endings. Learning them is a couple of hours of work that pays out for the rest of your chess life.',
    source: 'Named after Luis Ramírez de Lucena and François-André Philidor; standard in every endgame manual.',
    practice: 'Drill both from both sides until you can play them without recall effort.',
    themes: ['rookEndgame', 'lucena', 'philidor'],
  },

  /* ------------------------------------------------------- positional */
  {
    id: 'imbalances',
    title: 'Read the imbalances',
    pillar: 'positional',
    band: [1300, 2000],
    hook: 'Do not ask "what is my move?" Ask "what is different about the two sides?"',
    body: 'Every position has a short list of asymmetries: minor-piece quality, pawn structure, space, material, control of files and squares, development, and the initiative. Your plan should come from those differences rather than from a general urge to attack. If you own the only open file, the plan is the file. If their bishop is bad, the plan is to keep it bad. The position tells you what to do if you catalogue what is unequal about it.',
    source: "The imbalance framework as set out in Jeremy Silman's How to Reassess Your Chess.",
    practice: 'Pause at move twenty and list every imbalance before choosing a move.',
    themes: ['plan-selection', 'pawn-structure', 'bishop-quality', 'space'],
  },
  {
    id: 'outposts',
    title: 'The outpost',
    pillar: 'positional',
    band: [1200, 1800],
    hook: 'A knight no pawn can ever chase away is worth more than a bishop.',
    body: 'An outpost is a square in or near enemy territory that no enemy pawn can attack, because the pawns that would do so are gone or have advanced past it. A knight parked there is close to permanent, and a permanent knight inside the opponent\'s position is worth real material. Half of positional play is noticing these squares exist and getting a piece to one.',
    source: "Aron Nimzowitsch's treatment of outposts in My System.",
    practice: 'Every game, find the square no enemy pawn can attack. Try to occupy it.',
    themes: ['outpost', 'weak-square'],
  },
  {
    id: 'bad-bishop',
    title: 'The bishop your own pawns imprison',
    pillar: 'positional',
    band: [1400, 2000],
    hook: 'A bishop is only as good as the squares it can reach.',
    body: 'If your pawns sit on the same colour as your bishop, that bishop is biting granite. It looks like a piece and counts as three points, but it does very little. Two consequences follow: put your pawns on the opposite colour to your remaining bishop, and when you have the choice, trade off the bad bishop rather than the good one — even though on paper the trade looks equal.',
    source: 'Classical positional theory; the good-versus-bad bishop distinction is central to the imbalance framework.',
    practice: 'Before trading a bishop, check which colour your own pawns occupy.',
    themes: ['bishop-quality', 'colour-complex', 'pawn-structure'],
  },
  {
    id: 'prophylaxis',
    title: 'Prophylaxis',
    pillar: 'positional',
    band: [1500, 2200],
    hook: 'Before you ask what your plan is, ask what theirs is — then take it away.',
    body: 'Most players think only about their own intentions. The stronger habit is to work out what your opponent wants to do next, and make it impossible before it happens. A move that achieves nothing for you but permanently kills their idea is frequently the best move on the board. It feels passive and it is the opposite: you are the one setting the terms.',
    source: "Aron Nimzowitsch's concept of prophylaxis, from My System. Karpov is the classic practitioner.",
    practice: 'For one game, before every move, name what your opponent wants. Then stop it.',
    themes: ['prophylaxis', 'threat-detection', 'defence'],
  },
  {
    id: 'seventh-rank',
    title: 'Rooks on the seventh',
    pillar: 'positional',
    band: [1300, 1900],
    hook: 'A rook on the seventh attacks pawns and traps the king at the same time.',
    body: 'The seventh rank is where the enemy pawns start and where their king often still sits. A rook there does two jobs at once, and two rooks there is frequently winning regardless of material. This is why giving up a pawn to get a rook to the seventh is often a good trade — activity in rook endings is worth more than the pawn count suggests.',
    source: "Nimzowitsch's treatment of the seventh rank in My System.",
    practice: 'In your next endgame, prefer the active rook over the pawn-defending rook.',
    themes: ['rook-activity', 'open-file', 'rookEndgame'],
  },

  /* -------------------------------------------------------- strategy */
  {
    id: 'candidate-moves',
    title: 'Candidate moves',
    pillar: 'strategy',
    band: [1400, 2200],
    hook: 'List the options first. Then calculate. Never mix the two.',
    body: 'The common failure is to see one idea, calculate it for two minutes, and play it — never having asked what else existed. The discipline is to first list the two to four moves worth considering, then examine each one once, in order, without jumping back and forth. Most missed wins are not calculation failures. They are moves that were never considered at all.',
    source: "Alexander Kotov's method of candidate moves and the analysis tree, from Think Like a Grandmaster.",
    practice: 'On every critical move, name three candidates before calculating any of them.',
    themes: ['plan-selection', 'quietMove'],
  },
  {
    id: 'attack-requires-count',
    title: 'Count before you attack',
    pillar: 'strategy',
    band: [1300, 1900],
    hook: 'An attack with two pieces against three defenders is not an attack.',
    body: 'Before launching at the enemy king, count how many of your pieces can actually reach the attacking zone against how many defend it. If you are not ahead on that count, the attack will fail and leave you with loose pieces where your position used to be. Bring one more piece first. The most common attacking error is starting one piece too early.',
    source: 'Standard attacking method; the attacker-count heuristic is common to most attacking manuals.',
    practice: 'Before your next kingside push, count attackers versus defenders honestly.',
    themes: ['kingsideAttack', 'attack-count', 'exposedKing'],
  },
  {
    id: 'initiative',
    title: 'The initiative is worth material',
    pillar: 'strategy',
    band: [1500, 2200],
    hook: 'Sometimes the pawn is not the point.',
    body: 'When every move you make forces a reply, your opponent never gets to do what they want. That is worth something concrete, and sometimes more than a pawn or a piece. The judgment call is whether the forcing sequence lasts long enough to convert. Give material for the initiative when you can see the follow-up, not because the position feels exciting.',
    source: "Best illustrated by Mikhail Tal's practical play; the games are the argument.",
    practice: 'Study one sacrificial game and ask, each move, what the defender wanted and could not do.',
    themes: ['sacrifice', 'simulation', 'kingsideAttack'],
  },
  {
    id: 'small-advantages',
    title: 'Accumulate small advantages',
    pillar: 'strategy',
    band: [1500, 2200],
    hook: 'Nobody wins from equality in one move. They win from twenty tiny gains.',
    body: 'Strong positional players do not find brilliancies. They improve their worst-placed piece, take a slightly better square, fix a pawn on a bad colour, and repeat — until the accumulated small edges become a decisive one and the win looks inevitable in hindsight. If you cannot find a good move, find your worst piece and improve it.',
    source: 'The method associated with Wilhelm Steinitz and exemplified in Anatoly Karpov\'s games.',
    practice: 'When stuck, identify your worst-placed piece and spend the move improving it.',
    themes: ['manoeuvring', 'space', 'plan-selection'],
  },
  {
    id: 'convert-by-simplifying',
    title: 'Trade pieces when ahead, pawns when behind',
    pillar: 'strategy',
    band: [1200, 1800],
    hook: 'The most reliable winning technique, and it needs no calculation.',
    body: 'Material advantages grow as pieces leave the board — a rook up in a bare endgame is trivially winning, while a rook up in a crowded middlegame can still go wrong. So when ahead, trade pieces and keep pawns. When behind, do the reverse: keep pieces on for complications, and trade pawns toward drawn endings.',
    source: 'Standard conversion technique, taught universally.',
    practice: 'Next time you win a piece, count how many trades it takes to make the win obvious.',
    themes: ['conversion', 'simplification'],
  },

  /* --------------------------------------------------------- tactics */
  {
    id: 'pattern-volume',
    title: 'Tactics are recognition, not calculation',
    pillar: 'tactics',
    band: [600, 1800],
    hook: 'You cannot calculate a fork you do not recognise.',
    body: 'Strong players do not out-calculate you on most tactics — they recognise the shape instantly and only then check it. That recognition comes from volume: hundreds of examples of the same handful of patterns, until a knight two squares from two pieces simply looks wrong. This is why puzzle repetition works and reading about tactics does not.',
    source: "The volume-and-progression approach behind László Polgár's 5334 problem collection.",
    practice: 'Short daily sets beat occasional long ones. Consistency is the whole mechanism.',
    themes: ['fork', 'pin', 'skewer', 'mateIn1', 'mateIn2'],
  },
  {
    id: 'quiet-move',
    title: 'The hardest tactic is not a check',
    pillar: 'tactics',
    band: [1600, 2200],
    hook: 'When forcing moves fail, look for the one that threatens everything and forces nothing.',
    body: 'Most players search checks and captures, find nothing, and move on. The strongest tactical resource is often a quiet move that creates an unanswerable threat while giving the opponent no forced reply to hide behind. These are hard precisely because the search habit that finds normal tactics skips right over them.',
    source: 'A standard advanced tactical theme; the quiet-move category in puzzle databases isolates it.',
    practice: 'When the forcing moves come up empty, ask what threat you could create without check.',
    themes: ['quietMove', 'zugzwang', 'intermezzo'],
  },
]

export function lessonsAtRating(rating: number): Lesson[] {
  return LESSONS.filter((l) => rating >= l.band[0] && rating <= l.band[1])
}

export function lessonsForThemes(themes: string[]): Lesson[] {
  if (themes.length === 0) return []
  return LESSONS.filter((l) => l.themes.some((t) => themes.includes(t)))
}

/**
 * The lesson to show today: prefer one that addresses the current weakness,
 * fall back to the rating band, and rotate by day so it isn't the same card
 * every morning.
 */
export function pickLesson(
  rating: number,
  focusThemes: string[],
  seenIds: Set<string> = new Set(),
  dayIndex = Math.floor(Date.now() / 86_400_000),
): Lesson | null {
  const inBand = lessonsAtRating(rating)
  const targeted = inBand.filter(
    (l) => l.themes.some((t) => focusThemes.includes(t)) && !seenIds.has(l.id),
  )
  const unseen = inBand.filter((l) => !seenIds.has(l.id))
  const pool = targeted.length > 0 ? targeted : unseen.length > 0 ? unseen : inBand
  if (pool.length === 0) return null
  return pool[dayIndex % pool.length] ?? null
}
