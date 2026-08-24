-- Self-service profile edits from the account page.
--
-- Until now profiles was read-only for clients: only the admin-users Edge
-- Function (service role) could write. Renaming yourself needs a write path,
-- and the column-level grant below is what keeps it narrow — an UPDATE that
-- touches email, role or active is refused by the grant manager before row
-- security even runs, so nobody can escalate their own role by renaming.
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant update (display_name) on public.profiles to authenticated;
