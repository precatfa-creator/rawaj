-- Two endings and a pause the status list did not have.
--
-- `waiting` is a hold on a trip still in progress: the order sits where it was,
-- and the money is still expected. `delivered_partial` is a delivery that
-- handed over some of the lines; what it earned is read per line from the
-- items array rather than from the order total, so no column is added here —
-- `items[].deliveredQuantity` carries it inside the jsonb the order already has.
--
-- Existing rows keep their values: `delivered` still means a full delivery, so
-- nothing is rewritten.
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders add constraint orders_status_check
  check (status = any (array[
    'new', 'confirmed', 'processing', 'shipped', 'waiting',
    'delivered', 'delivered_partial', 'canceled', 'returned'
  ]));
