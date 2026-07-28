-- Scoring fields for puzzle attempts.
--
-- These three have existed on the local Dexie row since scoring was added, and
-- have been stranded there ever since: sync.ts maps every column by hand, so a
-- field with no matching column simply never left the device. Points earned on
-- the phone were invisible on the desktop and vice versa.
--
-- The ordering constraint is the reason this is a separate migration rather
-- than an edit to the initial schema. A column that exists locally and not
-- remotely loses data silently; a column pushed to a table that lacks it makes
-- PostgREST reject the whole upsert, which would take games and mistakes down
-- with it. So the column has to land BEFORE the client starts sending it, and
-- anyone running an older client stays fine because all three are nullable.
--
-- Nullable rather than defaulted, deliberately. Rows written before scoring
-- existed genuinely have no score, and `0 points` is a claim about performance
-- that nobody made. The client maps null back to absent.

alter table public.puzzle_attempts
  add column if not exists attempts  integer,
  add column if not exists hint_used boolean,
  add column if not exists points    integer;

comment on column public.puzzle_attempts.attempts is
  'Goes taken before solving; 1 = first time. Null for rows predating scoring.';
comment on column public.puzzle_attempts.hint_used is
  'Whether the idea was revealed before solving. Null for rows predating scoring.';
comment on column public.puzzle_attempts.points is
  'Points earned after deductions. Null for rows predating scoring.';

-- RLS needs no change: the policy on puzzle_attempts is table-wide
-- (`for all using (auth.uid() = user_id)`), so new columns are covered by it
-- automatically. Noted explicitly because a per-column policy would NOT be,
-- and this is the failure mode that makes a public-repo project leak.
