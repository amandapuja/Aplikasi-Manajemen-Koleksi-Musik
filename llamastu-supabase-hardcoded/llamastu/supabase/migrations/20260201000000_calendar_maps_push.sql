-- ===========================================================================
-- Llamastu — calendar, reminders, per-map progress and push subscriptions
--
-- Run after 20260101000000_llamastu_init.sql:
--   supabase db push
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- calendar_events — the single source of truth for the calendar AND the
-- timetable. Class entries use category = 'class', which is exactly what the
-- timetable screen reads, so there is no second competing schedule system.
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  title            text not null,
  description      text not null default '',
  category         text not null default 'study'
                     check (category in ('study','class','exam','assignment','review','other')),
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  location         text,
  /*
   * The reminder is DERIVED, not independent. reminder_at is recomputed from
   * start_at and reminder_minutes by the API on every write, so editing an
   * event moves its alarm and deleting the event removes it. -1 means "no
   * reminder". reminder_sent_at lets a scheduled job avoid double-sending.
   */
  reminder_minutes integer not null default 0,
  reminder_at      timestamptz,
  reminder_sent_at timestamptz,
  repeat_rule      text not null default 'none'
                     check (repeat_rule in ('none','daily','weekly','monthly')),
  material_id      uuid references public.materials (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists calendar_events_user_start_idx
  on public.calendar_events (user_id, start_at);
create index if not exists calendar_events_due_idx
  on public.calendar_events (reminder_at)
  where reminder_at is not null and reminder_sent_at is null;

drop trigger if exists calendar_events_touch_updated_at on public.calendar_events;
create trigger calendar_events_touch_updated_at
  before update on public.calendar_events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Carry any existing schedule rows across, then retire the old table so the
-- two systems can never drift apart.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.schedules') is not null then
    insert into public.calendar_events
      (id, user_id, title, description, category, start_at, end_at, location,
       reminder_minutes, reminder_at, repeat_rule, created_at, updated_at)
    select
      s.id,
      s.user_id,
      s.course,
      coalesce(s.notes, ''),
      'class',
      s.start_at,
      s.end_at,
      s.room,
      s.reminder_minutes,
      case
        when s.reminder_minutes >= 0
          then s.start_at - make_interval(mins => s.reminder_minutes)
        else null
      end,
      case when s.repeat_rule = 'weekly' then 'weekly' else 'none' end,
      s.created_at,
      s.updated_at
    from public.schedules s
    on conflict (id) do nothing;

    drop table public.schedules;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  enabled           boolean not null default true,
  study_reminders   boolean not null default true,
  game_reminders    boolean not null default true,
  agenda_reminders  boolean not null default true,
  browser_push      boolean not null default false,
  lead_minutes      integer not null default 15 check (lead_minutes >= 0),
  updated_at        timestamptz not null default now()
);

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_preferences on auth.users;
create trigger on_auth_user_created_preferences
  after insert on auth.users
  for each row execute function public.handle_new_user_preferences();

-- ---------------------------------------------------------------------------
-- push_subscriptions — one row per browser subscription, for Web Push
-- delivery when no tab is open. The VAPID private key stays in the function
-- environment; only the endpoint and the client keys are stored here.
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- game_progress — now keyed by (user, material, map), so one document played
-- in two different maps keeps two independent sets of progress and rewards.
-- ---------------------------------------------------------------------------

alter table public.game_progress
  add column if not exists map_id text not null default 'obstacle_adventure',
  add column if not exists character_id text not null default '',
  add column if not exists orb_total integer not null default 0,
  add column if not exists best_time_seconds integer;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.game_progress'::regclass
      and conname = 'game_progress_user_id_material_id_key'
  ) then
    alter table public.game_progress
      drop constraint game_progress_user_id_material_id_key;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.game_progress'::regclass
      and conname = 'game_progress_user_material_map_key'
  ) then
    alter table public.game_progress
      add constraint game_progress_user_material_map_key
      unique (user_id, material_id, map_id);
  end if;
end $$;

create index if not exists game_progress_user_map_idx
  on public.game_progress (user_id, material_id, map_id);

-- ---------------------------------------------------------------------------
-- Row Level Security for the new tables
-- ---------------------------------------------------------------------------

alter table public.calendar_events        enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions     enable row level security;

drop policy if exists calendar_events_own on public.calendar_events;
create policy calendar_events_own on public.calendar_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A scheduled job (service role) needs to find due reminders across all users.
-- It bypasses RLS by design, but keep an explicit reminder for the reader:
--   select * from calendar_events
--   where reminder_at is not null and reminder_sent_at is null
--     and reminder_at <= now();
