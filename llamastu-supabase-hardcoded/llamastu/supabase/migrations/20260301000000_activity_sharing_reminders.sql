-- ===========================================================================
-- Llamastu — authoritative study activity, always-unlocked achievements,
-- link note sharing with conflict safety, and reminder delivery records.
--
-- Run after 20260101000000_llamastu_init.sql and
-- 20260201000000_calendar_maps_push.sql:
--   supabase db push
--
-- Everything here is re-runnable: tables use `create table if not exists`,
-- new columns use `add column if not exists`, and every constraint is added
-- behind a pg_constraint guard.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- study_activity — the authoritative record of qualifying study.
--
-- A page visit does NOT qualify. Only four real activities are recorded:
-- a processed material, a stored quiz attempt, an opened challenge gate and a
-- finished world. `activity_key` is the idempotency key, so a double submit,
-- a retry or a replayed event can never add a second row — and therefore can
-- never stretch the streak. `date` defaults from the SERVER clock so a client
-- can neither choose nor backdate the day it is credited for.
-- ---------------------------------------------------------------------------

create table if not exists public.study_activity (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null
                 check (kind in ('material_processed','quiz_completed','gate_opened','world_finished')),
  date         date not null default ((now() at time zone 'utc')::date),
  activity_key text not null,
  created_at   timestamptz not null default now(),
  unique (user_id, activity_key)
);

create index if not exists study_activity_user_date_idx
  on public.study_activity (user_id, date);
create index if not exists study_activity_user_created_idx
  on public.study_activity (user_id, created_at desc);

alter table public.study_activity enable row level security;

drop policy if exists study_activity_own on public.study_activity;
create policy study_activity_own on public.study_activity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_achievements — the achievement record, INDEPENDENT of the XP ledger.
--
-- The table already exists from the init migration keyed by `achievement_code`.
-- It is extended here with a generated `code` column so the record exposes the
-- (code, user_id, unlocked_at) shape, and so a reader can never confuse the
-- achievement record with a reward: unlocking NEVER writes to xp_events and
-- NEVER awards SP.
-- ---------------------------------------------------------------------------

create table if not exists public.user_achievements (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  achievement_code text not null references public.achievements (code) on delete cascade,
  unlocked_at      timestamptz not null default now(),
  unique (user_id, achievement_code)
);

alter table public.user_achievements
  add column if not exists code text generated always as (achievement_code) stored;

alter table public.user_achievements enable row level security;

drop policy if exists user_achievements_own on public.user_achievements;
create policy user_achievements_own on public.user_achievements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ensure_all_achievements() — upsert a row for EVERY catalogue code for the
-- calling user, so /achievements and /bootstrap always report all codes
-- unlocked.
--
-- A genuinely earned achievement keeps its real unlocked_at, taken from its
-- reward event (`achievement:<code>`) when one exists; otherwise the account
-- creation time is used. This function NEVER touches xp_events and NEVER
-- awards SP, so opening the gallery can never fabricate a reward.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_all_achievements()
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.user_achievements (user_id, achievement_code, unlocked_at)
  select
    uid,
    a.code,
    coalesce(
      (
        select e.created_at
        from public.xp_events e
        where e.user_id = uid
          and e.event_key = 'achievement:' || a.code
        order by e.created_at
        limit 1
      ),
      (select pr.created_at from public.profiles pr where pr.id = uid),
      now()
    )
  from public.achievements a
  cross join (select auth.uid() as uid) s
  where uid is not null
  on conflict (user_id, achievement_code) do update
    set unlocked_at = excluded.unlocked_at
    -- Only a GENUINELY earned achievement adopts its reward event's timestamp;
    -- the value is stable, so re-running this can never drift the timestamp.
    where exists (
      select 1 from public.xp_events e
      where e.user_id = excluded.user_id
        and e.event_key = 'achievement:' || excluded.achievement_code
    );
$$;

revoke all on function public.ensure_all_achievements() from public;
grant execute on function public.ensure_all_achievements() to authenticated;

-- A brand-new account gets the whole catalogue immediately, so there is no
-- window in which the gallery looks empty.
create or replace function public.handle_new_user_achievements()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.user_achievements (user_id, achievement_code, unlocked_at)
  select new.id, a.code, coalesce(new.created_at, now())
  from public.achievements a
  on conflict (user_id, achievement_code) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_achievements on auth.users;
