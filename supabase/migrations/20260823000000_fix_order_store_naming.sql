-- document_naming gained one row per store in 20260816100000, but the order
-- transaction still used a scalar subquery that assumed one global `orders`
-- row. As soon as a store saved its own naming settings, every new order failed
-- with SQLSTATE 21000 (more than one row returned by a subquery).
--
-- Resolve the same effective config as next_document_name: the store row wins,
-- and the shared row is the fallback for stores that never customised naming.
create or replace function public.create_order_with_stock(
  p_id text, p_order_number text, p_store_id text, p_customer_id text,
  p_customer_name text, p_items jsonb, p_discount numeric, p_delivery_fee numeric,
  p_notes text, p_agent_id text default null, p_zone_id text default null,
  p_naming_series text default null
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
                             agent_id, zone_id)
  values (p_id, v_number, coalesce(v_series, ''), p_store_id, p_customer_id, p_customer_name, p_items,
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
  text, text, text, text, text, jsonb, numeric, numeric, text, text, text, text
) to authenticated;
