-- Revenue that counts what was actually delivered.
--
-- A `delivered_partial` order earns only the lines that arrived. Until now every
-- aggregate summed `o.total` and `quantity`, so a partly delivered order was
-- reported as if all of it had been handed over — the status recorded the truth
-- and the money did not.
--
-- The fix is at the choke point rather than in each report: `order_lines` gains
-- `delivered_quantity`, a new `order_revenue` view carries the order-level
-- amounts, and the four aggregate functions read those instead of the raw
-- columns. Nothing that reads them had to learn about partial delivery.

-- ------------------------------------------------------------------ the rule
--
-- The SQL twin of `deliveredOf` in src/lib/orderMath.ts; orderMath.check.ts
-- pins the TypeScript side against the same cases.
--
-- Absent means "all of it", which is what every line written before partial
-- delivery existed means and what every full delivery still means. The value is
-- clamped into [0, quantity] so a bad number in the jsonb can never invent
-- revenue or drive a total negative. Only a `delivered_partial` order consults
-- it: a stale figure left on an order moved back to a full delivery is ignored,
-- which is the same gate the app applies.
create or replace function public.delivered_units(p_item jsonb, p_status text)
returns numeric
language sql immutable
set search_path = ''
as $$
  select case
    when p_status is distinct from 'delivered_partial'
      then coalesce((p_item ->> 'quantity')::numeric, 0)
    else greatest(
      0,
      least(
        coalesce((p_item ->> 'quantity')::numeric, 0),
        coalesce(
          (p_item ->> 'deliveredQuantity')::numeric,
          (p_item ->> 'quantity')::numeric,
          0
        )
      )
    )
  end;
$$;

-- ------------------------------------------------------------- order_lines
--
-- `quantity` still means what was ordered — the reports that ask "what did
-- people ask for" need it. `delivered_quantity` is what arrived, and every sum
-- that turns into money now uses that one.
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
  c.city as customer_city,
  -- Appended rather than slotted beside `quantity`: CREATE OR REPLACE VIEW can
  -- only add columns at the end, and replacing in place keeps every dependent
  -- function working through the change.
  public.delivered_units(item, o.status) as delivered_quantity
from public.orders o
left join lateral jsonb_array_elements(o.items) as item on true
left join public.products p on p.id = item ->> 'productId'
left join public.customers c on c.id = o.customer_id;

grant select on public.order_lines to authenticated;

-- ------------------------------------------------------------ order_revenue
--
-- What each order earned, one row per order.
--
-- The goods are counted at what arrived. The delivery fee is kept whole because
-- the trip was made either way, and the discount is prorated by the delivered
-- share so a 10% discount stays 10% rather than becoming a deeper cut of a
-- smaller sale. Mirrors `deliveredTotals` in src/lib/orderMath.ts.
--
-- One formula covers both cases: a full delivery has delivered = ordered, so the
-- share is 1 and `realized_total` comes out equal to the stored `total`. There
-- is no separate branch to keep in step.
create or replace view public.order_revenue
with (security_invoker = on) as
select
  o.id          as order_id,
  o.store_id,
  o.customer_id,
  o.status,
  o.created_at,
  (o.status not in ('canceled', 'returned')) as realized,
  o.delivery_fee,
  agg.ordered_subtotal,
  agg.delivered_subtotal,
  o.discount * shares.share                  as realized_discount,
  greatest(0, agg.delivered_subtotal - o.discount * shares.share + o.delivery_fee)
                                             as realized_total
from public.orders o
left join lateral (
  select
    coalesce(sum(
      coalesce((i ->> 'price')::numeric, 0) * coalesce((i ->> 'quantity')::numeric, 0)
    ), 0) as ordered_subtotal,
    coalesce(sum(
      coalesce((i ->> 'price')::numeric, 0) * public.delivered_units(i, o.status)
    ), 0) as delivered_subtotal
  from jsonb_array_elements(o.items) as i
) agg on true
left join lateral (
  select case when agg.ordered_subtotal = 0 then 0
              else agg.delivered_subtotal / agg.ordered_subtotal end as share
) shares on true;

