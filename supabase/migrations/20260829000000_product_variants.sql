-- One catalogue product can have any number of option axes, while inventory is
-- held by the concrete combinations. products.stock remains the aggregate read
-- by existing reports and lists; product_variants.stock is the sellable truth.

alter table public.products
  add column if not exists variant_options jsonb not null default '[]'::jsonb
  check (jsonb_typeof(variant_options) = 'array');

create table if not exists public.product_variants (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  option_values jsonb not null check (jsonb_typeof(option_values) = 'object'),
  option_key text not null,
  sku text not null default '',
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, option_key)
);

create index if not exists product_variants_product_idx
  on public.product_variants(product_id, active, option_key);
create unique index if not exists product_variants_store_sku_idx
  on public.product_variants(store_id, sku) where sku <> '' and active;

alter table public.product_variants enable row level security;
drop policy if exists "Store permission read product variants" on public.product_variants;
create policy "Store permission read product variants"
  on public.product_variants for select to authenticated
  using (
    public.has_store_permission(store_id, 'products', 'read', 0)
    and public.has_user_store_permission((select auth.uid()), store_id, 'products', product_id)
  );

revoke all on public.product_variants from anon, authenticated;
grant select on public.product_variants to authenticated;
alter table public.product_variants replica identity full;

alter table public.stock_entries
  add column if not exists variant_id text references public.product_variants(id) on delete set null;
alter table public.stock_entries
  add column if not exists variant_balance integer check (variant_balance is null or variant_balance >= 0);
create index if not exists stock_entries_variant_idx
  on public.stock_entries(variant_id, created_at desc) where variant_id is not null;

