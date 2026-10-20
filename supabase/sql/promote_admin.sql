-- Make an existing (already registered) account an administrator.
-- Run in the Supabase SQL editor. This is deliberately impossible from the app.
update public.profiles
   set role = 'admin'
 where email = lower('replace-with-the-admin-email@example.com');

select email, role, status from public.profiles where role = 'admin';
