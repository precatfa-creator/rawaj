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

## Administrator data assistant

Administrators see an **اسأل البيانات** widget on the portal and inside each store. The AI runs through [Puter.js](https://docs.puter.com/AI/chat/), so there is no developer API key. On first use, Puter opens its sign-in window; under Puter's [user-pays model](https://docs.puter.com/user-pays-model/), each administrator's Puter account covers that administrator's AI usage.

The assistant becomes operational after `supabase db push` applies `20260812000000_admin_database_chat.sql`. The migration exposes a read-only `admin_chat_data` RPC that:

- re-checks `public.is_admin()` in Postgres on every call;
- accepts only nine predefined aggregate reports, not SQL;
- caps ranked results at 20 rows and monthly history at 12 months;
- excludes phone numbers, WhatsApp numbers, addresses, order notes, and credentials;
- cannot insert, update, or delete records.

The default model is `openai/gpt-5.4-nano`. To select another Puter model without changing code, set `VITE_PUTER_MODEL` before building the frontend.

## Security

- `VITE_SUPABASE_ANON_KEY` is intended for the browser and is restricted by Row Level Security.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is only used by the bootstrap script and Supabase's server-side Edge Function environment.
- Do not expose the service-role key or administrator password through a `VITE_` variable.
- Business report results and the administrator's prompts are sent to Puter and the selected AI provider to produce answers. Do not use the assistant for secrets or data outside its predefined reports.
