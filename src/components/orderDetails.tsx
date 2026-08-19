import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, History, Package, Pencil, Sheet } from 'lucide-react';
import { Modal, ghostButton, primaryButton } from './Modal';
import { OrderTracking, type StatusEvent } from './OrderTracking';
import { Combobox } from './Combobox';
import { money } from './ui';
import { supabase } from '../db/supabase';
import {
  ALL_STATUSES, STATUS_ACCENT_BASE, STATUS_ACCENT_NONE, statusAccent, statusLabels, statusWash,
} from '../lib/dashboardStats';
import { assignableReps, orderCommission } from '../lib/commission';
import { describeActor, useActorNames } from '../lib/actors';
import {
  AUDIT_PAGES, auditChanges, auditFields, auditSummary, emptyAuditFilter, fieldLabel,
  isAuditFiltered, matchesAudit, nextAuditPage, type AuditFilter,
} from '../lib/auditText';
import { downloadXlsx, type SheetRow } from '../lib/sheet';
import type { DeliveryZone, Order, OrderStatus, SalesRep, StockKind } from '../types';


const statusTone: Record<OrderStatus, string> = {
  new: 'bg-blue-50 text-blue-800 border-blue-200',
  confirmed: 'bg-purple-50 text-purple-800 border-purple-200',
  processing: 'bg-orange-50 text-orange-800 border-orange-200',
  shipped: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  waiting: 'bg-slate-100 text-slate-700 border-slate-300',
  delivered: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  delivered_partial: 'bg-teal-50 text-teal-800 border-teal-200',
  canceled: 'bg-rose-50 text-rose-800 border-rose-200',
  returned: 'bg-amber-50 text-amber-900 border-amber-200',
};

const dateTime = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium' });

const KIND_LABELS: Record<StockKind, string> = {
  purchase: 'استلام مشتريات',
  return: 'مرتجع من عميل',
  damage: 'تلف أو فقد',
  adjustment: 'تسوية جرد',
  sale: 'بيع',
  initial: 'كمية ابتدائية',
};

const ACTION_LABELS: Record<string, string> = {
  INSERT: 'إنشاء',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
};

interface MovementRow {
  id: string;
  kind: StockKind;
  quantity: number;
  balance: number;
  note: string;
  createdAt: string;
  product: { name: string; sku: string } | null;
}

interface AuditRow {
  id: number;
  action: string;
  actorId: string | null;
  actorRole: string;
  changedAt: string;
  changedFields: string[] | null;
  /** `to_jsonb(new)` on insert; `{field: {from, to}}` on update. */
  data: Record<string, unknown> | null;
}

/**
 * Loads a section's rows the first time it is opened, and again if the order
 * changes underneath it.
 *
 * Lazy on purpose: the stock ledger and the full change list are a round trip
 * each, and most people open an order to read the items and close it again.
 */
const useRows = <T,>(
  active: boolean,
  orderId: string | null,
  load: (id: string) => Promise<T[]>,
  version = '',
) => {
  const [rows, setRows] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || !orderId) return;
    let cancelled = false;
    setRows(null);
    setFailed(false);
    load(orderId).then(
      result => { if (!cancelled) setRows(result); },
      () => { if (!cancelled) setFailed(true); },
    );
    // A second order opened before the first request lands must not paint the
    // previous order's rows under the new order's number.
    return () => { cancelled = true; };
    // `load` is deliberately not a dependency: every caller passes a
    // module-level function. An inline closure here would refetch every render.
  }, [active, orderId, version]);

  return { rows, failed };
};

