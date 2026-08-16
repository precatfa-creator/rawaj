-- Store-scoped roles and permissions, global DocType metadata, and multi-store
-- ownership.  DocType definitions are intentionally global for now; the
-- permission rows that use them are scoped to a store.

-- ------------------------------------------------------------ identity

create or replace function public.generate_store_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'ST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create or replace function public.generate_business_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'BG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create table if not exists public.business_groups (
  id text primary key default gen_random_uuid()::text,
  code text not null unique default public.generate_business_code(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.stores
  add column if not exists store_code text,
  add column if not exists mobile_number text not null default '',
  add column if not exists business_group_id text references public.business_groups(id) on delete restrict;

do $$
declare
  item record;
begin
  for item in select id from public.stores where store_code is null or trim(store_code) = '' loop
    update public.stores
    set store_code = public.generate_store_code()
    where id = item.id;
  end loop;
end;
$$;

create unique index if not exists stores_store_code_idx on public.stores(store_code);

-- Existing stores become independent business groups.  This preserves their
-- current isolation until an owner deliberately links another store.
do $$
declare
  item record;
  group_id text;
begin
  for item in select id, name from public.stores where business_group_id is null loop
    insert into public.business_groups(name) values (item.name || ' — مجموعة') returning id into group_id;
    update public.stores set business_group_id = group_id where id = item.id;
  end loop;
end;
$$;

alter table public.stores alter column store_code set not null;
alter table public.stores alter column business_group_id set not null;
alter table public.stores alter column store_code set default public.generate_store_code();

-- ------------------------------------------------------------- doctypes

create table if not exists public.doctype_definitions (
  name text primary key,
  label text not null,
  module text not null default 'Rawaj',
  is_system boolean not null default false,
  is_active boolean not null default true,
  is_submittable boolean not null default false,
  naming_rule text,
  created_at timestamptz not null default now()
);

create table if not exists public.doctype_fields (
  id uuid primary key default gen_random_uuid(),
  doctype text not null references public.doctype_definitions(name) on delete cascade,
  fieldname text not null,
  label text not null,
  fieldtype text not null,
  options text not null default '',
  perm_level smallint not null default 0 check (perm_level between 0 and 9),
  required boolean not null default false,
  read_only boolean not null default false,
  hidden boolean not null default false,
  unique_value boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (doctype, fieldname)
);

insert into public.doctype_definitions(name, label, module, is_system) values
  ('stores', 'المتاجر', 'Rawaj', true),
  ('products', 'المنتجات', 'Commerce', true),
  ('customers', 'العملاء', 'Commerce', true),
  ('orders', 'الطلبات', 'Commerce', true),
  ('sales_reps', 'المندوبين', 'Commerce', true),
  ('delivery_zones', 'مناطق التوصيل', 'Commerce', true),
  ('categories', 'الفئات', 'Commerce', true),
  ('stock_entries', 'حركات المخزون', 'Inventory', true),
  ('document_naming', 'تسمية المستندات', 'Setup', true)
on conflict (name) do update set label = excluded.label, module = excluded.module;

insert into public.doctype_fields(doctype, fieldname, label, fieldtype, perm_level, read_only, position) values
  ('stores', 'store_code', 'معرّف المتجر', 'Data', 0, true, 1),
  ('stores', 'mobile_number', 'رقم الهاتف', 'Phone', 1, false, 2),
  ('products', 'name', 'اسم المنتج', 'Data', 0, false, 1),
  ('products', 'purchase_price', 'سعر الشراء', 'Currency', 1, false, 2),
  ('products', 'selling_price', 'سعر البيع', 'Currency', 0, false, 3),
  ('products', 'stock', 'المخزون', 'Int', 1, true, 4),
  ('products', 'margin', 'الهامش', 'Currency', 1, true, 5),
  ('customers', 'name', 'اسم العميل', 'Data', 0, false, 1),
  ('customers', 'phone', 'الهاتف', 'Phone', 1, false, 2),
  ('customers', 'whatsapp', 'واتساب', 'Phone', 1, false, 3),
  ('customers', 'address', 'العنوان', 'Small Text', 1, false, 4),
  ('orders', 'total', 'الإجمالي', 'Currency', 0, true, 1),
  ('orders', 'notes', 'الملاحظات', 'Small Text', 1, false, 2),
  ('orders', 'discount', 'الخصم', 'Currency', 1, false, 3),
  ('orders', 'delivery_fee', 'رسوم التوصيل', 'Currency', 1, false, 4),
  ('sales_reps', 'name', 'اسم المندوب', 'Data', 0, false, 1),
  ('sales_reps', 'phone', 'الهاتف', 'Phone', 1, false, 2),
  ('sales_reps', 'whatsapp', 'واتساب', 'Phone', 1, false, 3),
  ('sales_reps', 'commission', 'العمولة', 'Currency', 1, false, 4),
  ('sales_reps', 'note', 'ملاحظات', 'Small Text', 1, false, 5)
on conflict (doctype, fieldname) do update set
  label = excluded.label,
  fieldtype = excluded.fieldtype,
  perm_level = excluded.perm_level,
  read_only = excluded.read_only,
  position = excluded.position;

-- --------------------------------------------------------------- roles

create table if not exists public.store_roles (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  name text not null,
  description text not null default '',
  rank integer not null default 10,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  role_id uuid not null references public.store_roles(id) on delete restrict,
  is_owner boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, store_id)
);

create index if not exists store_memberships_user_idx on public.store_memberships(user_id, active);
create index if not exists store_memberships_store_idx on public.store_memberships(store_id, active);

create table if not exists public.business_group_members (
  id uuid primary key default gen_random_uuid(),
  business_group_id text not null references public.business_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_group_id, user_id)
);

