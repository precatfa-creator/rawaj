import { supabase } from '../db/supabase';
import type { Customer, DeliveryZone, OrderItem, OrderStatus, Product, StockKind, Store } from '../types';
import { orderTotals } from './orderMath';
import { deleteProductImages } from './storage';
import { trimRow } from './text';

export { orderTotals, nextOrderNumber } from './orderMath';

/**
 * Every write returns an Arabic message on failure instead of throwing, so callers
 * can put it on screen. Realtime refetches the affected table on success, so
 * nothing here updates local state optimistically.
 */
// One shape rather than a discriminated union: this project compiles without
// `strict`, so narrowing on a boolean discriminant is not dependable.
export interface WriteResult {
  ok: boolean;
  message?: string;
}

const ok: WriteResult = { ok: true };
const fail = (message: string): WriteResult => ({ ok: false, message });

const run = async (action: PromiseLike<{ error: unknown }>, message: string): Promise<WriteResult> => {
  const { error } = await action;
  if (!error) return ok;
  console.error(message, error);
  return fail(message);
};

export const newId = () => crypto.randomUUID();

// ---- stores ----

export type StoreDraft = Pick<Store, 'id' | 'name' | 'image' | 'facebookPage'>;

const storeRow = (draft: StoreDraft) => trimRow({
  name: draft.name,
  image: draft.image,
  facebook_page: draft.facebookPage,
});

export const saveStore = (draft: StoreDraft, isNew: boolean) =>
  run(
    isNew
      ? supabase.from('stores').insert({ id: draft.id, ...storeRow(draft) })
      : supabase.from('stores').update(storeRow(draft)).eq('id', draft.id),
    isNew ? 'تعذر إنشاء المتجر.' : 'تعذر حفظ تعديلات المتجر.',
  );

export const deleteStore = (id: string) =>
  run(
    supabase.from('stores').delete().eq('id', id),
    'تعذر حذف المتجر. تأكد من عدم وجود طلبات مرتبطة به.',
  );

// ---- products ----

export type ProductDraft = Pick<
  Product,
  'id' | 'storeId' | 'name' | 'description' | 'sku' | 'defaultSerial' | 'category'
  | 'purchasePrice' | 'sellingPrice' | 'stock' | 'minStock' | 'status'
> & { images: string[] };

const productRow = (draft: ProductDraft) => trimRow({
  store_id: draft.storeId,
  name: draft.name,
  description: draft.description,
  images: draft.images,
  purchase_price: draft.purchasePrice,
  selling_price: draft.sellingPrice,
  margin: draft.sellingPrice - draft.purchasePrice,
  sku: draft.sku,
  default_serial: draft.defaultSerial,
  category: draft.category,
  min_stock: draft.minStock,
  status: draft.status,
});

/**
 * `stock` is written once, at creation, and never by an update.
 *
 * This is the choke point that enforces it: the form, the importer and anything
 * added later all route through here, so none of them can quietly reset a
 * quantity that inventory transactions now own. Post-creation changes go through
 * `adjustStock`.
 */
export const saveProduct = (draft: ProductDraft, isNew: boolean) =>
  run(
    isNew
      ? supabase.from('products').insert({ id: draft.id, stock: draft.stock, ...productRow(draft) })
      : supabase.from('products').update(productRow(draft)).eq('id', draft.id),
    isNew ? 'تعذر إضافة المنتج.' : 'تعذر حفظ تعديلات المنتج.',
  );

export const deleteProduct = async (id: string, images: string[] = []): Promise<WriteResult> => {
  const result = await run(supabase.from('products').delete().eq('id', id), 'تعذر حذف المنتج.');
  // Only reap the blobs once the row is gone, so a failed delete leaves the
  // product intact and still showing its images.
  if (result.ok) await deleteProductImages(images);
  return result;
};

/**
 * The only way stock moves after an item is created.
 *
 * `quantity` is a signed delta so two movements recorded at once add up instead
 * of one overwriting the other. The kind is what the operator did; the sign is
 * derived from it by the caller.
 */
export const adjustStock = async (
  entry: { productId: string; kind: StockKind; quantity: number; note: string },
): Promise<WriteResult> => {
  const { error } = await supabase.rpc('record_stock_entry', {
    p_id: newId(),
    p_product_id: entry.productId,
    p_kind: entry.kind,
    p_quantity: entry.quantity,
    p_note: entry.note.trim(),
  });

  if (!error) return ok;
  console.error('adjustStock failed', error);

  const raw = `${error.message ?? ''}`;
  if (raw.includes('INSUFFICIENT_STOCK')) return fail('الكمية المطلوب خصمها تتجاوز المخزون المتاح.');
  if (raw.includes('ZERO_QUANTITY')) return fail('أدخل كمية أكبر من صفر.');
  if (raw.includes('NO_SUCH_PRODUCT')) return fail('المنتج لم يعد موجوداً.');
  return fail('تعذر تسجيل حركة المخزون.');
};