-- Internal stock primitive shared by orders, returns, edits and hand-entered
-- movements. A delta is applied to both the exact variant and its parent total.
create or replace function public.apply_product_stock_delta(
  p_entry_id text,
  p_product_id text,
  p_variant_id text,
  p_kind text,
  p_delta integer,
  p_note text,
  p_order_id text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_product record;
  v_variant record;
  v_product_balance integer;
  v_variant_balance integer;
begin
  if p_delta = 0 then raise exception 'ZERO_QUANTITY'; end if;

  select id, store_id, name, stock, variant_options, status
  into v_product
  from public.products where id = p_product_id for update;
  if not found then raise exception 'NO_SUCH_PRODUCT:%', p_product_id; end if;

  if nullif(p_variant_id, '') is null then
    if jsonb_array_length(v_product.variant_options) > 0 then
      raise exception 'VARIANT_REQUIRED:%', v_product.name;
    end if;
    v_variant_balance := null;
  else
    select id, stock, active into v_variant
    from public.product_variants
    where id = p_variant_id and product_id = p_product_id
    for update;
    if not found or not v_variant.active then
      raise exception 'NO_SUCH_VARIANT:%', p_variant_id;
    end if;
    v_variant_balance := v_variant.stock + p_delta;
    if v_variant_balance < 0 then
      raise exception 'INSUFFICIENT_STOCK:%', v_product.name;
    end if;
  end if;

  v_product_balance := v_product.stock + p_delta;
  if v_product_balance < 0 then
    raise exception 'INSUFFICIENT_STOCK:%', v_product.name;
  end if;

  if v_variant_balance is not null then
    update public.product_variants set stock = v_variant_balance where id = p_variant_id;
  end if;

  update public.products
  set stock = v_product_balance,
      status = case
        when v_product_balance <= 0 then 'out_of_stock'
        when status = 'out_of_stock' then 'active'
        else status
      end
  where id = p_product_id;

  insert into public.stock_entries (
    id, product_id, store_id, variant_id, kind, quantity,
    balance, variant_balance, note, order_id
  ) values (
    p_entry_id, p_product_id, v_product.store_id, nullif(p_variant_id, ''), p_kind,
    p_delta, v_product_balance, v_variant_balance, coalesce(p_note, ''), p_order_id
  );
end;
$$;

revoke all on function public.apply_product_stock_delta(text,text,text,text,integer,text,text) from public;

-- The product form saves metadata and its combination matrix together. Existing
-- variant quantities cannot be edited here: only the stock ledger may move them.
create or replace function public.save_product_with_variants(
  p_is_new boolean,
  p_product jsonb,
  p_variant_options jsonb,
  p_variants jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_id text := p_product ->> 'id';
  v_store_id text := p_product ->> 'store_id';
  v_existing record;
  v_variant jsonb;
  v_initial integer := greatest(0, coalesce((p_product ->> 'stock')::integer, 0));
  v_variant_total integer;
  v_has_variants boolean := jsonb_array_length(coalesce(p_variant_options, '[]'::jsonb)) > 0;
  v_had_variants boolean;
  v_row record;
begin
  if not (select public.is_active_user()) then raise exception 'NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_variant_options, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_variants, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_VARIANTS';
  end if;
  if v_has_variants and jsonb_array_length(p_variants) = 0 then
    raise exception 'INVALID_VARIANTS';
  end if;

  select id, store_id, stock, variant_options into v_existing
  from public.products where id = v_id for update;
  v_had_variants := found and jsonb_array_length(v_existing.variant_options) > 0;

  if p_is_new then
    if found then raise exception 'DUPLICATE_PRODUCT'; end if;
    if not public.has_store_permission(v_store_id, 'products', 'create', 0) then
      raise exception 'PERMISSION_DENIED:products:create' using errcode = '42501';
    end if;
    select coalesce(sum(greatest(0, coalesce((item ->> 'stock')::integer, 0))), 0)::integer
      into v_variant_total from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) item;
    if v_has_variants then v_initial := v_variant_total; end if;

    insert into public.products (
      id, store_id, name, description, images, purchase_price, selling_price,
      margin, sku, default_serial, category, sizes, min_stock, status,
      stock, variant_options
    ) values (
      v_id, v_store_id, p_product ->> 'name', coalesce(p_product ->> 'description', ''),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_product -> 'images', '[]'::jsonb))), '{}'),
      coalesce((p_product ->> 'purchase_price')::numeric, 0),
      coalesce((p_product ->> 'selling_price')::numeric, 0),
      coalesce((p_product ->> 'margin')::numeric, 0), coalesce(p_product ->> 'sku', ''),
      coalesce(p_product ->> 'default_serial', ''), coalesce(p_product ->> 'category', ''),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_product -> 'sizes', '[]'::jsonb))), '{}'),
      greatest(0, coalesce((p_product ->> 'min_stock')::integer, 0)),
      coalesce(p_product ->> 'status', 'active'), v_initial, coalesce(p_variant_options, '[]'::jsonb)
    );
  else
    if not found then raise exception 'NO_SUCH_PRODUCT'; end if;
    if v_existing.store_id <> v_store_id then raise exception 'STORE_MISMATCH'; end if;
    if not public.has_store_permission(v_store_id, 'products', 'write', 0)
       or not public.has_user_store_permission((select auth.uid()), v_store_id, 'products', v_id) then
      raise exception 'PERMISSION_DENIED:products:write' using errcode = '42501';
    end if;

    update public.products set
      name = p_product ->> 'name',
      description = coalesce(p_product ->> 'description', ''),
      images = coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_product -> 'images', '[]'::jsonb))), '{}'),
      purchase_price = coalesce((p_product ->> 'purchase_price')::numeric, 0),
      selling_price = coalesce((p_product ->> 'selling_price')::numeric, 0),
      margin = coalesce((p_product ->> 'margin')::numeric, 0),
      sku = coalesce(p_product ->> 'sku', ''),
      default_serial = coalesce(p_product ->> 'default_serial', ''),
      category = coalesce(p_product ->> 'category', ''),
      sizes = coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_product -> 'sizes', '[]'::jsonb))), '{}'),
      min_stock = greatest(0, coalesce((p_product ->> 'min_stock')::integer, 0)),
      status = coalesce(p_product ->> 'status', status),
      variant_options = coalesce(p_variant_options, '[]'::jsonb)
    where id = v_id;
  end if;

  if not v_has_variants then
    if v_had_variants and exists (
      select 1 from public.product_variants where product_id = v_id and active and stock <> 0
    ) then raise exception 'VARIANT_HAS_STOCK'; end if;
    update public.product_variants set active = false where product_id = v_id and active;
    if p_is_new and v_initial > 0 then
      insert into public.stock_entries(id, product_id, store_id, kind, quantity, balance, note)
      values (gen_random_uuid()::text, v_id, v_store_id, 'initial', v_initial, v_initial, 'كمية ابتدائية');
    end if;
    return;
  end if;

  if not p_is_new and not v_had_variants then
    select coalesce(sum(greatest(0, coalesce((item ->> 'stock')::integer, 0))), 0)::integer
      into v_variant_total from jsonb_array_elements(p_variants) item;
    if v_variant_total <> v_existing.stock then raise exception 'VARIANT_STOCK_MISMATCH'; end if;
  end if;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    if exists (select 1 from public.product_variants where id = v_variant ->> 'id' and product_id = v_id) then
      update public.product_variants set
        option_values = v_variant -> 'optionValues',
        option_key = v_variant ->> 'optionKey',
        sku = coalesce(v_variant ->> 'sku', ''),
        active = true
      where id = v_variant ->> 'id' and product_id = v_id;
    else
      if not p_is_new and v_had_variants and coalesce((v_variant ->> 'stock')::integer, 0) <> 0 then
        raise exception 'NEW_VARIANT_STOCK';
      end if;
      insert into public.product_variants(id, product_id, store_id, option_values, option_key, sku, stock, active)
      values (
        v_variant ->> 'id', v_id, v_store_id, v_variant -> 'optionValues',
        v_variant ->> 'optionKey', coalesce(v_variant ->> 'sku', ''),
        greatest(0, coalesce((v_variant ->> 'stock')::integer, 0)), true
      );
    end if;
  end loop;

  for v_row in
    select id, stock from public.product_variants pv
    where pv.product_id = v_id and pv.active
      and not exists (select 1 from jsonb_array_elements(p_variants) item where item ->> 'id' = pv.id)
  loop
    if v_row.stock <> 0 then raise exception 'VARIANT_HAS_STOCK'; end if;
    update public.product_variants set active = false where id = v_row.id;
  end loop;

  if p_is_new then
    insert into public.stock_entries(
      id, product_id, store_id, variant_id, kind, quantity, balance, variant_balance, note
    )
    select gen_random_uuid()::text, v_id, v_store_id, pv.id, 'initial', pv.stock,
           sum(pv.stock) over (order by pv.option_key), pv.stock, 'كمية ابتدائية'
    from public.product_variants pv
    where pv.product_id = v_id and pv.active and pv.stock > 0;
  end if;
