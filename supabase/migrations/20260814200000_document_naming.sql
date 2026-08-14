-- Document naming, in the shape Frappe uses.
--
-- Every kind of document (a doctype) declares which naming series it may use
-- and which one is the default. A series is a pattern:
--
--   ORD-.YYYY.-.####   ->  ORD-2026-0001
--   CUS-.####          ->  CUS-0001
--
-- `.YYYY.` `.YY.` `.MM.` `.DD.` are date tokens replaced at the moment the
-- document is created; the run of `#` is the counter and its length is the
-- zero-padding. Everything else is literal.
--
-- The counter lives in `naming_counters`, keyed by the resolved prefix — so a
-- series carrying a year rolls over on its own — and by the store, so each
-- store counts its own documents from 1 rather than continuing another store's
-- run. Two stores creating their first order of 2026 both get ORD-2026-0001,
-- which is why `orders.order_number` stops being globally unique below.
--
-- The store is part of the counter KEY, never part of the pattern: a pattern
-- with a store in it would put the store's identity in every document number
-- and make renaming a store rewrite history.

create table if not exists public.document_naming (
  /** The table the documents live in: 'orders', 'customers', … */
  doctype text primary key,
  label text not null,
  /** Every series the user may pick, most-preferred first. */
  series text[] not null check (cardinality(series) > 0),
  default_series text not null,
  /** false counts one global run, e.g. for records shared across stores. */
  per_store boolean not null default true,
  check (default_series = any (series))
);

create table if not exists public.naming_counters (
  /** The series with its date tokens already resolved: 'ORD-2026-'. */
  prefix text not null,
  /** Store id, or '' for a doctype that counts globally. Not null so it can be
      part of the primary key — a nullable key column would let duplicates in. */
  store_key text not null default '',
  current bigint not null default 0 check (current >= 0),
  primary key (prefix, store_key)
);

alter table public.document_naming enable row level security;
alter table public.naming_counters enable row level security;

-- Everyone who can create a document needs to read which series exist; only an
-- administrator changes them.
drop policy if exists "Active users can read document naming" on public.document_naming;
create policy "Active users can read document naming"
  on public.document_naming for select to authenticated
  using ((select public.is_active_user()));

drop policy if exists "Admins can manage document naming" on public.document_naming;
create policy "Admins can manage document naming"
  on public.document_naming for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Counters are readable by admins (the settings screen shows where each series
-- has reached) and writable by nobody: next_document_name owns them.
drop policy if exists "Admins can read naming counters" on public.naming_counters;
create policy "Admins can read naming counters"
  on public.naming_counters for select to authenticated
  using ((select public.is_admin()));

revoke all on public.document_naming, public.naming_counters from anon, authenticated;
grant select on public.naming_counters to authenticated;
grant select, insert, update, delete on public.document_naming to authenticated;

alter table public.document_naming replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'document_naming'
  ) then
    alter publication supabase_realtime add table public.document_naming;
  end if;
end;
$$;

drop trigger if exists audit_document_naming on public.document_naming;
create trigger audit_document_naming
  after insert or update or delete on public.document_naming
  for each row execute function public.audit_trigger();

