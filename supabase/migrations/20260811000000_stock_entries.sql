-- Inventory stops being an editable field and becomes the running total of a
-- ledger.
--
-- The quantity on an item is written once, when the item is created. Every
-- change after that is a row here: a purchase received, a sale fulfilled, a
-- count corrected, damage written off. `products.stock` is still the number
-- every screen reads — this table is why it holds the value it does.
--
-- `quantity` is a signed delta, not an absolute. A purchase is +5, a sale is
-- -2. Storing the delta means two concurrent movements add up instead of one
-- overwriting the other, which is exactly the failure an editable stock field
-- has.

create table if not exists public.stock_entries (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('purchase', 'sale', 'return', 'damage', 'adjustment', 'initial')),
  quantity integer not null check (quantity <> 0),
  /** Stock after this movement, so the ledger can be read without re-summing. */
  balance integer not null,
  note text not null default '',
  /** Set for order-driven movements, so a sale can be traced to its order. */
  order_id text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists stock_entries_product_idx on public.stock_entries (product_id, created_at desc);
create index if not exists stock_entries_store_idx on public.stock_entries (store_id, created_at desc);

alter table public.stock_entries enable row level security;

-- Insert goes through record_stock_entry / create_order_with_stock, which keep
-- the ledger and products.stock in step. Direct UPDATE and DELETE are withheld
-- on purpose: a ledger that can be rewritten explains nothing.
drop policy if exists "Active users can read stock entries" on public.stock_entries;
create policy "Active users can read stock entries"
  on public.stock_entries for select to authenticated
  using ((select public.is_active_user()));

revoke all on public.stock_entries from anon, authenticated;
grant select on public.stock_entries to authenticated;

alter table public.stock_entries replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_entries'
  ) then
    alter publication supabase_realtime add table public.stock_entries;
  end if;
end;
$$;

-- ------------------------------------------------------------------ writing

/**
 * Applies one movement: locks the item, moves the stock, records the row.
 *
 * SECURITY DEFINER because the table grants no INSERT to anyone — this function
 * is the only way in. It still checks is_active_user() itself, so revoking a
 * user's access revokes this too.
 */
create or replace function public.record_stock_entry(
  p_id text,
  p_product_id text,
  p_kind text,
  p_quantity integer,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id text;
  v_balance integer;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_quantity = 0 then
    raise exception 'ZERO_QUANTITY';
  end if;

  select store_id, stock into v_store_id, v_balance
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'NO_SUCH_PRODUCT';
  end if;

  v_balance := v_balance + p_quantity;

  -- The stock >= 0 check constraint would catch this anyway; naming it gives the
  -- client something it can turn into a sentence.
  if v_balance < 0 then
    raise exception 'INSUFFICIENT_STOCK';
  end if;

  update public.products
  set stock = v_balance,
      status = case
        when v_balance <= 0 then 'out_of_stock'
        when status = 'out_of_stock' then 'active'
        else status
      end
  where id = p_product_id;

  insert into public.stock_entries (id, product_id, store_id, kind, quantity, balance, note)
  values (p_id, p_product_id, p_kind, p_quantity, v_balance, coalesce(p_note, ''));
end;
$$;

grant execute on function public.record_stock_entry(text, text, text, integer, text) to authenticated;

-- --------------------------------------------------- orders join the ledger
--
-- Based on the CURRENT definition from 20260807, not the original from
-- 20260804: order numbers are generated here when the client sends none, and
-- the function returns the number it used. Rebuilding from the older body would
-- have quietly removed both — every order after the first would then insert
-- order_number = '' and collide on the unique index.
--
-- It changes from SECURITY INVOKER to SECURITY DEFINER because stock_entries
-- grants INSERT to nobody — that is what stops a client forging ledger rows.
-- The is_active_user() check added in its place enforces the same rule the RLS
-- policy did.
create or replace function public.create_order_with_stock(
  p_id text, p_order_number text, p_store_id text, p_customer_id text,
  p_customer_name text, p_items jsonb, p_discount numeric, p_delivery_fee numeric, p_notes text
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

  for v_line in
    select item ->> 'productId' as product_id, (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as item
  loop
    select stock, name into v_available, v_name
      from public.products where id = v_line.product_id for update;
    if found and v_available < v_line.quantity then
      raise exception 'INSUFFICIENT_STOCK:%', v_name;
    end if;
  end loop;

  insert into public.orders (id, order_number, store_id, customer_id, customer_name,
                             items, subtotal, discount, delivery_fee, total, notes)
  values (p_id, v_number, p_store_id, p_customer_id, p_customer_name, p_items,
          v_subtotal, coalesce(p_discount,0), coalesce(p_delivery_fee,0), v_total, coalesce(p_notes,''));

  update public.products p
  set stock = p.stock - line.quantity,
      status = case when p.stock - line.quantity <= 0 then 'out_of_stock' else p.status end
  from (select item ->> 'productId' as product_id, sum((item ->> 'quantity')::integer) as quantity
        from jsonb_array_elements(p_items) as item group by 1) as line
  where p.id = line.product_id;

  -- One ledger row per product on the order, carrying the post-movement balance
  -- the UPDATE above just wrote.
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

grant execute on function public.create_order_with_stock(text,text,text,text,text,jsonb,numeric,numeric,text) to authenticated;

-- The ledger is append-only through a definer function, so the audit trigger is
-- belt and braces rather than the record of last resort — but a table nobody
-- audits is exactly where a surprise hides.
drop trigger if exists audit_stock_entries on public.stock_entries;
create trigger audit_stock_entries
  after insert or update or delete on public.stock_entries
  for each row execute function public.audit_trigger();
