import { money } from '../components/ui';
import { statusLabels } from './dashboardStats';
import type { OrderStatus } from '../types';

/**
 * The audit trail in the operator's words.
 *
 * The log stores column names and raw values — `delivery_fee`, a uuid, an ISO
 * timestamp — which answer "what row changed" but not "what happened". This
 * turns one row into a sentence somebody can read without knowing the schema,
 * and is shared by the store's log page and the panel inside an order.
 */

/** Columns worth naming, across every table the trail covers. */
export const FIELD_LABELS: Record<string, string> = {
  // orders
  status: 'الحالة',
  status_reason: 'سبب الحالة',
  total: 'الإجمالي',
  subtotal: 'المجموع الفرعي',
  discount: 'الخصم',
  delivery_fee: 'التوصيل',
  items: 'المنتجات',
  agent_id: 'المندوب',
  zone_id: 'المنطقة',
  notes: 'الملاحظات',
  delivery_date: 'تاريخ التسليم',
  customer_id: 'العميل',
  customer_name: 'اسم العميل',
  order_number: 'رقم الطلب',
  // products and stock
  name: 'الاسم',
  sku: 'رمز المنتج',
  price: 'السعر',
  cost: 'التكلفة',
  stock: 'المخزون',
  quantity: 'الكمية',
  balance: 'الرصيد',
  kind: 'نوع الحركة',
  category_id: 'التصنيف',
  sizes: 'المقاسات',
  image: 'الصورة',
  images: 'الصور',
  // people and places
  phone: 'الهاتف',
  address: 'العنوان',
  city: 'المدينة',
  email: 'البريد',
  display_name: 'الاسم المعروض',
  role: 'الدور',
  active: 'مفعّل',
  commission: 'العمولة',
  zones: 'المناطق',
  delivery_time_days: 'مدة التوصيل بالأيام',
  // bookkeeping
  store_id: 'المتجر',
  naming_series: 'سلسلة الترقيم',
  created_at: 'تاريخ الإنشاء',
  code: 'الرمز',
};

/** Bookkeeping columns nobody reads a creation summary for. */
const NOISE = new Set(['id', 'store_id', 'created_at', 'updated_at', 'search_text', 'naming_series']);

export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

const MONEY_FIELDS = new Set(['total', 'subtotal', 'discount', 'delivery_fee', 'price', 'cost']);
const ISO = /^\d{4}-\d{2}-\d{2}(T|$)/;

const dateTime = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium' });

/** Enough lines to recognise the order; past that the cell stops being readable. */
const ITEM_LIMIT = 4;

/**
 * Order lines as "name ×qty", which is the smallest form a quantity edit still
 * shows up in. Sizes are included because two lines of the same product differ
 * only by size, and without it the diff reads as two identical entries.
 *
 * Exported because the orders list names its lines the same way. One phrasing
 * for "what is in this order", whether it is being read in the change log or
 * scanned down a column.
 */
export const describeOrderItems = (items: unknown[]): string => {
  const lines = items.map(entry => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = typeof item.productName === 'string' && item.productName !== '' ? item.productName : 'صنف';
    const size = typeof item.size === 'string' && item.size !== '' ? ` (${item.size})` : '';
    const quantity = Number(item.quantity);
    return `${name}${size} ×${Number.isFinite(quantity) ? quantity : '؟'}`;
  });
  const shown = lines.slice(0, ITEM_LIMIT).join('، ');
  return lines.length > ITEM_LIMIT ? `${shown} و${lines.length - ITEM_LIMIT} أخرى` : shown;
};

/**
 * A value as a reader would say it. `resolve` is how a page lends the names it
 * has — a rep's name for an `agent_id`, an Arabic label for a status — since
 * the log itself only ever stored the id.
 */
