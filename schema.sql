-- Fakkakha AI — Supabase schema (v2: real per-user isolation)
-- Safe to re-run at any time, on a fresh project OR an existing one that
-- ran an older version of this file — every CREATE is IF NOT EXISTS, and
-- the DO block below explicitly migrates exam_questions if it already
-- existed in an older shape (see the comment right above that block).
--
-- IMPORTANT: this version requires Anonymous Sign-ins to be turned on:
-- Supabase dashboard -> Authentication -> Providers -> Anonymous Sign-ins -> Enable.
-- Without that toggle, supabase.auth.signInAnonymously() in the frontend
-- will fail and nobody will be able to create a profile.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  grade_label text,
  created_at timestamptz default now()
);
create index if not exists profiles_user_id_idx on profiles(user_id);
alter table profiles drop constraint if exists profiles_name_len;
alter table profiles add constraint profiles_name_len check (char_length(name) between 1 and 80);


create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  subject_label text not null,
  topic text not null,
  mastery numeric not null default 0.4,
  attempts int not null default 0,
  correct int not null default 0,
  last_practiced timestamptz default now(),
  unique(profile_id, subject_label, topic)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  question text,
  subject text,
  subject_label text,
  topic text,
  state text default 'ANALYZING',
  completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  role text not null check (role in ('ai','student','system')),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists exam_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  subject_label text not null,
  topics text[] not null,
  difficulty text default 'medium',
  question_count int not null,
  score int,
  total int,
  started_at timestamptz default now(),
  finished_at timestamptz
);

-- exam_questions holds correct_index and is NEVER exposed to the browser:
-- RLS is enabled with NO policy for anon/authenticated roles at all, so only
-- the backend's service-role client (lib/supabaseAdmin.js) can read/write it,
-- regardless of who is signed in.
create table if not exists exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_session_id uuid references exam_sessions(id) on delete cascade,
  text text not null,
  type text not null default 'mcq',
  options text[],           -- mcq only
  correct_index int,        -- mcq only
  correct_answer text,      -- short_answer only — the model answer to judge against
  topic text not null,
  ord int not null default 0
);

-- The block below makes this script safe to re-run even if exam_questions
-- already existed from an OLDER version of this schema (before short_answer
-- support was added). CREATE TABLE IF NOT EXISTS above is a silent no-op on
-- an existing table — it would NOT add these columns or relax the NOT NULL
-- constraints, and exam generation would start failing the moment it tried
-- to insert a short_answer question. This runs every time and only acts
-- when something is actually missing.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='exam_questions' and column_name='type') then
    alter table exam_questions add column type text not null default 'mcq';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='exam_questions' and column_name='correct_answer') then
    alter table exam_questions add column correct_answer text;
  end if;
  -- older versions had these NOT NULL; short_answer questions have neither set
  alter table exam_questions alter column options drop not null;
  alter table exam_questions alter column correct_index drop not null;
  if not exists (
    select 1 from pg_constraint where conname = 'exam_questions_type_check'
  ) then
    alter table exam_questions add constraint exam_questions_type_check check (type in ('mcq','short_answer'));
  end if;
end $$;

-- mistake_log: one row per categorized mistake, over time. This is what
-- makes "which mistake type keeps recurring" and "which topic causes the
-- most mistakes" answerable — the skills table only tracks a point-in-time
-- mastery percentage, not the pattern of WHY a student keeps getting
-- things wrong.
create table if not exists mistake_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  subject_label text not null,
  topic text not null,
  category text not null,
  source text not null,   -- 'session-turn' | 'detect-mistake' | 'exam'
  created_at timestamptz not null default now()
);
create index if not exists mistake_log_profile_idx on mistake_log(profile_id, created_at);

create table if not exists exam_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exam_session_id uuid references exam_sessions(id) on delete cascade,
  question_id uuid,
  selected_index int,
  is_correct boolean,
  created_at timestamptz default now()
);

create index if not exists skills_profile_id_idx on skills(profile_id);
create index if not exists sessions_profile_id_idx on sessions(profile_id);
create index if not exists messages_session_id_idx on messages(session_id);
create index if not exists exam_sessions_profile_id_idx on exam_sessions(profile_id);
alter table exam_sessions drop constraint if exists exam_sessions_question_count;
alter table exam_sessions add constraint exam_sessions_question_count check (question_count between 3 and 15);

create index if not exists exam_questions_session_id_idx on exam_questions(exam_session_id);
create index if not exists exam_answers_session_id_idx on exam_answers(exam_session_id);

