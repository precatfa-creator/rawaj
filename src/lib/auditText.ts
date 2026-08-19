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
 * One row's changes, oldest value first. An update carries `{field: {from, to}}`;
 * a creation or deletion carries the whole record, and the bookkeeping columns
 * are dropped from it because nobody reads "معرّف المتجر" as news.
 */
export const auditChanges = (
  action: string,
  data: Record<string, unknown> | null,
  resolve?: (field: string, value: unknown) => string | undefined,
): AuditChange[] => {
  if (!data) return [];

  if (action === 'UPDATE') {
    return Object.entries(data).map(([field, change]) => {
      const { from, to } = (change ?? {}) as { from?: unknown; to?: unknown };
      return {
        field,
        label: fieldLabel(field),
        from: auditValue(field, from, resolve),
        to: auditValue(field, to, resolve),
      };
    });
  }

  return Object.entries(data)
    .filter(([field]) => !NOISE.has(field))
    .map(([field, value]) => ({
      field,
      label: fieldLabel(field),
      from: null,
      to: auditValue(field, value, resolve),
    }));
};

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
