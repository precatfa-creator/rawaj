# Rawaj

React/Vite commerce dashboard backed by Supabase Postgres, Auth, Realtime, and an admin-only Edge Function.

## Supabase setup

Prerequisites: Node.js, a Supabase project, and the Supabase CLI.

1. Copy `.env.example` to `.env.local`. If you have a Supabase access token and project reference, the API keys can be populated without copying them manually:

   ```bash
   npm run supabase:configure
   ```

2. Link the repository and apply the schema:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Deploy the protected function used by the admin panel:

   ```bash
   supabase functions deploy admin-users
   ```

4. Create or update the initial administrator. Keep the password in your shell/environment and never commit it:

   ```bash
   npm run bootstrap:admin
   ```

   The default admin email is `precatfa@gmail.com`; override it with `ADMIN_EMAIL` if needed.

5. Install and start the app:

   ```bash
   npm install
   npm run dev
   ```

The SQL migrations create the schema, RLS policies, and Realtime publication. No commerce records are seeded — stores, products, customers, and orders are created through the app. New users can only be created by an active administrator through **إدارة المستخدمين**. Directly registered Auth users remain inactive and cannot read application data.

If you applied an earlier version of the schema, `20260802000000_remove_demo_data.sql` deletes the demo records it seeded. It only removes rows that nothing of yours references, so it is safe to run on a database you have already been using.

## Security

- `VITE_SUPABASE_ANON_KEY` is intended for the browser and is restricted by Row Level Security.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is only used by the bootstrap script and Supabase's server-side Edge Function environment.
- Do not expose the service-role key or administrator password through a `VITE_` variable.
