import { supabase } from '../db/supabase';
import {
  createCity, createMunicipality, createOrder, createZoneScope, newId, saveProduct, saveZone,
  setOrderStatus, updateOrder, type WriteResult, type ZoneDraft,
} from './mutations';
import { downloadCsv, downloadXlsx, readSheet, toBoolean, toNumber, type SheetRow } from './sheet';
import { formatOrderItems, parseOrderItems } from './orderSheet';
import { byCode, zoneFromRow } from './zones';
import { statusLabels } from './dashboardStats';
import { splitList } from './text';
import type {
  CommissionType, DeliveryZone, Order, OrderItem, OrderStatus, Product, SalesRep, ZoneRegion,
} from '../types';

/**
 * Bulk import/export, shared by zones and items.
 *
 * The contract for the operator is: export a sheet, edit it, import it back.
 * That round trip is what makes "update if it exists, create if it does not"
 * unambiguous — every exported row carries its own identifier, so a re-imported
 * row updates the record it came from, and a row typed into a blank template has
 * no identifier and therefore creates one.
 */

export interface BulkColumn<T> {
  header: string;
  value: (row: T) => string;
}

export interface BulkSpec<T> {
  /** Base name for downloaded files, without extension. */
  filename: string;
  columns: BulkColumn<T>[];
  /** Every record, for the export and the pre-filled template. */
  all: () => Promise<T[]>;
  /**
   * Which existing record each sheet row refers to, as one batched lookup —
   * parallel to `rows`, `undefined` where the row is new.
   */
  resolve: (rows: SheetRow[]) => Promise<Array<T | undefined>>;
  save: (row: SheetRow, existing: T | undefined) => Promise<WriteResult>;
}

export interface ImportReport {
  created: number;
  updated: number;
  /** 1-based line in the sheet as the operator sees it, header included. */
  errors: Array<{ line: number; message: string }>;
}

export const headersOf = <T,>(spec: BulkSpec<T>) => spec.columns.map(column => column.header);

/**
 * Non-empty, de-duplicated values of one sheet column.
 *
 * These are fed to `.in()` rather than spliced into an `.or()` filter string:
 * a SKU containing a comma or a quote would otherwise change the shape of the
 * filter instead of being matched by it.
 */
const columnValues = (rows: SheetRow[], header: string): string[] =>
  [...new Set(rows.map(row => (row[header] ?? '').trim()).filter(Boolean))];

const sheetRowsOf = <T,>(spec: BulkSpec<T>, rows: T[]): SheetRow[] =>
  rows.map(row => Object.fromEntries(spec.columns.map(column => [column.header, column.value(row)])));

export type SheetFormat = 'csv' | 'xlsx';

/** `withData: false` writes the header row only — the blank template. */
export const exportSheet = async <T,>(spec: BulkSpec<T>, format: SheetFormat, withData: boolean) => {
  const headers = headersOf(spec);
  const rows = withData ? sheetRowsOf(spec, await spec.all()) : [];
  const filename = `${spec.filename}${withData ? '' : '-template'}.${format}`;
  if (format === 'csv') downloadCsv(filename, headers, rows);
  else await downloadXlsx(filename, headers, rows);
};

/**
 * ponytail: rows are saved one at a time so a single bad row reports its own
 * line number instead of failing the batch. Fine for the hundreds of rows a
 * sheet actually holds; if imports ever run to tens of thousands, move the
 * upsert into one Postgres function.
 */
export const importSheet = async <T,>(file: File, spec: BulkSpec<T>): Promise<ImportReport> => {
  const rows = await readSheet(file);
  const existing = await spec.resolve(rows);
  const report: ImportReport = { created: 0, updated: 0, errors: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const match = existing[index];
    const result = await spec.save(rows[index], match);
    if (!result.ok) report.errors.push({ line: index + 2, message: result.message ?? 'تعذر الحفظ.' });
    else if (match) report.updated += 1;
    else report.created += 1;
  }

  return report;
};

// ------------------------------------------------------------------- zones

const REGION_LABELS: Record<ZoneRegion, string> = {
  tripolitania: 'طرابلس',
  cyrenaica: 'برقة',
  fezzan: 'فزان',
};

const regionFromLabel = (value: string, fallback: ZoneRegion): ZoneRegion => {
  const text = value.trim().toLowerCase();
  if (text === '') return fallback;
  const match = (Object.keys(REGION_LABELS) as ZoneRegion[])
    .find(region => region === text || REGION_LABELS[region] === value.trim());
  return match ?? fallback;
};

