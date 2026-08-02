-- Sales representatives: the people who carry orders to customers.
--
-- orders.agent_id has existed since the initial schema as a bare text column
-- with nothing behind it. This gives it something to point at.

create table if not exists public.sales_reps (
  id text primary key,
  name text not null,
  phone text not null default '',
  whatsapp text not null default '',
  /** The zone name the rep covers, matching delivery_zones.name and
      customers.city — text for the same reason those are. Empty means all. */
  zone text not null default '',
  /** Flat cut per delivered order. Percentage schemes can come later; nobody
      has asked for one, and a nullable second column would just sit empty. */
  commission numeric(14, 2) not null default 0 check (commission >= 0),
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.sales_reps
  add column if not exists search_text text
  generated always as (public.ar_normalize(coalesce(name, '') || ' ' || coalesce(phone, ''))) stored;

create index if not exists sales_reps_search_idx on public.sales_reps using gin (search_text gin_trgm_ops);

alter table public.sales_reps enable row level security;

drop policy if exists "Active users can access sales reps" on public.sales_reps;
create policy "Active users can access sales reps"
  on public.sales_reps for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

revoke all on public.sales_reps from anon;
grant select, insert, update, delete on public.sales_reps to authenticated;

alter table public.sales_reps replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_reps'
  ) then
    alter publication supabase_realtime add table public.sales_reps;
  end if;
end;
$$;

drop trigger if exists audit_sales_reps on public.sales_reps;
create trigger audit_sales_reps
  after insert or update or delete on public.sales_reps
  for each row execute function public.audit_trigger();

-- Any agent_id written before this table existed points at nothing, and would
-- abort the FK creation. Clearing it loses no information: there was never a
-- record on the other end to lose.
update public.orders
set agent_id = null
where agent_id is not null
  and agent_id not in (select id from public.sales_reps);

alter table public.orders
  drop constraint if exists orders_agent_id_fkey;

-- ON DELETE SET NULL, not CASCADE: a rep leaving must never take the orders
-- they delivered with them.
alter table public.orders
  add constraint orders_agent_id_fkey
  foreign key (agent_id) references public.sales_reps(id) on delete set null;

create index if not exists orders_agent_id_idx on public.orders (agent_id);

-- ------------------------------------------- assigning a rep at order time
--
-- The rep is chosen while composing the order, so it is written in the same
-- transaction as the order and its stock movements rather than by a follow-up
-- update that could fail on its own and leave the order unassigned.
--
-- Adding a parameter creates an overload rather than replacing the function, so
-- the old signature is dropped first — two functions of the same name differing
-- only in a defaulted trailing argument make every call ambiguous.
drop function if exists public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text
);

create or replace function public.create_order_with_stock(
  p_id text,
  p_order_number text,
  p_store_id text,
  p_customer_id text,
  p_customer_name text,
  p_items jsonb,
  p_discount numeric,
  p_delivery_fee numeric,
  p_notes text,
  p_agent_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subtotal numeric(14, 2);
  v_total numeric(14, 2);
  v_line record;
  v_available integer;
  v_name text;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'quantity')::integer), 0)
    into v_subtotal
  from jsonb_array_elements(p_items) as item;

  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0));

  -- Lock and check every line before writing anything.
  for v_line in
    select item ->> 'productId' as product_id,
           (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as item
  loop
    select stock, name into v_available, v_name
    from public.products
    where id = v_line.product_id
    for update;

    -- Lines whose product no longer exists are still allowed onto the order;
    -- there is simply no inventory to adjust.
    if found and v_available < v_line.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_name;
    end if;
  end loop;

  insert into public.orders (
    id, order_number, store_id, customer_id, customer_name,
    items, subtotal, discount, delivery_fee, total, notes, agent_id
  )
  values (
    p_id, p_order_number, p_store_id, p_customer_id, p_customer_name,
    p_items, v_subtotal, coalesce(p_discount, 0), coalesce(p_delivery_fee, 0), v_total,
    coalesce(p_notes, ''), nullif(p_agent_id, '')
  );

  update public.products p
  set stock = p.stock - line.quantity,
      status = case when p.stock - line.quantity <= 0 then 'out_of_stock' else p.status end
  from (
    select item ->> 'productId' as product_id,
           sum((item ->> 'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) as item
    group by 1
  ) as line
  where p.id = line.product_id;

  insert into public.stock_entries (id, product_id, store_id, kind, quantity, balance, note, order_id)
  select
    gen_random_uuid()::text,
    p.id,
    p.store_id,
    'sale',
    -line.quantity,
    p.stock,
    'طلب ' || p_order_number,
    p_id
  from (
    select item ->> 'productId' as product_id,
           sum((item ->> 'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) as item
    group by 1
  ) as line
  join public.products p on p.id = line.product_id
  where line.quantity <> 0;
end;
$$;

grant execute on function public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text, text
) to authenticated;

-- --------------------------------------------------------- per-rep totals
--
-- Same shape as the other aggregate functions, so the page can report real
-- numbers instead of counting a loaded page.
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
    r.commission * count(o.id) filter (where o.status = 'delivered')
  from public.sales_reps r
  left join public.orders o
    on o.agent_id = r.id
   and (p_store_id is null or o.store_id = p_store_id)
  group by r.id, r.commission;
$$;

grant execute on function public.sales_rep_totals(text) to authenticated;
