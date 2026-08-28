-- The orders table's totals row counted a partly delivered order as if all of it
-- had been handed over.
--
-- `20260826000000_partial_delivery_revenue.sql` moved every dashboard aggregate
-- onto `order_revenue` / `order_lines`, but `orders_totals` — the filtered-set
-- row under the orders table — was written earlier and still summed the stored
-- `o.total`, `o.subtotal`, `o.discount` and the ordered `quantity`. So marking an
-- order `delivered_partial` changed its status and left the money alone, which
-- is exactly the mismatch that migration set out to remove.
--
-- Same arguments, same filters, same result columns: only the four amounts move
-- from ordered to realized. `delivery_fee` is unchanged — the trip was made
-- either way — and for every other status delivered equals ordered, so a full
-- delivery reports precisely what it reported before.
create or replace function public.orders_totals(
  p_store_id text default null,
  p_status text default null,
  p_agent_id text default null,
  p_zone_id text default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_min_total numeric default null,
  p_max_total numeric default null
)
returns table (
  order_count bigint, units numeric, subtotal numeric,
  discount numeric, delivery_fee numeric, total numeric
)
language sql stable security invoker set search_path = ''
as $$
  select
    count(*),
    coalesce(sum((select coalesce(sum(public.delivered_units(i, o.status)), 0)
                  from jsonb_array_elements(o.items) as i)), 0),
    coalesce(sum(r.delivered_subtotal), 0),
    coalesce(sum(r.realized_discount), 0),
    coalesce(sum(o.delivery_fee), 0),
    coalesce(sum(r.realized_total), 0)
  from public.orders o
  join public.order_revenue r on r.order_id = o.id
  where (p_store_id is null or o.store_id = p_store_id)
    and (p_status is null or o.status = p_status)
    and (p_agent_id is null or o.agent_id = p_agent_id)
    and (p_zone_id is null or o.zone_id = p_zone_id)
    -- p_search arrives already normalised by the client, the same shape
    -- search_text is generated in.
    and (p_search is null or o.search_text like '%' || p_search || '%')
    -- Inclusive at both ends: the client sends the last instant of the chosen
    -- day, and the paged list applies the identical bound with `lte`.
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at <= p_to)
    -- Still filtered on the stored total: this is the same range the list query
    -- applies, and the two rows have to describe the same set of orders.
    and (p_min_total is null or o.total >= p_min_total)
    and (p_max_total is null or o.total <= p_max_total);
$$;

grant execute on function public.orders_totals(
  text, text, text, text, text, timestamptz, timestamptz, numeric, numeric
) to authenticated;
