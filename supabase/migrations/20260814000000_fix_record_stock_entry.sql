-- Manual stock movements have never worked.
--
-- The INSERT in 20260811's record_stock_entry names seven columns and supplies
-- six values — `store_id` is selected into v_store_id and then never used:
--
--   insert into public.stock_entries (id, product_id, store_id, kind, quantity, balance, note)
--   values (p_id, p_product_id, p_kind, p_quantity, v_balance, coalesce(p_note, ''));
--
-- Postgres plans a plpgsql statement on first execution, so this is not a
-- creation-time error: every call raises "INSERT has more target columns than
-- expressions" at runtime, the client turns that into
-- 'تعذر تسجيل حركة المخزون.', and no purchase, damage or stocktake was ever
-- recorded. Orders were unaffected — create_order_with_stock writes its own
-- ledger rows and lists them correctly.
--
-- A new migration rather than an edit to 20260811: `supabase db push` only runs
-- files it has not applied, so correcting the old one would change nothing in a
-- database that already ran it.

create or replace function public.record_stock_entry(
  p_id text,
  p_product_id text,
  p_kind text,
  p_quantity integer,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id text;
  v_balance integer;
begin
  if not (select public.is_active_user()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_quantity = 0 then
    raise exception 'ZERO_QUANTITY';
  end if;

  select store_id, stock into v_store_id, v_balance
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'NO_SUCH_PRODUCT';
  end if;

  v_balance := v_balance + p_quantity;

  if v_balance < 0 then
    raise exception 'INSUFFICIENT_STOCK';
  end if;

  update public.products
  set stock = v_balance,
      status = case
        when v_balance <= 0 then 'out_of_stock'
        when status = 'out_of_stock' then 'active'
        else status
      end
  where id = p_product_id;

  insert into public.stock_entries (id, product_id, store_id, kind, quantity, balance, note)
  values (p_id, p_product_id, v_store_id, p_kind, p_quantity, v_balance, coalesce(p_note, ''));
end;
$$;

grant execute on function public.record_stock_entry(text, text, text, integer, text) to authenticated;
