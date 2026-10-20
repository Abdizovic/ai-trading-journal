-- =============================================================================
-- AI Trading Journal — core schema, constraints, indexes, triggers and RLS.
--
-- Security model
--   * Every table has Row Level Security enabled. Traders only ever see rows
--     where user_id = auth.uid().
--   * The `anon` role has no table access at all.
--   * `authenticated` gets the minimum privileges; UPDATE is granted per
--     column so users can never change role, status, ownership or timestamps.
--   * Admin capabilities are exposed only through SECURITY DEFINER functions
--     that check is_admin() and return aggregates (see the admin migration).
--   * AI analyses and AI request logs are written only by the Edge Function
--     (service role); users can read their own analyses.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Private schema for helpers that must not be exposed through the REST API
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users (id) on delete cascade,
  full_name          text not null check (char_length(btrim(full_name)) between 2 and 80),
  email              text not null check (char_length(email) <= 254),
  role               text not null default 'trader' check (role in ('trader', 'admin')),
  status             text not null default 'active' check (status in ('active', 'deactivated')),
  profile_image      text check (profile_image is null or char_length(profile_image) <= 500),
  trading_experience text check (trading_experience in ('beginner', 'intermediate', 'advanced', 'professional')),
  preferred_sessions text[] not null default '{}' check (cardinality(preferred_sessions) <= 5),
  preferred_pairs    text[] not null default '{}' check (cardinality(preferred_pairs) <= 10),
  last_active_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.trades (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  currency_pair     text not null check (currency_pair ~ '^[A-Z]{3}/[A-Z]{3}$'),
  direction         text not null check (direction in ('BUY', 'SELL')),
  entry_price       numeric(18, 6) not null check (entry_price > 0),
  exit_price        numeric(18, 6) not null check (exit_price > 0),
  stop_loss         numeric(18, 6) check (stop_loss > 0),
  take_profit       numeric(18, 6) check (take_profit > 0),
  position_size     numeric(12, 4) not null check (position_size > 0 and position_size <= 1000),
  risk_amount       numeric(16, 2) check (risk_amount >= 0),
  reward_amount     numeric(16, 2) check (reward_amount >= 0),
  risk_reward_ratio numeric(10, 2) check (risk_reward_ratio >= 0 and risk_reward_ratio < 1000),
  profit_loss       numeric(16, 2) not null check (abs(profit_loss) < 1000000000),
  trading_session   text not null check (trading_session in ('Asian', 'London', 'New York', 'London/NY Overlap', 'Sydney')),
  strategy          text not null check (char_length(btrim(strategy)) between 1 and 40),
  trade_result      text not null check (trade_result in ('win', 'loss', 'breakeven')),
  emotional_state   text check (emotional_state in ('calm', 'confident', 'fearful', 'greedy', 'stressed', 'neutral')),
  entry_reason      text check (char_length(entry_reason) <= 1000),
  notes             text check (char_length(notes) <= 4000),
  screenshot_url    text check (char_length(screenshot_url) <= 500),
  trade_date        timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- stop loss / take profit must sit on the correct side of the entry
  constraint trades_sl_side check (
    stop_loss is null
    or (direction = 'BUY' and stop_loss < entry_price)
    or (direction = 'SELL' and stop_loss > entry_price)
  ),
  constraint trades_tp_side check (
    take_profit is null
    or (direction = 'BUY' and take_profit > entry_price)
    or (direction = 'SELL' and take_profit < entry_price)
  ),
  -- result must agree with the sign of P/L
  constraint trades_result_matches_pl check (
    (trade_result = 'win' and profit_loss > 0)
    or (trade_result = 'loss' and profit_loss < 0)
    or trade_result = 'breakeven'
  )
);

create table public.trading_goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 3 and 80),
  description   text check (char_length(description) <= 500),
  metric        text not null default 'custom'
                check (metric in ('win_rate', 'avg_rr', 'journal_entries', 'max_trades_per_day', 'max_losing_streak', 'net_pnl', 'custom')),
  target_value  numeric(16, 2) not null check (target_value >= 0),
  current_value numeric(16, 2) not null default 0,
  start_date    timestamptz not null,
  end_date      timestamptz not null,
  status        text not null default 'active' check (status in ('active', 'completed', 'failed', 'paused')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint goals_dates check (end_date > start_date),
  constraint goals_win_rate_max check (metric <> 'win_rate' or target_value <= 100)
);

