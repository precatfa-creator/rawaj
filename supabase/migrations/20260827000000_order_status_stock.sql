-- Keep the order lifecycle and the stock ledger in one transaction.
--
-- Orders reserve their quantities when created. Before this function existed,
-- changing an order to canceled or returned only changed `orders.status`; the
-- shelf stayed short and no `return` ledger row explained the correction.
-- Reopening a canceled/returned order had the inverse bug: it became active
-- without reserving stock again.

create or replace function public.set_order_status_with_stock(
  p_order_ids text[],
  p_status text,
  p_reason text default '',
  p_items jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_line record;
  v_items jsonb;
  v_available integer;
  v_delta integer;
  v_name text;
  v_old_holds boolean;
  v_new_holds boolean;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    return;
  end if;

  if p_status not in (
    'new', 'confirmed', 'processing', 'shipped', 'waiting',
    'delivered', 'delivered_partial', 'canceled', 'returned'
  ) then
    raise exception 'INVALID_ORDER_STATUS:%', p_status;
  end if;

  -- Partial delivery carries the per-line delivered quantities in the same
  -- write. It is intentionally one order at a time; a bulk selection cannot
  -- answer which lines arrived for every order.
  if p_items is not null and (
    cardinality(p_order_ids) <> 1 or p_status <> 'delivered_partial'
    or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
  ) then
    raise exception 'INVALID_PARTIAL_DELIVERY';
  end if;

  -- Lock orders in a stable order. The product rows are then locked in product
  -- id order below, preventing two simultaneous status batches from deadlocking
  -- while they reconcile the same catalogue items.
  for v_order in
    select id, store_id, order_number, items, status
    from public.orders
    where id = any(p_order_ids)
    order by id
    for update
  loop
    -- SECURITY DEFINER bypasses RLS, so repeat the same store/item permission
    -- checks the normal orders UPDATE policy would have applied to this caller.
    if not public.has_store_permission(v_order.store_id, 'orders', 'write', 0)
       or not public.has_user_store_permission((select auth.uid()), v_order.store_id, 'orders', v_order.id) then
      raise exception 'PERMISSION_DENIED:orders:write' using errcode = '42501';
    end if;

    v_old_holds := v_order.status not in ('canceled', 'returned');
    v_new_holds := p_status not in ('canceled', 'returned');
    v_items := coalesce(p_items, v_order.items);

    -- A partial-delivery write may annotate lines with deliveredQuantity, but
    -- it may not change the reserved order quantities. Otherwise a crafted
    -- request could alter an active order's lines without a matching stock
    -- movement. The normal edit endpoint remains the only quantity editor.
    if p_items is not null and (
      exists (
        with old_lines as (
          select item ->> 'productId' as product_id,
                 sum((item ->> 'quantity')::integer) as quantity
          from jsonb_array_elements(v_order.items) as item group by 1
        ),
        new_lines as (
          select item ->> 'productId' as product_id,
                 sum((item ->> 'quantity')::integer) as quantity
          from jsonb_array_elements(p_items) as item group by 1
        )
        select 1
        from old_lines o full join new_lines n using (product_id)
        where coalesce(o.quantity, 0) <> coalesce(n.quantity, 0)
      )
      or exists (
        select 1
        from jsonb_array_elements(p_items) as item
        where item ? 'deliveredQuantity'
          and ((item ->> 'deliveredQuantity')::integer < 0
            or (item ->> 'deliveredQuantity')::integer > (item ->> 'quantity')::integer)
      )
    ) then
      raise exception 'INVALID_PARTIAL_DELIVERY';
    end if;

    if v_old_holds is distinct from v_new_holds then
      for v_line in
        select item ->> 'productId' as product_id,
               sum((item ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item
        group by 1
        order by 1
      loop
        continue when v_line.product_id is null or v_line.quantity = 0;

        select stock, name into v_available, v_name
        from public.products
        where id = v_line.product_id
        for update;

        if not found then
          raise exception 'NO_SUCH_PRODUCT:%', v_line.product_id;
        end if;

        v_delta := case when v_new_holds then -v_line.quantity else v_line.quantity end;
        if v_available + v_delta < 0 then
          raise exception 'INSUFFICIENT_STOCK:%', v_name;
        end if;

        update public.products
        set stock = v_available + v_delta,
            status = case
              when v_available + v_delta <= 0 then 'out_of_stock'
              when status = 'out_of_stock' then 'active'
              else status
            end
        where id = v_line.product_id;

        insert into public.stock_entries (
          id, product_id, store_id, kind, quantity, balance, note, order_id
        )
        select gen_random_uuid()::text, p.id, p.store_id,
               case when v_delta < 0 then 'sale' else 'return' end,
               v_delta, p.stock,
               case when v_delta < 0
                 then 'إعادة حجز الطلب ' || v_order.order_number
                 else 'إرجاع الطلب ' || v_order.order_number
               end,
               v_order.id
        from public.products p
        where p.id = v_line.product_id;
      end loop;
    end if;

    update public.orders
    set status = p_status,
        status_reason = coalesce(p_reason, ''),
        items = case when p_items is null then items else p_items end
    where id = v_order.id;
  end loop;
end;
$$;

grant execute on function public.set_order_status_with_stock(text[], text, text, jsonb) to authenticated;

-- Keep quantity edits consistent with the same exposure rule. An active order
-- owns a reservation, so changing its lines moves the difference. A canceled
-- or returned order owns no reservation, so editing its lines must not touch
-- stock; reopening it later will reserve the edited quantities exactly once.
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
      zone_id = nullif(p_zone_id, '')
  where id = p_id;
end;
$$;

grant execute on function public.update_order_with_stock(
  text, text, text, jsonb, numeric, numeric, text, text, text
) to authenticated;