-- push_tokens: registered device tokens for native push notifications
-- (Android/iOS via Capacitor). Actually SENDING a push still needs a
-- Firebase project's server credentials configured server-side — that part
-- is a manual account-setup step (see CHECKLIST.md). This table is what
-- makes the sending step possible once that's done; the client-side
-- registration that fills it is already fully wired up.
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token text not null,
  platform text not null,
  created_at timestamptz not null default now(),
  unique(user_id, token)
);

-- rate_limits backs simple per-user throttling on expensive AI endpoints.
-- No policy at all for anon/authenticated — only the backend's service-role
-- client ever touches this table.
create table if not exists rate_limits (
  key text primary key,       -- e.g. 'session-turn:<user_id>'
  window_start timestamptz not null default now(),
  count int not null default 0
);

-- response_cache: identical questions (e.g. "اشرحلي قانون نيوتن التاني" asked
-- by thousands of different students) reuse one stored Gemini response
-- instead of paying for a fresh call every single time. Admin-only, like
-- rate_limits — the cache key is a hash, never anything identifying a user.
create table if not exists response_cache (
  cache_key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists response_cache_created_at_idx on response_cache(created_at);

-- request_logs: one row per API call — endpoint, latency, status, whether
-- it was served from cache. This is what /api/metrics aggregates. Admin-only.
create table if not exists request_logs (
  id bigint generated always as identity primary key,
  endpoint text not null,
  status_code int not null,
  duration_ms int not null,
  cached boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists request_logs_endpoint_created_idx on request_logs(endpoint, created_at);

-- analytics_events: first-party, minimal product analytics (no third-party
-- tracker — deliberately, since this app is used by minors and third-party
-- trackers bring their own privacy/compliance baggage). Admin-only reads;
-- writes go through the backend, never directly from the browser.
create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  user_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_name_created_idx on analytics_events(event_name, created_at);

-- flagged_content: a student/parent/teacher can flag an AI response as
-- wrong or inappropriate. Reviewed manually via Supabase's table editor
-- for now; the important part is that reports land somewhere durable
-- instead of vanishing.
create table if not exists flagged_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  context text not null,       -- e.g. 'session-turn', 'detect-mistake'
  ai_message text not null,
  reason text,
  created_at timestamptz not null default now(),
  reviewed boolean not null default false
);

alter table profiles enable row level security;
alter table skills enable row level security;
alter table sessions enable row level security;
alter table messages enable row level security;
alter table exam_sessions enable row level security;
alter table exam_questions enable row level security;  -- intentionally no policy below
alter table exam_answers enable row level security;
alter table mistake_log enable row level security;
alter table push_tokens enable row level security;
alter table rate_limits enable row level security;     -- intentionally no policy below
alter table response_cache enable row level security;  -- intentionally no policy below
alter table request_logs enable row level security;    -- intentionally no policy below
alter table analytics_events enable row level security; -- intentionally no policy below
alter table flagged_content enable row level security;

-- Drop/recreate policies so this migration is genuinely safe to re-run.
drop policy if exists "own profiles" on profiles;
drop policy if exists "own skills" on skills;
drop policy if exists "own sessions" on sessions;
drop policy if exists "own messages" on messages;
drop policy if exists "own exam_sessions" on exam_sessions;
drop policy if exists "own exam_answers" on exam_answers;
drop policy if exists "own mistake_log" on mistake_log;
drop policy if exists "own push_tokens" on push_tokens;
drop policy if exists "own flagged_content insert" on flagged_content;
drop policy if exists "own flagged_content select" on flagged_content;

-- ---------------------------------------------------------------------------
-- Real per-user isolation: each policy checks auth.uid() = user_id, so a
-- signed-in (even anonymous) user can only ever see or modify their own
-- rows. This closes the "any anon-key holder can read/write anyone's data"
-- hole that a plain `using (true)` policy has.
-- ---------------------------------------------------------------------------
create policy "own profiles" on profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own skills" on skills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy "own sessions" on sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy "own messages" on messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "own exam_sessions" on exam_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy "own exam_answers" on exam_answers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from exam_sessions e where e.id = exam_session_id and e.user_id = auth.uid()));
create policy "own mistake_log" on mistake_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy "own push_tokens" on push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own flagged_content insert" on flagged_content for insert
  with check (auth.uid() = user_id);
create policy "own flagged_content select" on flagged_content for select
  using (auth.uid() = user_id);
-- exam_questions, rate_limits, response_cache, request_logs, analytics_events:
-- no policy on purpose — zero rows for anyone but the service-role backend,
-- regardless of auth state. flagged_content is the one exception: a user can
-- insert their own report and see reports they filed, but not anyone else's
-- or mark them reviewed (that's an admin-only action via the service role).