grant select on public.order_revenue to authenticated;

-- -------------------------------------------------------------------- totals
create or replace function public.stats_totals(p_store_id text default null)
returns table (
  gross_sales numeric, discounts numeric, delivery_fees numeric, net_revenue numeric,
  cogs numeric, order_count bigint, realized_count bigint, untracked_cost_lines bigint
)
language sql stable security invoker set search_path = ''
as $$
  with order_level as (
    select
      coalesce(sum(r.realized_discount) filter (where r.realized), 0) as discounts,
      coalesce(sum(r.delivery_fee) filter (where r.realized), 0) as delivery_fees,
      coalesce(sum(r.realized_total) filter (where r.realized), 0) as net_revenue,
      count(*) as order_count,
      count(*) filter (where r.realized) as realized_count
    from public.order_revenue r
    where p_store_id is null or r.store_id = p_store_id
  ),
  line_level as (
    select
      coalesce(sum(l.line_price * l.delivered_quantity), 0) as gross_sales,
      coalesce(sum(l.purchase_price * l.delivered_quantity), 0) as cogs,
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
    select date_trunc('month', r.created_at)::date as month_start,
           sum(r.realized_total) as net_revenue, sum(r.realized_discount) as discounts,
           sum(r.delivery_fee) as delivery_fees, count(*) as order_count
    from public.order_revenue r
    where r.realized
      and (p_store_id is null or r.store_id = p_store_id)
    group by 1
  ),
  line_level as (
    select date_trunc('month', l.created_at)::date as month_start,
           sum(l.line_price * l.delivered_quantity) as gross_sales,
           sum(l.purchase_price * l.delivered_quantity) as cogs,
           sum(coalesce(l.margin, 0) * l.delivered_quantity) as profit
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
-- Unchanged in shape: only the quantity every money column multiplies by moved
-- from ordered to delivered, and the per-order revenue the customer and city
-- panels report is now the realized total rather than the stored one.
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
    select l.*, r.realized_total
    from public.order_lines l
    join public.order_revenue r on r.order_id = l.order_id
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
           coalesce(sum(l.delivered_quantity), 0),
           coalesce(sum(l.line_price * l.delivered_quantity), 0),
           coalesce(sum(coalesce(l.margin, 0) * l.delivered_quantity), 0)
    from lines l left join public.stores s on s.id = l.store_id
    where p_dimension = 'store' and l.realized group by 1, 2

    union all
    select l.product_id, coalesce(l.product_name, l.product_id),
           count(distinct l.order_id),
           coalesce(sum(l.delivered_quantity), 0),
           coalesce(sum(l.line_price * l.delivered_quantity), 0),
           coalesce(sum(coalesce(l.margin, 0) * l.delivered_quantity), 0)
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
                        then l2.realized_total else 0 end) as distinct_order_total
      from lines l2 where l2.realized
    ) l
    where p_dimension = 'customer' group by 1, 2

    union all
    select coalesce(l.category, 'غير مصنّف'), coalesce(l.category, 'غير مصنّف'),
           count(distinct l.order_id),
           coalesce(sum(l.delivered_quantity), 0),
           coalesce(sum(l.line_price * l.delivered_quantity), 0),
           coalesce(sum(coalesce(l.margin, 0) * l.delivered_quantity), 0)
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
                        then l2.realized_total else 0 end) as distinct_order_total
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
    coalesce((select sum(r.realized_total) from public.order_revenue r
              where r.store_id = s.id and r.realized), 0),
    coalesce((select sum(coalesce(l.margin, 0) * l.delivered_quantity) from public.order_lines l
              where l.store_id = s.id and l.realized), 0)
  from public.stores s;
$$;

grant execute on function public.delivered_units(jsonb, text) to authenticated;
grant execute on function public.stats_totals(text) to authenticated;
grant execute on function public.stats_by_month(text, int) to authenticated;
grant execute on function public.stats_by_dimension(text, text, int) to authenticated;
grant execute on function public.store_totals() to authenticated;
