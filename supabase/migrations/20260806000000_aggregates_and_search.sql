-- Server-side aggregates and searchable columns, so the app stops loading every
-- row to compute a total.
--
-- Everything runs with security_invoker, so the existing RLS policies still
-- decide what a caller can see.

-- ---------------------------------------------------------------- Arabic search
--
-- Must be IMMUTABLE to be usable in a generated column. This mirrors
-- src/lib/arabic.ts exactly; arabic.check.ts asserts both agree on the same
-- fixtures, so a change to one without the other fails the check.
create or replace function public.ar_normalize(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
    translate(
      regexp_replace(value, '[ً-ٰٟـ]', '', 'g'),
      'أإآٱةىؤئ',
      'اااا' || 'ه' || 'يوي'
    )
  );
$$;

create extension if not exists pg_trgm;

alter table public.products
  add column if not exists search_text text
  generated always as (public.ar_normalize(coalesce(name, '') || ' ' || coalesce(sku, ''))) stored;

alter table public.customers
  add column if not exists search_text text
  generated always as (public.ar_normalize(coalesce(name, '') || ' ' || coalesce(phone, ''))) stored;

alter table public.orders
  add column if not exists search_text text
  generated always as (public.ar_normalize(coalesce(order_number, '') || ' ' || coalesce(customer_name, ''))) stored;

create index if not exists products_search_idx on public.products using gin (search_text gin_trgm_ops);
create index if not exists customers_search_idx on public.customers using gin (search_text gin_trgm_ops);
create index if not exists orders_search_idx on public.orders using gin (search_text gin_trgm_ops);

-- ------------------------------------------------------------------ line view
--
-- One row per order line, with the order carried alongside. Orders with no
-- items survive as a single NULL-product row (LEFT JOIN LATERAL), so order-level
-- counts stay correct.
--
-- `realized` is the single definition of "this order became revenue". The
-- TypeScript copy in dashboardStats.ts mirrors it.
create or replace view public.order_lines
with (security_invoker = on) as
select
  o.id            as order_id,
  o.store_id,
  o.customer_id,
  o.customer_name,
  o.status,
  o.created_at,
  o.total         as order_total,
  o.subtotal,
  o.discount,
  o.delivery_fee,
  (o.status not in ('canceled', 'returned')) as realized,
  item ->> 'productId'                        as product_id,
  coalesce((item ->> 'quantity')::numeric, 0) as quantity,
  coalesce((item ->> 'price')::numeric, 0)    as line_price,
  p.purchase_price,
  p.margin,
  p.category,
  p.name as product_name,
  p.sku,
  c.city as customer_city
from public.orders o
left join lateral jsonb_array_elements(o.items) as item on true
left join public.products p on p.id = item ->> 'productId'
left join public.customers c on c.id = o.customer_id;

grant select on public.order_lines to authenticated;

-- -------------------------------------------------------------------- totals
create or replace function public.stats_totals(p_store_id text default null)
returns table (
  gross_sales numeric, discounts numeric, delivery_fees numeric, net_revenue numeric,
  cogs numeric, order_count bigint, realized_count bigint, untracked_cost_lines bigint
)
language sql stable security invoker set search_path = ''
as $$
  with scoped as (
    select * from public.orders o
    where p_store_id is null or o.store_id = p_store_id
  ),
  order_level as (
    select
      coalesce(sum(discount) filter (where status not in ('canceled','returned')), 0) as discounts,
      coalesce(sum(delivery_fee) filter (where status not in ('canceled','returned')), 0) as delivery_fees,
      coalesce(sum(total) filter (where status not in ('canceled','returned')), 0) as net_revenue,
      count(*) as order_count,
      count(*) filter (where status not in ('canceled','returned')) as realized_count
    from scoped
  ),
  line_level as (
    select
      coalesce(sum(l.line_price * l.quantity), 0) as gross_sales,
      coalesce(sum(l.purchase_price * l.quantity), 0) as cogs,
      count(*) filter (where l.product_id is not null and l.purchase_price is null) as untracked_cost_lines
    from public.order_lines l
    where l.realized
      and (p_store_id is null or l.store_id = p_store_id)
  )
  select line_level.gross_sales, order_level.discounts, order_level.delivery_fees,
         order_level.net_revenue, line_level.cogs, order_level.order_count,
         order_level.realized_count, line_level.untracked_cost_lines
  from order_level, line_level;
$$;