const loadMovements = async (orderId: string): Promise<MovementRow[]> => {
  const { data, error } = await supabase
    .from('stock_entries')
    .select('id,kind,quantity,balance,note,createdAt:created_at,product:products(name,sku)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MovementRow[];
};

const loadAudit = async (orderId: string): Promise<AuditRow[]> => {
  const { data, error } = await supabase
    .from('audit_log')
    .select('id,action,actorId:actor_id,actorRole:actor_role,changedAt:changed_at,changedFields:changed_fields,data')
    .eq('table_name', 'orders')
    .eq('record_id', orderId)
    .order('changed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AuditRow[];
};

/**
 * The status a log row put the order into: the whole row on insert, the `to`
 * side of the diff on update. Anything else is a change that did not touch the
 * status and has no place on the ladder.
 */
const statusOf = (row: AuditRow): string | null => {
  const value = row.data?.status;
  if (row.action === 'INSERT') return typeof value === 'string' ? value : null;
  const change = value as { to?: unknown } | undefined;
  return typeof change?.to === 'string' ? change.to : null;
};

const logFilterClass =
  'block mt-1 bg-white border border-surface-200 rounded-xl px-2.5 py-2 text-sm font-bold text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

const LOG_HEADERS = ['التاريخ', 'الإجراء', 'المستخدم', 'الملخص', 'الحقل', 'من', 'إلى'];

/**
 * The log as a spreadsheet: one row per field changed, not per log entry.
 *
 * An entry that touched three fields is three rows, because that is the shape
 * somebody can filter and pivot. A row that changed nothing readable still gets
 * a line, so exporting never silently drops an entry the screen showed.
 */
const logSheetRows = (
  rows: AuditRow[],
  describe: (row: AuditRow) => string,
  resolve: (field: string, value: unknown) => string | undefined,
): SheetRow[] =>
  rows.flatMap(row => {
    const changes = auditChanges(row.action, row.data, resolve);
    const base = {
      'التاريخ': dateTime.format(new Date(row.changedAt)),
      'الإجراء': ACTION_LABELS[row.action] ?? row.action,
      'المستخدم': describe(row),
      'الملخص': auditSummary(row.action, changes, 'الطلب'),
    };
    if (changes.length === 0) return [{ ...base, 'الحقل': '', 'من': '', 'إلى': '' }];
    return changes.map(change => ({
      ...base,
      'الحقل': change.label,
      'من': change.from ?? '—',
      'إلى': change.to,
    }));
  });

/** Same three states everywhere: still loading, refused, or genuinely empty. */
const RowsState: React.FC<{ rows: unknown[] | null; failed: boolean; empty: string }> = ({ rows, failed, empty }) => {
  if (failed) return <p className="text-sm text-surface-500 py-4">تعذر تحميل البيانات. تحقق من الاتصال وحاول مجدداً.</p>;
  if (rows === null) return <p className="text-sm text-surface-400 py-4">جارٍ التحميل…</p>;
  if (rows.length === 0) return <p className="text-sm text-surface-500 py-4">{empty}</p>;
  return null;
};

const Card: React.FC<{ title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title, aside, children, className,
}) => (
  <section className={`rounded-2xl border border-surface-200 bg-white ${className ?? ''}`}>
    {title && (
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-200 bg-surface-50">
        <h3 className="font-black text-sm text-surface-900">{title}</h3>
        {aside}
      </header>
    )}
    {children}
  </section>
);

/** A section that costs a query, so it only pays when somebody opens it. */
const Drawer: React.FC<{
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}> = ({ title, icon, open, onToggle, children }) => (
  <details
    open={open}
    onToggle={event => onToggle((event.currentTarget as HTMLDetailsElement).open)}
    className="rounded-2xl border border-surface-200 bg-white overflow-hidden"
  >
    <summary className="flex items-center gap-2 px-4 py-3 font-black text-sm text-surface-900 cursor-pointer select-none bg-surface-50 hover:bg-surface-100 transition-colors marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
      {icon}
      {title}
      <ChevronDown size={16} className={`ms-auto text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </summary>
    <div className="px-4 pb-4 pt-1">{children}</div>
  </details>
);

const stepButton =
  'inline-flex items-center justify-center w-10 h-10 rounded-xl border border-surface-200 bg-white text-surface-700 hover:bg-surface-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * One order, as a working document.
 *
 * Laid out like the delivery docket it stands in for: the goods and the money
 * fill the sheet, and everything about *handling* the order — its status, its
 * rep, where it has been — runs down a column beside them. Tabs are gone; the
 * two sections that cost a query are drawers that pay only when opened.
 */
export const OrderDetails: React.FC<{
  order: Order | null;
  salesReps: SalesRep[];
  zones: DeliveryZone[];
  onClose: () => void;
  /** Walk the list without closing — reviewing orders is a loop, not a visit. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Acting on the order from the document itself, rather than the row behind it. */
  onEdit?: (order: Order) => void;
  onStatus?: (id: string, status: OrderStatus) => void;
  onAgent?: (id: string, agentId: string) => void;
}> = ({ order, salesReps, zones, onClose, onPrev, onNext, onEdit, onStatus, onAgent }) => {
  const [fullscreen, setFullscreen] = useState(true);
  const [showMovements, setShowMovements] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logFull, setLogFull] = useState(false);
  const [logFilter, setLogFilter] = useState<AuditFilter>(emptyAuditFilter);
  const [logVisible, setLogVisible] = useState(AUDIT_PAGES[0]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [copied, setCopied] = useState(false);
  const actors = useActorNames();

  const rep = salesReps.find(item => item.id === order?.agentId);
  const zone = zones.find(item => item.id === order?.zoneId);
  const commission = rep ? orderCommission(order?.deliveryFee ?? 0, zone, rep.commission) : null;

  // *Any* write to the order writes an audit row, so the trail and the ledger
  // are refetched whenever any field changes. Listing the fields by hand is what
  // left the log stale after a rep change — the key has to be the whole record,
  // or it falls behind again the next time a column is added. Content, not
  // identity: a list reload that returns an identical order refetches nothing.
  const version = JSON.stringify(order ?? {});
  const movements = useRows<MovementRow>(showMovements, order?.id ?? null, loadMovements, version);
  // The ladder needs the trail, so this one is not deferred. Non-admins simply
  // get no rows back, and the ladder falls back to stages without moments.
  const audit = useRows<AuditRow>(true, order?.id ?? null, loadAudit, version);

  /** Ids in the log become the names this page already knows. */
  const resolveValue = (field: string, value: unknown): string | undefined => {
    if (field === 'status' && typeof value === 'string') return statusLabels[value as OrderStatus] ?? value;
    if (field === 'agent_id') return salesReps.find(item => item.id === value)?.name ?? 'بدون مندوب';
    if (field === 'zone_id') return zones.find(item => item.id === value)?.name ?? 'بدون منطقة';
    // `items` is deliberately absent: auditValue spells the lines out with their
    // quantities, and a count here would hide a quantity edit behind "1 صنف".
    return undefined;
  };

  const events: StatusEvent[] = [...(audit.rows ?? [])]
    .reverse()
    .flatMap(row => {
      const status = statusOf(row);
      return status ? [{ status, at: row.changedAt, by: describeActor(row, actors) }] : [];
    });

  // Every order opens as its own document rather than resuming the last one's
  // drawers, which would show one order's ledger under another order's number.
  useEffect(() => {
    setFullscreen(true);
    setShowMovements(false);
    setShowLog(false);
    setLogFull(false);
    setLogFilter(emptyAuditFilter);
    setLogVisible(AUDIT_PAGES[0]);
    setExportError('');
    setCopied(false);
  }, [order?.id]);

  // Filtering happens over the whole trail, and the page size only decides how
  // much of the result is painted. Export follows the filter, not the page: what
  // somebody narrowed to is what they mean to take away.
  const auditRows = audit.rows ?? [];
  const filteredAudit = auditRows.filter(row => matchesAudit(row, logFilter));
  const shownAudit = filteredAudit.slice(0, logVisible);

  /** Only the actions, fields and people this order's trail actually contains. */
  const actionChoices = [...new Set(auditRows.map(row => row.action))];
  const fieldChoices = [...new Set(auditRows.flatMap(row => auditFields(row.action, row.data)))]
    .sort((a, b) => fieldLabel(a).localeCompare(fieldLabel(b), 'ar'));
  const actorChoices = [...new Map(
    auditRows.map(row => [row.actorId ?? '', describeActor(row, actors)]),
  )];

  const setFilter = (patch: Partial<AuditFilter>) => {
    setLogFilter(current => ({ ...current, ...patch }));
    // A narrower list starts at the top; keeping a deep page would open on rows
    // the new filter may not even have.
    setLogVisible(AUDIT_PAGES[0]);
  };

  const exportLog = async () => {
    if (!order || !filteredAudit.length) return;
    setExporting(true);
    setExportError('');
    try {
      await downloadXlsx(
        `order-${order.orderNumber}-log.xlsx`,
        LOG_HEADERS,
        logSheetRows(filteredAudit, row => describeActor(row, actors), resolveValue),
      );
    } catch (error) {
      // exceljs is a ~940 kB lazy chunk; on a bad connection the import is what
      // fails, and a silent dead button is worse than saying so.
      console.error('Failed to export the order log', error);
      setExportError('تعذّر إنشاء الملف. حاول مجدداً.');
    } finally {
      setExporting(false);
    }
  };

  const copyNumber = async () => {
    if (!order) return;
    await navigator.clipboard.writeText(order.orderNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const units = order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <Modal
      open={!!order}
      wide
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen(current => !current)}
      title={order ? `الطلب ${order.orderNumber}` : ''}
      onClose={onClose}
    >
      {order && (
        <div className="@container space-y-5 max-w-[80rem] mx-auto">
          {/* Identity: who it is for, what it comes to, and the controls that
              change it — the three things somebody opens an order to do. */}
          <div className={`grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_auto] items-start rounded-2xl border border-surface-200 bg-white p-4 ${STATUS_ACCENT_BASE} ${statusAccent[order.status] ?? STATUS_ACCENT_NONE} ${statusWash[order.status] ?? ''}`}>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyNumber()}
                  title="نسخ رقم الطلب"
                  className="inline-flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-2.5 py-1 font-mono text-sm font-bold text-surface-900 hover:bg-surface-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  dir="ltr"
                  translate="no"
                >
                  <Copy size={14} className="text-surface-500" />
                  {order.orderNumber}
                </button>
                <span aria-live="polite" className="text-xs font-bold text-primary-700">
                  {copied ? 'نُسخ الرقم' : ''}
                </span>
                <span className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${statusTone[order.status]}`}>
                  {statusLabels[order.status] ?? order.status}
                </span>
                {order.statusReason && (
                  <span className="text-sm text-surface-600 min-w-0 truncate" title={order.statusReason}>
                    — {order.statusReason}
                  </span>
                )}
              </div>

              <div>
                <p className="text-2xl font-black text-surface-900 truncate">{order.customerName}</p>
                {/* surface-600, not 500: this line sits on the status wash, where
                    the lighter grey drops to 4.2:1 against the tint. */}
                <p className="text-sm text-surface-600 mt-0.5">
                  {zone?.name ?? 'بدون منطقة'} · أُنشئ {dateOnly.format(new Date(order.createdAt))}
                  {order.deliveryDate && ` · التسليم ${dateOnly.format(new Date(order.deliveryDate))}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onStatus && (
                  <Combobox
                    size="sm"
                    label="حالة الطلب"
                    value={order.status}
                    onChange={value => onStatus(order.id, value as OrderStatus)}
                    options={ALL_STATUSES.map(status => ({ value: status, label: statusLabels[status] }))}
                    className="w-40"
                  />
                )}
                {onAgent && salesReps.length > 0 && (
                  <Combobox
                    size="sm"
                    label="المندوب"
                    value={order.agentId ?? ''}
                    onChange={value => onAgent(order.id, value)}
                    options={[
                      { value: '', label: 'بدون مندوب' },
                      // Only reps who serve this order's zone. Whoever is on it
                      // already stays listed even if they no longer cover it, so
                      // the field shows the truth rather than blanking.
                      ...assignableReps(salesReps, zone?.name ?? '', order.agentId).map(item => ({
                        value: item.id,
                        label: item.name,
                        hint: item.zones.length > 0 ? item.zones.join('، ') : 'كل المناطق',
                      })),
                    ]}
                    className="w-44"
                  />
                )}
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(order)}
                    className="inline-flex items-center gap-2 rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm font-bold text-surface-700 hover:bg-surface-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Pencil size={16} />
                    تعديل الطلب
                  </button>
                )}
                {(onPrev || onNext) && (
                  <div className="flex items-center gap-2 ms-auto">
                    <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="الطلب السابق" className={stepButton}>
                      <ChevronRight size={18} />
                    </button>
                    <button type="button" onClick={onNext} disabled={!onNext} aria-label="الطلب التالي" className={stepButton}>
                      <ChevronLeft size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* The stamped total: the one number the whole document is about. */}
            {/* The app's own teal rather than near-black: the total is the one
                number the document is about, and it should read as part of the
                system, not as a foreign block. white/70 for the labels — /60
                measures 3.84:1 on this ground, under the 4.5 floor. */}
            <div className="rounded-2xl bg-gradient-to-br from-primary-700 to-primary-900 text-white px-5 py-4 @2xl:min-w-52 shadow-sm shadow-primary-900/20">
              <p className="text-xs font-bold text-white/70">الإجمالي</p>
              <p className="text-3xl font-black tabular-nums mt-1">{money(order.total)}</p>
              <p className="text-xs text-white/70 mt-1 tabular-nums">
                {units} قطعة · {order.items.length} صنف
              </p>
            </div>
          </div>

          <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_22rem] items-start">
            <div className="space-y-5 min-w-0">
              <Card title="المنتجات" aside={<span className="text-xs text-surface-500 tabular-nums">{units} قطعة</span>}>
                <ul className="divide-y divide-surface-100">
                  {order.items.map((item, index) => (
                    <li key={`${item.productId}-${item.size ?? ''}-${index}`} className="flex items-center gap-3 px-4 py-3">
                      {item.image
                        ? <img src={item.image} alt="" width={44} height={44} loading="lazy" className="w-11 h-11 rounded-lg object-cover border border-surface-200 shrink-0" />
                        : <span aria-hidden className="w-11 h-11 rounded-lg bg-surface-100 border border-surface-200 shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="block font-bold text-surface-900 truncate">{item.productName}</span>
                        {item.size && <span className="block text-xs text-surface-500 mt-0.5">مقاس {item.size}</span>}
                      </span>
                      <span className="text-sm text-surface-500 tabular-nums whitespace-nowrap">
                        {item.quantity} × {money(item.price)}
                      </span>
                      <span className="font-bold tabular-nums w-24 text-left">{money(item.quantity * item.price)}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="الحساب">
                <dl className="px-4 py-3 space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-surface-500">المجموع الفرعي</dt><dd className="font-bold tabular-nums">{money(order.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-surface-500">الخصم</dt><dd className="font-bold tabular-nums">−{money(order.discount)}</dd></div>
                  <div className="flex justify-between"><dt className="text-surface-500">التوصيل</dt><dd className="font-bold tabular-nums">{money(order.deliveryFee)}</dd></div>
                  {commission !== null && (
                    <div className="flex justify-between">
                      <dt className="text-surface-500">عمولة المندوب ({rep?.name})</dt>
                      <dd className="font-bold tabular-nums">{money(commission)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-surface-200 pt-2 mt-1">
                    <dt className="font-black text-surface-900">الإجمالي</dt>
                    <dd className="font-black text-lg tabular-nums">{money(order.total)}</dd>
                  </div>
                </dl>
              </Card>

              {order.notes && (
                <Card title="ملاحظات">
                  <p className="px-4 py-3 text-surface-700 whitespace-pre-wrap break-words">{order.notes}</p>
                </Card>
              )}

              <Drawer
                title="حركات المخزون"
                icon={<Package size={16} className="text-surface-500" />}
                open={showMovements}
                onToggle={setShowMovements}
              >
                <RowsState rows={movements.rows} failed={movements.failed} empty="لا توجد حركات مخزون مرتبطة بهذا الطلب." />
                <ul className="space-y-2">
                  {movements.rows?.map(row => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-surface-200 rounded-xl p-3">
                      <span className="font-bold text-surface-900 flex-1 min-w-40 truncate">
                        {row.product?.name ?? 'منتج محذوف'}
                        {row.product?.sku && <span className="text-xs text-surface-500 font-mono mr-2" dir="ltr">{row.product.sku}</span>}
                      </span>
                      <span className="text-xs font-bold text-surface-600 bg-surface-100 border border-surface-200 rounded-lg px-2 py-1">
                        {KIND_LABELS[row.kind] ?? row.kind}
                      </span>
                      {/* The sign is the whole story of a movement, so it is
                          spelled out rather than left to a minus glyph. */}
                      <span className={`font-black tabular-nums ${row.quantity < 0 ? 'text-rose-700' : 'text-emerald-700'}`} dir="ltr">
                        {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                      </span>
                      <span className="text-xs text-surface-500 tabular-nums">الرصيد بعدها: {row.balance}</span>
                      <span className="text-xs text-surface-500 w-full sm:w-auto">{dateTime.format(new Date(row.createdAt))}</span>
                    </li>
                  ))}
                </ul>
              </Drawer>
            </div>

            <aside className="space-y-5 min-w-0">
              <OrderTracking order={order} rep={rep} zone={zone} events={events} />

              {/* The log reads badly in a narrow column — every entry is a
                  three-part diff — so it opens as its own sheet instead. */}
              <button
                type="button"
                onClick={() => setShowLog(true)}
                className="w-full flex items-center gap-2 rounded-2xl border border-surface-200 bg-white px-4 py-3 font-black text-sm text-surface-900 hover:bg-surface-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <History size={16} className="text-surface-500" />
                سجل التغييرات
                {audit.rows && (
                  <span className="text-xs font-bold text-surface-500 tabular-nums">({audit.rows.length})</span>
                )}
                <ChevronLeft size={16} className="ms-auto text-surface-400" />
              </button>
            </aside>
          </div>
        </div>
      )}

      <Modal
        open={showLog && !!order}
        wide
        fullscreen={logFull}
        onToggleFullscreen={() => setLogFull(current => !current)}
        title={order ? `سجل التغييرات · ${order.orderNumber}` : 'سجل التغييرات'}
        onClose={() => setShowLog(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => void exportLog()}
              disabled={exporting || filteredAudit.length === 0}
              className={primaryButton}
            >
              <Sheet size={16} />
              {exporting
                ? 'جارٍ التجهيز…'
                : `تصدير Excel (${filteredAudit.length})`}
            </button>
            <button type="button" onClick={() => setShowLog(false)} className={ghostButton}>إغلاق</button>
            <span role="status" className="text-sm font-bold text-rose-700 self-center">{exportError}</span>
          </>
        }
      >
        {/* Non-admins are not refused here, they simply see nothing: the audit
            policy filters the rows away, so an empty list has two meanings and
            the message has to carry both. */}
        <RowsState
          rows={audit.rows}
          failed={audit.failed}
          empty="لا توجد تغييرات مسجّلة على هذا الطلب، أو أن السجل متاح لمديري النظام فقط."
        />

        {auditRows.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 pb-3 mb-3 border-b border-surface-200">
            <label className="text-xs font-bold text-surface-600">
              الإجراء
              <select
                value={logFilter.action}
                onChange={event => setFilter({ action: event.target.value })}
                className={logFilterClass}
              >
                <option value="">الكل</option>
                {actionChoices.map(action => (
                  <option key={action} value={action}>{ACTION_LABELS[action] ?? action}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-surface-600">
              الحقل
              <select
                value={logFilter.field}
                onChange={event => setFilter({ field: event.target.value })}
                className={logFilterClass}
              >
                <option value="">الكل</option>
                {fieldChoices.map(field => (
                  <option key={field} value={field}>{fieldLabel(field)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-surface-600">
              المستخدم
              <select
                value={logFilter.actor}
                onChange={event => setFilter({ actor: event.target.value })}
                className={logFilterClass}
              >
                <option value="">الكل</option>
                {actorChoices.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
            {isAuditFiltered(logFilter) && (
              <button
                type="button"
                onClick={() => { setLogFilter(emptyAuditFilter); setLogVisible(AUDIT_PAGES[0]); }}
                className="text-xs font-bold text-primary-800 hover:text-primary-900 rounded-lg px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                مسح الفلاتر
              </button>
            )}
            <span className="text-xs text-surface-500 tabular-nums ms-auto self-center">
              {filteredAudit.length} من {auditRows.length}
            </span>
          </div>
        )}

        {auditRows.length > 0 && filteredAudit.length === 0 && (
          <p className="text-sm text-surface-500 py-4">لا تغييرات تطابق الفلاتر المختارة.</p>
        )}

        <ul className="space-y-2">
          {shownAudit.map(row => {
            const changes = auditChanges(row.action, row.data, resolveValue);
            return (
              <li key={row.id} className="border border-surface-200 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-surface-700 bg-surface-100 border border-surface-200 rounded-lg px-2 py-1">
                    {ACTION_LABELS[row.action] ?? row.action}
                  </span>
                  <span className="text-xs text-surface-500 truncate">{describeActor(row, actors)}</span>
                  <span className="text-xs text-surface-400 tabular-nums ms-auto whitespace-nowrap">
                    {dateTime.format(new Date(row.changedAt))}
                  </span>
                </div>
                <p className="text-sm font-bold text-surface-900">
                  {auditSummary(row.action, changes, 'الطلب')}
                </p>
                {row.action === 'UPDATE' && (
                  <ul className="text-xs text-surface-600 space-y-0.5">
                    {changes.map(change => (
                      <li key={change.field} className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="font-bold text-surface-700">{change.label}:</span>
                        <span className="text-surface-400 line-through">{change.from}</span>
                        <span aria-hidden>←</span>
                        <span className="font-bold text-surface-900">{change.to}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        {filteredAudit.length > shownAudit.length && (
          <button
            type="button"
            onClick={() => setLogVisible(nextAuditPage)}
            className="w-full mt-3 rounded-xl border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm font-bold text-surface-700 hover:bg-surface-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            عرض المزيد ({Math.min(nextAuditPage(shownAudit.length), filteredAudit.length) - shownAudit.length}
            {' '}من {filteredAudit.length - shownAudit.length})
          </button>
        )}
      </Modal>
    </Modal>
  );
};
