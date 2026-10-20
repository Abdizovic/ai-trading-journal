-- =============================================================================
-- Admin + trader RPC functions.
--
-- All admin functions are SECURITY DEFINER, verify public.is_admin() first,
-- and return aggregates only — never trade prices, reasons, notes, emotions
-- or screenshots. JSON shapes match mobile/src/types/models.ts.
-- =============================================================================

begin;

create or replace function private.assert_admin()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Weekly buckets ending today: [{label:'Sep 24', value:n}] for the last p_weeks weeks.
create or replace function private.weekly_series(p_times timestamptz[], p_weeks int default 8)
returns jsonb language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', to_char(w.week_end, 'Mon FMDD'), 'value', w.n) order by w.week_end), '[]'::jsonb)
  from (
    select g.week_end,
           (select count(*) from unnest(p_times) t where t > g.week_end - interval '7 days' and t <= g.week_end) as n
    from generate_series(now() - make_interval(weeks => p_weeks - 1), now(), interval '7 days') as g(week_end)
  ) w;
$$;

-- ---------------------------------------------------------------------------
-- Trader: AI quota
-- ---------------------------------------------------------------------------
create or replace function public.ai_quota()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'used_today', (select count(*) from public.ai_requests where user_id = auth.uid() and created_at > now() - interval '1 day'),
    'daily_limit', s.ai_daily_limit_per_user,
    'min_trades', s.min_trades_for_ai,
    'ai_enabled', s.ai_enabled
  )
  from public.system_settings s;
$$;

