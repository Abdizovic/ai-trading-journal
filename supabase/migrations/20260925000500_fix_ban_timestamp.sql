-- Supabase Auth (GoTrue) cannot load a user whose banned_until is 'infinity'
-- ("Database error loading user"), which broke sign-in checks, admin deletes
-- and email lookups for deactivated users. Use a far-future timestamp instead.

begin;

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
  update auth.users
     set banned_until = case when p_status = 'deactivated' then '2999-12-31 00:00:00+00'::timestamptz else null end
   where id = p_user;
  if p_status = 'deactivated' then
    delete from auth.sessions where user_id = p_user;  -- cascades to refresh tokens
  end if;
  perform private.log_audit(auth.uid(), case when p_status = 'deactivated' then 'user.deactivate' else 'user.activate' end, p_user::text);
end;
$$;

revoke execute on function public.admin_set_user_status(uuid, text) from public, anon;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;

update auth.users set banned_until = '2999-12-31 00:00:00+00' where banned_until = 'infinity';

commit;
