-- Append-only audit log, written by database triggers.
--
-- Triggers rather than app-level logging: this captures changes made through the
-- dashboard, psql, the Management API and Edge Functions too, and a new code path
-- cannot forget to log.
--
-- SCOPE: table writes only. Supabase Auth events (sign-in, password reset) and
-- Storage object changes happen outside these tables and are NOT captured here.

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  /** Null when the write did not come from a signed-in user (service role, SQL). */
  actor_id uuid,
  /** Distinguishes "service_role" / "postgres" from a genuinely unknown actor. */
  actor_role text not null default '',
  /** Same value for every row written by one transaction, so a multi-table
      operation (order insert + stock decrements) can be reassembled. */
  txid bigint not null,
  changed_at timestamptz not null default now(),
  changed_fields text[] not null default '{}',
  /** INSERT: the new row. DELETE: the removed row. UPDATE: {field: {from, to}}. */
  data jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_changed_at_idx on public.audit_log (changed_at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, changed_at desc);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, changed_at desc);
create index if not exists audit_log_txid_idx on public.audit_log (txid);

alter table public.audit_log enable row level security;

-- Read-only, admins only. There is deliberately no INSERT/UPDATE/DELETE policy:
-- the trigger is SECURITY DEFINER and bypasses RLS, so nothing else can write.
drop policy if exists "Admins can read the audit log" on public.audit_log;
create policy "Admins can read the audit log"
  on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- Belt and braces: even without policies, make the grants explicit. A client that
-- could INSERT here could forge history; one that could DELETE could erase it.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

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
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_role, txid, changed_fields, data)
    values (TG_TABLE_NAME, coalesce(v_new ->> 'id', ''), 'INSERT',
            auth.uid(), coalesce(nullif(auth.role(), ''), current_user), txid_current(),
            array(select jsonb_object_keys(v_new)), v_new);
    return NEW;

  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD) - v_excluded;
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_role, txid, changed_fields, data)
    values (TG_TABLE_NAME, coalesce(v_old ->> 'id', ''), 'DELETE',
            auth.uid(), coalesce(nullif(auth.role(), ''), current_user), txid_current(),
            array(select jsonb_object_keys(v_old)), v_old);
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

    insert into public.audit_log (table_name, record_id, action, actor_id, actor_role, txid, changed_fields, data)
    values (TG_TABLE_NAME, coalesce(v_new ->> 'id', ''), 'UPDATE',
            auth.uid(), coalesce(nullif(auth.role(), ''), current_user), txid_current(),
            v_fields, v_diff);
    return NEW;
  end if;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['stores', 'products', 'customers', 'orders', 'delivery_zones', 'profiles'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function public.audit_trigger()', t);
  end loop;
end;
$$;
