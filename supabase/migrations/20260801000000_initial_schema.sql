create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));

create table if not exists public.stores (
  id text primary key,
  name text not null,
  image text not null default '',
  product_count integer not null default 0 check (product_count >= 0),
  customer_count integer not null default 0 check (customer_count >= 0),
  order_count integer not null default 0 check (order_count >= 0),
  total_profit numeric(14, 2) not null default 0,
  last_activity text not null default ''
);

create table if not exists public.products (
  id text primary key,
  store_id text not null references public.stores(id) on delete cascade,
  name text not null,
  description text not null default '',
  images text[] not null default '{}',
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(14, 2) not null default 0 check (selling_price >= 0),
  margin numeric(14, 2) not null default 0,
  sku text not null default '',
  barcode text not null default '',
  brand text not null default '',
  provider text not null default '',
  category text not null default '',
  colors text[] not null default '{}',
  sizes text[] not null default '{}',
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  status text not null default 'draft' check (status in ('active', 'draft', 'out_of_stock')),
  added_at date not null default current_date,
  sales_count integer not null default 0 check (sales_count >= 0)
);

create index if not exists products_store_id_idx on public.products(store_id);

create table if not exists public.customers (
  id text primary key,
  name text not null,
  phone text not null default '',
  whatsapp text not null default '',
  city text not null default '',
  address text not null default '',
  order_count integer not null default 0 check (order_count >= 0),
  total_spent numeric(14, 2) not null default 0 check (total_spent >= 0),
  last_purchase date,
  rating smallint not null default 1 check (rating between 1 and 5),
  status text not null default 'active' check (status in ('active', 'inactive', 'vip'))
);

create table if not exists public.orders (
  id text primary key,
  order_number text not null unique,
  store_id text not null references public.stores(id),
  customer_id text not null references public.customers(id),
  customer_name text not null default '',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  delivery_fee numeric(14, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  status text not null default 'new' check (status in ('new', 'confirmed', 'processing', 'shipped', 'delivered', 'canceled', 'returned')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  delivery_date date,
  agent_id text
);

create index if not exists orders_store_id_idx on public.orders(store_id);
create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'user',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active = true and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

create policy "Active users can access stores"
  on public.stores for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Active users can access products"
  on public.products for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Active users can access customers"
  on public.customers for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Active users can access orders"
  on public.orders for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

revoke all on public.profiles, public.stores, public.products, public.customers, public.orders from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.stores, public.products, public.customers, public.orders to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.stores replica identity full;
alter table public.products replica identity full;
alter table public.customers replica identity full;
alter table public.orders replica identity full;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['stores', 'products', 'customers', 'orders'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
