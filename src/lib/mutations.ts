import { supabase } from '../db/supabase';
import type {
  Customer, DeliveryZone, OrderItem, OrderStatus, Product, SalesRep, StockKind, Store,
} from '../types';
import { orderTotals } from './orderMath';
import { deleteProductImages } from './storage';
import { trimRow } from './text';
import { normalizeArabic } from './arabic';

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

/**
 * The next document name for a doctype, from its naming series.
 *
 * The counter lives in Postgres and is taken in one atomic statement, so two
 * tabs creating a document at the same moment get two numbers. Returns '' on
 * failure and lets the caller decide — for a blank SKU that means "leave it
 * blank", which is what it was before.
 */
export const nextDocumentName = async (
  doctype: string,
  series: string | null,
  storeId: string | null,
): Promise<string> => {
  const { data, error } = await supabase.rpc('next_document_name', {
    p_doctype: doctype,
    p_series: series,
    p_store_id: storeId,
  });
  if (error) { console.error(`next_document_name(${doctype}) failed`, error); return ''; }
  return (data as string) ?? '';
};

// ---- stores ----

export type StoreDraft = Pick<Store, 'id' | 'name' | 'image' | 'facebookPage' | 'mobileNumber'>;

const storeRow = (draft: StoreDraft) => trimRow({
  name: draft.name,
  image: draft.image,
  facebook_page: draft.facebookPage,
  mobile_number: draft.mobileNumber,
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
> & {
  images: string[];
  sizes: string[];
  /** Series used to fill a blank SKU on creation; the doctype default when absent. */
  namingSeries?: string;
};

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
  // Blanks are dropped rather than stored: a sizes array holding '' would put an
  // unnamed option in every order line's picker.
  sizes: draft.sizes.map(size => size.trim()).filter(Boolean),
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
export const saveProduct = async (draft: ProductDraft, isNew: boolean): Promise<WriteResult> => {
  // A blank SKU on a new item is filled from the item naming series, so every
  // item ends up with an identifier without anyone having to invent one. A SKU
  // that was typed is kept exactly as typed.
  const sku = isNew && !draft.sku.trim()
    ? await nextDocumentName('products', draft.namingSeries ?? null, draft.storeId)
    : draft.sku;
  const row = productRow({ ...draft, sku });

  return run(
    isNew
      ? supabase.from('products').insert({ id: draft.id, stock: draft.stock, ...row })
      : supabase.from('products').update(row).eq('id', draft.id),
    isNew ? 'تعذر إضافة المنتج.' : 'تعذر حفظ تعديلات المنتج.',
  );
};

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
  'id' | 'storeId' | 'name' | 'phone' | 'whatsapp' | 'city' | 'address' | 'status'
> & {
  /** Series to number a new customer with; the doctype default when absent. */
  namingSeries?: string;
};

// `rating` is deliberately absent: it is not collected at creation time and an
// update must not reset a rating the customer earned later.
const customerRow = (draft: CustomerDraft) => trimRow({
  store_id: draft.storeId,
  name: draft.name,
  phone: draft.phone,
  whatsapp: draft.whatsapp,
  city: draft.city,
  address: draft.address,
  status: draft.status,
});

export const saveCustomer = async (draft: CustomerDraft, isNew: boolean): Promise<WriteResult> => {
  // Numbered on creation only: a customer keeps the code they were given, the
  // same rule orders follow. A failed numbering fails the save — saving without
  // a code would leave a record the operator cannot refer to, and no sign why.
  const code = isNew ? await nextDocumentName('customers', draft.namingSeries ?? null, draft.storeId) : undefined;
  if (isNew && !code) return fail('تعذر توليد رقم العميل. حاول مرة أخرى.');

  return run(
    isNew
      ? supabase.from('customers').insert({ id: draft.id, code, ...customerRow(draft) })
      : supabase.from('customers').update(customerRow(draft)).eq('id', draft.id),
    isNew ? 'تعذر إضافة العميل.' : 'تعذر حفظ تعديلات العميل.',
  );
};

export const deleteCustomer = (id: string) =>
  run(
    supabase.from('customers').delete().eq('id', id),
    'تعذر حذف العميل. تأكد من عدم وجود طلبات مرتبطة به.',
  );

// ---- categories ----

/**
 * Creates a category and returns its name, which is what `products.category`
 * stores. An existing category with the same normalised spelling wins instead of
 * erroring — the user asked for that category to exist, and it does.
 */
export const createCategory = async (name: string, storeId: string): Promise<string> => {
  const trimmed = name.trim();
  if (!trimmed) return '';

  const { error } = await supabase.from('categories').insert({ id: newId(), name: trimmed, store_id: storeId });
  if (!error) return trimmed;

  if (`${error.message ?? ''}`.includes('duplicate key')) {
    // The unique index is on (store_id, ar_normalize(name)), so a collision
    // means the normalised forms match while the raw text differs — "فاطمه"
    // against "فاطمة". Matching on the raw text would never find the row that
    // caused it, and searching every store would find another store's.
    const { data } = await supabase.from('categories').select('name').eq('store_id', storeId);
    const target = normalizeArabic(trimmed);
    const existing = (data ?? []).find(row => normalizeArabic(row.name as string) === target);
    return (existing?.name as string) ?? trimmed;
  }

  console.error('createCategory failed', error);
  return '';
};

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
  agentId: string;
  /** The zone the order goes to — what the rep's commission is priced from. */
  zoneId: string;
  /** Which naming series numbers this order; the doctype default when blank. */
  namingSeries?: string;
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
    p_agent_id: draft.agentId || null,
    p_zone_id: draft.zoneId || null,
    p_naming_series: draft.namingSeries || null,
  });

  if (!error) return ok;
  console.error('createOrder failed', error);
  return fail(orderFailure(error, 'تعذر إنشاء الطلب.'));
};

