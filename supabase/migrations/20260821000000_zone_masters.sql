-- The levels around a zone become records instead of typed strings.
--
-- `city`, `scope` and `municipality` were free text on every zone. 407 seeded
-- rows agreed with each other because a script wrote them; the first hand-typed
-- row would not. A city typed with a trailing space is a new branch in the tree
-- and a new option in every filter, silently.
--
-- So the three levels become masters and the zone links to them:
--
--   cities        المدينة الكبرى   — 28 rows, the parent of everything
--   zone_scopes   النطاق الجغرافي  — operational grouping, always under a city
--   municipalities البلدية         — already existed with 140 rows and nothing
--                                    pointed at it; now it is linked
--
-- Shared, not per store. Two stores slicing Tripoli differently is a real
-- future need, but a store-scoped scope cannot be pointed at by a shared zone,
-- and today every zone is shared. Adding `store_key` later is an additive
-- change; guessing at it now would build the harder half of a feature nobody
-- has asked for yet.
--
-- `region` is deliberately NOT promoted: three values that never change are an
-- enum, and a table holding three rows forever is a join for nothing.
--
-- The text columns stay, kept in step by a trigger. The tree, the filters, the
-- export and `store_zones` all read flat fields; a trigger-maintained copy means
-- none of them change. One trigger against rewriting every read path.

-- --------------------------------------------------------------- the masters