create table public.ai_analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  analysis_period text not null check (char_length(analysis_period) <= 40),
  period_start    timestamptz,
  period_end      timestamptz,
  trades_analyzed integer not null check (trades_analyzed >= 0),
  scope           text not null default 'portfolio' check (scope in ('portfolio', 'trade')),
  trade_id        uuid references public.trades (id) on delete set null,
  summary         text not null check (char_length(summary) <= 4000),
  analysis_result jsonb not null check (jsonb_typeof(analysis_result) = 'object'),
  model           text not null,
  created_at      timestamptz not null default now()
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null check (char_length(title) <= 120),
  message    text not null check (char_length(message) <= 1000),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  notifications_enabled boolean not null default true,
  goal_reminders        boolean not null default true,
  ai_ready_alerts       boolean not null default true,
  ai_include_notes      boolean not null default true,
  ai_include_emotions   boolean not null default true,
  ai_default_period     text not null default '90d' check (ai_default_period in ('30d', '90d', '180d', '365d', 'all')),
  theme                 text not null default 'system' check (theme in ('system', 'light', 'dark')),
  biometric_lock        boolean not null default false,
  auto_logout_minutes   integer not null default 30 check (auto_logout_minutes between 0 and 1440),
  updated_at            timestamptz not null default now()
);

-- Singleton row of platform settings (editable by admins only).
create table public.system_settings (
  id                      boolean primary key default true check (id),
  ai_enabled              boolean not null default true,
  ai_daily_limit_per_user integer not null default 10 check (ai_daily_limit_per_user between 0 and 100),
  min_trades_for_ai       integer not null default 5 check (min_trades_for_ai between 1 and 100),
  registration_open       boolean not null default true,
  maintenance_mode        boolean not null default false,
  max_screenshot_mb       integer not null default 5 check (max_screenshot_mb between 1 and 20),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users (id) on delete set null
);
insert into public.system_settings (id) values (true);

-- Append-only audit trail (written only by SECURITY DEFINER code).
create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null check (char_length(action) <= 60),
  target     text check (char_length(target) <= 120),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One row per AI call (success or failure) — quota, monitoring and billing.
create table public.ai_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null check (status in ('success', 'failed')),
  scope           text not null default 'portfolio' check (scope in ('portfolio', 'trade')),
  trades_analyzed integer not null default 0,
  latency_ms      integer not null default 0,
  error_code      text,
  model           text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes (every RLS predicate and common sort is indexed)
-- ---------------------------------------------------------------------------
create index trades_user_date_idx       on public.trades (user_id, trade_date desc);
create index trades_user_pair_idx       on public.trades (user_id, currency_pair);
create index trades_user_strategy_idx   on public.trades (user_id, strategy);
create index trades_user_created_idx    on public.trades (user_id, created_at desc);
create index goals_user_idx             on public.trading_goals (user_id, created_at desc);
create index analyses_user_idx          on public.ai_analyses (user_id, created_at desc);
create index analyses_trade_idx         on public.ai_analyses (trade_id);
create index notifications_user_idx     on public.notifications (user_id, created_at desc);
create index notifications_unread_idx   on public.notifications (user_id) where not read;
create index ai_requests_user_idx       on public.ai_requests (user_id, created_at desc);
create index ai_requests_created_idx    on public.ai_requests (created_at desc);
create index audit_logs_created_idx     on public.audit_logs (created_at desc);
create index audit_logs_actor_idx       on public.audit_logs (actor_id);
create index profiles_role_status_idx   on public.profiles (role, status);
create index system_settings_by_idx     on public.system_settings (updated_by);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- Active account and not locked out by maintenance mode (admins always pass).
create or replace function public.can_use_app()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.status = 'active'
      and (p.role = 'admin' or not coalesce((select maintenance_mode from public.system_settings), false))
  );