const COMMISSION_LABELS: Record<CommissionType, string> = {
  none: 'عمولة المندوب الثابتة',
  percent: 'نسبة من رسوم التوصيل',
  fixed: 'مبلغ ثابت لكل طلب',
};

const commissionFromLabel = (value: string, fallback: CommissionType): CommissionType => {
  const text = value.trim();
  if (text === '') return fallback;
  const match = (Object.keys(COMMISSION_LABELS) as CommissionType[])
    .find(type => type === text.toLowerCase() || COMMISSION_LABELS[type] === text);
  return match ?? fallback;
};

/**
 * Resolves the three hierarchy columns of a sheet row to master records.
 *
 * A blank cell keeps whatever the existing row already links to, so a sheet
 * exported for pricing and re-imported does not unfile every area. A named city
 * or scope that does not exist yet is created — the point of the Link is to stop
 * typos multiplying, not to stop an operator entering a real place.
 */
const hierarchyOf = async (
  row: SheetRow,
  existing: DeliveryZone | undefined,
): Promise<Pick<ZoneDraft, 'cityId' | 'scopeId' | 'municipalityId'>> => {
  const cityName = (row['المدينة الكبرى'] ?? '').trim();
  const scopeName = (row['النطاق الجغرافي'] ?? '').trim();
  const muniName = (row['البلدية'] ?? '').trim();

  const cityId = cityName ? await createCity(cityName) : existing?.cityId ?? null;
  return {
    cityId,
    // A scope without a city has nothing to hang off, so it is left unset
    // rather than attached to whichever city happened to be nearby.
    scopeId: scopeName && cityId
      ? await createZoneScope(scopeName, cityId)
      : scopeName ? null : existing?.scopeId ?? null,
    municipalityId: muniName ? await createMunicipality(muniName) : existing?.municipalityId ?? null,
  };
};

const ZONE_ID_HEADER = 'المعرّف الداخلي (لا تعدّله)';
const ZONE_CODE_HEADER = 'رقم المنطقة';

/**
 * Scoped to the open store, because the zone list is: it exports what that
 * store actually works with — its own zones plus the shared defaults it has not
 * replaced — and importing a changed row edits the store's copy, creating it on
 * first change exactly as the form does.
 */
export const zoneBulk = (storeId: string | null): BulkSpec<DeliveryZone> => ({
  filename: 'zones',
  columns: [
    { header: ZONE_ID_HEADER, value: zone => zone.id },
    { header: ZONE_CODE_HEADER, value: zone => zone.code },
    { header: 'اسم المنطقة', value: zone => zone.name },
    // The three levels around the area. A sheet can be sorted and priced city
    // by city, and a name typed here is resolved to the master record on import
    // — creating it when it is genuinely new, so an import is never blocked by
    // a city nobody has entered yet.
    { header: 'المدينة الكبرى', value: zone => zone.city },
    { header: 'النطاق الجغرافي', value: zone => zone.scope },
    { header: 'البلدية', value: zone => zone.municipality },
    { header: 'الإقليم', value: zone => REGION_LABELS[zone.region] },
    { header: 'رسوم التوصيل', value: zone => String(zone.fee) },
    { header: 'مدة التوصيل (أيام)', value: zone => String(zone.deliveryTimeDays) },
    { header: 'عمولة المندوب', value: zone => COMMISSION_LABELS[zone.commissionType] },
    { header: 'قيمة العمولة', value: zone => String(zone.commissionValue) },
    { header: 'متاح', value: zone => (zone.active ? 'نعم' : 'لا') },
  ],

  // Through the RPC, so an export shows the store the same list the app does.
  all: async () => {
    const { data, error } = await supabase.rpc('store_zones', { p_store_id: storeId });
    if (error) { console.error('zone export failed', error); return []; }
    return (data ?? []).map(zoneFromRow).sort(byCode);
  },

  resolve: async rows => {
    // Match on the internal id first, then on the zone number, so both a
    // round-tripped export and a sheet that only quotes zone numbers work. Only
    // within what this store sees — another store's copy is not this store's.
    const ids = columnValues(rows, ZONE_ID_HEADER);
    const codes = columnValues(rows, ZONE_CODE_HEADER);
    const { data, error } = await supabase.rpc('store_zones', { p_store_id: storeId });
    if (error) { console.error('zone lookup failed', error); return rows.map(() => undefined); }

    const visible: DeliveryZone[] = (data ?? []).map(zoneFromRow);
    const byId = new Map(visible.filter(zone => ids.includes(zone.id)).map(zone => [zone.id, zone]));
    const byZoneCode = new Map(visible.filter(zone => codes.includes(zone.code)).map(zone => [zone.code, zone]));

    return rows.map(row =>
      byId.get((row[ZONE_ID_HEADER] ?? '').trim()) ?? byZoneCode.get((row[ZONE_CODE_HEADER] ?? '').trim()));
  },

  save: async (row, existing) => {
    const name = (row['اسم المنطقة'] ?? '').trim();
    if (!name) return { ok: false, message: 'اسم المنطقة مطلوب.' };

    return saveZone({
      id: existing?.id ?? newId(),
      // Blank on a new zone means "number it for me" — Postgres does that.
      code: (row[ZONE_CODE_HEADER] ?? '').trim(),
      name,
      region: regionFromLabel(row['الإقليم'] ?? '', existing?.region ?? 'tripolitania'),
      ...(await hierarchyOf(row, existing)),
      altName: existing?.altName ?? '',
      fee: toNumber(row['رسوم التوصيل'] ?? '', existing?.fee ?? 0),
      deliveryTimeDays: Math.max(1, toNumber(row['مدة التوصيل (أيام)'] ?? '', existing?.deliveryTimeDays ?? 3)),
      commissionType: commissionFromLabel(row['عمولة المندوب'] ?? '', existing?.commissionType ?? 'none'),
      commissionValue: toNumber(row['قيمة العمولة'] ?? '', existing?.commissionValue ?? 0),
      active: toBoolean(row['متاح'] ?? '', existing?.active ?? true),
      // Null here means the row is a shared default, which is what tells
      // saveZone to copy it into this store before writing.
      storeId: existing?.storeId ?? null,
    }, !existing, storeId);
  },
});