create table if not exists public.cities (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  region text not null default 'tripolitania'
    check (region in ('tripolitania', 'cyrenaica', 'fezzan')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Normalised, so «طرابلس» cannot be entered twice in two spellings.
create unique index if not exists cities_name_idx
  on public.cities (public.ar_normalize(name));

create table if not exists public.zone_scopes (
  id text primary key default gen_random_uuid()::text,
  city_id text not null references public.cities(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- A scope only means something under its city: «غرب طرابلس» is not a name that
-- travels. So the pair is unique, not the name alone.
create unique index if not exists zone_scopes_city_name_idx
  on public.zone_scopes (city_id, public.ar_normalize(name));

create index if not exists zone_scopes_city_idx on public.zone_scopes (city_id);

-- ------------------------------------------------------------------ the links
--
-- ON DELETE SET NULL throughout: removing a city must not take the zones with
-- it. The zone keeps its text name and simply stops being linked, which is
-- visible and fixable — unlike a cascade, which is neither.
alter table public.delivery_zones
  add column if not exists city_id text references public.cities(id) on delete set null;
alter table public.delivery_zones
  add column if not exists scope_id text references public.zone_scopes(id) on delete set null;
alter table public.delivery_zones
  add column if not exists municipality_id text references public.municipalities(id) on delete set null;

create index if not exists delivery_zones_city_id_idx on public.delivery_zones (city_id);
create index if not exists delivery_zones_scope_id_idx on public.delivery_zones (scope_id);

-- ------------------------------------------------------------------ backfill
--
-- Exact, not fuzzy: the 407 seeded rows carry clean names straight from the
-- build script, so every link resolves by name with nothing guessed.
alter table public.delivery_zones disable trigger enforce_delivery_zones_permissions;
alter table public.delivery_zones disable trigger audit_delivery_zones;

-- Two rows were added by hand before the hierarchy existed and carry a capital
-- but no city. The capital is the city under the new meaning of a zone, so it
-- is promoted rather than dropped on the floor.
update public.delivery_zones
set city = capital
where coalesce(city, '') = '' and coalesce(capital, '') <> '';

insert into public.cities (name, region)
select distinct on (public.ar_normalize(z.city)) z.city, z.region
from public.delivery_zones z
where coalesce(z.city, '') <> ''
order by public.ar_normalize(z.city), z.region
on conflict do nothing;

insert into public.zone_scopes (city_id, name)
select distinct on (c.id, public.ar_normalize(z.scope)) c.id, z.scope
from public.delivery_zones z
join public.cities c on public.ar_normalize(c.name) = public.ar_normalize(z.city)
where coalesce(z.scope, '') <> ''
order by c.id, public.ar_normalize(z.scope)
on conflict do nothing;

update public.delivery_zones z
set city_id = c.id
from public.cities c
where public.ar_normalize(c.name) = public.ar_normalize(z.city) and z.city_id is null;

update public.delivery_zones z
set scope_id = s.id
from public.zone_scopes s
where s.city_id = z.city_id
  and public.ar_normalize(s.name) = public.ar_normalize(z.scope)
  and z.scope_id is null;

update public.delivery_zones z
set municipality_id = m.id
from public.municipalities m
where public.ar_normalize(m.name) = public.ar_normalize(z.municipality)
  and z.municipality_id is null;

-- `capital` said which city a shabiyah was run from. A zone is a neighbourhood
-- now, so it repeated `city` on all 407 rows. Dropped rather than promoted.
alter table public.delivery_zones drop column if exists capital;

alter table public.delivery_zones enable trigger enforce_delivery_zones_permissions;
alter table public.delivery_zones enable trigger audit_delivery_zones;

-- ------------------------------------------------------- keeping the two agree
--
-- The link is the truth and the text is a copy of it, refreshed on every write
-- and whenever a master is renamed. Writes that set only the text — a
-- spreadsheet import quoting names — are left alone, so both routes work.
create or replace function public.sync_zone_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.city_id is not null then
    select c.name into new.city from public.cities c where c.id = new.city_id;
  end if;
  if new.scope_id is not null then
    select s.name into new.scope from public.zone_scopes s where s.id = new.scope_id;
  end if;
  if new.municipality_id is not null then
    select m.name into new.municipality from public.municipalities m where m.id = new.municipality_id;
  end if;
  return new;
end;
$$;

drop trigger if exists zone_hierarchy_sync on public.delivery_zones;
create trigger zone_hierarchy_sync
  before insert or update on public.delivery_zones
  for each row execute function public.sync_zone_hierarchy();

/** Renaming a city or a scope rewrites the copies the zones carry. */
create or replace function public.rename_zone_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'cities' then
    update public.delivery_zones set city = new.name where city_id = new.id and city is distinct from new.name;
  elsif tg_table_name = 'zone_scopes' then
    update public.delivery_zones set scope = new.name where scope_id = new.id and scope is distinct from new.name;
  else
    update public.delivery_zones set municipality = new.name where municipality_id = new.id and municipality is distinct from new.name;
  end if;
  return new;
end;
$$;

drop trigger if exists cities_rename on public.cities;
create trigger cities_rename after update of name on public.cities
  for each row execute function public.rename_zone_hierarchy();

drop trigger if exists zone_scopes_rename on public.zone_scopes;
create trigger zone_scopes_rename after update of name on public.zone_scopes
  for each row execute function public.rename_zone_hierarchy();

drop trigger if exists municipalities_rename on public.municipalities;
create trigger municipalities_rename after update of name on public.municipalities
  for each row execute function public.rename_zone_hierarchy();

-- ------------------------------------------------------------------- access
--
-- Anyone active reads them, and may add one: a spreadsheet import naming a city
-- that does not exist yet has to be able to create it, or a Link field turns
-- into a wall. Renaming and deleting stay with administrators, because those
-- rewrite what every store sees.
do $$
declare
  t text;
begin
  foreach t in array array['cities', 'zone_scopes'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Active users can read %1$s" on public.%1$I', t);
    execute format(
      'create policy "Active users can read %1$s" on public.%1$I for select to authenticated
         using ((select public.is_active_user()))', t);

    execute format('drop policy if exists "Active users can add %1$s" on public.%1$I', t);
    execute format(
      'create policy "Active users can add %1$s" on public.%1$I for insert to authenticated
         with check ((select public.is_active_user()))', t);

    execute format('drop policy if exists "Admins can change %1$s" on public.%1$I', t);
    execute format(
      'create policy "Admins can change %1$s" on public.%1$I for update to authenticated
         using ((select public.is_admin())) with check ((select public.is_admin()))', t);

    execute format('drop policy if exists "Admins can remove %1$s" on public.%1$I', t);
    execute format(
      'create policy "Admins can remove %1$s" on public.%1$I for delete to authenticated
         using ((select public.is_admin()))', t);

    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('alter table public.%I replica identity full', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function public.audit_trigger()', t);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- doctypes
--
-- Registered like every other table, which is what earns them per-role
-- permissions, audit rows and a naming series rather than being three ad-hoc
-- foreign keys.
insert into public.doctype_definitions (name, label, module, is_system, is_active)
values
  ('cities', 'المدن', 'Commerce', true, true),
  ('zone_scopes', 'النطاقات الجغرافية', 'Commerce', true, true),
  ('municipalities', 'البلديات', 'Commerce', true, true)
on conflict (name) do nothing;

-- `Link` is new to the builder's vocabulary. `options` names the doctype the
-- field points at, the same convention Frappe uses.
insert into public.doctype_fields (doctype, fieldname, label, fieldtype, options, perm_level, position)
values
  ('delivery_zones', 'city_id', 'المدينة الكبرى', 'Link', 'cities', 0, 10),
  ('delivery_zones', 'scope_id', 'النطاق الجغرافي', 'Link', 'zone_scopes', 0, 11),
  ('delivery_zones', 'municipality_id', 'البلدية', 'Link', 'municipalities', 0, 12),
  ('zone_scopes', 'city_id', 'المدينة الكبرى', 'Link', 'cities', 0, 1)
on conflict do nothing;

-- ------------------------------------------------- copy-on-write, without capital
--
-- 20260819000000 rebuilt this to stop a store copy losing the hierarchy. Its
-- column list names `capital`, which no longer exists, so the function is
-- rebuilt here on the same intent: the copy carries the links as well as the
-- text, and the sync trigger keeps them agreeing afterwards.
create or replace function public.zone_for_store(p_zone_id text, p_store_id text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_zone public.delivery_zones;
  v_existing text;
  v_new_id text;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if coalesce(p_store_id, '') = '' then
    raise exception 'NO_STORE';
  end if;

  select * into v_zone from public.delivery_zones where id = p_zone_id;
  if not found then
    raise exception 'NO_SUCH_ZONE';
  end if;

  if v_zone.store_id is not null then
    if v_zone.store_id <> p_store_id then
      raise exception 'OTHER_STORE_ZONE';
    end if;
    return v_zone.id;
  end if;

  select id into v_existing from public.delivery_zones
  where store_id = p_store_id and source_id = v_zone.id;
  if found then
    return v_existing;
  end if;

  v_new_id := gen_random_uuid()::text;
  insert into public.delivery_zones (
    id, code, name, region, area_km2, fee, delivery_time_days, active,
    commission_type, commission_value, city, scope, municipality,
    city_id, scope_id, municipality_id, alt_name,
    lat, lon, needs_translation, source, store_id, source_id
  )
  values (
    v_new_id, v_zone.code, v_zone.name, v_zone.region, v_zone.area_km2,
    v_zone.fee, v_zone.delivery_time_days, v_zone.active, v_zone.commission_type,
    v_zone.commission_value, v_zone.city, v_zone.scope, v_zone.municipality,
    v_zone.city_id, v_zone.scope_id, v_zone.municipality_id,
    v_zone.alt_name, v_zone.lat, v_zone.lon, v_zone.needs_translation, v_zone.source,
    p_store_id, v_zone.id
  );

  return v_new_id;
end;
$$;

grant execute on function public.zone_for_store(text, text) to authenticated;