export const auditValue = (
  field: string,
  value: unknown,
  resolve?: (field: string, value: unknown) => string | undefined,
): string => {
  const named = resolve?.(field, value);
  if (named !== undefined) return named;

  // Statuses are app-wide vocabulary, so every reader of the log gets the
  // Arabic word without having to lend it.
  if (field === 'status' && typeof value === 'string' && statusLabels[value as OrderStatus]) {
    return statusLabels[value as OrderStatus];
  }

  // Before the generic array branch: a line count hides the edit people make
  // most. Changing a quantity leaves the number of lines identical, so
  // "1 عنصر ← 1 عنصر" reported a real change as no change at all.
  if (field === 'items' && Array.isArray(value)) return value.length === 0 ? '—' : describeOrderItems(value);

  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (Array.isArray(value)) return `${value.length} عنصر`;
  if (typeof value === 'number') return MONEY_FIELDS.has(field) ? money(value) : value.toLocaleString('en-US');
  if (typeof value === 'object') return 'قيمة مركّبة';

  const text = String(value);
  if (MONEY_FIELDS.has(field) && text !== '' && !Number.isNaN(Number(text))) return money(Number(text));
  if (ISO.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return text.length <= 10 ? dateOnly.format(parsed) : dateTime.format(parsed);
  }
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

export interface AuditChange {
  field: string;
  label: string;
  /** Null on a creation row: there was nothing there before. */
  from: string | null;
  to: string;
}

/**
 * Which columns a row is about. One source of truth, so the filter list and the
 * rendered diff can never disagree about what a row touched.
 */
export const auditFields = (action: string, data: Record<string, unknown> | null): string[] => {
  if (!data) return [];
  const fields = Object.keys(data);
  return action === 'UPDATE' ? fields : fields.filter(field => !NOISE.has(field));
};

/**
 * One row's changes, oldest value first. An update carries `{field: {from, to}}`;
 * a creation or deletion carries the whole record, and the bookkeeping columns
 * are dropped from it because nobody reads "معرّف المتجر" as news.
 */
export const auditChanges = (
  action: string,
  data: Record<string, unknown> | null,
  resolve?: (field: string, value: unknown) => string | undefined,
): AuditChange[] =>
  auditFields(action, data).map(field => {
    const raw = (data ?? {})[field];
    if (action !== 'UPDATE') {
      return { field, label: fieldLabel(field), from: null, to: auditValue(field, raw, resolve) };
    }
    const { from, to } = (raw ?? {}) as { from?: unknown; to?: unknown };
    return {
      field,
      label: fieldLabel(field),
      from: auditValue(field, from, resolve),
      to: auditValue(field, to, resolve),
    };
  });

/** Empty string means "any", so a blank filter matches every row. */
export interface AuditFilter {
  action: string;
  field: string;
  /** Matches `actorId`; the empty string is the unattributed system actor. */
  actor: string;
}

export const emptyAuditFilter: AuditFilter = { action: '', field: '', actor: '' };

export const isAuditFiltered = (filter: AuditFilter): boolean =>
  Boolean(filter.action || filter.field || filter.actor);

/**
 * How many rows the list shows, one "more" click at a time.
 *
 * 20 to start, then 50 more, then 100 more, then 200 — and 200 at a time after
 * that. Somebody who has already asked twice is reading the whole log, not
 * peeking at the top of it, so the chunks grow rather than making them click
 * twenty times.
 */
export const AUDIT_PAGES = [20, 70, 170, 370];

export const nextAuditPage = (visible: number): number =>
  AUDIT_PAGES.find(size => size > visible) ?? visible + 200;

/** A row survives every filter that is set. Unset filters do not narrow. */
export const matchesAudit = (
  row: { action: string; actorId: string | null; data: Record<string, unknown> | null },
  filter: AuditFilter,
): boolean =>
  (!filter.action || row.action === filter.action)
  && (!filter.actor || (row.actorId ?? '') === filter.actor)
  && (!filter.field || auditFields(row.action, row.data).includes(filter.field));

/**
 * The headline: what this row did, in one line.
 *
 * A status change says so by name, because that is the change people scan the
 * log for. Everything else names the fields it touched.
 */
export const auditSummary = (action: string, changes: AuditChange[], record = 'السجل'): string => {
  if (action === 'INSERT') return `أنشأ ${record}`;
  if (action === 'DELETE') return `حذف ${record}`;

  const status = changes.find(change => change.field === 'status');
  if (status) {
    const rest = changes.filter(change => change.field !== 'status' && change.field !== 'status_reason');
    const tail = rest.length > 0 ? ` و${rest.length} حقل آخر` : '';
    return `غيّر الحالة من ${status.from} إلى ${status.to}${tail}`;
  }
  if (changes.length === 0) return 'لا تفاصيل حقول';
  if (changes.length <= 3) return `عدّل ${changes.map(change => change.label).join('، ')}`;
  return `عدّل ${changes.length} حقول`;
};