-- ---------------------------------------------------------------------------
-- Admin: overview
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_admin();
  select jsonb_build_object(
    'total_traders',       count(*),
    'active_traders',      count(*) filter (where status = 'active'),
    'deactivated_traders', count(*) filter (where status = 'deactivated'),
    'new_users_7d',        count(*) filter (where created_at > now() - interval '7 days'),
    'daily_active',        count(*) filter (where last_active_at > now() - interval '1 day'),
    'weekly_active',       count(*) filter (where last_active_at > now() - interval '7 days'),
    'monthly_active',      count(*) filter (where last_active_at > now() - interval '30 days')
  ) into v
  from public.profiles where role = 'trader';

  return v || jsonb_build_object(
    'total_trades',      (select count(*) from public.trades),
    'total_ai_analyses', (select count(*) from public.ai_requests where status = 'success'),
    'user_growth', (
      select coalesce(jsonb_agg(jsonb_build_object('label', to_char(m, 'Mon'), 'value',
               (select count(*) from public.profiles p where p.role = 'trader' and p.created_at < m + interval '1 month')) order by m), '[]'::jsonb)
      from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
    ),
    'trade_activity',   private.weekly_series((select coalesce(array_agg(trade_date), '{}') from public.trades)),
    'ai_usage',         private.weekly_series((select coalesce(array_agg(created_at), '{}') from public.ai_requests)),
    'journal_activity', (
      select coalesce(jsonb_agg(jsonb_build_object('label', to_char(g, 'Mon FMDD'), 'value',
               (select count(distinct t.user_id) from public.trades t where t.created_at > g - interval '7 days' and t.created_at <= g)) order by g), '[]'::jsonb)
      from generate_series(now() - interval '7 weeks', now(), interval '7 days') g
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: user management
-- ---------------------------------------------------------------------------
create or replace function public.admin_traders(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  q text := nullif(lower(btrim(left(coalesce(p_search, ''), 60))), '');
begin
  perform private.assert_admin();
  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc)
    from (
      select p.id, p.user_id, p.full_name, p.email, p.role, p.status, p.created_at, p.last_active_at,
             (select count(*) from public.trades t where t.user_id = p.user_id) as trade_count,
             (select count(*) from public.ai_requests a where a.user_id = p.user_id) as ai_count
      from public.profiles p
      where q is null or lower(p.full_name) like '%' || q || '%' or p.email like '%' || q || '%'
      limit 500
    ) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_trader(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_admin();
  select jsonb_build_object(
    'id', p.id, 'user_id', p.user_id, 'full_name', p.full_name, 'email', p.email, 'role', p.role, 'status', p.status,
    'created_at', p.created_at, 'last_active_at', p.last_active_at,
    'trade_count', (select count(*) from public.trades t where t.user_id = p.user_id),
    'ai_count', (select count(*) from public.ai_requests a where a.user_id = p.user_id),
    'win_rate', coalesce((select 100.0 * count(*) filter (where trade_result = 'win') / nullif(count(*), 0) from public.trades t where t.user_id = p.user_id), 0),
    'net_pnl', coalesce((select sum(profit_loss) from public.trades t where t.user_id = p.user_id), 0),
    'last_trade_at', (select max(trade_date) from public.trades t where t.user_id = p.user_id)
  ) into v
  from public.profiles p where p.user_id = p_user;
  if v is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Activate / deactivate a trader. Deactivation bans the auth user (blocks
-- sign-in and token refresh) and revokes every existing session immediately.
create or replace function public.admin_set_user_status(p_user uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_role text;
begin
  perform private.assert_admin();
  if p_status not in ('active', 'deactivated') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select role into v_role from public.profiles where user_id = p_user;
  if v_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_role = 'admin' or p_user = auth.uid() then
    raise exception 'forbidden: administrator accounts cannot be changed here' using errcode = '42501';
  end if;

  update public.profiles set status = p_status where user_id = p_user;
  update auth.users set banned_until = case when p_status = 'deactivated' then 'infinity'::timestamptz else null end
   where id = p_user;
  if p_status = 'deactivated' then
    delete from auth.sessions where user_id = p_user;  -- cascades to refresh tokens
  end if;
  perform private.log_audit(auth.uid(), case when p_status = 'deactivated' then 'user.deactivate' else 'user.activate' end, p_user::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: platform trading statistics (aggregates only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_trading_stats()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return (
    select jsonb_build_object(
      'total_trades', count(*),
      'winning_trades', count(*) filter (where trade_result = 'win'),
      'losing_trades', count(*) filter (where trade_result = 'loss'),
      'breakeven_trades', count(*) filter (where trade_result = 'breakeven'),
      'platform_win_rate', coalesce(100.0 * count(*) filter (where trade_result = 'win') / nullif(count(*), 0), 0),
      'popular_pairs', (select coalesce(jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc), '[]') from
                         (select currency_pair k, count(*) n from public.trades group by 1 order by 2 desc limit 6) x),
      'popular_strategies', (select coalesce(jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc), '[]') from
                         (select strategy k, count(*) n from public.trades group by 1 order by 2 desc limit 6) x),
      'sessions', (select coalesce(jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc), '[]') from
                         (select trading_session k, count(*) n from public.trades group by 1) x),
      'activity_by_month', (select coalesce(jsonb_agg(jsonb_build_object('label', to_char(m, 'Mon'), 'value',
                              (select count(*) from public.trades t where date_trunc('month', t.trade_date) = m)) order by m), '[]')
                            from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m),
      'activity_by_weekday', (select jsonb_agg(jsonb_build_object('label', d.label, 'value',
                              (select count(*) from public.trades t where extract(isodow from t.trade_date) = d.n)) order by d.n)
                            from (values (1, 'Mon'), (2, 'Tue'), (3, 'Wed'), (4, 'Thu'), (5, 'Fri')) d(n, label))
    )
    from public.trades
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: AI monitoring
-- ---------------------------------------------------------------------------
create or replace function public.admin_ai_stats()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_err numeric;
  v_lat numeric;
  v_enabled boolean := (select ai_enabled from public.system_settings);
begin
  perform private.assert_admin();
  select coalesce(avg((status = 'failed')::int), 0), coalesce(avg(latency_ms) filter (where status = 'success'), 0)
    into v_err, v_lat
    from public.ai_requests where created_at > now() - interval '7 days';

  return jsonb_build_object(
    'total', (select count(*) from public.ai_requests),
    'today', (select count(*) from public.ai_requests where created_at > now() - interval '1 day'),
    'week',  (select count(*) from public.ai_requests where created_at > now() - interval '7 days'),
    'month', (select count(*) from public.ai_requests where created_at > now() - interval '30 days'),
    'per_day', (select jsonb_agg(jsonb_build_object('label', to_char(d, 'Mon FMDD'), 'value',
                  (select count(*) from public.ai_requests a where a.created_at::date = d::date)) order by d)
                from generate_series(current_date - 13, current_date, interval '1 day') d),
    'by_trader', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'full_name', x.full_name, 'count', x.n) order by x.n desc), '[]')
                  from (select a.user_id, p.full_name, count(*) n from public.ai_requests a
                        join public.profiles p on p.user_id = a.user_id group by 1, 2 order by 3 desc limit 8) x),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'created_at', x.created_at,
                  'trades_analyzed', x.trades_analyzed, 'scope', x.scope, 'status', x.status) order by x.created_at desc), '[]')
               from (select a.id, p.full_name, a.created_at, a.trades_analyzed, a.scope, a.status from public.ai_requests a
                     join public.profiles p on p.user_id = a.user_id order by a.created_at desc limit 10) x),
    'service_status', jsonb_build_object(
      'status', case when not v_enabled then 'down' when v_err > 0.2 then 'degraded' else 'operational' end,
      'latency_ms', round(v_lat),
      'model', coalesce((select model from public.ai_requests where model is not null order by created_at desc limit 1), 'gemini'),
      'error_rate', round(v_err * 100, 1)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: reports and audit log
-- ---------------------------------------------------------------------------
create or replace function private.mask_email(p_email text)
returns text language sql immutable set search_path = ''
as $$
  select left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2);
$$;