// ------------------------------------------------------------------- items

const STATUS_LABELS: Record<Product['status'], string> = {
  active: 'معروض',
  draft: 'مسودة',
  out_of_stock: 'نفدت الكمية',
};

const statusFromLabel = (value: string, fallback: Product['status']): Product['status'] => {
  const text = value.trim();
  if (text === '') return fallback;
  const match = (Object.keys(STATUS_LABELS) as Product['status'][])
    .find(status => status === text.toLowerCase() || STATUS_LABELS[status] === text);
  return match ?? fallback;
};

const PRODUCT_ID_HEADER = 'المعرّف الداخلي (لا تعدّله)';
const SKU_HEADER = 'رمز SKU';

const PRODUCT_COLUMNS =
  'id,storeId:store_id,name,description,images,purchasePrice:purchase_price,sellingPrice:selling_price,margin,sku,barcode,brand,provider,category,defaultSerial:default_serial,colors,sizes,stock,minStock:min_stock,status,addedAt:added_at,salesCount:sales_count';

/** Scoped to one store: items belong to a store, and so does an import of them. */
export const productBulk = (storeId: string): BulkSpec<Product> => ({
  filename: 'items',
  columns: [
    { header: PRODUCT_ID_HEADER, value: product => product.id },
    { header: 'اسم المنتج', value: product => product.name },
    { header: SKU_HEADER, value: product => product.sku },
    { header: 'الرقم التسلسلي الافتراضي', value: product => product.defaultSerial },
    { header: 'الفئة', value: product => product.category },
    { header: 'المقاسات', value: product => (product.sizes ?? []).join('، ') },
    { header: 'سعر الشراء', value: product => String(product.purchasePrice) },
    { header: 'سعر البيع', value: product => String(product.sellingPrice) },
    { header: 'الكمية الابتدائية', value: product => String(product.stock) },
    { header: 'حد التنبيه', value: product => String(product.minStock) },
    { header: 'الحالة', value: product => STATUS_LABELS[product.status] },
    { header: 'الوصف', value: product => product.description },
  ],

  all: async () => {
    const { data, error } = await supabase
      .from('products').select(PRODUCT_COLUMNS).eq('store_id', storeId).order('name');
    if (error) { console.error('item export failed', error); return []; }
    return (data ?? []) as unknown as Product[];
  },

  resolve: async rows => {
    const ids = columnValues(rows, PRODUCT_ID_HEADER);
    const skus = columnValues(rows, SKU_HEADER);

    // Scoped to this store, so a SKU reused by another store cannot be hit.
    const lookup = (column: 'id' | 'sku', values: string[]) =>
      values.length === 0
        ? Promise.resolve([] as Product[])
        : supabase
            .from('products').select(PRODUCT_COLUMNS).eq('store_id', storeId).in(column, values)
            .then(({ data, error }) => {
              if (error) { console.error('item lookup failed', error); return [] as Product[]; }
              return (data ?? []) as unknown as Product[];
            });

    const [byIdRows, bySkuRows] = await Promise.all([lookup('id', ids), lookup('sku', skus)]);
    const byId = new Map(byIdRows.map(product => [product.id, product]));
    const bySku = new Map(bySkuRows.filter(product => product.sku).map(product => [product.sku, product]));

    return rows.map(row =>
      byId.get((row[PRODUCT_ID_HEADER] ?? '').trim()) ?? bySku.get((row[SKU_HEADER] ?? '').trim()));
  },

  save: (row, existing) => {
    const name = (row['اسم المنتج'] ?? '').trim();
    if (!name) return Promise.resolve({ ok: false, message: 'اسم المنتج مطلوب.' });

    return saveProduct({
      id: existing?.id ?? newId(),
      storeId,
      name,
      description: row['الوصف'] ?? existing?.description ?? '',
      sku: row[SKU_HEADER] ?? existing?.sku ?? '',
      defaultSerial: row['الرقم التسلسلي الافتراضي'] ?? existing?.defaultSerial ?? '',
      category: row['الفئة'] ?? existing?.category ?? '',
      // An absent column leaves the sizes alone; an empty cell in a column that
      // IS present clears them, which is the only way to remove one from a sheet.
      sizes: 'المقاسات' in row ? splitList(row['المقاسات'] ?? '') : (existing?.sizes ?? []),
      purchasePrice: toNumber(row['سعر الشراء'] ?? '', existing?.purchasePrice ?? 0),
      sellingPrice: toNumber(row['سعر البيع'] ?? '', existing?.sellingPrice ?? 0),
      // Only meaningful on creation; saveProduct drops it from an update, so an
      // import can never silently overwrite stock that transactions now own.
      stock: toNumber(row['الكمية الابتدائية'] ?? '', 0),
      minStock: toNumber(row['حد التنبيه'] ?? '', existing?.minStock ?? 0),
      status: statusFromLabel(row['الحالة'] ?? '', existing?.status ?? 'active'),
      images: existing?.images ?? [],
    }, !existing);
  },
});

