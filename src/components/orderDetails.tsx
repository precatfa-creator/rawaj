import React, { useEffect, useState } from 'react';
import { ClipboardList, History, Package, Receipt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Modal } from './Modal';
import { OrderTracking } from './OrderTracking';
import { supabase } from '../db/supabase';
import { statusLabels } from '../lib/dashboardStats';
import { orderCommission } from '../lib/commission';
import type { DeliveryZone, Order, SalesRep, StockKind } from '../types';

const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;

const dateTime = (value: string) =>
  new Date(value).toLocaleString('ar-LY', { dateStyle: 'medium', timeStyle: 'short' });

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

/** The order columns worth naming in Arabic when the audit trail lists them. */
const FIELD_LABELS: Record<string, string> = {
  status: 'الحالة',
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
  actorRole: string;
  changedAt: string;
  changedFields: string[] | null;
}

type TabId = 'overview' | 'items' | 'movements' | 'log';

/** Below `sm` the dialog opens filled: four tabs and a five-step tracker do
 *  not fit a floating panel at 360px. */
const startsFullscreen = () => window.innerWidth < 640;

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'نظرة عامة', icon: ClipboardList },
  { id: 'items', label: 'المنتجات والمالية', icon: Receipt },
  { id: 'movements', label: 'حركات المخزون', icon: Package },
  { id: 'log', label: 'سجل التغييرات', icon: History },
];

/**
 * Loads a tab's rows the first time that tab is opened, and again if the order
 * changes underneath it.
 *
 * Lazy on purpose: three of the four tabs are a round trip each, and most
 * people open the dialog to read the first one and close it again.
 */
const useTabRows = <T,>(active: boolean, orderId: string | null, load: (id: string) => Promise<T[]>) => {
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
    // A second dialog opened before the first request lands must not paint the
    // previous order's rows under the new order's number.
    return () => { cancelled = true; };
    // `load` is deliberately not a dependency: every caller passes a
    // module-level function. An inline closure here would refetch every render.
  }, [active, orderId]);

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
    .select('id,action,actorRole:actor_role,changedAt:changed_at,changedFields:changed_fields')
    .eq('table_name', 'orders')
    .eq('record_id', orderId)
    .order('changed_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as AuditRow[];
};

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="bg-surface-50 border border-surface-200 rounded-xl p-3">
    <dt className="text-surface-500 text-xs">{label}</dt>
    <dd className="font-bold text-surface-900 mt-1">{value}</dd>
  </div>
);

/** Same three states everywhere: still loading, refused, or genuinely empty. */
const RowsState: React.FC<{ rows: unknown[] | null; failed: boolean; empty: string; denied?: string }> = ({
  rows, failed, empty, denied,
}) => {
  if (failed) {
    return (
      <p className="text-center text-surface-500 py-8">
        {denied ?? 'تعذر تحميل البيانات. تحقق من الاتصال وحاول مجدداً.'}
      </p>
    );
  }
  if (rows === null) return <p className="text-center text-surface-400 py-8">جارٍ التحميل…</p>;
  if (rows.length === 0) return <p className="text-center text-surface-500 py-8">{empty}</p>;
  return null;
};

