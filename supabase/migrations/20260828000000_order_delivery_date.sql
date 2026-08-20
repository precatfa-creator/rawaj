-- `orders.delivery_date` existed since the initial schema but nothing in the
-- app could write it, so the التسليم column read «—» for every order created
-- here; only the sheet importer ever filled it. Both order transactions now
-- take the date, as a trailing optional argument.
--
-- The old signatures are dropped rather than replaced: adding a parameter makes
-- a new function, and leaving the previous one behind would make every call
-- ambiguous.
drop function if exists public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text, text, text, text
);

create or replace function public.create_order_with_stock(
  p_id text, p_order_number text, p_store_id text, p_customer_id text,
  p_customer_name text, p_items jsonb, p_discount numeric, p_delivery_fee numeric,
  p_notes text, p_agent_id text default null, p_zone_id text default null,
  p_naming_series text default null, p_delivery_date date default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_subtotal numeric(14,2); v_total numeric(14,2); v_line record;
  v_available integer; v_name text; v_number text; v_series text;
  v_default_series text;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  select n.default_series into v_default_series
  from public.document_naming n
  where n.doctype = 'orders'
    and n.store_key in (coalesce(p_store_id, ''), '')
  order by (n.store_key <> '') desc
  limit 1;

  if not found then
    raise exception 'NO_SUCH_DOCTYPE:orders';
  end if;

  -- A number sent by the client wins — that is how an imported sheet keeps the
  -- numbers it came with. Otherwise the series issues one for THIS store.
  v_number := nullif(trim(coalesce(p_order_number, '')), '');
  v_series := coalesce(
    nullif(trim(coalesce(p_naming_series, '')), ''),
    v_default_series
  );
  if v_number is null then
    v_number := public.next_document_name('orders', v_series, p_store_id);
  end if;

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(p_items) as item;
  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0));

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

  insert into public.orders (id, order_number, naming_series, store_id, customer_id, customer_name,
                             items, subtotal, discount, delivery_fee, total, notes,
                             agent_id, zone_id, delivery_date)
  values (p_id, v_number, coalesce(v_series, ''), p_store_id, p_customer_id, p_customer_name, p_items,
          v_subtotal, coalesce(p_discount,0), coalesce(p_delivery_fee,0), v_total,
          coalesce(p_notes,''), nullif(p_agent_id, ''), nullif(p_zone_id, ''), p_delivery_date);

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
  text, text, text, text, text, jsonb, numeric, numeric, text, text, text, text, date
) to authenticated;

drop function if exists public.update_order_with_stock(
  text, text, text, jsonb, numeric, numeric, text, text, text
);

-- Body unchanged from 20260827000000 apart from the new column: an active order
-- owns a reservation, so editing its lines moves stock; a canceled or returned
-- order owns none, so editing it must not.
create or replace function public.update_order_with_stock(
  p_id text, p_customer_id text, p_customer_name text, p_items jsonb,
  p_discount numeric, p_delivery_fee numeric, p_notes text,
  p_agent_id text default null, p_zone_id text default null,
  p_delivery_date date default null
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

  select id, order_number, items, status into v_order
  from public.orders where id = p_id for update;

  if not found then
    raise exception 'NO_SUCH_ORDER';
  end if;

  if v_order.status not in ('canceled', 'returned') then
    -- delta > 0 means the order now takes more units than it did, so stock
    -- falls by that much. A product dropped from the order gives its units back.
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

      -- A product deleted since the order was placed cannot have its stock
      -- moved; the edit still goes through, as it did before this safeguard.
      continue when not found;

      if v_available - v_line.delta < 0 then
        raise exception 'INSUFFICIENT_STOCK:%', v_name;
      end if;

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
  end if;

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
      zone_id = nullif(p_zone_id, ''),
      delivery_date = p_delivery_date
  where id = p_id;
end;
$$;

grant execute on function public.update_order_with_stock(
  text, text, text, jsonb, numeric, numeric, text, text, text, date
) to authenticated;