-- ------------------------------------------------------------------- by month
create or replace function public.stats_by_month(p_store_id text default null, p_months int default 6)
returns table (
  month_start date, gross_sales numeric, net_revenue numeric, discounts numeric,
  delivery_fees numeric, cogs numeric, profit numeric, order_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  with months as (
    select generate_series(
      date_trunc('month', now()) - make_interval(months => p_months - 1),
      date_trunc('month', now()),
      interval '1 month'
    )::date as month_start
  ),
  order_level as (
    select date_trunc('month', o.created_at)::date as month_start,
           sum(o.total) as net_revenue, sum(o.discount) as discounts,
           sum(o.delivery_fee) as delivery_fees, count(*) as order_count
    from public.orders o
    where o.status not in ('canceled','returned')
      and (p_store_id is null or o.store_id = p_store_id)
    group by 1
  ),
  line_level as (
    select date_trunc('month', l.created_at)::date as month_start,
           sum(l.line_price * l.quantity) as gross_sales,
           sum(l.purchase_price * l.quantity) as cogs,
           sum(coalesce(l.margin, 0) * l.quantity) as profit
    from public.order_lines l
    where l.realized and (p_store_id is null or l.store_id = p_store_id)
    group by 1
  )
  select m.month_start,
         coalesce(ll.gross_sales, 0), coalesce(ol.net_revenue, 0), coalesce(ol.discounts, 0),
         coalesce(ol.delivery_fees, 0), coalesce(ll.cogs, 0), coalesce(ll.profit, 0),
         coalesce(ol.order_count, 0)
  from months m
  left join order_level ol using (month_start)
  left join line_level ll using (month_start)
  order by m.month_start;
$$;

-- --------------------------------------------------------------- by dimension
--
-- One entry point for every "group the orders by X" panel: store, status,
-- product, customer, category, city. Keeps a single copy of the realized rule
-- and the line join instead of one function per chart.
create or replace function public.stats_by_dimension(
  p_dimension text,
  p_store_id text default null,
  p_limit int default 100
)
returns table (
  key text, label text, order_count bigint, units numeric, revenue numeric, profit numeric
)
language sql stable security invoker set search_path = ''
as $$
  with lines as (
    select * from public.order_lines l
    where (p_store_id is null or l.store_id = p_store_id)
  )
  -- status counts every order, including cancelled ones; that is the point of
  -- the tab bar. Every other dimension reports realized revenue only.
  select * from (
    select l.status::text as key,
           l.status::text as label,
           count(distinct l.order_id) as order_count,
           0::numeric as units, 0::numeric as revenue, 0::numeric as profit
    from lines l where p_dimension = 'status' group by 1, 2

    union all
    select l.store_id, coalesce(s.name, l.store_id),
           count(distinct l.order_id),
           coalesce(sum(l.quantity), 0),
           coalesce(sum(l.line_price * l.quantity), 0),
           coalesce(sum(coalesce(l.margin, 0) * l.quantity), 0)
    from lines l left join public.stores s on s.id = l.store_id
    where p_dimension = 'store' and l.realized group by 1, 2

    union all
    select l.product_id, coalesce(l.product_name, l.product_id),
           count(distinct l.order_id),
           coalesce(sum(l.quantity), 0),
           coalesce(sum(l.line_price * l.quantity), 0),
           coalesce(sum(coalesce(l.margin, 0) * l.quantity), 0)
    from lines l
    where p_dimension = 'product' and l.realized and l.product_id is not null group by 1, 2

    union all
    select l.customer_id, coalesce(l.customer_name, l.customer_id),
           count(distinct l.order_id),
           0::numeric,
           coalesce(sum(distinct_order_total), 0),
           0::numeric
    from (
      select l2.*, (case when row_number() over (partition by l2.order_id order by l2.product_id nulls first) = 1
                        then l2.order_total else 0 end) as distinct_order_total
      from lines l2 where l2.realized
    ) l
    where p_dimension = 'customer' group by 1, 2

    union all
    select coalesce(l.category, 'غير مصنّف'), coalesce(l.category, 'غير مصنّف'),
           count(distinct l.order_id),
           coalesce(sum(l.quantity), 0),
           coalesce(sum(l.line_price * l.quantity), 0),
           coalesce(sum(coalesce(l.margin, 0) * l.quantity), 0)
    from lines l
    where p_dimension = 'category' and l.realized and l.product_id is not null group by 1, 2

    union all
    select coalesce(l.customer_city, 'غير محددة'), coalesce(l.customer_city, 'غير محددة'),
           count(distinct l.order_id),
           0::numeric,
           coalesce(sum(distinct_order_total), 0),
           0::numeric
    from (
      select l2.*, (case when row_number() over (partition by l2.order_id order by l2.product_id nulls first) = 1
                        then l2.order_total else 0 end) as distinct_order_total
      from lines l2 where l2.realized
    ) l
    where p_dimension = 'city' group by 1, 2
  ) grouped
  order by revenue desc, order_count desc
  limit p_limit;
$$;

-- ------------------------------------------------------- per-store card counts
create or replace function public.store_totals()
returns table (
  store_id text, product_count bigint, order_count bigint,
  customer_count bigint, total_sales numeric, total_profit numeric
)
language sql stable security invoker set search_path = ''
as $$
  select s.id,
    (select count(*) from public.products p where p.store_id = s.id),
    (select count(*) from public.orders o where o.store_id = s.id),
    (select count(distinct o.customer_id) from public.orders o where o.store_id = s.id),
    coalesce((select sum(o.total) from public.orders o
              where o.store_id = s.id and o.status not in ('canceled','returned')), 0),
    coalesce((select sum(coalesce(l.margin, 0) * l.quantity) from public.order_lines l
              where l.store_id = s.id and l.realized), 0)
  from public.stores s;
$$;

grant execute on function public.stats_totals(text) to authenticated;
grant execute on function public.stats_by_month(text, int) to authenticated;
grant execute on function public.stats_by_dimension(text, text, int) to authenticated;
grant execute on function public.store_totals() to authenticated;
