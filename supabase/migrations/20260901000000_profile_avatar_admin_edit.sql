-- Profile pictures, admin profile edits, and a per-user store list.
--
-- Three gaps in one trip because they share one table: the account page and
-- the user page both need avatar_url, an administrator fixing a typo in
-- someone's name needs a write path that is not the service role, and the
-- user page needs to list which stores a person reaches.

alter table public.profiles add column if not exists avatar_url text not null default '';

-- Column grants accumulate, so this widens the earlier display_name-only
-- grant. role, active and email stay ungranted: changing those still goes
-- through the admin-users Edge Function under the service role.
grant update (display_name, avatar_url) on public.profiles to authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users update their own profile, admins any profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- The bucket is public-read (an avatar is shown wherever the person appears)
-- but write-restricted to the owner's own folder. Size and MIME limits live
-- on the bucket row, not in JavaScript, so they hold even if a request
-- bypasses the app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are keyed avatars/<user-id>/<uuid>.<ext>, so the first folder is
-- the owner and the write policies are self-service by construction.
drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload avatars to their own folder" on storage.objects;
create policy "Users can upload avatars to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can replace their own avatar" on storage.objects;
create policy "Users can replace their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- The user page lists a person's store memberships. Reading your own list was
-- already possible through my_store_network(); this opens the same view for
-- one explicit caller — the system administrator reviewing an account — and
-- to nobody else.
create or replace function public.user_store_network(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_id', s.id,
        'store_code', s.store_code,
        'store_name', s.name,
        'role_name', r.name,
        'is_owner', m.is_owner
      ) order by s.name)
      from public.store_memberships m
      join public.stores s on s.id = m.store_id
      join public.store_roles r on r.id = m.role_id
      where m.user_id = p_user_id and m.active
        and ((select auth.uid()) = p_user_id or public.is_system_admin())
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.user_store_network(uuid) to authenticated;
