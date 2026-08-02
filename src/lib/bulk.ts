import { supabase } from '../db/supabase';
import { newId, saveProduct, saveZone, type WriteResult } from './mutations';
import { downloadCsv, downloadXlsx, readSheet, toBoolean, toNumber, type SheetRow } from './sheet';
import type { DeliveryZone, Product, ZoneRegion } from '../types';

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

const ZONE_ID_HEADER = 'المعرّف الداخلي (لا تعدّله)';
const ZONE_CODE_HEADER = 'رقم المنطقة';

export const zoneBulk: BulkSpec<DeliveryZone> = {
  filename: 'zones',
  columns: [
    { header: ZONE_ID_HEADER, value: zone => zone.id },
    { header: ZONE_CODE_HEADER, value: zone => zone.code },
    { header: 'اسم المنطقة', value: zone => zone.name },
    { header: 'الإقليم', value: zone => REGION_LABELS[zone.region] },
    { header: 'المدينة الرئيسية', value: zone => zone.capital },
    { header: 'رسوم التوصيل', value: zone => String(zone.fee) },
    { header: 'مدة التوصيل (أيام)', value: zone => String(zone.deliveryTimeDays) },
    { header: 'متاح', value: zone => (zone.active ? 'نعم' : 'لا') },
  ],

  all: async () => {
    const { data, error } = await supabase
      .from('delivery_zones')
      .select('id,code,name,region,capital,areaKm2:area_km2,fee,deliveryTimeDays:delivery_time_days,active')
      .order('code');
    if (error) { console.error('zone export failed', error); return []; }
    return (data ?? []) as unknown as DeliveryZone[];
  },

  resolve: async rows => {
    // Match on the internal id first, then on the zone number, so both a
    // round-tripped export and a sheet that only quotes zone numbers work.
    const ids = columnValues(rows, ZONE_ID_HEADER);
    const codes = columnValues(rows, ZONE_CODE_HEADER);

    const lookup = (column: 'id' | 'code', values: string[]) =>
      values.length === 0
        ? Promise.resolve([] as DeliveryZone[])
        : supabase
            .from('delivery_zones')
            .select('id,code,name,region,capital,areaKm2:area_km2,fee,deliveryTimeDays:delivery_time_days,active')
            .in(column, values)
            .then(({ data, error }) => {
              if (error) { console.error('zone lookup failed', error); return [] as DeliveryZone[]; }
              return (data ?? []) as unknown as DeliveryZone[];
            });

    const [byIdRows, byCodeRows] = await Promise.all([lookup('id', ids), lookup('code', codes)]);
    const byId = new Map(byIdRows.map(zone => [zone.id, zone]));
    const byCode = new Map(byCodeRows.map(zone => [zone.code, zone]));

    return rows.map(row =>
      byId.get((row[ZONE_ID_HEADER] ?? '').trim()) ?? byCode.get((row[ZONE_CODE_HEADER] ?? '').trim()));
  },

  save: (row, existing) => {
    const name = (row['اسم المنطقة'] ?? '').trim();
    if (!name) return Promise.resolve({ ok: false, message: 'اسم المنطقة مطلوب.' });

    return saveZone({
      id: existing?.id ?? newId(),
      // Blank on a new zone means "number it for me" — Postgres does that.
      code: (row[ZONE_CODE_HEADER] ?? '').trim(),
      name,
      region: regionFromLabel(row['الإقليم'] ?? '', existing?.region ?? 'tripolitania'),
      capital: row['المدينة الرئيسية'] ?? existing?.capital ?? '',
      fee: toNumber(row['رسوم التوصيل'] ?? '', existing?.fee ?? 0),
      deliveryTimeDays: Math.max(1, toNumber(row['مدة التوصيل (أيام)'] ?? '', existing?.deliveryTimeDays ?? 3)),
      active: toBoolean(row['متاح'] ?? '', existing?.active ?? true),
    }, !existing);
  },
};

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
