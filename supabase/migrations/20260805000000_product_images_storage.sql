-- Storage for product images.
--
-- The bucket is public-read (catalog images are shown to anyone the operator
-- shares a storefront with) but write-restricted to active users. The size and
-- MIME limits live on the bucket row, not in JavaScript, so they hold even if a
-- request bypasses the app.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- `create policy` has no IF NOT EXISTS, and storage.objects already carries
-- policies, so each one is dropped by name first to keep this re-runnable.
drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "Active users can upload product images" on storage.objects;
create policy "Active users can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_active_user()));

drop policy if exists "Active users can replace product images" on storage.objects;
create policy "Active users can replace product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_active_user()))
  with check (bucket_id = 'product-images' and (select public.is_active_user()));

drop policy if exists "Active users can delete product images" on storage.objects;
create policy "Active users can delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_active_user()));
