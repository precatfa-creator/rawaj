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

## What belongs to a store

Products, orders, stock movements, customers, sales representatives and categories all belong to exactly one store. The same person shopping at two stores is two customer records; the same category name in two stores is two rows. Nothing is shared, and switching store reloads all of it.

Delivery zones are the exception. The 22 Libyan zones are a shared catalogue every store starts from. The first time a store changes one — its fee, its commission, whether it is active — that store gets its own copy, and the shared default keeps serving every other store. A store can also add zones of its own. Deleting a shared zone from inside a store is not possible; it is switched off for that store only.

Every active user still sees every store. Per-user store membership is not implemented yet.

## Document naming

Each doctype — orders, customers, items, sales representatives, zones — declares the naming series it may use and which one is the default, in **تسمية المستندات** on the portal (administrators only). A series is a pattern:

```
ORD-.YYYY.-.####   ->  ORD-2026-0001
CUS-.####          ->  CUS-0001
```

`.YYYY.` `.YY.` `.MM.` `.DD.` are replaced when the document is created, and the run of `#` is the counter — its length is the zero-padding. Counters are per store, so **every store numbers its own orders from 1**: two stores can each hold their own `ORD-2026-0001`, and `orders.order_number` is unique per store rather than globally.

The same screen lists each counter and lets an administrator set it, for a business that already issued numbers before this app.

Orders created before this existed keep their old `ORD-1002`-style numbers; the new series has a different prefix, so the two never collide. An item saved with a blank SKU takes one from the item series; a typed SKU is kept as typed.

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
