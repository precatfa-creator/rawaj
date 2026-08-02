-- Categories get a table so the picker can offer what already exists instead of
-- every operator inventing their own spelling.
--
-- products.category stays a text column and keeps holding the category *name*,
-- not a foreign key. That is deliberate: order_lines selects p.category and
-- stats_by_dimension groups on it for the reports, so turning it into an id
-- would mean rewriting the view, the dimension function and every panel that
-- reads them — to buy referential integrity nobody asked for on a field whose
-- whole job is to be a label.

create table if not exists public.categories (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- Case- and spelling-insensitive: "ملابس" and " ملابس " must not coexist, and
-- neither must two Arabic spellings that normalise to the same thing.
create unique index if not exists categories_name_idx
  on public.categories (public.ar_normalize(name));

alter table public.categories enable row level security;

drop policy if exists "Active users can access categories" on public.categories;
create policy "Active users can access categories"
  on public.categories for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

revoke all on public.categories from anon;
grant select, insert, update, delete on public.categories to authenticated;

alter table public.categories replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table public.categories;
  end if;
end;
$$;

drop trigger if exists audit_categories on public.categories;
create trigger audit_categories
  after insert or update or delete on public.categories
  for each row execute function public.audit_trigger();

-- Seed from what items already use, so the picker is not empty on day one and
-- existing spellings stay selectable.
insert into public.categories (id, name)
select gen_random_uuid()::text, name
from (
  select distinct on (public.ar_normalize(btrim(category))) btrim(category) as name
  from public.products
  where btrim(coalesce(category, '')) <> ''
  order by public.ar_normalize(btrim(category)), btrim(category)
) existing
on conflict do nothing;
