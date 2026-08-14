-- Records belong to a store.
--
-- Products, orders and stock movements always did. Customers, sales reps and
-- categories did not: one list served every store, so opening a second store
-- showed the first one's customers. This gives each of them a `store_id` and
-- backfills what already exists from the orders that reference it.
--
-- Delivery zones are the deliberate exception, handled at the bottom: the 22
-- Libyan zones are a shared default catalogue, and a store that changes one
-- gets its own copy rather than editing everybody's.
--
-- What this migration does NOT do: change who can see what. Every active user
-- still sees every store, exactly as before. Per-user store membership is a
-- later step, and quietly enforcing it here would lock people out of stores
-- they are working in today.

-- ------------------------------------------------------------- customers

alter table public.customers
  add column if not exists store_id text references public.stores(id) on delete cascade;

do $$
declare
  v_orphans bigint;
begin
  -- A customer who ordered from two stores becomes two customers, one per
  -- store, and each store's orders follow their own copy. Merging them into one
  -- store instead would hand one store's orders to the other's customer list.
  create temp table customer_store_pairs on commit drop as
  select distinct o.customer_id, o.store_id from public.orders o;

  create temp table customer_copies on commit drop as
  select p.customer_id as original_id,
         p.store_id,
         gen_random_uuid()::text as new_id
  from (
    select customer_id, store_id,
           row_number() over (partition by customer_id order by store_id) as rn
    from customer_store_pairs
  ) p
  where p.rn > 1;

  -- The first store keeps the original row.
  update public.customers c
  set store_id = first_store.store_id
  from (
    select customer_id, store_id from (
      select customer_id, store_id,
             row_number() over (partition by customer_id order by store_id) as rn
      from customer_store_pairs
    ) ranked where rn = 1
  ) first_store
  where c.id = first_store.customer_id and c.store_id is null;

  insert into public.customers (
    id, name, phone, whatsapp, city, address, order_count, total_spent,
    last_purchase, rating, status, store_id
  )
  select cc.new_id, c.name, c.phone, c.whatsapp, c.city, c.address,
         0, 0, null, c.rating, c.status, cc.store_id
  from customer_copies cc
  join public.customers c on c.id = cc.original_id;

  update public.orders o
  set customer_id = cc.new_id
  from customer_copies cc
  where o.customer_id = cc.original_id and o.store_id = cc.store_id;

  -- A customer with no orders has nothing to infer a store from. They go to the
  -- oldest store rather than being deleted or left invisible.
  update public.customers
  set store_id = (select id from public.stores order by id limit 1)
  where store_id is null;

  select count(*) into v_orphans
  from public.orders o
  where not exists (select 1 from public.customers c where c.id = o.customer_id);
  if v_orphans > 0 then
    raise exception 'ORPHANED_ORDERS:%', v_orphans;
  end if;

  if not exists (select 1 from public.customers where store_id is null) then
    alter table public.customers alter column store_id set not null;
  end if;
end;
$$;

create index if not exists customers_store_idx on public.customers (store_id);

-- --------------------------------------------------------- sales reps

alter table public.sales_reps
  add column if not exists store_id text references public.stores(id) on delete cascade;

do $$
begin
  -- Same rule as customers: a rep who carried orders for two stores becomes two
  -- reps, and each store's orders keep pointing at their own.
  create temp table rep_store_pairs on commit drop as
  select distinct o.agent_id as rep_id, o.store_id
  from public.orders o where o.agent_id is not null;

  create temp table rep_copies on commit drop as
  select p.rep_id as original_id, p.store_id, gen_random_uuid()::text as new_id
  from (
    select rep_id, store_id, row_number() over (partition by rep_id order by store_id) as rn
    from rep_store_pairs
  ) p
  where p.rn > 1;

  update public.sales_reps r
  set store_id = first_store.store_id
  from (
    select rep_id, store_id from (
      select rep_id, store_id, row_number() over (partition by rep_id order by store_id) as rn
      from rep_store_pairs
    ) ranked where rn = 1
  ) first_store
  where r.id = first_store.rep_id and r.store_id is null;

  insert into public.sales_reps (id, name, phone, whatsapp, zones, commission, active, note, store_id)
  select rc.new_id, r.name, r.phone, r.whatsapp, r.zones, r.commission, r.active, r.note, rc.store_id
  from rep_copies rc
  join public.sales_reps r on r.id = rc.original_id;

  update public.orders o
  set agent_id = rc.new_id
  from rep_copies rc
  where o.agent_id = rc.original_id and o.store_id = rc.store_id;

  update public.sales_reps
  set store_id = (select id from public.stores order by id limit 1)
  where store_id is null;

  if not exists (select 1 from public.sales_reps where store_id is null) then
    alter table public.sales_reps alter column store_id set not null;
  end if;
