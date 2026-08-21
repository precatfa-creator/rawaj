-- Variant axes are store vocabulary, not something operators should retype for
-- every product. Products still store a snapshot (name + allowed values), while
-- this catalogue supplies reusable Color, Size, Material, ... definitions.

create table if not exists public.variant_option_catalog (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  name text not null,
  name_key text generated always as (public.ar_normalize(name)) stored,
  option_values text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name_key)
);

create index if not exists variant_option_catalog_store_idx
  on public.variant_option_catalog(store_id, name);

alter table public.variant_option_catalog enable row level security;
drop policy if exists "Store permission read variant option catalogue" on public.variant_option_catalog;
create policy "Store permission read variant option catalogue"
  on public.variant_option_catalog for select to authenticated
  using (public.has_store_permission(store_id, 'products', 'read', 0));

revoke all on public.variant_option_catalog from anon, authenticated;
grant select on public.variant_option_catalog to authenticated;

-- Called by the product trigger and by the one-time backfill. Values are merged:
-- one product using S/M must not erase XL already declared by another product.
create or replace function public.merge_variant_option_catalog(
  p_id text,
  p_store_id text,
  p_name text,
  p_values text[]
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_values text[];
begin
  if nullif(trim(coalesce(p_name, '')), '') is null then return; end if;
  select coalesce(array_agg(distinct trim(value) order by trim(value)), '{}')
    into v_values from unnest(coalesce(p_values, '{}')) value
    where nullif(trim(value), '') is not null;

  update public.variant_option_catalog c
  set name = trim(p_name),
      option_values = (
        select coalesce(array_agg(distinct value order by value), '{}')
        from unnest(c.option_values || v_values) value
      ),
      updated_at = now()
  where c.id = p_id and c.store_id = p_store_id;
  if found then return; end if;

  insert into public.variant_option_catalog(id, store_id, name, option_values)
  values (p_id, p_store_id, trim(p_name), v_values)
  on conflict (store_id, name_key) do update set
    name = excluded.name,
    option_values = (
      select coalesce(array_agg(distinct value order by value), '{}')
      from unnest(public.variant_option_catalog.option_values || excluded.option_values) value
    ),
    updated_at = now();
end;
$$;

revoke all on function public.merge_variant_option_catalog(text,text,text,text[]) from public;

create or replace function public.capture_product_variant_options()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_option jsonb;
begin
  for v_option in select value from jsonb_array_elements(new.variant_options)
  loop
    perform public.merge_variant_option_catalog(
      v_option ->> 'id',
      new.store_id,
      v_option ->> 'name',
      coalesce(array(select jsonb_array_elements_text(v_option -> 'values')), '{}')
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists capture_product_variant_options on public.products;
create trigger capture_product_variant_options
  after insert or update of variant_options on public.products
  for each row
  when (jsonb_array_length(new.variant_options) > 0)
  execute function public.capture_product_variant_options();

-- Existing product options become immediately selectable after this migration.
do $$
declare
  v_product record;
  v_option jsonb;
begin
  for v_product in
    select store_id, variant_options from public.products
    where jsonb_array_length(variant_options) > 0
  loop
    for v_option in select value from jsonb_array_elements(v_product.variant_options)
    loop
      perform public.merge_variant_option_catalog(
        v_option ->> 'id',
        v_product.store_id,
        v_option ->> 'name',
        coalesce(array(select jsonb_array_elements_text(v_option -> 'values')), '{}')
      );
    end loop;
  end loop;
end;
$$;