// ------------------------------------------------------------------ orders

const ORDER_ID_HEADER = 'المعرّف الداخلي (لا تعدّله)';
const ORDER_NUMBER_HEADER = 'رقم الطلب';
const ORDER_ITEMS_HEADER = 'المنتجات';
const ORDER_CUSTOMER_ID_HEADER = 'معرّف العميل (لا تعدّله)';
const ORDER_STATUS_HEADER = 'الحالة';

const ORDER_COLUMNS =
  'id,orderNumber:order_number,storeId:store_id,customerId:customer_id,customerName:customer_name,items,subtotal,discount,deliveryFee:delivery_fee,total,status,notes,createdAt:created_at,deliveryDate:delivery_date,agentId:agent_id,zoneId:zone_id';

/** Orders are unbounded; an export that tried to be complete would time out. */
const ORDER_EXPORT_LIMIT = 5000;

const orderStatusFromLabel = (value: string, fallback: OrderStatus): OrderStatus => {
  const text = value.trim();
  if (text === '') return fallback;
  const match = (Object.keys(statusLabels) as OrderStatus[])
    .find(status => status === text.toLowerCase() || statusLabels[status] === text);
  return match ?? fallback;
};

/**
 * Import/export of orders — the same round trip zones and items have, over a
 * record that carries a list of lines rather than a flat set of fields.
 *
 * Two rules make it safe to hand an operator:
 *
 *   - Nothing is inserted directly. A new row goes through
 *     `create_order_with_stock` and an edited one through
 *     `update_order_with_stock`, so stock, the ledger and the audit trail hold
 *     for a sheet exactly as they do for the form.
 *   - Customers are matched, never created. A typo in a customer name is a
 *     reported line, not a duplicate customer record nobody asked for.
 */
