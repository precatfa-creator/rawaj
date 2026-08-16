-- Six related changes, all of which hang off one missing link: an order never
-- recorded the delivery zone it was composed against.
--
--   1. orders.zone_id            — the zone the order form already asks for.
--   2. zone commission           — what the rep earns out of that zone's fee.
--   3. sales_reps.zones          — a rep covers more than one zone.
--   4. update_order_with_stock   — editing an order as one audited transaction.
--   5. sales_rep_totals          — commission per order, not a flat multiplier.
--   6. orders_totals             — totals for a filtered set, not for a page.

-- ------------------------------------------------------- 1. the zone on an order
--
-- ON DELETE SET NULL: deleting a zone must not take the orders delivered into
-- it. The fee already lives on the order, so history survives the detachment.
alter table public.orders
  add column if not exists zone_id text references public.delivery_zones(id) on delete set null;

create index if not exists orders_zone_id_idx on public.orders (zone_id);

-- ---------------------------------------------------------- 2. zone commission
--
-- The rep's cut comes out of the delivery fee: either a percentage of it, or a
-- flat amount per delivered order. 'none' means this zone says nothing and the
-- rep's own flat commission applies — which is what every existing zone means
-- today, so it is the default.
alter table public.delivery_zones
  add column if not exists commission_type text not null default 'none'
    check (commission_type in ('none', 'fixed', 'percent'));

alter table public.delivery_zones
  add column if not exists commission_value numeric(14, 2) not null default 0
    check (commission_value >= 0);

-- ------------------------------------------------------- 3. a rep's zone list
--
-- Backfilled from the single `zone` column, which is then dropped: keeping both
-- would leave two answers to "which zones does this rep cover" and no rule for
-- which one wins. An empty array keeps its old meaning — covers everywhere.
-- sales_reps.search_text is generated from name and phone only, so nothing
-- blocks the drop.
alter table public.sales_reps
  add column if not exists zones text[] not null default '{}';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_reps' and column_name = 'zone'
  ) then
    update public.sales_reps
    set zones = array[zone]
    where coalesce(zone, '') <> '' and cardinality(zones) = 0;

    alter table public.sales_reps drop column zone;
  end if;
end;
$$;

-- ------------------------------------------------- what one delivered order pays
--
-- One definition, used by the totals function and mirrored in
-- src/lib/commission.ts (commission.check.ts asserts the two agree).
create or replace function public.order_commission(
  p_delivery_fee numeric,
  p_commission_type text,
  p_commission_value numeric,
  p_rep_commission numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_commission_type, 'none')
    when 'percent' then coalesce(p_delivery_fee, 0) * coalesce(p_commission_value, 0) / 100
    when 'fixed' then coalesce(p_commission_value, 0)
    else coalesce(p_rep_commission, 0)
  end;
$$;

grant execute on function public.order_commission(numeric, text, numeric, numeric) to authenticated;

-- --------------------------------------------- 4a. creating an order, with a zone
--
-- Adding a defaulted parameter would overload rather than replace, and two
-- candidates differing only in a trailing default make every call ambiguous —
-- so the 10-argument version from 20260813 is dropped first. The body is that
-- one plus `zone_id`.
drop function if exists public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text, text
);