create or replace function public.admin_report(p_type text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  perform private.assert_admin();
  perform private.log_audit(auth.uid(), 'report.generate', p_type);

  if p_type = 'registrations' then
    return jsonb_build_object(
      'type', p_type, 'title', 'User Registration Report', 'generated_at', v_now,
      'columns', jsonb_build_array('Name', 'Email', 'Registered', 'Status', 'Trades'),
      'rows', (select coalesce(jsonb_agg(jsonb_build_array(p.full_name, private.mask_email(p.email), to_char(p.created_at, 'YYYY-MM-DD'), p.status,
                 (select count(*) from public.trades t where t.user_id = p.user_id)) order by p.created_at desc), '[]')
               from public.profiles p where p.role = 'trader'),
      'summary', jsonb_build_array(
        jsonb_build_object('label', 'Total traders', 'value', (select count(*) from public.profiles where role = 'trader')::text),
        jsonb_build_object('label', 'Joined last 30 days', 'value', (select count(*) from public.profiles where role = 'trader' and created_at > v_now - interval '30 days')::text),
        jsonb_build_object('label', 'Deactivated', 'value', (select count(*) from public.profiles where role = 'trader' and status = 'deactivated')::text)));
  elsif p_type = 'trading' then
    return jsonb_build_object(
      'type', p_type, 'title', 'Trading Activity Report', 'generated_at', v_now,
      'columns', jsonb_build_array('Month', 'Trades', 'Wins', 'Losses', 'Win rate', 'Active traders'),
      'rows', (select jsonb_agg(jsonb_build_array(to_char(m, 'Mon YY'), x.n, x.w, x.l,
                 case when x.n > 0 then round(100.0 * x.w / x.n, 1)::text || '%' else '—' end, x.u) order by m)
               from generate_series(date_trunc('month', v_now) - interval '5 months', date_trunc('month', v_now), interval '1 month') m
               cross join lateral (select count(*) n, count(*) filter (where trade_result = 'win') w,
                                          count(*) filter (where trade_result = 'loss') l, count(distinct user_id) u
                                   from public.trades t where date_trunc('month', t.trade_date) = m) x),
      'summary', jsonb_build_array(
        jsonb_build_object('label', 'Total trades', 'value', (select count(*) from public.trades)::text),
        jsonb_build_object('label', 'Traders journaling', 'value', (select count(distinct user_id) from public.trades)::text)));
  elsif p_type = 'ai_usage' then
    return jsonb_build_object(
      'type', p_type, 'title', 'AI Usage Report', 'generated_at', v_now,
      'columns', jsonb_build_array('Date', 'Requests', 'Succeeded', 'Failed', 'Unique traders'),
      'rows', (select jsonb_agg(jsonb_build_array(to_char(d, 'YYYY-MM-DD'), x.n, x.s, x.f, x.u) order by d)
               from generate_series(current_date - 13, current_date, interval '1 day') d
               cross join lateral (select count(*) n, count(*) filter (where status = 'success') s,
                                          count(*) filter (where status = 'failed') f, count(distinct user_id) u
                                   from public.ai_requests a where a.created_at::date = d::date) x),
      'summary', jsonb_build_array(
        jsonb_build_object('label', 'All-time requests', 'value', (select count(*) from public.ai_requests)::text),
        jsonb_build_object('label', 'Daily limit / user', 'value', (select ai_daily_limit_per_user from public.system_settings)::text)));
  elsif p_type = 'system' then
    return jsonb_build_object(
      'type', p_type, 'title', 'System Activity Report', 'generated_at', v_now,
      'columns', jsonb_build_array('Time', 'Actor', 'Action', 'Target'),
      'rows', (select coalesce(jsonb_agg(jsonb_build_array(to_char(l.created_at, 'YYYY-MM-DD HH24:MI'), coalesce(p.full_name, 'System'), l.action, coalesce(l.target, ''))
                 order by l.created_at desc), '[]')
               from (select * from public.audit_logs order by created_at desc limit 200) l
               left join public.profiles p on p.user_id = l.actor_id),
      'summary', jsonb_build_array(
        jsonb_build_object('label', 'Events logged', 'value', (select count(*) from public.audit_logs)::text),
        jsonb_build_object('label', 'Maintenance mode', 'value', case when (select maintenance_mode from public.system_settings) then 'On' else 'Off' end)));
  end if;
  raise exception 'invalid report type' using errcode = '22023';
end;
$$;

create or replace function public.admin_audit_logs(p_limit int default 50)
returns setof public.audit_logs language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query select * from public.audit_logs order by created_at desc limit least(greatest(p_limit, 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: signed-in users only (functions self-check admin role)
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'ai_quota()', 'admin_overview()', 'admin_traders(text)', 'admin_trader(uuid)', 'admin_set_user_status(uuid, text)',
    'admin_trading_stats()', 'admin_ai_stats()', 'admin_report(text)', 'admin_audit_logs(int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
