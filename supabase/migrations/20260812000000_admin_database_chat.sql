-- Read-only data gateway for the administrator AI assistant.
--
-- The model never receives a database credential or arbitrary SQL capability.
-- It can select one of the bounded reports below, and this function verifies the
-- caller's role again inside Postgres before reading anything.

create or replace function public.admin_chat_data(
  p_report text,
  p_store_id text default null,
  p_limit int default 10,
  p_months int default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 20));
  v_months int := greatest(1, least(coalesce(p_months, 6), 12));
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;

  if p_report is null or p_report not in (
    'overview', 'monthly_sales', 'order_statuses', 'top_products',
    'top_customers', 'top_cities', 'low_stock', 'stock_activity', 'recent_orders'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Unsupported assistant report.';
  end if;

  if p_store_id is not null and not exists (
    select 1 from public.stores where id = p_store_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'Unknown store.';
  end if;

  if p_report = 'overview' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.store_name), '[]'::jsonb)
    )
    into v_result
    from (
      select
        s.id as store_id,
        s.name as store_name,
        (select count(*) from public.products p where p.store_id = s.id) as product_count,
        (select count(distinct o.customer_id) from public.orders o where o.store_id = s.id) as customer_count,
        (select count(*) from public.orders o where o.store_id = s.id) as order_count,
        (select count(*) from public.orders o
          where o.store_id = s.id and o.status not in ('canceled', 'returned')) as realized_order_count,
        coalesce((select sum(o.total) from public.orders o
          where o.store_id = s.id and o.status not in ('canceled', 'returned')), 0) as net_revenue,
        coalesce((select sum(coalesce(l.margin, 0) * l.quantity) from public.order_lines l
          where l.store_id = s.id and l.realized), 0) as profit,
        (select count(*) from public.products p
          where p.store_id = s.id and (p.stock <= p.min_stock or p.status = 'out_of_stock')) as low_stock_count
      from public.stores s
      where p_store_id is null or s.id = p_store_id
    ) row_data;

  elsif p_report = 'monthly_sales' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'months', v_months,
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.month_start), '[]'::jsonb)
    )
    into v_result
    from public.stats_by_month(p_store_id, v_months) row_data;

  elsif p_report = 'order_statuses' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.order_count desc), '[]'::jsonb)
    )
    into v_result
    from (
      select o.status, count(*) as order_count, coalesce(sum(o.total), 0) as recorded_total
      from public.orders o
      where p_store_id is null or o.store_id = p_store_id
      group by o.status
    ) row_data;

  elsif p_report = 'top_products' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.revenue desc), '[]'::jsonb)
    )
    into v_result
    from (
      select
        coalesce(l.product_name, 'منتج محذوف') as product_name,
        coalesce(l.sku, '') as sku,
        sum(l.quantity) as units,
        count(distinct l.order_id) as order_count,
        coalesce(sum(l.line_price * l.quantity), 0) as revenue,
        coalesce(sum(coalesce(l.margin, 0) * l.quantity), 0) as profit
      from public.order_lines l
      where l.realized
        and (p_store_id is null or l.store_id = p_store_id)
        and l.product_id is not null
      group by l.product_id, l.product_name, l.sku
      order by revenue desc
      limit v_limit
    ) row_data;

  elsif p_report = 'top_customers' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'privacy', 'No phone, WhatsApp, address, or notes are included.',
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.net_revenue desc), '[]'::jsonb)
    )
    into v_result
    from (
      select
        coalesce(nullif(o.customer_name, ''), 'عميل غير مسمى') as customer_name,
        count(*) as order_count,
        coalesce(sum(o.total), 0) as net_revenue,
        max(o.created_at) as last_order_at
      from public.orders o
      where o.status not in ('canceled', 'returned')
        and (p_store_id is null or o.store_id = p_store_id)
      group by o.customer_id, o.customer_name
      order by net_revenue desc
      limit v_limit
    ) row_data;

  elsif p_report = 'top_cities' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.net_revenue desc), '[]'::jsonb)
    )
    into v_result
    from (
      select
        coalesce(nullif(c.city, ''), 'غير محددة') as city,
        count(*) as order_count,
        coalesce(sum(o.total), 0) as net_revenue
      from public.orders o
      left join public.customers c on c.id = o.customer_id
      where o.status not in ('canceled', 'returned')
        and (p_store_id is null or o.store_id = p_store_id)
      group by coalesce(nullif(c.city, ''), 'غير محددة')
      order by net_revenue desc
      limit v_limit
    ) row_data;

  elsif p_report = 'low_stock' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.shortage desc, row_data.product_name), '[]'::jsonb)
    )
    into v_result
    from (
      select
        s.name as store_name,
        p.name as product_name,
        p.sku,
        p.stock,
        p.min_stock,
        greatest(p.min_stock - p.stock, 0) as shortage,
        p.status
      from public.products p
      join public.stores s on s.id = p.store_id
      where (p_store_id is null or p.store_id = p_store_id)
        and (p.stock <= p.min_stock or p.status = 'out_of_stock')
      order by shortage desc, p.stock, p.name
      limit v_limit
    ) row_data;

  elsif p_report = 'stock_activity' then
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'privacy', 'Stock entry notes and actor identifiers are excluded.',
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.movement_count desc), '[]'::jsonb)
    )
    into v_result
    from (
      select
        se.kind,
        count(*) as movement_count,
        coalesce(sum(se.quantity), 0) as net_quantity,
        coalesce(sum(abs(se.quantity)), 0) as moved_units,
        max(se.created_at) as last_movement_at
      from public.stock_entries se
      where p_store_id is null or se.store_id = p_store_id
      group by se.kind
    ) row_data;

  else -- recent_orders
    select jsonb_build_object(
      'report', p_report,
      'scope', coalesce(p_store_id, 'all'),
      'privacy', 'Customer identity, contact details, address, and notes are excluded.',
      'generated_at', now(),
      'rows', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc), '[]'::jsonb)
    )
    into v_result
    from (
      select
        o.order_number,
        s.name as store_name,
        o.status,
        o.total,
        o.created_at,
        jsonb_array_length(o.items) as item_line_count
      from public.orders o
      join public.stores s on s.id = o.store_id
      where p_store_id is null or o.store_id = p_store_id
      order by o.created_at desc
      limit v_limit
    ) row_data;
  end if;

  return coalesce(v_result, jsonb_build_object(
    'report', p_report,
    'scope', coalesce(p_store_id, 'all'),
    'rows', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.admin_chat_data(text, text, int, int) from public, anon;
grant execute on function public.admin_chat_data(text, text, int, int) to authenticated;