create or replace function public.create_order_with_stock(
  p_id text, p_order_number text, p_store_id text, p_customer_id text,
  p_customer_name text, p_items jsonb, p_discount numeric, p_delivery_fee numeric,
  p_notes text, p_agent_id text default null, p_zone_id text default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_subtotal numeric(14,2); v_total numeric(14,2); v_line record;
  v_available integer; v_name text; v_number text;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  v_number := nullif(trim(coalesce(p_order_number, '')), '');
  if v_number is null then
    select 'ORD-' || (coalesce(max(nullif(regexp_replace(order_number, '\D', '', 'g'), ''))::bigint, 1000) + 1)::text
      into v_number from public.orders;
  end if;

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(p_items) as item;
  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0));

  -- Grouped by product, not one row per line: two lines of the same item (two
  -- sizes, say) must be checked against stock as their sum. Ordered by id so
  -- concurrent orders take their locks in the same sequence.
  for v_line in
    select item ->> 'productId' as product_id, sum((item ->> 'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) as item
    group by 1 order by 1
  loop
    select stock, name into v_available, v_name
      from public.products where id = v_line.product_id for update;
    if found and v_available < v_line.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_name;
    end if;
  end loop;

  insert into public.orders (id, order_number, store_id, customer_id, customer_name,
                             items, subtotal, discount, delivery_fee, total, notes,
                             agent_id, zone_id)
  values (p_id, v_number, p_store_id, p_customer_id, p_customer_name, p_items,
          v_subtotal, coalesce(p_discount,0), coalesce(p_delivery_fee,0), v_total,
          coalesce(p_notes,''), nullif(p_agent_id, ''), nullif(p_zone_id, ''));

  update public.products p
  set stock = p.stock - line.quantity,
      status = case when p.stock - line.quantity <= 0 then 'out_of_stock' else p.status end
  from (select item ->> 'productId' as product_id, sum((item ->> 'quantity')::integer) as quantity
        from jsonb_array_elements(p_items) as item group by 1) as line
  where p.id = line.product_id;

  insert into public.stock_entries (id, product_id, store_id, kind, quantity, balance, note, order_id)
  select gen_random_uuid()::text, p.id, p.store_id, 'sale', -line.quantity, p.stock,
         'طلب ' || v_number, p_id
  from (select item ->> 'productId' as product_id, sum((item ->> 'quantity')::integer) as quantity
        from jsonb_array_elements(p_items) as item group by 1) as line
  join public.products p on p.id = line.product_id
  where line.quantity <> 0;

  return v_number;
end;
$$;

grant execute on function public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text, text, text
) to authenticated;

-- ------------------------------------------------------- 4b. editing an order
--
-- An edit is a transaction, not a form save: the order row, the stock of every
-- item whose quantity moved, and the ledger rows explaining the movement are
-- written together or not at all.
--
-- The ledger is append-only by design — stock_entries grants no UPDATE and no
-- DELETE — so an edit never rewrites the original 'sale' row. It appends a
-- compensating 'adjustment' carrying the same order_id, which is what makes the
-- history of an order readable after the fact. 'adjustment' rather than a new
-- kind keeps the CHECK constraint, the StockKind union and the labels map in
-- StockForm.tsx agreeing without a fourth place to update.
--
-- Status is deliberately not a parameter: it is changed from the orders table
-- and from bulk selection, and routing it through here too would give two
-- writers for one field.
create or replace function public.update_order_with_stock(
  p_id text, p_customer_id text, p_customer_name text, p_items jsonb,
  p_discount numeric, p_delivery_fee numeric, p_notes text,
  p_agent_id text default null, p_zone_id text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order record; v_subtotal numeric(14,2); v_total numeric(14,2);
  v_line record; v_available integer; v_name text;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  select id, order_number, items into v_order
  from public.orders where id = p_id for update;

  if not found then
    raise exception 'NO_SUCH_ORDER';
  end if;

  -- delta > 0 means the order now takes more units than it did, so stock falls
  -- by that much. A product dropped from the order gives its units back.
  for v_line in
    with old_lines as (
      select item ->> 'productId' as product_id, sum((item ->> 'quantity')::integer) as quantity
      from jsonb_array_elements(v_order.items) as item group by 1
    ),
    new_lines as (
      select item ->> 'productId' as product_id, sum((item ->> 'quantity')::integer) as quantity
      from jsonb_array_elements(p_items) as item group by 1
    )
    select coalesce(n.product_id, o.product_id) as product_id,
           coalesce(n.quantity, 0) - coalesce(o.quantity, 0) as delta
    from new_lines n
    full join old_lines o on o.product_id = n.product_id
    order by 1
  loop
    continue when v_line.product_id is null or v_line.delta = 0;

    select stock, name into v_available, v_name
      from public.products where id = v_line.product_id for update;

    -- A product deleted since the order was placed cannot have its stock moved;
    -- the edit still goes through, because refusing it would strand the order.
    continue when not found;

    if v_available - v_line.delta < 0 then
      raise exception 'INSUFFICIENT_STOCK:%', v_name;
    end if;

    -- Written from v_available, the value just locked, rather than from a bare
    -- `stock` inside its own SET expression: one name, one meaning.
    update public.products
    set stock = v_available - v_line.delta,
        status = case
          when v_available - v_line.delta <= 0 then 'out_of_stock'
          when status = 'out_of_stock' then 'active'
          else status
        end
    where id = v_line.product_id;

    insert into public.stock_entries (id, product_id, store_id, kind, quantity, balance, note, order_id)
    select gen_random_uuid()::text, p.id, p.store_id, 'adjustment', -v_line.delta, p.stock,
           'تعديل طلب ' || v_order.order_number, p_id
    from public.products p where p.id = v_line.product_id;
  end loop;

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(p_items) as item;
  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0));

  update public.orders
  set customer_id = p_customer_id,
      customer_name = coalesce(p_customer_name, ''),
      items = p_items,
      subtotal = v_subtotal,
      discount = coalesce(p_discount, 0),
      delivery_fee = coalesce(p_delivery_fee, 0),
      total = v_total,
      notes = coalesce(p_notes, ''),
      agent_id = nullif(p_agent_id, ''),
      zone_id = nullif(p_zone_id, '')
  where id = p_id;
