-- ============================================================
-- ARISE: Push Notifications + Daily Bonus Missions
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Push subscriptions (one per user, stores browser push subscription JSON)
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null unique,
  subscription jsonb not null,
  created_at   timestamptz default now()
);

alter table push_subscriptions enable row level security;

create policy "Users manage own push subscription"
  on push_subscriptions for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Daily bonus missions (one row per user per day)
create table if not exists daily_bonus_missions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  missions       jsonb not null default '[]',
  generated_date text not null,           -- YYYY-MM-DD
  created_at     timestamptz default now(),
  unique(user_id, generated_date)
);

alter table daily_bonus_missions enable row level security;

create policy "Users read/update own daily missions"
  on daily_bonus_missions for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 3. pg_cron schedule (optional — alternative to Dashboard schedule)
--    Enable extensions first:  Extensions → pg_cron + pg_net
--    Then run the block below AFTER deploying the Edge Function.
-- ============================================================
--
-- select cron.schedule(
--   'arise-generate-daily-missions',
--   '0 7 * * *',       -- 7:00 AM UTC every day
--   $$
--   select net.http_post(
--     url     := 'https://hidccqxlomgtiqezelqv.supabase.co/functions/v1/generate-daily-missions',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <PASTE_SERVICE_ROLE_KEY_HERE>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