$$;

create or replace function private.log_audit(p_actor uuid, p_action text, p_target text, p_metadata jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, target, metadata)
  values (p_actor, p_action, left(p_target, 120), coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.notify(p_user uuid, p_title text, p_message text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce((select notifications_enabled from public.user_settings where user_id = p_user), true) then
    insert into public.notifications (user_id, title, message) values (p_user, p_title, p_message);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at  before update on public.profiles       for each row execute function private.set_updated_at();
create trigger trades_updated_at    before update on public.trades         for each row execute function private.set_updated_at();
create trigger goals_updated_at     before update on public.trading_goals  for each row execute function private.set_updated_at();
create trigger settings_updated_at  before update on public.user_settings  for each row execute function private.set_updated_at();
create trigger system_updated_at    before update on public.system_settings for each row execute function private.set_updated_at();

-- New auth user -> profile (always role 'trader'), settings, welcome notice.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 80);
begin
  if not coalesce((select registration_open from public.system_settings), true) then
    raise exception 'Registrations are currently closed' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 2 then
    v_name := split_part(new.email, '@', 1);
  end if;
  -- Strip characters that have no place in a name (defence against stored XSS in web views)
  v_name := regexp_replace(v_name, '[<>]', '', 'g');

  insert into public.profiles (user_id, full_name, email, role)
  values (new.id, v_name, lower(new.email), 'trader');   -- client-supplied role is ignored
  insert into public.user_settings (user_id) values (new.id);
  insert into public.notifications (user_id, title, message)
  values (new.id, 'Welcome to AI Trading Journal', 'Record your first completed trade to start building your performance insights.');
  perform private.log_audit(new.id, 'auth.signup', new.id::text);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profile email in sync if it changes in auth.
create or replace function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Login audit + last activity (a new auth session == a successful sign-in).
create or replace function private.handle_new_session()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set last_active_at = now() where user_id = new.user_id;
  perform private.log_audit(new.user_id, 'auth.login', new.user_id::text);
  return new;
end;
$$;

create trigger on_auth_session_created
  after insert on auth.sessions
  for each row execute function private.handle_new_session();

-- Database-level write rate limit: at most 30 new trades per user per minute.
create or replace function private.enforce_trade_rate_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.trades
      where user_id = new.user_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited: too many trades created, please slow down' using errcode = 'P0001';
  end if;
  if new.trade_date > now() + interval '1 minute' then
    raise exception 'A completed trade cannot be dated in the future' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trades_rate_limit
  before insert on public.trades
  for each row execute function private.enforce_trade_rate_limit();

create or replace function private.enforce_future_date()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.trade_date > now() + interval '1 minute' then
    raise exception 'A completed trade cannot be dated in the future' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trades_future_date
  before update of trade_date on public.trades
  for each row execute function private.enforce_future_date();

-- Cap goals per user.
create or replace function private.enforce_goal_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.trading_goals where user_id = new.user_id) >= 50 then
    raise exception 'You can have at most 50 goals' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger goals_limit
  before insert on public.trading_goals
  for each row execute function private.enforce_goal_limit();

-- Notify when a trader reaches the AI analysis threshold.
create or replace function private.handle_trade_created()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
  v_min int := coalesce((select min_trades_for_ai from public.system_settings), 5);
begin
  select count(*) into v_count from public.trades where user_id = new.user_id;
  if v_count = v_min and coalesce((select ai_ready_alerts from public.user_settings where user_id = new.user_id), true) then
    perform private.notify(new.user_id, 'AI analysis unlocked',
      format('You have journaled %s trades — you can now request an AI performance analysis.', v_count));
  end if;
  return new;
end;
$$;

create trigger trades_after_insert
  after insert on public.trades
  for each row execute function private.handle_trade_created();

create or replace function private.audit_trade_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.log_audit(auth.uid(), 'trade.delete', old.id::text);
  return old;
end;
$$;

create trigger trades_audit_delete
  after delete on public.trades
  for each row execute function private.audit_trade_delete();

