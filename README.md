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

Products, orders, stock movements and categories belong to exactly one store. Customers and sales representatives remain attributed to the store that created their record for reporting, but stores linked into the same business group can work with the whole group roster. A customer who appears in two stores is still kept as two store-attributed records until a later merge workflow is introduced.

Delivery zones are the exception. They are a shared catalogue of **407 real Libyan neighbourhoods** every store starts from, each one carrying the four levels the business works in — المدينة الكبرى ← النطاق الجغرافي ← المنطقة ← البلدية. The first time a store changes one — its fee, its commission, whether it is active — that store gets its own copy. Linked stores can work with the effective zone list across their business group, while store-specific overrides remain attributed to their store.

The three levels around an area are records, not typed strings — `cities`, `zone_scopes` and `municipalities`, each registered as a doctype and linked from the zone with a `Link` field. The zone still carries the names as plain text, kept in step by a database trigger, so lists, filters, the tree and the export read one flat row without a join; renaming a city rewrites every copy. A scope belongs to exactly one city and the picker offers only that city's scopes. Anything genuinely missing can be created straight from the picker or named in an imported sheet, so a link never blocks the work.

A zone used to mean one of the 22 shabiyat, which is a province and not somewhere anyone delivers to. The table kept its name; only what a row means changed, so orders, commissions, rep coverage and the importer were untouched. The zones screen offers a tree (city → scope → area) and a card grid, filtered by city, scope, municipality, region and state. Fees all start at zero — there is no public source for Libyan delivery prices, so export the sheet, price it, and import it back. Coverage gaps and how the data was built are in [`docs/libya-areas.md`](docs/libya-areas.md).

Every active user still sees every store. Per-user store membership is not implemented yet.

## Document naming

Each doctype — orders, customers, items, sales representatives — declares the naming series it may use and which one is the default, in **تسمية المستندات** inside a store (administrators only). The settings belong to that store: until a store saves its own, it runs on the shared default every store starts from, and one store's patterns never reach another's. A series is a pattern:

```
ORD-.YYYY.-.####   ->  ORD-2026-0001
CUS-.####          ->  CUS-0001
```

`.YYYY.` `.YY.` `.MM.` `.DD.` are replaced when the document is created, and the run of `#` is the counter — its length is the zero-padding. Counters are per store, so **every store numbers its own orders from 1**: two stores can each hold their own `ORD-2026-0001`, and `orders.order_number` is unique per store rather than globally.

The same screen lists each counter and lets an administrator set it, for a business that already issued numbers before this app.

Orders created before this existed keep their old `ORD-1002`-style numbers; the new series has a different prefix, so the two never collide. An item saved with a blank SKU takes one from the item series; a typed SKU is kept as typed.

## The audit trail

Every insert, update and delete on the business tables is recorded by a database trigger, with the signed-in user who made it. Administrators read it in two places, and they do not overlap:

- **سجل التدقيق** inside a store — everything that happened to that store's products, orders, customers, representatives, categories, zones and stock.
- **سجل النظام** on the portal — the changes no store owns: user accounts, and records deleted since they were edited.

Rows written by `supabase db push` are attributed to **ترحيل قاعدة البيانات** rather than to a person, because a migration runs with no signed-in user. Sign-ins, password resets and image uploads happen outside these tables and are not recorded.

## Administrator data assistant

Administrators see an **اسأل البيانات** widget on the portal and inside each store. The AI runs through [Puter.js](https://docs.puter.com/AI/chat/), so there is no developer API key. On first use, Puter opens its sign-in window; under Puter's [user-pays model](https://docs.puter.com/user-pays-model/), each administrator's Puter account covers that administrator's AI usage.

The assistant becomes operational after `supabase db push` applies `20260812000000_admin_database_chat.sql`. The migration exposes a read-only `admin_chat_data` RPC that:

- re-checks `public.is_admin()` in Postgres on every call;
- accepts only nine predefined aggregate reports, not SQL;
- caps ranked results at 20 rows and monthly history at 12 months;
- excludes phone numbers, WhatsApp numbers, addresses, order notes, and credentials;
- cannot insert, update, or delete records.

The default model is `openai/gpt-5.4-nano`. To select another Puter model without changing code, set `VITE_PUTER_MODEL` before building the frontend.

## Stores, DocTypes, and permissions

The access-control migration adds a Frappe-inspired foundation:

- DocType definitions and fields are global while the builder is under development, and each field carries a `perm_level` from 0 to 9.
- Roles, role membership, Role Permission Manager rows, and User Permissions belong to one store. The same user can have a different role in every store.
- Every store receives an immutable system-generated Store ID (`ST-...`) and a configurable mobile number.
- A store owner can approve a Store ID linking request. Approved stores share a business group, which is the boundary for future shared customers, zones, and representatives while orders, products, stock, and finances remain store-specific.
- The database rechecks store permissions with security-definer functions and RLS. The client UI is not treated as a security boundary.

The **منشئ DocType** is available to system administrators from the portal. **صلاحيات المتجر** contains the store-specific Role Permission Manager and User Permissions editor. The **شبكة المتاجر** screen handles Store ID requests and owner approval.

## Security

- `VITE_SUPABASE_ANON_KEY` is intended for the browser and is restricted by Row Level Security.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is only used by the bootstrap script and Supabase's server-side Edge Function environment.
- Do not expose the service-role key or administrator password through a `VITE_` variable.
- Business report results and the administrator's prompts are sent to Puter and the selected AI provider to produce answers. Do not use the assistant for secrets or data outside its predefined reports.