/** Shared reading of what Postgres refused, in the words the operator needs. */
const orderFailure = (error: { message?: string }, fallback: string): string => {
  const raw = `${error.message ?? ''}`;
  if (raw.includes('INSUFFICIENT_STOCK')) {
    // Postgres interpolates the bare product name and may append its own lines,
    // so the name ends at the first quote OR newline — splitting on the quote
    // alone would print the whole rest of the error at the operator.
    const product = raw.split('INSUFFICIENT_STOCK:')[1]?.split(/["\n]/)[0]?.trim();
    return product ? `الكمية غير كافية من "${product}".` : 'الكمية المطلوبة غير متوفرة في المخزون.';
  }
  if (raw.includes('EMPTY_ORDER')) return 'أضف منتجاً واحداً على الأقل.';
  if (raw.includes('NO_SUCH_ORDER')) return 'الطلب لم يعد موجوداً.';
  if (raw.includes('NO_SUCH_PRODUCT')) return 'المنتج المرتبط بالطلب لم يعد موجوداً.';
  if (raw.includes('INVALID_PARTIAL_DELIVERY')) return 'بيانات التسليم الجزئي غير صالحة.';
  if (raw.includes('PERMISSION_DENIED')) return 'لا تملك صلاحية تعديل مخزون هذا المتجر.';
  if (raw.includes('duplicate key')) return 'رقم الطلب مستخدم بالفعل. أعد المحاولة.';
  return fallback;
};

/**
 * Editing an existing order.
 *
 * The whole edit is one Postgres transaction: the order row, the stock of every
 * item whose quantity changed, and a compensating ledger row per movement. The
 * audit trigger on `orders` records the before/after of the row itself, so an
 * edited order can be explained afterwards — which is the point of editing
 * through a transaction rather than a plain update.
 *
 * Status is not part of it: that is changed through the transition-aware
 * status function, so an edit cannot race a stock reservation or return.
 */
export const updateOrder = async (draft: Omit<OrderDraft, 'orderNumber' | 'storeId'>): Promise<WriteResult> => {
  const { error } = await supabase.rpc('update_order_with_stock', {
    p_id: draft.id,
    p_customer_id: draft.customerId,
    p_customer_name: draft.customerName.trim(),
    p_items: draft.items.map(item => trimRow(item as unknown as Record<string, unknown>)),
    p_discount: draft.discount,
    p_delivery_fee: draft.deliveryFee,
    p_notes: draft.notes.trim(),
    p_agent_id: draft.agentId || null,
    p_zone_id: draft.zoneId || null,
  });

  if (!error) return ok;
  console.error('updateOrder failed', error);
  return fail(orderFailure(error, 'تعذر حفظ تعديلات الطلب.'));
};

// ---- sales representatives ----

export type SalesRepDraft = Pick<
  SalesRep, 'id' | 'storeId' | 'name' | 'phone' | 'whatsapp' | 'zones' | 'commission' | 'active' | 'note'
> & {
  /** Series to number a new rep with; the doctype default when absent. */
  namingSeries?: string;
};

const salesRepRow = (draft: SalesRepDraft) => trimRow({
  store_id: draft.storeId,
  name: draft.name,
  phone: draft.phone,
  whatsapp: draft.whatsapp,
  // De-duplicated: the same zone twice covers nothing extra, and would read as
  // two zones on the rep's card.
  zones: [...new Set(draft.zones.map(zone => zone.trim()).filter(Boolean))],
  commission: draft.commission,
  active: draft.active,
  note: draft.note,
});

export const saveSalesRep = async (draft: SalesRepDraft, isNew: boolean): Promise<WriteResult> => {
  const code = isNew ? await nextDocumentName('sales_reps', draft.namingSeries ?? null, draft.storeId) : undefined;
  if (isNew && !code) return fail('تعذر توليد رقم المندوب. حاول مرة أخرى.');

  return run(
    isNew
      ? supabase.from('sales_reps').insert({ id: draft.id, code, ...salesRepRow(draft) })
      : supabase.from('sales_reps').update(salesRepRow(draft)).eq('id', draft.id),
    isNew ? 'تعذر إضافة المندوب.' : 'تعذر حفظ تعديلات المندوب.',
  );
};

/**
 * Orders keep their history: the foreign key is ON DELETE SET NULL, so deleting
 * a rep detaches their orders rather than taking them along.
 */
export const deleteSalesRep = (id: string) =>
  run(supabase.from('sales_reps').delete().eq('id', id), 'تعذر حذف المندوب.');

export const setOrderAgent = (orderIds: string[], agentId: string | null) =>
  run(
    supabase.from('orders').update({ agent_id: agentId }).in('id', orderIds),
    'تعذر إسناد الطلب إلى المندوب.',
  );

// ---- delivery zones ----

export type ZoneDraft = Pick<
  DeliveryZone,
  'id' | 'code' | 'name' | 'region' | 'fee' | 'deliveryTimeDays' | 'active'
  | 'commissionType' | 'commissionValue' | 'altName'
  | 'cityId' | 'scopeId' | 'municipalityId'
> & {
  /** Null when the row being edited is one of the shared defaults. */
  storeId?: string | null;
};

/**
 * Finds or creates one of the hierarchy masters, and returns its id.
 *
 * Same shape as `createCategory`, for the same reason: the unique index is on
 * `ar_normalize(name)`, so a collision means the normalised forms match while
 * the raw text differs — «فاطمه» against «فاطمة» — and matching on raw text
 * would never find the row that caused the collision.
 *
 * This is what stops a Link field becoming a wall: importing a sheet that names
 * a city nobody has entered yet creates it instead of failing the row.
 */
const findOrCreate = async (
  table: 'cities' | 'zone_scopes' | 'municipalities',
  name: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> => {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from(table).insert({ name: trimmed, ...extra }).select('id').maybeSingle();
  if (!error && data) return data.id as string;

  if (`${error?.message ?? ''}`.includes('duplicate key')) {
    const { data: rows } = await supabase.from(table).select('id,name').match(extra);
    const target = normalizeArabic(trimmed);
    const hit = (rows ?? []).find(row => normalizeArabic(row.name as string) === target);
    if (hit) return hit.id as string;
  }

  console.error(`findOrCreate ${table} failed`, error);
  return null;
};

export const createCity = (name: string) => findOrCreate('cities', name);
export const createZoneScope = (name: string, cityId: string) =>
  findOrCreate('zone_scopes', name, { city_id: cityId });
export const createMunicipality = (name: string) => findOrCreate('municipalities', name);

/**
 * Saving a zone, copy-on-write.
 *
 * The 22 Libyan zones are a shared catalogue every store starts from. Editing
 * one from inside a store must not change what other stores see, so the first
 * edit copies that default into the store and the edit lands on the copy —
 * `zone_for_store` does the copying in Postgres, where a second tab doing the
 * same thing at the same moment cannot produce two copies.
 *
 * A zone the store created, or has already copied, is edited in place.
 */
export const saveZone = async (
  draft: ZoneDraft,
  isNew: boolean,
  storeId: string | null,
): Promise<WriteResult> => {
  let targetId = draft.id;

  if (!isNew && !draft.storeId) {
    if (!storeId) return fail('افتح متجراً لتعديل مناطق التوصيل.');
    const { data, error } = await supabase.rpc('zone_for_store', {
      p_zone_id: draft.id,
      p_store_id: storeId,
    });
    if (error) {
      console.error('zone_for_store failed', error);
      return fail('تعذر تجهيز نسخة المنطقة الخاصة بهذا المتجر.');
    }
    targetId = data as string;
  }

  const code = draft.code.trim();
  const row = trimRow({
    name: draft.name,
    region: draft.region,
    // Links only. `city`, `scope` and `municipality` are written by the
    // `zone_hierarchy_sync` trigger from whatever these point at, so sending
    // both would let a stale label overwrite a fresh one.
    city_id: draft.cityId,
    scope_id: draft.scopeId,
    municipality_id: draft.municipalityId,
    alt_name: draft.altName,
    fee: draft.fee,
    delivery_time_days: draft.deliveryTimeDays,
    active: draft.active,
    commission_type: draft.commissionType,
    // A rule of 'none' carries no number; storing whatever was last typed would
    // resurrect it the moment someone switched the type back.
    commission_value: draft.commissionType === 'none' ? 0 : draft.commissionValue,
    // A blank code is omitted rather than sent: the insert trigger then numbers
    // the zone, and an update leaves the existing number alone.
    ...(code ? { code } : {}),
  });
  return run(
    isNew
      // A zone a store adds belongs to that store, not to the shared catalogue.
      ? supabase.from('delivery_zones').insert({ id: draft.id, store_id: storeId, ...row })
      : supabase.from('delivery_zones').update(row).eq('id', targetId),
    isNew ? 'تعذر إضافة المنطقة.' : 'تعذر حفظ تعديلات المنطقة.',
  ).then(result =>
    !result.ok && code ? { ok: false, message: `تعذر الحفظ. قد يكون رقم المنطقة "${code}" مستخدماً بالفعل.` } : result,
  );
};

/**
 * Removing a zone from a store's list.
 *
 * A zone the store owns is deleted outright. A shared default cannot be — it
 * belongs to every store — so it is hidden from this store the only honest way:
 * the store takes its copy and deactivates it. Other stores keep the default.
 */
export const deleteZone = async (zone: DeliveryZone, storeId: string | null): Promise<WriteResult> => {
  if (zone.storeId) {
    return run(supabase.from('delivery_zones').delete().eq('id', zone.id), 'تعذر حذف المنطقة.');
  }
  if (!storeId) return fail('افتح متجراً لتعديل مناطق التوصيل.');

  const { data, error } = await supabase.rpc('zone_for_store', { p_zone_id: zone.id, p_store_id: storeId });
  if (error) {
    console.error('zone_for_store failed', error);
    return fail('تعذر إيقاف المنطقة لهذا المتجر.');
  }
  return run(
    supabase.from('delivery_zones').update({ active: false }).eq('id', data as string),
    'تعذر إيقاف المنطقة لهذا المتجر.',
  );
};

export interface OrderStatusRow {
  id: string;
  status: OrderStatus;
  statusReason: string;
}

/**
 * What the statuses were, read before a change writes over them.
 *
 * Read first because afterwards they are gone, and the caller needs to know
 * which orders actually moved: a delivery is only worth announcing for the ones
 * that were not already delivered.
 */
export const orderStatusesOf = async (ids: string[]): Promise<OrderStatusRow[]> => {
  const { data, error } = await supabase.from('orders').select('id,status,statusReason:status_reason').in('id', ids);
  if (error) { console.error('failed to read order statuses', error); return []; }
  return (data ?? []) as OrderStatusRow[];
};


/**
 * `reason` is what the operator typed when cancelling or returning. Every other
 * status clears it: a reason left behind from an earlier cancellation would
 * read as the reason for the state the order is in now.
 */
export const setOrderStatus = async (
  ids: string[],
  status: OrderStatus,
  reason = '',
  items: OrderItem[] | null = null,
): Promise<WriteResult> => {
  const { error } = await supabase.rpc('set_order_status_with_stock', {
    p_order_ids: ids,
    p_status: status,
    p_reason: reason,
    p_items: items,
  });
  if (!error) return ok;
  console.error('setOrderStatus failed', error);
  return fail(orderFailure(error, ids.length > 1 ? 'تعذر تحديث حالة الطلبات.' : 'تعذر تحديث حالة الطلب.'));
};

/**
 * Marking one order partly delivered.
 *
 * The lines and the status move together in a single update, because an order
 * that says `delivered_partial` without per-line quantities would be read as a
 * full delivery by every total — the status is only meaningful with the numbers
 * beside it.
 *
 * Stock follows the status exposure transition in the same database function:
 * active → partial keeps the units with the rep, while reopening a canceled or
 * returned order reserves them again. A partial delivery never silently puts
 * undelivered units back on the shelf.
 */
export const setPartialDelivery = (id: string, items: OrderItem[], reason = '') =>
  setOrderStatus([id], 'delivered_partial', reason, items);

export const deleteOrders = (ids: string[]) =>
  run(supabase.from('orders').delete().in('id', ids), 'تعذر حذف الطلبات.');