exception
  when unique_violation then raise exception 'DUPLICATE_VARIANT';
end;
$$;

grant execute on function public.save_product_with_variants(boolean,jsonb,jsonb,jsonb) to authenticated;

-- Manual movement now optionally targets one exact combination.
drop function if exists public.record_stock_entry(text, text, text, integer, text);
create or replace function public.record_stock_entry(
  p_id text,
  p_product_id text,
  p_kind text,
  p_quantity integer,
  p_note text default '',
  p_variant_id text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select public.is_active_user()) then raise exception 'NOT_AUTHORIZED'; end if;
  perform public.apply_product_stock_delta(
    p_id, p_product_id, p_variant_id, p_kind, p_quantity, coalesce(p_note, ''), null
  );
end;
$$;
grant execute on function public.record_stock_entry(text,text,text,integer,text,text) to authenticated;

-- Orders reserve exact combinations. Legacy/simple lines continue to work when
-- their product has no variant_options.
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
  v_number text; v_series text; v_default_series text;
begin
  if not (select public.is_active_user()) then raise exception 'NOT_AUTHORIZED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'EMPTY_ORDER'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) item
             where coalesce((item ->> 'quantity')::integer, 0) <= 0 or nullif(item ->> 'productId', '') is null)
  then raise exception 'INVALID_ORDER_ITEMS'; end if;

  select n.default_series into v_default_series from public.document_naming n
  where n.doctype = 'orders' and n.store_key in (coalesce(p_store_id, ''), '')
  order by (n.store_key <> '') desc limit 1;
  if not found then raise exception 'NO_SUCH_DOCTYPE:orders'; end if;
  v_number := nullif(trim(coalesce(p_order_number, '')), '');
  v_series := coalesce(nullif(trim(coalesce(p_naming_series, '')), ''), v_default_series);
  if v_number is null then v_number := public.next_document_name('orders', v_series, p_store_id); end if;

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(p_items) item;
  v_total := greatest(0, v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0));

  insert into public.orders(id, order_number, naming_series, store_id, customer_id, customer_name,
    items, subtotal, discount, delivery_fee, total, notes, agent_id, zone_id, delivery_date)
  values (p_id, v_number, coalesce(v_series, ''), p_store_id, p_customer_id, p_customer_name,
    p_items, v_subtotal, coalesce(p_discount,0), coalesce(p_delivery_fee,0), v_total,
    coalesce(p_notes,''), nullif(p_agent_id,''), nullif(p_zone_id,''), p_delivery_date);

  for v_line in
    select item ->> 'productId' product_id, nullif(item ->> 'variantId', '') variant_id,
           sum((item ->> 'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_items) item group by 1,2 order by 1,2 nulls first
  loop
    perform public.apply_product_stock_delta(
      gen_random_uuid()::text, v_line.product_id, v_line.variant_id, 'sale', -v_line.quantity,
      'طلب ' || v_number, p_id
    );
  end loop;
  return v_number;
end;
$$;

grant execute on function public.create_order_with_stock(
  text,text,text,text,text,jsonb,numeric,numeric,text,text,text,text,date
) to authenticated;

create or replace function public.update_order_with_stock(
  p_id text, p_customer_id text, p_customer_name text, p_items jsonb,
  p_discount numeric, p_delivery_fee numeric, p_notes text,
  p_agent_id text default null, p_zone_id text default null, p_delivery_date date default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order record; v_subtotal numeric(14,2); v_total numeric(14,2); v_line record;
begin
  if not (select public.is_active_user()) then raise exception 'NOT_AUTHORIZED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'EMPTY_ORDER'; end if;
  select id, order_number, items, status into v_order from public.orders where id = p_id for update;
  if not found then raise exception 'NO_SUCH_ORDER'; end if;

  if v_order.status not in ('canceled', 'returned') then
    for v_line in
      with old_lines as (
        select item ->> 'productId' product_id, coalesce(item ->> 'variantId', '') variant_id,
               sum((item ->> 'quantity')::integer)::integer quantity
        from jsonb_array_elements(v_order.items) item group by 1,2
      ), new_lines as (
        select item ->> 'productId' product_id, coalesce(item ->> 'variantId', '') variant_id,
               sum((item ->> 'quantity')::integer)::integer quantity
        from jsonb_array_elements(p_items) item group by 1,2
      )
      select coalesce(n.product_id,o.product_id) product_id,
             nullif(coalesce(n.variant_id,o.variant_id), '') variant_id,
             coalesce(n.quantity,0) - coalesce(o.quantity,0) delta
      from new_lines n full join old_lines o
        on o.product_id = n.product_id and o.variant_id = n.variant_id
      order by 1,2 nulls first
    loop
      continue when v_line.product_id is null or v_line.delta = 0;
      perform public.apply_product_stock_delta(
        gen_random_uuid()::text, v_line.product_id, v_line.variant_id, 'adjustment', -v_line.delta,
        'تعديل طلب ' || v_order.order_number, p_id
      );
    end loop;
  end if;

  select coalesce(sum((item ->> 'price')::numeric * (item ->> 'quantity')::integer), 0)
    into v_subtotal from jsonb_array_elements(p_items) item;
  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_delivery_fee,0));
  update public.orders set customer_id=p_customer_id, customer_name=coalesce(p_customer_name,''),
    items=p_items, subtotal=v_subtotal, discount=coalesce(p_discount,0),
    delivery_fee=coalesce(p_delivery_fee,0), total=v_total, notes=coalesce(p_notes,''),
    agent_id=nullif(p_agent_id,''), zone_id=nullif(p_zone_id,''), delivery_date=p_delivery_date
  where id=p_id;
end;
$$;

grant execute on function public.update_order_with_stock(
  text,text,text,jsonb,numeric,numeric,text,text,text,date
) to authenticated;

create or replace function public.set_order_status_with_stock(
  p_order_ids text[], p_status text, p_reason text default '', p_items jsonb default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order record; v_line record; v_items jsonb;
  v_delta integer; v_old_holds boolean; v_new_holds boolean;
begin
  if not (select public.is_active_user()) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_order_ids is null or cardinality(p_order_ids)=0 then return; end if;
  if p_status not in ('new','confirmed','processing','shipped','waiting','delivered',
    'delivered_partial','canceled','returned') then raise exception 'INVALID_ORDER_STATUS:%',p_status; end if;
  if p_items is not null and (cardinality(p_order_ids)<>1 or p_status<>'delivered_partial'
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0)
  then raise exception 'INVALID_PARTIAL_DELIVERY'; end if;

  for v_order in select id,store_id,order_number,items,status from public.orders
    where id=any(p_order_ids) order by id for update
  loop
    if not public.has_store_permission(v_order.store_id,'orders','write',0)
       or not public.has_user_store_permission((select auth.uid()),v_order.store_id,'orders',v_order.id)
    then raise exception 'PERMISSION_DENIED:orders:write' using errcode='42501'; end if;
    v_old_holds := v_order.status not in ('canceled','returned');
    v_new_holds := p_status not in ('canceled','returned');
    v_items := coalesce(p_items,v_order.items);

    if p_items is not null and (
      exists (
        with old_lines as (
          select item ->> 'productId' product_id, coalesce(item ->> 'variantId','') variant_id,
                 sum((item ->> 'quantity')::integer) quantity
          from jsonb_array_elements(v_order.items) item group by 1,2
        ), new_lines as (
          select item ->> 'productId' product_id, coalesce(item ->> 'variantId','') variant_id,
                 sum((item ->> 'quantity')::integer) quantity
          from jsonb_array_elements(p_items) item group by 1,2
        ) select 1 from old_lines o full join new_lines n
          on o.product_id=n.product_id and o.variant_id=n.variant_id
        where coalesce(o.quantity,0)<>coalesce(n.quantity,0)
      ) or exists (
        select 1 from jsonb_array_elements(p_items) item where item ? 'deliveredQuantity'
          and ((item ->> 'deliveredQuantity')::integer<0
            or (item ->> 'deliveredQuantity')::integer>(item ->> 'quantity')::integer)
      )
    ) then raise exception 'INVALID_PARTIAL_DELIVERY'; end if;

    if v_old_holds is distinct from v_new_holds then
      for v_line in
        select item ->> 'productId' product_id, nullif(item ->> 'variantId','') variant_id,
               sum((item ->> 'quantity')::integer)::integer quantity
        from jsonb_array_elements(v_items) item group by 1,2 order by 1,2 nulls first
      loop
        continue when v_line.product_id is null or v_line.quantity=0;
        v_delta := case when v_new_holds then -v_line.quantity else v_line.quantity end;
        perform public.apply_product_stock_delta(
          gen_random_uuid()::text, v_line.product_id, v_line.variant_id,
          case when v_delta<0 then 'sale' else 'return' end, v_delta,
          case when v_delta<0 then 'إعادة حجز الطلب ' else 'إرجاع الطلب ' end || v_order.order_number,
          v_order.id
        );
      end loop;
    end if;
    update public.orders set status=p_status,status_reason=coalesce(p_reason,''),
      items=case when p_items is null then items else p_items end where id=v_order.id;
  end loop;
end;
$$;

grant execute on function public.set_order_status_with_stock(text[],text,text,jsonb) to authenticated;