create or replace function private.audit_system_settings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  perform private.log_audit(auth.uid(), 'settings.update', 'system',
    (select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
       from jsonb_each(to_jsonb(new)) n
       join jsonb_each(to_jsonb(old)) o on o.key = n.key
      where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by')));
  return new;
end;
$$;

create trigger system_settings_audit
  before update on public.system_settings
  for each row execute function private.audit_system_settings();

-- ---------------------------------------------------------------------------
-- Privileges: least privilege, column-level UPDATE grants
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;

grant select on public.profiles to authenticated;
grant update (full_name, trading_experience, preferred_sessions, preferred_pairs, profile_image, last_active_at)
  on public.profiles to authenticated;

grant select, insert, delete on public.trades to authenticated;
grant update (currency_pair, direction, entry_price, exit_price, stop_loss, take_profit, position_size, risk_amount,
              reward_amount, risk_reward_ratio, profit_loss, trading_session, strategy, trade_result, emotional_state,
              entry_reason, notes, screenshot_url, trade_date)
  on public.trades to authenticated;

grant select, insert, delete on public.trading_goals to authenticated;
grant update (title, description, metric, target_value, current_value, start_date, end_date, status)
  on public.trading_goals to authenticated;

grant select, delete on public.ai_analyses to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

grant select on public.user_settings to authenticated;
grant update (notifications_enabled, goal_reminders, ai_ready_alerts, ai_include_notes, ai_include_emotions,
              ai_default_period, theme, biometric_lock, auto_logout_minutes)
  on public.user_settings to authenticated;

grant select on public.system_settings to authenticated;
grant update (ai_enabled, ai_daily_limit_per_user, min_trades_for_ai, registration_open, maintenance_mode, max_screenshot_mb)
  on public.system_settings to authenticated;

grant select on public.ai_requests to authenticated;
-- audit_logs: no direct access; read via admin functions only.

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_use_app() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_use_app() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.trades          enable row level security;
alter table public.trading_goals   enable row level security;
alter table public.ai_analyses     enable row level security;
alter table public.notifications   enable row level security;
alter table public.user_settings   enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.ai_requests     enable row level security;

-- profiles: read/update own row. (Admins use the admin_* functions instead of raw rows.)
create policy "profiles: read own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.can_use_app()))
  with check (user_id = (select auth.uid()));

-- trades: full CRUD on own rows while the account is usable. Admins get no row access.
create policy "trades: read own" on public.trades
  for select to authenticated using (user_id = (select auth.uid()) and (select public.can_use_app()));
create policy "trades: insert own" on public.trades
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.can_use_app()));
create policy "trades: update own" on public.trades
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.can_use_app()))
  with check (user_id = (select auth.uid()));
create policy "trades: delete own" on public.trades
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.can_use_app()));

-- goals
create policy "goals: read own" on public.trading_goals
  for select to authenticated using (user_id = (select auth.uid()) and (select public.can_use_app()));
create policy "goals: insert own" on public.trading_goals
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.can_use_app()));
create policy "goals: update own" on public.trading_goals
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.can_use_app()))
  with check (user_id = (select auth.uid()));
create policy "goals: delete own" on public.trading_goals
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.can_use_app()));

-- AI analyses: read/delete own. Inserted only by the Edge Function (service role).
create policy "analyses: read own" on public.ai_analyses
  for select to authenticated using (user_id = (select auth.uid()) and (select public.can_use_app()));
create policy "analyses: delete own" on public.ai_analyses
  for delete to authenticated using (user_id = (select auth.uid()) and (select public.can_use_app()));

-- notifications
create policy "notifications: read own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: mark own read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: delete own" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- user settings
create policy "settings: read own" on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "settings: update own" on public.user_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- system settings: everyone signed in can read limits; only admins can change them.
create policy "system: read" on public.system_settings
  for select to authenticated using (true);
create policy "system: admin update" on public.system_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ai_requests: users see their own usage (for quota display).
create policy "ai_requests: read own" on public.ai_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- audit_logs: RLS on with no policies = no direct access for any API role.

commit;