export const OrderDetails: React.FC<{
  order: Order | null;
  salesReps: SalesRep[];
  zones: DeliveryZone[];
  onClose: () => void;
}> = ({ order, salesReps, zones, onClose }) => {
  const [tab, setTab] = useState<TabId>('overview');
  const [fullscreen, setFullscreen] = useState(startsFullscreen);

  const rep = salesReps.find(item => item.id === order?.agentId);
  const zone = zones.find(item => item.id === order?.zoneId);

  const movements = useTabRows<MovementRow>(tab === 'movements', order?.id ?? null, loadMovements);
  const audit = useTabRows<AuditRow>(tab === 'log', order?.id ?? null, loadAudit);

  // Every order opens on its own overview; keeping the last tab would show one
  // order's stock ledger under another order's heading.
  useEffect(() => {
    setTab('overview');
    setFullscreen(startsFullscreen());
  }, [order?.id]);

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
        <div className="space-y-5">
          <div role="tablist" aria-label="أقسام الطلب" className="flex gap-1.5 overflow-x-auto no-scrollbar bg-surface-100 rounded-2xl p-1.5">
            {TABS.map(item => {
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  role="tab"
                  id={`order-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls={`order-panel-${item.id}`}
                  onClick={() => setTab(item.id)}
                  className={`relative flex-1 whitespace-nowrap inline-flex items-center justify-center gap-2 min-h-10 px-3 rounded-xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    selected ? 'text-primary-800' : 'text-surface-600 hover:text-surface-900'
                  }`}
                >
                  {selected && (
                    <motion.span
                      layoutId="orderTabIndicator"
                      className="absolute inset-0 bg-white rounded-xl shadow-sm"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <item.icon size={16} className="relative shrink-0" />
                  <span className="relative">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div id={`order-panel-${tab}`} role="tabpanel" aria-labelledby={`order-tab-${tab}`}>
            {tab === 'overview' && (
              <div className="space-y-5">
                <OrderTracking order={order} rep={rep} />

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <Fact label="العميل" value={order.customerName} />
                  <Fact label="الحالة" value={statusLabels[order.status] ?? order.status} />
                  <Fact label="تاريخ الإنشاء" value={new Date(order.createdAt).toLocaleDateString('ar-LY')} />
                  <Fact label="المنطقة" value={zone?.name ?? 'بدون منطقة'} />
                  <Fact label="المندوب" value={rep?.name ?? 'بدون مندوب'} />
                  {rep && (
                    <Fact
                      label="عمولة المندوب"
                      value={money(orderCommission(order.deliveryFee, zone, rep.commission))}
                    />
                  )}
                  <Fact label="عدد القطع" value={order.items.reduce((sum, item) => sum + item.quantity, 0)} />
                  <Fact label="الإجمالي" value={money(order.total)} />
                </dl>

                {order.notes && (
                  <div>
                    <h4 className="text-sm font-bold text-surface-700 mb-1.5">ملاحظات</h4>
                    <p className="text-surface-700 bg-surface-50 border border-surface-200 rounded-xl p-3">{order.notes}</p>
                  </div>
                )}
              </div>
            )}

            {tab === 'items' && (
              <div className="space-y-5">
                <ul className="space-y-2">
                  {order.items.map((item, index) => (
                    <li key={`${item.productId}-${item.size ?? ''}-${index}`} className="flex items-center gap-3 border border-surface-200 rounded-xl p-3">
                      {item.image && <img src={item.image} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover border border-surface-200" />}
                      <span className="flex-1 font-semibold text-surface-900 truncate">
                        {item.productName}
                        {item.size && <span className="text-surface-500 font-medium"> · مقاس {item.size}</span>}
                      </span>
                      <span className="text-sm text-surface-500 tabular-nums">{item.quantity} × {money(item.price)}</span>
                      <span className="font-bold tabular-nums">{money(item.quantity * item.price)}</span>
                    </li>
                  ))}
                </ul>

                <dl className="bg-surface-50 border border-surface-200 rounded-xl p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-surface-500">المجموع الفرعي</dt><dd className="font-bold tabular-nums">{money(order.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-surface-500">الخصم</dt><dd className="font-bold tabular-nums">−{money(order.discount)}</dd></div>
                  <div className="flex justify-between"><dt className="text-surface-500">التوصيل</dt><dd className="font-bold tabular-nums">{money(order.deliveryFee)}</dd></div>
                  {rep && (
                    <div className="flex justify-between">
                      <dt className="text-surface-500">عمولة المندوب ({rep.name})</dt>
                      <dd className="font-bold tabular-nums">{money(orderCommission(order.deliveryFee, zone, rep.commission))}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-surface-200 pt-1.5 mt-1.5"><dt className="font-bold text-surface-900">الإجمالي</dt><dd className="font-black text-lg tabular-nums">{money(order.total)}</dd></div>
                </dl>
              </div>
            )}

            {tab === 'movements' && (
              <div className="space-y-2">
                <RowsState
                  rows={movements.rows}
                  failed={movements.failed}
                  empty="لا توجد حركات مخزون مرتبطة بهذا الطلب."
                />
                {movements.rows?.map(row => (
                  <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-surface-200 rounded-xl p-3">
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
                    <span className="text-xs text-surface-500 w-full sm:w-auto">{dateTime(row.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'log' && (
              <div className="space-y-2">
                {/* Non-admins are not refused here, they simply see nothing:
                    the audit policy filters the rows away, so an empty list has
                    two meanings and the message has to carry both. */}
                <RowsState
                  rows={audit.rows}
                  failed={audit.failed}
                  empty="لا توجد تغييرات مسجّلة على هذا الطلب، أو أن السجل متاح لمديري النظام فقط."
                />
                {audit.rows?.map(row => (
                  <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-surface-200 rounded-xl p-3">
                    <span className="text-xs font-bold text-surface-700 bg-surface-100 border border-surface-200 rounded-lg px-2 py-1">
                      {ACTION_LABELS[row.action] ?? row.action}
                    </span>
                    <span className="flex-1 min-w-40 text-sm text-surface-700">
                      {row.changedFields && row.changedFields.length > 0
                        ? row.changedFields.map(field => FIELD_LABELS[field] ?? field).join('، ')
                        : 'لا تفاصيل حقول'}
                    </span>
                    <span className="text-xs text-surface-500">{row.actorRole || 'غير معروف'}</span>
                    <span className="text-xs text-surface-500">{dateTime(row.changedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