create trigger on_auth_user_created_achievements
  after insert on auth.users
  for each row execute function public.handle_new_user_achievements();

-- Backfill every existing account. Existing (genuine) rows are preserved by the
-- `do nothing`, so a real unlock timestamp is never overwritten.
insert into public.user_achievements (user_id, achievement_code, unlocked_at)
select
  p.id,
  a.code,
  coalesce(
    (
      select e.created_at
      from public.xp_events e
      where e.user_id = p.id
        and e.event_key = 'achievement:' || a.code
      order by e.created_at
      limit 1
    ),
    p.created_at,
    now()
  )
from public.profiles p
cross join public.achievements a
on conflict (user_id, achievement_code) do update
  set unlocked_at = excluded.unlocked_at
  where exists (
    select 1 from public.xp_events e
    where e.user_id = excluded.user_id
      and e.event_key = 'achievement:' || excluded.achievement_code
  );

-- ---------------------------------------------------------------------------
-- notes — link sharing, share modes and optimistic-concurrency versioning.
-- ---------------------------------------------------------------------------

alter table public.notes
  add column if not exists share_token text,
  add column if not exists share_mode text not null default 'private',
  add column if not exists version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass and conname = 'notes_share_mode_check'
  ) then
    alter table public.notes
      add constraint notes_share_mode_check
      check (share_mode in ('private','view','edit'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass and conname = 'notes_share_token_key'
  ) then
    alter table public.notes
      add constraint notes_share_token_key unique (share_token);
  end if;
end $$;

-- The sharing RLS: the owner always has full access; an invited collaborator
-- reads, and writes only when permission = 'editor'. A row whose share_mode is
-- not 'private' is readable by anyone holding the token — but ONLY through the
-- SECURITY DEFINER function below, so a link holder can never list notes.
drop policy if exists notes_read on public.notes;
create policy notes_read on public.notes
  for select using (public.can_access_note(id, false));

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert with check (auth.uid() = owner_id);

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update using (public.can_access_note(id, true))
  with check (public.can_access_note(id, true));

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete using (auth.uid() = owner_id);

-- Resolve ONE shared note from its token. It takes the token, not a user id, so
-- possession of the link is the capability — and it returns a single row, never
-- a listable set. Revoking sharing clears share_token, so an old link stops
-- resolving on the very next request.
create or replace function public.note_by_share_token(p_token text)
returns setof public.notes
language sql
security definer
set search_path = public, extensions
stable
as $$
  select *
  from public.notes
  where p_token is not null
    and share_token = p_token
    and share_mode in ('view','edit')
  limit 1;
$$;

revoke all on function public.note_by_share_token(text) from public;
grant execute on function public.note_by_share_token(text) to anon, authenticated;

-- A share token is the only thing protecting a shared link, so it must be
-- unguessable: drawn from the CSPRNG, never derived from the note id.
create or replace function public.new_share_token()
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select encode(gen_random_bytes(24), 'hex');
$$;

revoke all on function public.new_share_token() from public;
grant execute on function public.new_share_token() to authenticated;

-- Real-time: stream note changes to subscribed clients. Guarded so it is a
-- no-op when the table is already part of the publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.notes;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- reminder_deliveries — an auditable record of every reminder the caller was
-- told about, on any channel. The unique key makes a delivery idempotent.
-- ---------------------------------------------------------------------------

create table if not exists public.reminder_deliveries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  event_id     uuid not null references public.calendar_events (id) on delete cascade,
  reminder_at  timestamptz not null,
  channel      text not null check (channel in ('in-app','browser','push')),
  status       text not null check (status in ('scheduled','delivered','failed')),
  detail       text not null default '',
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  unique (user_id, event_id, reminder_at, channel)
);

create index if not exists reminder_deliveries_user_idx
  on public.reminder_deliveries (user_id, created_at desc);

alter table public.reminder_deliveries enable row level security;

drop policy if exists reminder_deliveries_own on public.reminder_deliveries;
create policy reminder_deliveries_own on public.reminder_deliveries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
