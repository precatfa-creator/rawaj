-- Why an order stopped.
--
-- Cancelling or returning an order is the one status change that destroys
-- information: the row afterwards says the trip ended but not why, and the
-- audit log records only that `status` changed. The reason is asked for at the
-- moment of the change and kept beside it, so the log carries both.
alter table public.orders
  add column if not exists status_reason text not null default '';

comment on column public.orders.status_reason is
  'Why the order was canceled or returned, in the operator''s words. Empty for every other status.';
