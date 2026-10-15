-- ===========================================================================
-- Llamastu — Interactive Learning Platform
-- Full relational schema, Row Level Security, indexes and seed data.
--
-- Apply with either:
--   supabase db push
-- or by pasting this file into the Supabase SQL editor.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user, holds progression + character
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null default '',
  name               text not null default '',
  username           text not null default '',
  program            text not null default '',
  semester           text not null default '',
  bio                text not null default '',
  character          jsonb not null default jsonb_build_object(
                       'hair', 'cocoa', 'face', 'bright', 'outfit', 'peach',
                       'shoes', 'trail', 'hat', 'none', 'glasses', 'none',
                       'backpack', 'canvas', 'accessory', 'book'
                     ),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- xp_events — append-only ledger. The unique constraint is what makes
-- duplicate XP from replays, refreshes or retried requests impossible.
-- ---------------------------------------------------------------------------

create table if not exists public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  event_key  text not null,
  xp         integer not null check (xp >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists xp_events_user_idx on public.xp_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- daily_activity — one row per user per active day, drives the streak
-- ---------------------------------------------------------------------------

create table if not exists public.daily_activity (
  user_id       uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  xp_earned     integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (user_id, activity_date)
);

-- ---------------------------------------------------------------------------
-- materials
-- ---------------------------------------------------------------------------

create table if not exists public.materials (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null default '',
  name           text not null default '',
  subject        text,
  mime_type      text not null default 'application/octet-stream',
  size_bytes     bigint not null default 0,
  storage_path   text,
  status         text not null default 'processing'
                   check (status in ('uploading', 'processing', 'ready', 'failed', 'needs_text')),
  error_message  text,
  summary        text,
  key_points     jsonb not null default '[]'::jsonb,
  objectives     jsonb not null default '[]'::jsonb,
  flashcards     jsonb not null default '[]'::jsonb,
  extracted_text text,
  word_count     integer not null default 0,
  xp_awarded     boolean not null default false,
  processed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists materials_user_idx on public.materials (user_id, created_at desc);
create index if not exists materials_status_idx on public.materials (user_id, status);

drop trigger if exists materials_touch_updated_at on public.materials;
create trigger materials_touch_updated_at
  before update on public.materials
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- material_questions — generated quiz/challenge questions
-- ---------------------------------------------------------------------------

create table if not exists public.material_questions (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references public.materials (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  position     integer not null default 0,
  question     text not null,
  choices      jsonb not null default '[]'::jsonb,
  answer_index integer not null default 0,
  explanation  text not null default '',
  difficulty   text not null default 'medium'
                 check (difficulty in ('easy', 'medium', 'hard')),
  created_at   timestamptz not null default now()
);

create index if not exists material_questions_material_idx
  on public.material_questions (material_id, position);

-- ---------------------------------------------------------------------------
-- quiz_attempts
-- ---------------------------------------------------------------------------

create table if not exists public.quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  score       integer not null default 0,
  total       integer not null default 0,
  xp_awarded  integer not null default 0,
  answers     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists quiz_attempts_user_idx
  on public.quiz_attempts (user_id, material_id, created_at desc);

-- ---------------------------------------------------------------------------
-- notes + note_collaborators
-- ---------------------------------------------------------------------------

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  material_id uuid references public.materials (id) on delete set null,
  title       text not null default 'Untitled note',
  content     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_owner_idx on public.notes (owner_id, updated_at desc);

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

create table if not exists public.note_collaborators (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  email      text not null,
  permission text not null default 'viewer' check (permission in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  unique (note_id, email)
);

create index if not exists note_collaborators_note_idx on public.note_collaborators (note_id);
create index if not exists note_collaborators_email_idx on public.note_collaborators (lower(email));

-- ---------------------------------------------------------------------------
-- schedules
-- ---------------------------------------------------------------------------

create table if not exists public.schedules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  course           text not null,
  lecturer         text,
  room             text,
  notes            text,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  repeat_rule      text not null default 'none' check (repeat_rule in ('none', 'weekly')),
  reminder_minutes integer not null default 0 check (reminder_minutes >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists schedules_user_idx on public.schedules (user_id, start_at);

drop trigger if exists schedules_touch_updated_at on public.schedules;
create trigger schedules_touch_updated_at
  before update on public.schedules
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  message    text not null default '',
  kind       text not null default 'system'
               check (kind in ('material', 'quiz', 'game', 'schedule', 'achievement', 'system')),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, read, created_at desc);

-- ---------------------------------------------------------------------------
-- game_progress — one row per (user, material)
-- ---------------------------------------------------------------------------

create table if not exists public.game_progress (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  material_id         uuid not null references public.materials (id) on delete cascade,
  opened_gates        jsonb not null default '[]'::jsonb,
  collected           jsonb not null default '[]'::jsonb,
  checkpoints         jsonb not null default '[]'::jsonb,
  position            real not null default 0,
  finished            boolean not null default false,
  xp_awarded          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, material_id)
);

drop trigger if exists game_progress_touch_updated_at on public.game_progress;
create trigger game_progress_touch_updated_at
  before update on public.game_progress
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- achievements catalogue + unlocked achievements
-- ---------------------------------------------------------------------------

create table if not exists public.achievements (
  code        text primary key,
  title       text not null,
  description text not null default '',
  icon        text not null default 'award',
  xp_reward   integer not null default 0
);

create table if not exists public.user_achievements (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  achievement_code text not null references public.achievements (code) on delete cascade,
  unlocked_at      timestamptz not null default now(),
  unique (user_id, achievement_code)
);

insert into public.achievements (code, title, description, icon, xp_reward) values
  ('first_upload',   'First Upload',        'Processed your first real learning material.',              'upload',  10),
  ('first_quiz',     'Quiz Explorer',       'Submitted your first generated quiz.',                      'quiz',    10),
  ('perfect_quiz',   'Quiz Master',         'Scored 100% on a generated quiz.',                          'award',   25),
  ('first_gate',     'First Game',          'Opened your first challenge gate in the adventure world.',  'play',    10),
  ('world_explorer', 'World Explorer',      'Reached the goal and finished a complete learning world.',  'spark',   25),
  ('collector',      'Orb Collector',       'Collected every study orb inside a learning world.',        'check',   20),
  ('note_taker',     'Note Taker',          'Created your first study note.',                            'edit',    10),
  ('planner',        'Planner',             'Added your first class to your schedule.',                  'calendar',10),
  ('streak_3',       'Consistent Learner',  'Studied three days in a row.',                              'flame',   20),
  ('level_5',        'Rising Scholar',      'Reached level 5.',                                          'book',    30)
on conflict (code) do update
  set title = excluded.title,
      description = excluded.description,
      icon = excluded.icon,
      xp_reward = excluded.xp_reward;

-- ---------------------------------------------------------------------------
-- New-user bootstrap: profile row + welcome notification
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, username)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'learner'), '@', 1)),
    lower(split_part(coalesce(new.email, 'learner'), '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.notifications (user_id, title, message, kind)
  values (
    new.id,
    'Welcome to Llamastu',
    'Upload your first course document to generate a study world.',
    'system'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security — every table is owner-only
-- ---------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.xp_events           enable row level security;
alter table public.daily_activity      enable row level security;
alter table public.materials           enable row level security;
alter table public.material_questions  enable row level security;
alter table public.quiz_attempts       enable row level security;
alter table public.notes               enable row level security;
alter table public.note_collaborators  enable row level security;
alter table public.schedules           enable row level security;
alter table public.notifications       enable row level security;
alter table public.game_progress       enable row level security;
alter table public.achievements        enable row level security;
alter table public.user_achievements   enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

-- xp_events -----------------------------------------------------------------
drop policy if exists xp_events_own on public.xp_events;
create policy xp_events_own on public.xp_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- daily_activity ------------------------------------------------------------
drop policy if exists daily_activity_own on public.daily_activity;
create policy daily_activity_own on public.daily_activity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- materials -----------------------------------------------------------------
drop policy if exists materials_own on public.materials;
create policy materials_own on public.materials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- material_questions --------------------------------------------------------
drop policy if exists material_questions_own on public.material_questions;
create policy material_questions_own on public.material_questions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- quiz_attempts -------------------------------------------------------------
drop policy if exists quiz_attempts_own on public.quiz_attempts;
create policy quiz_attempts_own on public.quiz_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- game_progress -------------------------------------------------------------
drop policy if exists game_progress_own on public.game_progress;
create policy game_progress_own on public.game_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- schedules -----------------------------------------------------------------
drop policy if exists schedules_own on public.schedules;
create policy schedules_own on public.schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notifications -------------------------------------------------------------
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- achievements catalogue is readable by any signed-in user ------------------
drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements
  for select using (auth.role() = 'authenticated');

-- user_achievements ---------------------------------------------------------
drop policy if exists user_achievements_own on public.user_achievements;
create policy user_achievements_own on public.user_achievements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notes: owner or accepted collaborator ------------------------------------
create or replace function public.can_access_note(note_uuid uuid, need_edit boolean default false)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.notes n
    where n.id = note_uuid and n.owner_id = auth.uid()
  ) or exists (
    select 1 from public.note_collaborators c
    join auth.users u on lower(u.email) = lower(c.email)
    where c.note_id = note_uuid
      and u.id = auth.uid()
      and (not need_edit or c.permission = 'editor')
  );
$$;

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

-- note_collaborators: only the note owner manages sharing -------------------
drop policy if exists note_collaborators_read on public.note_collaborators;
create policy note_collaborators_read on public.note_collaborators
  for select using (public.can_access_note(note_id, false));

drop policy if exists note_collaborators_write on public.note_collaborators;
create policy note_collaborators_write on public.note_collaborators
  for all using (
    exists (select 1 from public.notes n where n.id = note_id and n.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.notes n where n.id = note_id and n.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Storage: private bucket for uploaded material files.
-- Object names are always "<user_id>/<material_id>/<filename>", and the
-- policies below only allow access to the owner's own folder prefix.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists materials_storage_select on storage.objects;
create policy materials_storage_select on storage.objects
  for select using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists materials_storage_insert on storage.objects;
create policy materials_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists materials_storage_update on storage.objects;
create policy materials_storage_update on storage.objects
  for update using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists materials_storage_delete on storage.objects;
create policy materials_storage_delete on storage.objects
  for delete using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
