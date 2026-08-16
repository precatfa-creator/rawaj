-- Naming series become a store's own setting.
--
-- The counters were already per store — two stores each start their orders at
-- 1. The patterns were not: one row per doctype decided the shape of every
-- store's numbers, so a store could not use `TRP-.####` while another used
-- `ORD-.YYYY.-.####`.
--
-- Same key shape as `naming_counters`: `store_key`, not null, where '' means
-- "every store". A nullable key column would let the same doctype in twice for
-- the same store and leave no rule for which row wins.
--
-- The '' rows stay and keep working as the default a new store inherits. A
-- store that never opens the screen behaves exactly as it does today.

alter table public.document_naming
  add column if not exists store_key text not null default '';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_naming'::regclass and conname = 'document_naming_pkey'
      and array_length(conkey, 1) = 1
  ) then
    alter table public.document_naming drop constraint document_naming_pkey;
    alter table public.document_naming add primary key (doctype, store_key);
  end if;
end;
$$;

create index if not exists document_naming_store_idx on public.document_naming (store_key);

/**
 * The naming config a store actually uses.
 *
 * Its own row for a doctype wins; otherwise the shared default. Same rule as
 * `store_zones`, and the same reason for putting it in Postgres:
 * `next_document_name` resolves it too, and two readers disagreeing about which
 * series is in force would mean documents numbered by a pattern the settings
 * screen never showed.
 */
create or replace function public.store_document_naming(p_store_id text default null)
returns setof public.document_naming
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (n.doctype) n.*
  from public.document_naming n
  where n.store_key in (coalesce(p_store_id, ''), '')
  order by n.doctype, (n.store_key <> '') desc;
$$;

grant execute on function public.store_document_naming(text) to authenticated;

-- --------------------------------------------------------- issuing a name
--
-- Rebuilt on 20260814200000's body. The only change is the config lookup: the
-- store's own row is preferred, and the shared default is the fallback that
-- keeps every existing store numbering as it did before this migration.
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

  select * into v_config
  from public.document_naming
  where doctype = p_doctype
    and store_key in (coalesce(p_store_id, ''), '')
  order by (store_key <> '') desc
  limit 1;

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
