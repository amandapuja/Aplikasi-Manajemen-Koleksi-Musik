-- Store account-level appearance preferences in the same durable profile row
-- used by the rest of the user's cloud data.
alter table public.profiles
  add column if not exists app_preferences jsonb not null default '{}'::jsonb;
