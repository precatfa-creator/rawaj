-- The audit log learns which store a change belongs to.
--
-- Until now the log was one flat list: reading it meant scrolling past every
-- other store's work. The store is now a column, so the trail can be read from
-- inside the store it describes.
--
-- Deliberately NOT a foreign key. `on delete cascade` would let deleting a store
-- erase its history, and `on delete set null` would quietly detach it — either
-- one turns an append-only record into something a delete can rewrite. The
-- column holds the id the row had at the time, and keeps holding it.

alter table public.audit_log add column if not exists store_id text;

create index if not exists audit_log_store_idx on public.audit_log (store_id, changed_at desc);

/**
 * Which store a logged row belongs to, from the row itself.
 *
 * Table-shape rather than a table list, so a table audited later is covered
 * without touching this:
 *   - anything carrying `store_id` answers directly;
 *   - `stores` is its own store;
 *   - `store_key` is the naming tables' spelling, where '' means every store;
 *   - anything else — profiles — is not a store's business and stays null.
 */
create or replace function public.audit_store_of(p_table text, p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row ? 'store_id' then p_row ->> 'store_id'
    when p_table = 'stores' then p_row ->> 'id'
    when p_row ? 'store_key' then nullif(p_row ->> 'store_key', '')
  end;
$$;

-- The store comes from the whole row, never from `data`: on an UPDATE `data` is
-- a diff of changed fields, and store_id is only in it when the record moved
-- store — which is exactly when reading it from the diff would be wrong.
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Generated column: a name edit would otherwise show up as two changed fields,
  -- one of them derived noise.
  v_excluded text[] := array['search_text'];
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb;
  v_fields text[];
begin
  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW) - v_excluded;
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_role, txid, changed_fields, data, store_id)
    values (TG_TABLE_NAME, coalesce(v_new ->> 'id', ''), 'INSERT',
            auth.uid(), coalesce(nullif(auth.role(), ''), current_user), txid_current(),
            array(select jsonb_object_keys(v_new)), v_new,
            public.audit_store_of(TG_TABLE_NAME, v_new));
    return NEW;

  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD) - v_excluded;
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_role, txid, changed_fields, data, store_id)
    values (TG_TABLE_NAME, coalesce(v_old ->> 'id', ''), 'DELETE',
            auth.uid(), coalesce(nullif(auth.role(), ''), current_user), txid_current(),
            array(select jsonb_object_keys(v_old)), v_old,
            public.audit_store_of(TG_TABLE_NAME, v_old));
    return OLD;

  else
    v_old := to_jsonb(OLD) - v_excluded;
    v_new := to_jsonb(NEW) - v_excluded;

    select coalesce(jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)), '{}'::jsonb),
           coalesce(array_agg(key), '{}')
      into v_diff, v_fields
    from jsonb_each(v_new)
    where v_old -> key is distinct from value;

    -- `update ... set x = x` fires the trigger; logging it would be noise.
    if v_diff = '{}'::jsonb then
      return NEW;
    end if;

    -- The row after the edit: a record moved between stores is filed under
    -- where it ended up, which is where someone will go looking for it.
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_role, txid, changed_fields, data, store_id)
    values (TG_TABLE_NAME, coalesce(v_new ->> 'id', ''), 'UPDATE',
            auth.uid(), coalesce(nullif(auth.role(), ''), current_user), txid_current(),
            v_fields, v_diff,
            public.audit_store_of(TG_TABLE_NAME, v_new));
    return NEW;
  end if;
end;
$$;

-- ----------------------------------------------------------------- backfill
--
-- INSERT and DELETE kept the whole row in `data`, so they answer for themselves.
do $$
begin
  update public.audit_log
  set store_id = public.audit_store_of(table_name, data)
  where store_id is null and action in ('INSERT', 'DELETE');
end;
$$;

-- UPDATE rows kept only a diff, so their store has to come from the live record.
-- A record deleted since its edit was logged has nowhere to read it from and
-- keeps a null store: the row stays in the log, and shows in the portal's
-- full view rather than in a store's.
do $$
declare
  t text;
begin
  foreach t in array array['products', 'orders', 'customers', 'sales_reps', 'categories', 'delivery_zones', 'stock_entries'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'store_id'
    ) then
      execute format(
        'update public.audit_log a set store_id = t.store_id
           from public.%I t
          where a.store_id is null and a.action = ''UPDATE''
            and a.table_name = %L and t.id::text = a.record_id',
        t, t);
    end if;
  end loop;

  -- A store's own edits are filed under itself.
  update public.audit_log
  set store_id = record_id
  where store_id is null and action = 'UPDATE' and table_name = 'stores' and record_id <> '';
end;
$$;