end;
$$;

create index if not exists sales_reps_store_idx on public.sales_reps (store_id);

-- ---------------------------------------------------------- categories

alter table public.categories
  add column if not exists store_id text references public.stores(id) on delete cascade;

-- Dropped before the copies are inserted, not after: it forbids one name twice
-- in the whole table, which is exactly what handing a name to two stores does.
drop index if exists public.categories_name_idx;

-- The vocabulary is per store now, so each existing category is handed to every
-- store: the items already filed under it live in one store or another, and a
-- category that vanished from a store's picker would read as data loss.
insert into public.categories (id, name, store_id)
select gen_random_uuid()::text, c.name, s.id
from public.categories c
cross join public.stores s
where c.store_id is null
  and not exists (
    select 1 from public.categories existing
    where existing.store_id = s.id
      and public.ar_normalize(existing.name) = public.ar_normalize(c.name)
  );

-- Guarded: with no stores yet there is nothing to hand them to, and deleting
-- the unscoped rows would empty the table instead of migrating it.
delete from public.categories
where store_id is null and exists (select 1 from public.stores);

do $$
begin
  if not exists (select 1 from public.categories where store_id is null) then
    alter table public.categories alter column store_id set not null;
  end if;
end;
$$;

-- One spelling per store, not one per database.
create unique index if not exists categories_store_name_idx
  on public.categories (store_id, public.ar_normalize(name));

-- ------------------------------------------------------- delivery zones
--
-- Copy on write. A zone with no store is a shared default; a zone with a store
-- is that store's own, and `source_id` says which default it replaced. For a
-- given store the effective list is: its own zones, plus every default it has
-- not replaced.
alter table public.delivery_zones
  add column if not exists store_id text references public.stores(id) on delete cascade;

alter table public.delivery_zones
  add column if not exists source_id text references public.delivery_zones(id) on delete set null;

-- The code was globally unique, which a copy carrying its source's number would
-- immediately violate. NULLS NOT DISTINCT so the defaults (store_id null) still
-- cannot repeat a code between themselves.
drop index if exists public.delivery_zones_code_idx;
create unique index if not exists delivery_zones_store_code_idx
  on public.delivery_zones (store_id, code) nulls not distinct;

create index if not exists delivery_zones_source_idx on public.delivery_zones (source_id);

/**
 * The zones a store actually works with.
 *
 * Its own rows win over the defaults they replaced. A store that has changed
 * nothing sees exactly the shared catalogue.
 */
create or replace function public.store_zones(p_store_id text default null)
returns setof public.delivery_zones
language sql stable security invoker set search_path = ''
as $$
  select z.* from public.delivery_zones z
  where z.store_id = p_store_id
  union all
  select d.* from public.delivery_zones d
  where d.store_id is null
    and not exists (
      select 1 from public.delivery_zones copy
      where copy.store_id = p_store_id and copy.source_id = d.id
    );
$$;

grant execute on function public.store_zones(text) to authenticated;

/**
 * The row a store may edit for a given zone, creating it on first change.
 *
 * Editing a shared default from inside a store must not change what every other
 * store sees, so the first edit copies the default into the store and returns
 * the copy's id. Editing a zone the store already owns returns it unchanged.
 *
 * The copy keeps the default's code — that is the number people quote — which
 * is exactly why the unique index had to become (store_id, code).
 */
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

  -- Another tab may have copied it a moment ago; one copy per store per source.
  select id into v_existing from public.delivery_zones
  where store_id = p_store_id and source_id = v_zone.id;
  if found then
    return v_existing;
  end if;

  v_new_id := gen_random_uuid()::text;
  insert into public.delivery_zones (
    id, code, name, region, capital, area_km2, fee, delivery_time_days, active,
    commission_type, commission_value, store_id, source_id
  )
  values (
    v_new_id, v_zone.code, v_zone.name, v_zone.region, v_zone.capital, v_zone.area_km2,
    v_zone.fee, v_zone.delivery_time_days, v_zone.active,
    v_zone.commission_type, v_zone.commission_value, p_store_id, v_zone.id
  );

  return v_new_id;
end;
$$;

grant execute on function public.zone_for_store(text, text) to authenticated;

-- Zone codes still come from one global sequence, so a store's numbers can have
-- gaps. That is the cheaper trade: the alternative is a counter per store, and
-- the number's job is to identify a zone in conversation, not to run 1..n.