create table if not exists public.store_access_requests (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null default 'Store Admin',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists store_access_pending_idx
  on public.store_access_requests(store_id, requester_id) where status = 'pending';

create table if not exists public.store_role_permissions (
  role_id uuid not null references public.store_roles(id) on delete cascade,
  doctype text not null references public.doctype_definitions(name) on delete cascade,
  perm_level smallint not null default 0 check (perm_level between 0 and 9),
  can_read boolean not null default false,
  can_write boolean not null default false,
  can_create boolean not null default false,
  can_delete boolean not null default false,
  can_submit boolean not null default false,
  can_cancel boolean not null default false,
  can_amend boolean not null default false,
  can_report boolean not null default false,
  can_export boolean not null default false,
  can_import boolean not null default false,
  can_set_user_permissions boolean not null default false,
  can_share boolean not null default false,
  can_print boolean not null default false,
  can_email boolean not null default false,
  primary key (role_id, doctype, perm_level)
);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  allow_doctype text not null references public.doctype_definitions(name) on delete cascade,
  allow_value text not null,
  apply_to_doctype text references public.doctype_definitions(name) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, user_id, allow_doctype, allow_value, apply_to_doctype)
);

-- --------------------------------------------------------- permission API

create or replace function public.is_system_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active = true and role = 'admin'
  );
$$;

create or replace function public.can_access_store(p_store_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1 from public.store_memberships m
    where m.user_id = (select auth.uid())
      and m.store_id = p_store_id
      and m.active = true
  );
$$;

create or replace function public.can_manage_store(p_store_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1
    from public.store_memberships m
    join public.store_roles r on r.id = m.role_id
    where m.user_id = (select auth.uid())
      and m.store_id = p_store_id
      and m.active = true
      and (m.is_owner = true or r.name = 'Store Admin' or r.rank >= 100)
  );
$$;