end;
$$;

grant execute on function public.update_order_with_stock(
  text, text, text, jsonb, numeric, numeric, text, text, text
) to authenticated;

-- ------------------------------------------------- 5. commission per order
--
-- Was `r.commission * count(delivered)`, which cannot express a rate that
-- depends on where the order went. Now each delivered order is priced by its
-- own zone, and the rep's flat amount is the fallback for orders whose zone
-- says nothing — or which have no zone at all.
create or replace function public.sales_rep_totals(p_store_id text default null)
returns table (
  rep_id text, order_count bigint, realized_count bigint, revenue numeric, commission_due numeric
)
language sql stable security invoker set search_path = ''
as $$
  select
    r.id,
    count(o.id),
    count(o.id) filter (where o.status not in ('canceled', 'returned')),
    coalesce(sum(o.total) filter (where o.status not in ('canceled', 'returned')), 0),
    coalesce(sum(
      public.order_commission(o.delivery_fee, z.commission_type, z.commission_value, r.commission)
    ) filter (where o.status = 'delivered'), 0)
  from public.sales_reps r
  left join public.orders o
    on o.agent_id = r.id
   and (p_store_id is null or o.store_id = p_store_id)
  left join public.delivery_zones z on z.id = o.zone_id
  group by r.id;
$$;

grant execute on function public.sales_rep_totals(text) to authenticated;

-- ------------------------------------------------- 6. totals of a filtered set
--
-- The orders table shows a totals row, and it has to describe every order the
-- filters match — not the 24 rows on screen. Same filter arguments as the list
-- query, so the two cannot describe different sets.
create or replace function public.orders_totals(
  p_store_id text default null,
  p_status text default null,
  p_agent_id text default null,
  p_zone_id text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_min_total numeric default null,
  p_max_total numeric default null
)
returns table (
  order_count bigint, units numeric, subtotal numeric,
  discount numeric, delivery_fee numeric, total numeric
)
language sql stable security invoker set search_path = ''
as $$
  select
    count(*),
    coalesce(sum((select coalesce(sum((i ->> 'quantity')::numeric), 0)
                  from jsonb_array_elements(o.items) as i)), 0),
    coalesce(sum(o.subtotal), 0),
    coalesce(sum(o.discount), 0),
    coalesce(sum(o.delivery_fee), 0),
    coalesce(sum(o.total), 0)
  from public.orders o
  where (p_store_id is null or o.store_id = p_store_id)
    and (p_status is null or o.status = p_status)
    and (p_agent_id is null or o.agent_id = p_agent_id)
    and (p_zone_id is null or o.zone_id = p_zone_id)
    -- p_search arrives already normalised by the client, the same shape
    -- search_text is generated in.
    and (p_search is null or o.search_text like '%' || p_search || '%')
    -- Inclusive at both ends: the client sends the last instant of the chosen
    -- day, and the paged list applies the identical bound with `lte`.
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at <= p_to)
    and (p_min_total is null or o.total >= p_min_total)
    and (p_max_total is null or o.total <= p_max_total);
$$;

grant execute on function public.orders_totals(
  text, text, text, text, text, timestamptz, timestamptz, numeric, numeric
) to authenticated;
