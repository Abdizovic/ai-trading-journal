-- =============================================================================
-- Storage buckets and policies.
--   trade-screenshots : PRIVATE. Path = <user_id>/<uuid>.<ext>. Only the owner
--                       can read (via short-lived signed URLs) or write.
--                       Administrators have no access.
--   avatars           : public-read profile photos. Path = <user_id>/<file>.
--                       Only the owner can upload/replace/delete.
-- Size and MIME limits are enforced by the bucket itself.
-- =============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('trade-screenshots', 'trade-screenshots', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- trade-screenshots
create policy "screenshots: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "screenshots: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.can_use_app()));
create policy "screenshots: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "screenshots: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trade-screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- avatars (reads are public through the bucket's public URL)
create policy "avatars: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
