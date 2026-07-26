-- Chess Coach — cloud mirror of the local training data.
--
-- SECURITY NOTE, because it matters here more than usual:
-- the repo is public and the publishable key ships inside the client bundle.
-- That is fine and by design — publishable keys are meant to be public — but
-- ONLY because Row Level Security is on. RLS is the entire security boundary.
-- Every table below enables it and every policy is scoped to auth.uid().
-- If a future table forgets either, that table becomes world-readable.
--
-- The local IndexedDB stays the source of truth. This is a mirror so the same
-- profile follows Sean between his phone and his work machine; the app must
-- keep working with this unreachable.

-- ---------------------------------------------------------------- profile

create table if not exists public.profiles (
  user_id           uuid primary key references auth.users on delete cascade,
  rating            integer     not null default 1400,
  rating_deviation  real        not null default 250,
  streak            integer     not null default 0,
  last_session_date date,
  updated_at        timestamptz not null default now()
);

-- ------------------------------------------------------------------ games

create table if not exists public.games (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users on delete cascade,
  played_at           timestamptz not null,
  human_colour        text        not null check (human_colour in ('w', 'b')),
  opponent_elo        integer     not null,
  opponent_style      text        not null,
  result              text        not null check (result in ('win', 'loss', 'draw')),
  reason              text        not null default '',
  pgn                 text        not null,
  acpl                integer,
  performance_rating  integer,
  analysed_at         timestamptz,
  -- Local Dexie id, so a re-sync updates rather than duplicating.
  local_id            integer,
  unique (user_id, local_id)
);

create index if not exists games_user_played on public.games (user_id, played_at desc);

-- --------------------------------------------------------------- mistakes

create table if not exists public.mistakes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid        not null references auth.users on delete cascade,
  -- 0 when it came from a puzzle rather than a game.
  game_id   integer     not null default 0,
  source    text        not null default 'game' check (source in ('game', 'puzzle')),
  ply       integer     not null default 0,
  fen       text        not null,
  san       text        not null default '',
  best_san  text,
  loss_cp   integer     not null,
  severity  text        not null,
  tag       text,
  phase     text        not null,
  at        timestamptz not null,
  local_id  integer,
  unique (user_id, local_id)
);

-- The two hot reads are "recent mistakes" and "mistakes by tag".
create index if not exists mistakes_user_at on public.mistakes (user_id, at desc);
create index if not exists mistakes_user_tag on public.mistakes (user_id, tag);

-- -------------------------------------------------------- puzzle attempts

create table if not exists public.puzzle_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users on delete cascade,
  puzzle_id  text        not null,
  themes     text        not null default '',
  rating     integer     not null,
  correct    boolean     not null,
  ms         integer     not null default 0,
  tier_id    text,
  at         timestamptz not null,
  local_id   integer,
  unique (user_id, local_id)
);

create index if not exists attempts_user_at on public.puzzle_attempts (user_id, at desc);
-- Used to avoid re-serving a puzzle already seen.
create index if not exists attempts_user_puzzle on public.puzzle_attempts (user_id, puzzle_id);

-- ----------------------------------------------------------- tier progress

create table if not exists public.tier_progress (
  user_id     uuid        not null references auth.users on delete cascade,
  tier_id     text        not null,
  solved      integer     not null default 0,
  correct     integer     not null default 0,
  cleared     boolean     not null default false,
  cleared_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, tier_id)
);

-- ------------------------------------------------------------------- RLS

alter table public.profiles        enable row level security;
alter table public.games           enable row level security;
alter table public.mistakes        enable row level security;
alter table public.puzzle_attempts enable row level security;
alter table public.tier_progress   enable row level security;

-- One policy shape, applied to every table: you may touch your own rows and
-- nobody else's. `with check` on writes stops a client inserting rows tagged
-- with someone else's user_id.

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own games" on public.games;
create policy "own games" on public.games
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own mistakes" on public.mistakes;
create policy "own mistakes" on public.mistakes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own attempts" on public.puzzle_attempts;
create policy "own attempts" on public.puzzle_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tier progress" on public.tier_progress;
create policy "own tier progress" on public.tier_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------ profile bootstrap

-- Create the profile row on signup so the client never has to handle a
-- missing-profile case on a fresh device.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