// ---- customers ----

export type CustomerDraft = Pick<
  Customer,
  'id' | 'name' | 'phone' | 'whatsapp' | 'city' | 'address' | 'status'
>;

// `rating` is deliberately absent: it is not collected at creation time and an
// update must not reset a rating the customer earned later.
const customerRow = (draft: CustomerDraft) => trimRow({
  name: draft.name,
  phone: draft.phone,
  whatsapp: draft.whatsapp,
  city: draft.city,
  address: draft.address,
  status: draft.status,
});

export const saveCustomer = (draft: CustomerDraft, isNew: boolean) =>
  run(
    isNew
      ? supabase.from('customers').insert({ id: draft.id, ...customerRow(draft) })
      : supabase.from('customers').update(customerRow(draft)).eq('id', draft.id),
    isNew ? 'تعذر إضافة العميل.' : 'تعذر حفظ تعديلات العميل.',
  );

export const deleteCustomer = (id: string) =>
  run(
    supabase.from('customers').delete().eq('id', id),
    'تعذر حذف العميل. تأكد من عدم وجود طلبات مرتبطة به.',
  );

// ---- orders ----

export interface OrderDraft {
  id: string;
  orderNumber: string;
  storeId: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  discount: number;
  deliveryFee: number;
  notes: string;
}

/**
 * Insert + stock decrement happen inside one Postgres function, so a concurrent
 * order cannot read the same stock and a failure never leaves an order whose
 * inventory was not adjusted. Totals are recomputed server-side from the items.
 */
export const createOrder = async (draft: OrderDraft): Promise<WriteResult> => {
  const { error } = await supabase.rpc('create_order_with_stock', {
    p_id: draft.id,
    p_order_number: draft.orderNumber,
    p_store_id: draft.storeId,
    p_customer_id: draft.customerId,
    p_customer_name: draft.customerName.trim(),
    p_items: draft.items.map(item => trimRow(item as unknown as Record<string, unknown>)),
    p_discount: draft.discount,
    p_delivery_fee: draft.deliveryFee,
    p_notes: draft.notes.trim(),
  });

  if (!error) return ok;
  console.error('createOrder failed', error);

  const raw = `${error.message ?? ''}`;
  if (raw.includes('INSUFFICIENT_STOCK')) {
    const product = raw.split('INSUFFICIENT_STOCK:')[1]?.split('"')[0]?.trim();
    return fail(product ? `الكمية غير كافية من "${product}".` : 'الكمية المطلوبة غير متوفرة في المخزون.');
  }
  if (raw.includes('EMPTY_ORDER')) return fail('أضف منتجاً واحداً على الأقل.');
  if (raw.includes('duplicate key')) return fail('رقم الطلب مستخدم بالفعل. أعد المحاولة.');
  return fail('تعذر إنشاء الطلب.');
};

// ---- delivery zones ----

export type ZoneDraft = Pick<
  DeliveryZone, 'id' | 'code' | 'name' | 'region' | 'capital' | 'fee' | 'deliveryTimeDays' | 'active'
>;

export const saveZone = (draft: ZoneDraft, isNew: boolean) => {
  const code = draft.code.trim();
  const row = trimRow({
    name: draft.name,
    region: draft.region,
    capital: draft.capital,
    fee: draft.fee,
    delivery_time_days: draft.deliveryTimeDays,
    active: draft.active,
    // A blank code is omitted rather than sent: the insert trigger then numbers
    // the zone, and an update leaves the existing number alone.
    ...(code ? { code } : {}),
  });
  return run(
    isNew
      ? supabase.from('delivery_zones').insert({ id: draft.id, ...row })
      : supabase.from('delivery_zones').update(row).eq('id', draft.id),
    isNew ? 'تعذر إضافة المنطقة.' : 'تعذر حفظ تعديلات المنطقة.',
  ).then(result =>
    !result.ok && code ? { ok: false, message: `تعذر الحفظ. قد يكون رقم المنطقة "${code}" مستخدماً بالفعل.` } : result,
  );
};

export const deleteZone = (id: string) =>
  run(supabase.from('delivery_zones').delete().eq('id', id), 'تعذر حذف المنطقة.');

export const setOrderStatus = (ids: string[], status: OrderStatus) =>
  run(
    supabase.from('orders').update({ status }).in('id', ids),
    ids.length > 1 ? 'تعذر تحديث حالة الطلبات.' : 'تعذر تحديث حالة الطلب.',
  );

export const deleteOrders = (ids: string[]) =>
  run(supabase.from('orders').delete().in('id', ids), 'تعذر حذف الطلبات.');
