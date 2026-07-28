-- Scoring fields for puzzle attempts.
--
-- `attempts`, `hint_used` and `points` have been on the local Dexie row since
-- three-tries scoring went in, but were never mirrored. The effect was quiet
-- and wrong in a specific way: a puzzle solved first time on the phone arrived
-- on the laptop as a bare correct/incorrect, so the same history told two
-- different stories depending which device you opened.
--
-- Nullable on purpose. Rows written before scoring existed genuinely have no
-- value, and defaulting them to (1, false, 0) would invent a clean first-time
-- solve that nobody ever made — which is worse than admitting the gap, because
-- a fabricated 1 is indistinguishable from a real one.
--
-- No policy changes needed: "own attempts" is `for all` on the table, so it
-- covers columns added later. Worth stating rather than assuming, since RLS is
-- the entire security boundary here (see the initial migration).

alter table public.puzzle_attempts
  add column if not exists attempts  integer,
  add column if not exists hint_used boolean,
  add column if not exists points    integer;

comment on column public.puzzle_attempts.attempts is
  'Tries taken; 1 = first time. Null for rows predating scoring.';
comment on column public.puzzle_attempts.hint_used is
  'Idea revealed before solving. Null for rows predating scoring.';
comment on column public.puzzle_attempts.points is
  'Points earned after deductions. Null for rows predating scoring.';