-- ------------------------------------------------------------ the resolver
--
-- Split out from the counter so it can be read without touching a sequence.
-- `describeSeries` in src/components/forms.tsx mirrors it to preview a series
-- on screen. IMMUTABLE it is not — it reads the clock — but it is otherwise pure.
create or replace function public.resolve_naming_prefix(p_series text, p_at timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select regexp_replace(
    replace(
      replace(
        replace(
          replace(coalesce(p_series, ''), '.YYYY.', to_char(p_at, 'YYYY')),
          '.YY.', to_char(p_at, 'YY')),
        '.MM.', to_char(p_at, 'MM')),
      '.DD.', to_char(p_at, 'DD')),
    -- The counter, and the dot that separated it from the prefix: in this
    -- notation a dot delimits tokens, it is not a character in the name.
    '\.?#+$', '');
$$;

grant execute on function public.resolve_naming_prefix(text, timestamptz) to authenticated;

-- --------------------------------------------------------- issuing a name
--
-- One statement takes the number: `on conflict … do update … returning` is
-- atomic, so two orders created at the same instant get two numbers. A
-- read-then-write would hand both the same one and let the unique index decide
-- who loses.
--
-- SECURITY DEFINER because naming_counters grants no INSERT or UPDATE to
-- anyone — this function is the only way a counter moves.
create or replace function public.next_document_name(
  p_doctype text,
  p_series text default null,
  p_store_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.document_naming;
  v_series text;
  v_prefix text;
  v_width integer;
  v_next bigint;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_config from public.document_naming where doctype = p_doctype;
  if not found then
    raise exception 'NO_SUCH_DOCTYPE:%', p_doctype;
  end if;

  v_series := coalesce(nullif(trim(coalesce(p_series, '')), ''), v_config.default_series);
  if not (v_series = any (v_config.series)) then
    raise exception 'UNKNOWN_SERIES:%', v_series;
  end if;

  v_prefix := public.resolve_naming_prefix(v_series);
  -- No `#` at all still numbers the document; a series that produced the same
  -- text every time would collide with itself on the second document.
  v_width := coalesce(length(substring(v_series from '#+$')), 0);
  if v_width = 0 then v_width := 4; end if;

  insert into public.naming_counters (prefix, store_key, current)
  values (v_prefix, case when v_config.per_store then coalesce(p_store_id, '') else '' end, 1)
  on conflict (prefix, store_key)
    do update set current = public.naming_counters.current + 1
  returning current into v_next;

  return v_prefix || lpad(v_next::text, v_width, '0');
end;
$$;

grant execute on function public.next_document_name(text, text, text) to authenticated;

/**
 * Moving a counter by hand, from the naming settings screen.
 *
 * Frappe calls this the series updater, and it exists for the same reason here:
 * a business that already issued ORD-2026-0500 on paper needs the next one to
 * be 0501, not 0001.
 */
create or replace function public.set_naming_counter(
  p_prefix text,
  p_store_id text default null,
  p_current bigint default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_current < 0 then
    raise exception 'NEGATIVE_COUNTER';
  end if;

  insert into public.naming_counters (prefix, store_key, current)
  values (p_prefix, coalesce(p_store_id, ''), p_current)
  on conflict (prefix, store_key) do update set current = excluded.current;
end;
$$;

grant execute on function public.set_naming_counter(text, text, bigint) to authenticated;

-- ------------------------------------------------------------ the doctypes
--
-- Seeded, not created by the app: a doctype with no series would leave the
-- form with an empty select and no way to name anything. Series can be edited
-- and added from the settings screen afterwards.
insert into public.document_naming (doctype, label, series, default_series, per_store) values
  ('orders', 'الطلبات', array['ORD-.YYYY.-.####', 'ORD-.####'], 'ORD-.YYYY.-.####', true),
  ('customers', 'العملاء', array['CUS-.YYYY.-.####', 'CUS-.####'], 'CUS-.####', true),
  ('products', 'المنتجات', array['ITM-.YYYY.-.####', 'ITM-.####'], 'ITM-.####', true),
  ('sales_reps', 'المندوبين', array['REP-.####'], 'REP-.####', true)
on conflict (doctype) do nothing;

-- Zones are deliberately absent: their `code` comes from the sequence in
-- 20260810 and is the number people quote ("منطقة 03"). A series here would
-- issue names nothing consumes, which is the same trap as a settings screen
-- offering a switch that is not wired to anything.

-- ------------------------------------------- orders are numbered per store
--
-- The global unique index is what forced every store to share one run of
-- numbers. Per store it becomes: this store cannot have two orders with the
-- same number, and two stores can both have their first.
alter table public.orders drop constraint if exists orders_order_number_key;
drop index if exists public.orders_order_number_key;

create unique index if not exists orders_store_number_idx
  on public.orders (store_id, order_number);

alter table public.orders
  add column if not exists naming_series text not null default '';

-- Existing orders were numbered by the old global scheme (ORD-1002…). They keep
-- those numbers: renumbering documents that have been quoted to customers is a
-- worse outcome than a store whose history starts mid-sequence. New orders take
-- their number from the series, whose prefix differs, so the two cannot collide.

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
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  -- A number sent by the client wins — that is how an imported sheet keeps the
  -- numbers it came with. Otherwise the series issues one for THIS store.
  v_number := nullif(trim(coalesce(p_order_number, '')), '');
  v_series := coalesce(nullif(trim(coalesce(p_naming_series, '')), ''),
                       (select default_series from public.document_naming where doctype = 'orders'));
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

-- The 11-argument version from 20260814100000 would otherwise remain as an
-- overload, and a call naming only the shared arguments would be ambiguous.
drop function if exists public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text, text, text
);

grant execute on function public.create_order_with_stock(
  text, text, text, text, text, jsonb, numeric, numeric, text, text, text, text
) to authenticated;
