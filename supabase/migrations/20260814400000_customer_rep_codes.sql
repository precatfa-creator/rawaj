-- Customers and sales reps get the number their naming series issues.
--
-- 20260814200000 configured a series for both, but neither had anywhere to put
-- the result: their only identifier was a UUID nobody quotes over the phone.
-- Items already had `sku` and orders `order_number`, which is why those two
-- needed no column of their own.
--
-- Blank is allowed and is what every existing row keeps: renaming records that
-- people already refer to by name would be a worse outcome than a code that
-- starts partway through the list.

alter table public.customers add column if not exists code text not null default '';
alter table public.sales_reps add column if not exists code text not null default '';

-- Unique per store, and only where set: many rows legitimately have no code.
create unique index if not exists customers_store_code_idx
  on public.customers (store_id, code) where code <> '';

create unique index if not exists sales_reps_store_code_idx
  on public.sales_reps (store_id, code) where code <> '';

-- The code is something a person searches by, so it joins the search column.
-- Dropping and re-adding is the only way to change a generated expression.
alter table public.customers drop column if exists search_text;
alter table public.customers
  add column search_text text
  generated always as (
    public.ar_normalize(coalesce(name, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(code, ''))
  ) stored;

create index if not exists customers_search_idx on public.customers using gin (search_text gin_trgm_ops);

alter table public.sales_reps drop column if exists search_text;
alter table public.sales_reps
  add column search_text text
  generated always as (
    public.ar_normalize(coalesce(name, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(code, ''))
  ) stored;

create index if not exists sales_reps_search_idx on public.sales_reps using gin (search_text gin_trgm_ops);
