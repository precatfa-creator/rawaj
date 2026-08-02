-- Creates an order and decrements the stock of every line it contains, in one
-- transaction. Doing this as two client calls races: a concurrent order can read
-- the same stock, and an insert followed by a failed update leaves an order whose
-- inventory was never adjusted.
--
-- products.stock carries `check (stock >= 0)`, so overselling aborts the whole
-- function and the caller gets a message instead of a half-applied order.

create or replace function public.create_order_with_stock(
  p_id text,
  p_order_number text,
  p_store_id text,
  p_customer_id text,
  p_customer_name text,
  p_items jsonb,
  p_discount numeric,
  p_delivery_fee numeric,
  p_notes text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subtotal numeric(14, 2);
  v_total numeric(14, 2);
  v_line record;
  v_available integer;
  v_name text;
begin
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
    items, subtotal, discount, delivery_fee, total, notes
  )
  values (
    p_id, p_order_number, p_store_id, p_customer_id, p_customer_name,
    p_items, v_subtotal, coalesce(p_discount, 0), coalesce(p_delivery_fee, 0), v_total, coalesce(p_notes, '')
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
end;
$$;

grant execute on function public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text
) to authenticated;
