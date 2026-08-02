-- A human-facing zone number, and a default serial for items.
--
-- `code` is NOT the primary key. The seeded zones use slugs (`tripoli`,
-- `benghazi`) and the seed relies on `on conflict (id)`, so the sequential
-- number people quote over the phone ("منطقة 03") gets its own column.
--
-- Assignment is server-side on purpose: two operators creating a zone at the
-- same moment would otherwise both read the same max and pick the same code.
-- A sequence hands out each number once, and the unique index is the backstop.

alter table public.delivery_zones
  add column if not exists code text not null default '';

-- Existing rows first, ordered by name so the numbering is stable and
-- reproducible rather than dependent on physical row order.
update public.delivery_zones z
set code = numbered.code
from (
  select id, lpad((row_number() over (order by name) - 1)::text, 2, '0') as code
  from public.delivery_zones
) numbered
where z.id = numbered.id and z.code = '';

create unique index if not exists delivery_zones_code_idx on public.delivery_zones (code);

create sequence if not exists public.delivery_zone_code_seq as bigint minvalue 0 start 0;

-- Park the sequence past whatever the backfill used, so the next insert does
-- not collide with an existing code.
select setval(
  'public.delivery_zone_code_seq',
  coalesce((select max(code::bigint) from public.delivery_zones where code ~ '^[0-9]+$'), -1) + 1,
  false
);

create or replace function public.assign_zone_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only fill a blank. An import that carries an explicit code keeps it, which
  -- is what makes a round-tripped export update the row it came from.
  if new.code is null or btrim(new.code) = '' then
    new.code := lpad(nextval('public.delivery_zone_code_seq')::text, 2, '0');
  else
    new.code := btrim(new.code);
  end if;
  return new;
end;
$$;

drop trigger if exists zone_code_assign on public.delivery_zones;
create trigger zone_code_assign
  before insert on public.delivery_zones
  for each row execute function public.assign_zone_code();

grant usage, select on sequence public.delivery_zone_code_seq to authenticated;

-- ----------------------------------------------------------------- items
--
-- The serial an item ships with by default. Free text: serials in this market
-- are whatever the supplier printed, not a checkable format.
alter table public.products
  add column if not exists default_serial text not null default '';

-- Zones are searched client-side over the loaded list, but items are searched
-- in Postgres — so the serial has to join the generated search column to be
-- findable. Dropping and re-adding is the only way to change the expression.
alter table public.products drop column if exists search_text;
alter table public.products
  add column search_text text
  generated always as (
    public.ar_normalize(
      coalesce(name, '') || ' ' || coalesce(sku, '') || ' ' || coalesce(default_serial, '')
    )
  ) stored;

create index if not exists products_search_idx on public.products using gin (search_text gin_trgm_ops);
