-- A third role: the delivery rep.
--
-- `agent` is added to the allowed set only. It grants nothing on its own —
-- every policy that gates on a role tests for 'admin', so an agent has exactly
-- the reach 'user' has until a policy says otherwise. That is deliberate: a new
-- role should start with the least privilege, not inherit whatever it resembles.
--
-- Stored values are untouched. The Arabic wording lives in the app
-- (`roleLabels`), so renaming a role is never a data migration.
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin', 'user', 'agent']));