create or replace function public.can_access_business_group(p_group_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1 from public.business_group_members m
    where m.business_group_id = p_group_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_store_permission(
  p_store_id text,
  p_doctype text,
  p_action text,
  p_perm_level integer default 0
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if public.is_system_admin() then return true; end if;
  if not public.can_access_store(p_store_id) then return false; end if;

  execute format(
    'select exists (
       select 1
       from public.store_memberships m
       join public.store_role_permissions p on p.role_id = m.role_id
       where m.user_id = $1 and m.store_id = $2 and m.active = true
         and p.doctype = $3 and p.perm_level = $4 and p.can_%I = true
     )',
    p_action
  ) into v_allowed using (select auth.uid()), p_store_id, p_doctype, p_perm_level;
  return coalesce(v_allowed, false);
exception when undefined_column then
  return false;
end;
$$;

create or replace function public.has_user_store_permission(
  p_user_id uuid,
  p_store_id text,
  p_doctype text,
  p_value text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.user_permissions u
    where u.user_id = p_user_id and u.store_id = p_store_id
      and u.allow_doctype = p_doctype and u.is_active = true
  ) or exists (
    select 1 from public.user_permissions u
    where u.user_id = p_user_id and u.store_id = p_store_id
      and u.allow_doctype = p_doctype and u.allow_value = p_value
      and u.is_active = true
  );
$$;

create or replace function public.can_access_store(p_store_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (public.is_system_admin() or exists (
    select 1 from public.store_memberships m
    where m.user_id = (select auth.uid()) and m.store_id = p_store_id and m.active = true
  ))
  and public.has_user_store_permission((select auth.uid()), p_store_id, 'stores', p_store_id);
$$;

grant execute on function public.is_system_admin() to authenticated;
grant execute on function public.can_access_store(text) to authenticated;
grant execute on function public.can_manage_store(text) to authenticated;
grant execute on function public.can_access_business_group(text) to authenticated;
grant execute on function public.has_store_permission(text, text, text, integer) to authenticated;

create or replace function public.has_store_field_permission(
  p_store_id text,
  p_doctype text,
  p_fieldname text,
  p_action text default 'read'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_store_permission(
    p_store_id,
    p_doctype,
    p_action,
    coalesce((select f.perm_level from public.doctype_fields f where f.doctype = p_doctype and f.fieldname = p_fieldname), 0)::smallint
  );
$$;

grant execute on function public.has_store_field_permission(text, text, text, text) to authenticated;

-- Writes are checked again in the database.  UI hiding is only a convenience;
-- this trigger prevents a client from updating a restricted field directly.
create or replace function public.enforce_store_field_permissions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_store_id text;
  v_doctype text;
  v_field text;
begin
  if public.is_system_admin() then return new; end if;
  v_doctype := tg_table_name;
  if tg_table_name = 'stores' then
    v_store_id := new.id;
  elsif tg_op = 'INSERT' then
    v_store_id := new.store_id;
  else
    v_store_id := coalesce(new.store_id, old.store_id);
  end if;
  if tg_op = 'INSERT' and tg_table_name in ('orders', 'stock_entries', 'delivery_zones')
     and not public.has_store_permission(v_store_id, v_doctype, 'create', 0) then
    raise exception 'PERMISSION_DENIED:%:create', v_doctype using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not public.has_store_permission(v_store_id, v_doctype, 'write', 0) then
    raise exception 'PERMISSION_DENIED:%:write', v_doctype using errcode = '42501';
  end if;
  if tg_table_name <> 'stores' then
    if coalesce(new.store_id, '') <> coalesce(old.store_id, new.store_id, '') then
      raise exception 'FIELD_PERMISSION:%:%', tg_table_name, 'store_id' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'products' then
    if new.purchase_price is distinct from old.purchase_price then v_field := 'purchase_price';
    elsif new.stock is distinct from old.stock then v_field := 'stock';
    elsif new.margin is distinct from old.margin then v_field := 'margin'; end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'customers' then
    if new.phone is distinct from old.phone then v_field := 'phone';
    elsif new.whatsapp is distinct from old.whatsapp then v_field := 'whatsapp';
    elsif new.address is distinct from old.address then v_field := 'address'; end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'orders' then
    if new.notes is distinct from old.notes then v_field := 'notes';
    elsif new.discount is distinct from old.discount then v_field := 'discount';
    elsif new.delivery_fee is distinct from old.delivery_fee then v_field := 'delivery_fee'; end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'sales_reps' then
    if new.phone is distinct from old.phone then v_field := 'phone';
    elsif new.whatsapp is distinct from old.whatsapp then v_field := 'whatsapp';
    elsif new.commission is distinct from old.commission then v_field := 'commission';
    elsif new.note is distinct from old.note then v_field := 'note'; end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'stores' then
    if new.mobile_number is distinct from old.mobile_number then v_field := 'mobile_number'; end if;
  end if;

  if v_field is not null and not public.has_store_field_permission(v_store_id, v_doctype, v_field, 'write') then
    raise exception 'FIELD_PERMISSION:%:%', v_doctype, v_field using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_products_field_permissions on public.products;
create trigger enforce_products_field_permissions before update on public.products for each row execute function public.enforce_store_field_permissions();
drop trigger if exists enforce_customers_field_permissions on public.customers;
create trigger enforce_customers_field_permissions before update on public.customers for each row execute function public.enforce_store_field_permissions();
drop trigger if exists enforce_orders_field_permissions on public.orders;
create trigger enforce_orders_field_permissions before insert or update on public.orders for each row execute function public.enforce_store_field_permissions();
drop trigger if exists enforce_sales_reps_field_permissions on public.sales_reps;
create trigger enforce_sales_reps_field_permissions before update on public.sales_reps for each row execute function public.enforce_store_field_permissions();
drop trigger if exists enforce_stores_field_permissions on public.stores;
create trigger enforce_stores_field_permissions before update on public.stores for each row execute function public.enforce_store_field_permissions();
drop trigger if exists enforce_stock_entries_permissions on public.stock_entries;
create trigger enforce_stock_entries_permissions before insert or update on public.stock_entries for each row execute function public.enforce_store_field_permissions();
drop trigger if exists enforce_delivery_zones_permissions on public.delivery_zones;
create trigger enforce_delivery_zones_permissions before insert or update on public.delivery_zones for each row execute function public.enforce_store_field_permissions();

-- --------------------------------------------------------- store defaults

create or replace function public.seed_store_security(p_store_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin uuid;
  v_user uuid;
  v_doctype text;
begin
  insert into public.store_roles(store_id, name, description, rank, is_system)
  values (p_store_id, 'Store Admin', 'إدارة كاملة لهذا المتجر', 100, true)
  on conflict (store_id, name) do nothing;
  insert into public.store_roles(store_id, name, description, rank, is_system)
  values (p_store_id, 'Store User', 'صلاحيات تشغيلية أساسية', 10, true)
  on conflict (store_id, name) do nothing;

  select id into v_admin from public.store_roles where store_id = p_store_id and name = 'Store Admin';
  select id into v_user from public.store_roles where store_id = p_store_id and name = 'Store User';
  for v_doctype in select name from public.doctype_definitions where is_active loop
    insert into public.store_role_permissions(
      role_id, doctype, perm_level, can_read, can_write, can_create, can_delete,
      can_submit, can_cancel, can_amend, can_report, can_export, can_import,
      can_set_user_permissions, can_share, can_print, can_email
    ) values (v_admin, v_doctype, 0, true, true, true, true, true, true, true, true, true, true, true, true, true, true)
    on conflict (role_id, doctype, perm_level) do update set
      can_read = true, can_write = true, can_create = true, can_delete = true,
      can_submit = true, can_cancel = true, can_amend = true, can_report = true,
      can_export = true, can_import = true, can_set_user_permissions = true,
      can_share = true, can_print = true, can_email = true;
    insert into public.store_role_permissions(role_id, doctype, perm_level, can_read, can_write)
    select v_admin, f.doctype, f.perm_level, true, true
    from public.doctype_fields f
    where f.doctype = v_doctype and f.perm_level > 0
    group by f.doctype, f.perm_level
    on conflict (role_id, doctype, perm_level) do update set can_read = true, can_write = true;
    insert into public.store_role_permissions(role_id, doctype, perm_level, can_read, can_write, can_create, can_report, can_export)
    values (v_user, v_doctype, 0, true, true, true, true, true)
    on conflict (role_id, doctype, perm_level) do nothing;
  end loop;

  if (select auth.uid()) is not null and public.is_active_user() then
    insert into public.store_memberships(user_id, store_id, role_id, is_owner)
    values ((select auth.uid()), p_store_id, v_admin, true)
    on conflict (user_id, store_id) do update set is_owner = true, role_id = excluded.role_id, active = true;
    insert into public.business_group_members(business_group_id, user_id, is_owner)
    select s.business_group_id, (select auth.uid()), true from public.stores s where s.id = p_store_id
    on conflict (business_group_id, user_id) do update set is_owner = true;
  end if;
end;
$$;

create or replace function public.initialize_store_security()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_group text;
begin
  if new.business_group_id is null then
    insert into public.business_groups(name, created_by) values (new.name || ' — مجموعة', (select auth.uid())) returning id into v_group;
    update public.stores set business_group_id = v_group where id = new.id;
  end if;
  perform public.seed_store_security(new.id);
  return new;
end;
$$;

drop trigger if exists initialize_store_security on public.stores;
create trigger initialize_store_security
  after insert on public.stores
  for each row execute function public.initialize_store_security();

-- Preserve existing behavior for current users while the administrator assigns
-- tighter memberships. Future users receive access only through membership.
do $$
declare
  store_item record;
  user_item record;
  v_admin uuid;
begin
  for store_item in select id, business_group_id from public.stores loop
    perform public.seed_store_security(store_item.id);
    select id into v_admin from public.store_roles where store_id = store_item.id and name = 'Store Admin';
    for user_item in select id from public.profiles where active loop
      insert into public.store_memberships(user_id, store_id, role_id, is_owner)
      values (user_item.id, store_item.id, v_admin, user_item.id in (select id from public.profiles where role = 'admin'))
      on conflict (user_id, store_id) do nothing;
      insert into public.business_group_members(business_group_id, user_id, is_owner)
      values (store_item.business_group_id, user_item.id, user_item.id in (select id from public.profiles where role = 'admin'))
      on conflict (business_group_id, user_id) do nothing;
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------- linking API

create or replace function public.request_store_access(p_store_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_store public.stores;
  v_request uuid;
begin
  if not public.is_active_user() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into v_store from public.stores where upper(store_code) = upper(trim(p_store_code));
  if not found then raise exception 'NO_SUCH_STORE'; end if;
  if exists (select 1 from public.store_memberships where user_id = (select auth.uid()) and store_id = v_store.id and active) then
    raise exception 'ALREADY_MEMBER';
  end if;
  insert into public.store_access_requests(store_id, requester_id, requested_role)
  values (v_store.id, (select auth.uid()), 'Store Admin')
  on conflict (store_id, requester_id) where status = 'pending' do update set created_at = now()
  returning id into v_request;
  return v_request;
end;
$$;

create or replace function public.review_store_access(p_request_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.store_access_requests;
  v_store public.stores;
  v_role uuid;
  v_target_store text;
begin
  select * into v_request from public.store_access_requests where id = p_request_id and status = 'pending';
  if not found then raise exception 'NO_SUCH_REQUEST'; end if;
  select * into v_store from public.stores where id = v_request.store_id;
  if not public.is_system_admin() and not exists (
    select 1 from public.store_memberships m where m.store_id = v_store.id and m.user_id = (select auth.uid()) and m.is_owner and m.active
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  update public.store_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = v_request.id;
  if not p_approve then return; end if;

  insert into public.business_group_members(business_group_id, user_id)
  values (v_store.business_group_id, v_request.requester_id)
  on conflict (business_group_id, user_id) do nothing;

  for v_target_store in select id from public.stores where business_group_id = v_store.business_group_id loop
    select id into v_role from public.store_roles where store_id = v_target_store and name = v_request.requested_role;
    if v_role is null then
      select id into v_role from public.store_roles where store_id = v_target_store and name = 'Store User';
    end if;
    insert into public.store_memberships(user_id, store_id, role_id, is_owner)
    values (v_request.requester_id, v_target_store, v_role, false)
    on conflict (user_id, store_id) do update set role_id = excluded.role_id, active = true;
  end loop;
end;
$$;

grant execute on function public.request_store_access(text) to authenticated;
grant execute on function public.review_store_access(uuid, boolean) to authenticated;

-- ------------------------------------------------------------ matrix API

create or replace function public.store_permission_matrix(p_store_id text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.can_manage_store(p_store_id) then raise exception 'NOT_AUTHORIZED'; end if;
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(to_jsonb(r) order by r.rank desc, r.name) from public.store_roles r where r.store_id = p_store_id), '[]'::jsonb),
    'doctypes', coalesce((select jsonb_agg(to_jsonb(d) order by d.module, d.label) from public.doctype_definitions d where d.is_active), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(to_jsonb(p)) from public.store_role_permissions p join public.store_roles r on r.id = p.role_id where r.store_id = p_store_id), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.set_store_role_permission(
  p_store_id text,
  p_role_id uuid,
  p_doctype text,
  p_perm_level smallint,
  p_read boolean,
  p_write boolean,
  p_create boolean,
  p_delete boolean,
  p_submit boolean,
  p_cancel boolean,
  p_amend boolean,
  p_report boolean,
  p_export boolean,
  p_import boolean,
  p_set_user_permissions boolean,
  p_share boolean,
  p_print boolean,
  p_email boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_manage_store(p_store_id) then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from public.store_roles where id = p_role_id and store_id = p_store_id) then raise exception 'INVALID_ROLE'; end if;
  insert into public.store_role_permissions(
    role_id, doctype, perm_level, can_read, can_write, can_create, can_delete,
    can_submit, can_cancel, can_amend, can_report, can_export, can_import,
    can_set_user_permissions, can_share, can_print, can_email
  ) values (
    p_role_id, p_doctype, p_perm_level, p_read, p_write, p_create, p_delete,
    p_submit, p_cancel, p_amend, p_report, p_export, p_import,
    p_set_user_permissions, p_share, p_print, p_email
  ) on conflict (role_id, doctype, perm_level) do update set
    can_read = excluded.can_read, can_write = excluded.can_write, can_create = excluded.can_create,
    can_delete = excluded.can_delete, can_submit = excluded.can_submit, can_cancel = excluded.can_cancel,
    can_amend = excluded.can_amend, can_report = excluded.can_report, can_export = excluded.can_export,
    can_import = excluded.can_import, can_set_user_permissions = excluded.can_set_user_permissions,
    can_share = excluded.can_share, can_print = excluded.can_print, can_email = excluded.can_email;
end;
$$;

grant execute on function public.store_permission_matrix(text) to authenticated;

create or replace function public.store_users(p_store_id text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'display_name', coalesce(p.display_name, p.email),
    'email', p.email,
    'role_name', r.name,
    'is_owner', m.is_owner
  ) order by p.display_name, p.email), '[]'::jsonb)
  from public.store_memberships m
  join public.profiles p on p.id = m.user_id
  join public.store_roles r on r.id = m.role_id
  where m.store_id = p_store_id and m.active = true and public.can_manage_store(p_store_id);
$$;

create or replace function public.set_store_user_permission(
  p_store_id text,
  p_user_id uuid,
  p_allow_doctype text,
  p_allow_value text,
  p_apply_to_doctype text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_manage_store(p_store_id) then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from public.store_memberships where store_id = p_store_id and user_id = p_user_id and active) then raise exception 'INVALID_USER'; end if;
  if trim(coalesce(p_allow_value, '')) = '' then raise exception 'VALUE_REQUIRED'; end if;
  insert into public.user_permissions(store_id, user_id, allow_doctype, allow_value, apply_to_doctype, created_by)
  values (p_store_id, p_user_id, p_allow_doctype, trim(p_allow_value), p_apply_to_doctype, (select auth.uid()))
  on conflict (store_id, user_id, allow_doctype, allow_value, apply_to_doctype) do update set is_active = true;
end;
$$;

create or replace function public.remove_store_user_permission(p_store_id text, p_permission_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_manage_store(p_store_id) then raise exception 'NOT_AUTHORIZED'; end if;
  delete from public.user_permissions where id = p_permission_id and store_id = p_store_id;
end;
$$;

grant execute on function public.store_users(text) to authenticated;
grant execute on function public.set_store_user_permission(text, uuid, text, text, text) to authenticated;
grant execute on function public.remove_store_user_permission(text, uuid) to authenticated;
grant execute on function public.set_store_role_permission(text, uuid, text, smallint, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.my_store_network()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_id', s.id,
        'store_code', s.store_code,
        'store_name', s.name,
        'mobile_number', s.mobile_number,
        'business_group_id', s.business_group_id,
        'role_name', r.name,
        'is_owner', m.is_owner
      ) order by s.name)
      from public.store_memberships m
      join public.stores s on s.id = m.store_id
      join public.store_roles r on r.id = m.role_id
      where m.user_id = (select auth.uid()) and m.active
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'store_id', q.store_id,
        'store_code', s.store_code,
        'store_name', s.name,
        'requester_id', q.requester_id,
        'requester_name', coalesce(p.display_name, p.email),
        'requested_role', q.requested_role,
        'status', q.status,
        'can_review', public.can_manage_store(q.store_id),
        'created_at', q.created_at
      ) order by q.created_at desc)
      from public.store_access_requests q
      join public.stores s on s.id = q.store_id
      join public.profiles p on p.id = q.requester_id
      where q.status = 'pending'
        and (q.requester_id = (select auth.uid()) or public.can_manage_store(q.store_id))
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.my_store_network() to authenticated;

create or replace function public.business_group_zones(p_store_id text)
returns setof public.delivery_zones
language sql stable security invoker set search_path = ''
as $$
  select distinct on (z.code) z.*
  from public.stores s
  cross join lateral public.store_zones(s.id) z
  where s.business_group_id = (select business_group_id from public.stores where id = p_store_id)
    and public.can_access_store(s.id)
  order by z.code, (z.store_id = p_store_id) desc, (z.store_id is null) desc;
$$;

grant execute on function public.business_group_zones(text) to authenticated;

-- -------------------------------------------------------------- RLS

alter table public.business_groups enable row level security;
alter table public.doctype_definitions enable row level security;
alter table public.doctype_fields enable row level security;
alter table public.store_roles enable row level security;
alter table public.store_memberships enable row level security;
alter table public.business_group_members enable row level security;
alter table public.store_access_requests enable row level security;
alter table public.store_role_permissions enable row level security;
alter table public.user_permissions enable row level security;

drop policy if exists "Active users can access stores" on public.stores;
create policy "Store members can read stores" on public.stores for select to authenticated
  using (public.can_access_store(id));
create policy "Active users can create stores" on public.stores for insert to authenticated
  with check (public.is_active_user());
create policy "Store admins can update stores" on public.stores for update to authenticated
  using (public.can_manage_store(id)) with check (public.can_manage_store(id));
create policy "Store owners can delete stores" on public.stores for delete to authenticated
  using (public.is_system_admin() or exists (select 1 from public.store_memberships m where m.store_id = public.stores.id and m.user_id = (select auth.uid()) and m.is_owner));

drop policy if exists "Active users can access products" on public.products;
create policy "Store permission read products" on public.products for select to authenticated
  using (public.has_store_permission(store_id, 'products', 'read', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'products', id));
create policy "Store permission create products" on public.products for insert to authenticated
  with check (public.has_store_permission(store_id, 'products', 'create', 0));
create policy "Store permission update products" on public.products for update to authenticated
  using (public.has_store_permission(store_id, 'products', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'products', id)) with check (public.has_store_permission(store_id, 'products', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'products', id));
create policy "Store permission delete products" on public.products for delete to authenticated
  using (public.has_store_permission(store_id, 'products', 'delete', 0));

drop policy if exists "Active users can access customers" on public.customers;
create policy "Store permission read customers" on public.customers for select to authenticated
  using (public.has_store_permission(store_id, 'customers', 'read', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'customers', id));
create policy "Store permission create customers" on public.customers for insert to authenticated
  with check (public.has_store_permission(store_id, 'customers', 'create', 0));
create policy "Store permission update customers" on public.customers for update to authenticated
  using (public.has_store_permission(store_id, 'customers', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'customers', id)) with check (public.has_store_permission(store_id, 'customers', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'customers', id));
create policy "Store permission delete customers" on public.customers for delete to authenticated
  using (public.has_store_permission(store_id, 'customers', 'delete', 0));

drop policy if exists "Active users can access orders" on public.orders;
create policy "Store permission read orders" on public.orders for select to authenticated
  using (public.has_store_permission(store_id, 'orders', 'read', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'orders', id));
create policy "Store permission update orders" on public.orders for update to authenticated
  using (public.has_store_permission(store_id, 'orders', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'orders', id)) with check (public.has_store_permission(store_id, 'orders', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'orders', id));
create policy "Store permission delete orders" on public.orders for delete to authenticated
  using (public.has_store_permission(store_id, 'orders', 'delete', 0));

-- Supporting tables use the same store boundary.
drop policy if exists "Active users can access sales reps" on public.sales_reps;
create policy "Store permission read sales reps" on public.sales_reps for select to authenticated
  using (public.has_store_permission(store_id, 'sales_reps', 'read', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'sales_reps', id));
create policy "Store permission create sales reps" on public.sales_reps for insert to authenticated
  with check (public.has_store_permission(store_id, 'sales_reps', 'create', 0));
create policy "Store permission update sales reps" on public.sales_reps for update to authenticated
  using (public.has_store_permission(store_id, 'sales_reps', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'sales_reps', id)) with check (public.has_store_permission(store_id, 'sales_reps', 'write', 0) and public.has_user_store_permission((select auth.uid()), store_id, 'sales_reps', id));
create policy "Store permission delete sales reps" on public.sales_reps for delete to authenticated
  using (public.has_store_permission(store_id, 'sales_reps', 'delete', 0));

drop policy if exists "Active users can access categories" on public.categories;
create policy "Store permission read categories" on public.categories for select to authenticated
  using (public.has_store_permission(store_id, 'categories', 'read', 0));
create policy "Store permission write categories" on public.categories for all to authenticated
  using (public.has_store_permission(store_id, 'categories', 'write', 0))
  with check (public.has_store_permission(store_id, 'categories', 'write', 0));

drop policy if exists "Active users can read stock entries" on public.stock_entries;
create policy "Store permission read stock entries" on public.stock_entries for select to authenticated
  using (public.has_store_permission(store_id, 'stock_entries', 'read', 0));

-- Shared/default zone rows remain readable to active users; store-owned zone
-- writes still require the store's permission level.
drop policy if exists "Active users can access delivery zones" on public.delivery_zones;
create policy "Users can read shared zones" on public.delivery_zones for select to authenticated
  using (store_id is null and public.is_active_user());
create policy "Store users can read owned zones" on public.delivery_zones for select to authenticated
  using (store_id is not null and public.has_store_permission(store_id, 'delivery_zones', 'read', 0));
create policy "Store users can write zones" on public.delivery_zones for all to authenticated
  using (store_id is not null and public.has_store_permission(store_id, 'delivery_zones', 'write', 0))
  with check (store_id is not null and public.has_store_permission(store_id, 'delivery_zones', 'write', 0));

create policy "Members can read business groups" on public.business_groups for select to authenticated
  using (public.can_access_business_group(id));
create policy "Admins can manage doctypes" on public.doctype_definitions for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
create policy "Users can read doctypes" on public.doctype_definitions for select to authenticated
  using (public.is_active_user());
create policy "Admins can manage doctype fields" on public.doctype_fields for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
create policy "Users can read doctype fields" on public.doctype_fields for select to authenticated
  using (public.is_active_user());

create policy "Members can read store roles" on public.store_roles for select to authenticated
  using (public.can_access_store(store_id));
create policy "Store admins can manage store roles" on public.store_roles for all to authenticated
  using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));