export const orderBulk = (
  storeId: string,
  refs: { zones: DeliveryZone[]; salesReps: SalesRep[] },
): BulkSpec<Order> => {
  // Filled by `all()` (export) and `resolve()` (import), which both run before
  // any column or row is written.
  let skuById = new Map<string, string>();
  let productByIdent = new Map<string, Product>();
  let customerById = new Map<string, { id: string; name: string }>();
  let customerByName = new Map<string, { id: string; name: string }>();

  const zoneByKey = () => {
    const map = new Map<string, DeliveryZone>();
    refs.zones.forEach(zone => {
      map.set(zone.name.trim(), zone);
      if (zone.code) map.set(zone.code.trim(), zone);
    });
    return map;
  };

  const repByName = () => new Map(refs.salesReps.map(rep => [rep.name.trim(), rep]));

  const loadSkus = async () => {
    const { data } = await supabase.from('products').select('id,sku').eq('store_id', storeId);
    skuById = new Map((data ?? []).map(row => [row.id as string, (row.sku as string) ?? '']));
  };

  return {
    filename: 'orders',
    columns: [
      { header: ORDER_ID_HEADER, value: order => order.id },
      { header: ORDER_NUMBER_HEADER, value: order => order.orderNumber },
      { header: 'التاريخ', value: order => new Date(order.createdAt).toISOString().slice(0, 10) },
      { header: 'العميل', value: order => order.customerName },
      { header: ORDER_CUSTOMER_ID_HEADER, value: order => order.customerId },
      { header: ORDER_ITEMS_HEADER, value: order => formatOrderItems(order.items, skuById) },
      { header: 'الخصم', value: order => String(order.discount) },
      { header: 'رسوم التوصيل', value: order => String(order.deliveryFee) },
      // Recomputed from the lines on every write, so a number typed here is
      // ignored rather than trusted.
      { header: 'الإجمالي (محسوب)', value: order => String(order.total) },
      { header: ORDER_STATUS_HEADER, value: order => statusLabels[order.status] },
      { header: 'المنطقة', value: order => refs.zones.find(zone => zone.id === order.zoneId)?.name ?? '' },
      { header: 'المندوب', value: order => refs.salesReps.find(rep => rep.id === order.agentId)?.name ?? '' },
      { header: 'ملاحظات', value: order => order.notes },
    ],

    all: async () => {
      await loadSkus();
      const { data, error } = await supabase
        .from('orders').select(ORDER_COLUMNS).eq('store_id', storeId)
        .order('created_at', { ascending: false }).limit(ORDER_EXPORT_LIMIT);
      if (error) { console.error('order export failed', error); return []; }
      return (data ?? []) as unknown as Order[];
    },

    resolve: async rows => {
      const ids = columnValues(rows, ORDER_ID_HEADER);
      const numbers = columnValues(rows, ORDER_NUMBER_HEADER);

      // Every product identifier the sheet mentions, looked up once by SKU and
      // once by name rather than per row.
      const idents = [...new Set(
        rows.flatMap(row => parseOrderItems(row[ORDER_ITEMS_HEADER] ?? '').lines.map(line => line.ident)),
      )];
      const customerIds = columnValues(rows, ORDER_CUSTOMER_ID_HEADER);
      const customerNames = columnValues(rows, 'العميل');

      const lookupOrders = (column: 'id' | 'order_number', values: string[]) =>
        values.length === 0
          ? Promise.resolve([] as Order[])
          : supabase
              .from('orders').select(ORDER_COLUMNS).eq('store_id', storeId).in(column, values)
              .then(({ data, error }) => {
                if (error) { console.error('order lookup failed', error); return [] as Order[]; }
                return (data ?? []) as unknown as Order[];
              });

      const lookupProducts = (column: 'sku' | 'name', values: string[]) =>
        values.length === 0
          ? Promise.resolve([] as Product[])
          : supabase
              .from('products').select(PRODUCT_COLUMNS).eq('store_id', storeId).in(column, values)
              .then(({ data, error }) => {
                if (error) { console.error('product lookup failed', error); return [] as Product[]; }
                return (data ?? []) as unknown as Product[];
              });

      // Scoped to this store: a customer name that exists in another store is
      // not this store's customer, and matching it would file the order under
      // someone else's record.
      const lookupCustomers = (column: 'id' | 'name', values: string[]) =>
        values.length === 0
          ? Promise.resolve([] as Array<{ id: string; name: string }>)
          : supabase
              .from('customers').select('id,name').eq('store_id', storeId).in(column, values)
              .then(({ data, error }) => {
                if (error) { console.error('customer lookup failed', error); return []; }
                return (data ?? []) as Array<{ id: string; name: string }>;
              });

      const [byIdRows, byNumberRows, bySku, byName, byCustomerId, byCustomerName] = await Promise.all([
        lookupOrders('id', ids),
        lookupOrders('order_number', numbers),
        lookupProducts('sku', idents),
        lookupProducts('name', idents),
        lookupCustomers('id', customerIds),
        lookupCustomers('name', customerNames),
      ]);

      // SKU wins over name: it is the identifier the export writes.
      productByIdent = new Map([
        ...byName.map(product => [product.name.trim(), product] as const),
        ...bySku.filter(product => product.sku).map(product => [product.sku.trim(), product] as const),
      ]);
      skuById = new Map([...bySku, ...byName].map(product => [product.id, product.sku ?? '']));
      customerById = new Map(byCustomerId.map(customer => [customer.id, customer]));
      customerByName = new Map(byCustomerName.map(customer => [customer.name.trim(), customer]));

      const orderById = new Map(byIdRows.map(order => [order.id, order]));
      const orderByNumber = new Map(byNumberRows.map(order => [order.orderNumber, order]));

      return rows.map(row =>
        orderById.get((row[ORDER_ID_HEADER] ?? '').trim())
        ?? orderByNumber.get((row[ORDER_NUMBER_HEADER] ?? '').trim()));
    },

    save: async (row, existing) => {
      const parsed = parseOrderItems(row[ORDER_ITEMS_HEADER] ?? '');
      if (parsed.invalid.length > 0) {
        return { ok: false, message: `تعذر قراءة المنتجات: "${parsed.invalid[0]}". الصيغة: SKU * الكمية @ السعر # المقاس` };
      }

      const items: OrderItem[] = [];
      for (const line of parsed.lines) {
        const product = productByIdent.get(line.ident);
        if (!product) return { ok: false, message: `لا يوجد منتج بالرمز أو الاسم "${line.ident}" في هذا المتجر.` };
        items.push({
          productId: product.id,
          productName: product.name,
          quantity: line.quantity,
          price: line.price ?? product.sellingPrice,
          image: product.images?.[0] ?? '',
          size: line.size ?? '',
        });
      }

      const customerId = (row[ORDER_CUSTOMER_ID_HEADER] ?? '').trim();
      const customerName = (row['العميل'] ?? '').trim();
      const customer = customerById.get(customerId) ?? customerByName.get(customerName);
      if (!customer && !existing) {
        return { ok: false, message: `لا يوجد عميل باسم "${customerName || '—'}". أضف العميل أولاً.` };
      }

      const zone = zoneByKey().get((row['المنطقة'] ?? '').trim());
      const rep = repByName().get((row['المندوب'] ?? '').trim());
      const status = orderStatusFromLabel(row[ORDER_STATUS_HEADER] ?? '', existing?.status ?? 'new');

      const draft = {
        customerId: customer?.id ?? existing?.customerId ?? '',
        customerName: customer?.name ?? existing?.customerName ?? '',
        // An empty products cell leaves the lines as they are; clearing an order
        // to nothing is a delete, not an edit.
        items: items.length > 0 ? items : (existing?.items ?? []),
        discount: toNumber(row['الخصم'] ?? '', existing?.discount ?? 0),
        deliveryFee: toNumber(row['رسوم التوصيل'] ?? '', existing?.deliveryFee ?? zone?.fee ?? 0),
        notes: row['ملاحظات'] ?? existing?.notes ?? '',
        agentId: rep?.id ?? existing?.agentId ?? '',
        zoneId: zone?.id ?? existing?.zoneId ?? '',
      };

      if (draft.items.length === 0) {
        return { ok: false, message: 'أضف منتجاً واحداً على الأقل في عمود المنتجات.' };
      }

      const id = existing?.id ?? newId();
      const result = existing
        ? await updateOrder({ id, ...draft })
        : await createOrder({ id, orderNumber: '', storeId, ...draft });
      if (!result.ok) return result;

      // Status is not part of either RPC — it has one writer, the orders table —
      // so a change to it is a second, small write.
      if (status !== (existing?.status ?? 'new')) return setOrderStatus([id], status);
      return result;
    },
  };
};
