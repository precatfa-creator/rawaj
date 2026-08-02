-- Removes the demo commerce records seeded by the initial migration.
--
-- Scoped to the exact seeded ids, in dependency order, and each store delete is
-- guarded so it only fires when nothing outside the seed still points at it.
-- That matters because products.store_id cascades: deleting a seeded store would
-- silently take real products with it.

delete from public.orders where id in ('o1', 'o2');

delete from public.products where id in ('p1', 'p2');

delete from public.customers c
where c.id in ('c1', 'c2')
  and not exists (select 1 from public.orders o where o.customer_id = c.id);

delete from public.stores s
where s.id in ('s1', 's2', 's3')
  and not exists (select 1 from public.products p where p.store_id = s.id)
  and not exists (select 1 from public.orders o where o.store_id = s.id);