create policy "Users can read own memberships" on public.store_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_store(store_id));
create policy "Members can read group members" on public.business_group_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_access_business_group(business_group_id));
create policy "Requesters and owners can read requests" on public.store_access_requests for select to authenticated
  using (requester_id = (select auth.uid()) or public.can_manage_store(store_id));
create policy "Users can request access" on public.store_access_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and public.is_active_user());
create policy "Members can read role permissions" on public.store_role_permissions for select to authenticated
  using (exists (select 1 from public.store_roles r where r.id = role_id and public.can_access_store(r.store_id)));
create policy "Store admins can manage role permissions" on public.store_role_permissions for all to authenticated
  using (exists (select 1 from public.store_roles r where r.id = role_id and public.can_manage_store(r.store_id)))
  with check (exists (select 1 from public.store_roles r where r.id = role_id and public.can_manage_store(r.store_id)));
create policy "Users can read own user permissions" on public.user_permissions for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_store(store_id));
create policy "Managers can manage user permissions" on public.user_permissions for all to authenticated
  using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));

grant select on public.business_groups, public.doctype_definitions, public.doctype_fields,
  public.store_roles, public.store_memberships, public.business_group_members,
  public.store_access_requests, public.store_role_permissions, public.user_permissions to authenticated;
grant insert, update, delete on public.doctype_definitions, public.doctype_fields to authenticated;
grant insert on public.store_access_requests to authenticated;

-- Permission-bearing rows are changed only through the checked RPCs above;
-- direct PostgREST writes would make it possible to bypass role hierarchy and
-- target-user validation.
revoke insert, update, delete on public.store_roles, public.store_role_permissions, public.user_permissions from authenticated;

-- Keep the audit trail useful for permission changes and store linking.
alter table public.store_roles replica identity full;
alter table public.store_role_permissions replica identity full;
alter table public.user_permissions replica identity full;
