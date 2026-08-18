-- Per-user preferences.
--
-- Keyed rather than columned: a preference is a small, private, frequently
-- changed thing, and adding a migration every time someone wants to remember a
-- toggle is how a settings table stops getting used. The value is jsonb so a
-- key can hold a string today and an object later without a schema change.
--
-- Private by construction: the policies compare `user_id` to `auth.uid()`, so
-- there is no "read everyone's settings" path at all — not even for an
-- administrator. Nothing here is business data anybody needs to audit.
--
-- Two triggers other tables get are deliberately absent:
--   * `audit_trigger` — a sidebar group toggled a dozen times a day would put a
--     dozen rows into a log that answers "who changed what" about the business.
--     Preferences are noise there.
--   * `enforce_store_field_permissions` — it resolves `new.store_id`, and this
--     table has none. Attaching it would raise on every write.
--
-- Left out of the realtime publication on purpose: syncing a preference between
-- two open tabs is not worth a subscription.

create table if not exists public.user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  /** Dotted namespace, e.g. `sidebar.groups`. */
  key text not null,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_settings enable row level security;

do $$
declare
  verb text;
begin
  foreach verb in array array['select', 'insert', 'update', 'delete'] loop
    execute format('drop policy if exists "Users %1$s their own settings" on public.user_settings', verb);
  end loop;
end;
$$;

create policy "Users select their own settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users insert their own settings"
  on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users update their own settings"
  on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users delete their own settings"
  on public.user_settings for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_settings from anon, authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

-- Touched on every write, so a preference carries when it last changed without
-- the client having to remember to send it.
create or replace function public.touch_user_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch
  before update on public.user_settings
  for each row execute function public.touch_user_setting();

insert into public.doctype_definitions (name, label, module, is_system, is_active)
values ('user_settings', 'تفضيلات المستخدم', 'Setup', true, true)
on conflict (name) do nothing;
