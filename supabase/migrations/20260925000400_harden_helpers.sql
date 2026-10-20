-- =============================================================================
-- Hardening (Supabase security advisor):
--   * is_admin() / can_use_app() move to the non-exposed `private` schema so
--     they cannot be called through /rest/v1/rpc. RLS policies reference them
--     by OID, so existing policies keep working unchanged.
--   * ai_quota() becomes SECURITY INVOKER (it only reads rows RLS already allows).
--   * admin_* RPCs intentionally remain SECURITY DEFINER + callable by
--     `authenticated`: each one calls private.assert_admin() first and returns
--     only aggregates. This is the accepted design (verified by tests).
-- =============================================================================

begin;

alter function public.is_admin() set schema private;
alter function public.can_use_app() set schema private;

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;      -- needed while evaluating RLS policies
grant execute on function private.can_use_app() to authenticated;

create or replace function private.assert_admin()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function private.assert_admin() from public, anon, authenticated;

alter function public.ai_quota() security invoker;

commit;
