import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { Plus, Search, Eye, Truck, CheckCircle2, ShoppingCart, Trash2, X, Pencil, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { OrderStatus } from '../types';
import { statusLabels } from '../lib/dashboardStats';
import { PAGE_SIZE, useDimension, useOrderTotals, usePagedList } from '../lib/queries';
import { emptyOrderFilters, isFiltered, orderRangeFilters, type OrderFilters } from '../lib/orderFilters';
import { deleteOrders, setOrderAgent, setOrderStatus } from '../lib/mutations';
import { orderBulk } from '../lib/bulk';
import { Confirm, ErrorNote } from '../components/Confirm';
import { OrderDetails } from '../components/orderDetails';
import { OrderForm } from '../components/orderForms';
import { Combobox } from '../components/Combobox';
import { BulkBar } from '../components/BulkBar';
import { Pagination, quietButton } from '../components/ui';
import type { Order } from '../types';
import type { PagedProps } from '../lib/route';

const ALL_STATUSES: OrderStatus[] = ['new', 'confirmed', 'processing', 'shipped', 'delivered', 'canceled', 'returned'];

const statusStyles: Record<OrderStatus, string> = {
  new: 'bg-blue-50 text-blue-800 border-blue-200',
  confirmed: 'bg-purple-50 text-purple-800 border-purple-200',
  processing: 'bg-amber-50 text-amber-800 border-amber-200',
  shipped: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  delivered: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  canceled: 'bg-rose-50 text-rose-800 border-rose-200',
  returned: 'bg-slate-50 text-slate-800 border-slate-200',
};

const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;

const dateField =
  'w-full bg-white border border-surface-200 rounded-xl px-3 py-2 text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

export const Orders: React.FC<PagedProps> = ({ page, onPage }) => {
  const { stores, pickerProducts, pickerCustomers, zones, salesReps, activeStoreId, sharedStoreIds } = useAppStore();
  const [filters, setFilters] = useState<OrderFilters>(() => emptyOrderFilters(activeStoreId));
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  // The store comes from the shell, not from the filter bar, so it is refreshed
  // rather than stored twice.
  const active: OrderFilters = { ...filters, storeId: activeStoreId };

  /** Any filter change invalidates the current offset. */
  const set = <K extends keyof OrderFilters>(field: K, value: OrderFilters[K]) => {
    setFilters(current => ({ ...current, [field]: value }));
    onPage(0);
  };

  const list = usePagedList<Order>({
    table: 'orders',
    columns: 'id,orderNumber:order_number,storeId:store_id,customerId:customer_id,customerName:customer_name,items,subtotal,discount,deliveryFee:delivery_fee,total,status,notes,createdAt:created_at,deliveryDate:delivery_date,agentId:agent_id,zoneId:zone_id',
    match: {
      store_id: activeStoreId ?? undefined,
      status: active.status || undefined,
      agent_id: active.agentId || undefined,
      zone_id: active.zoneId || undefined,
    },
    filters: orderRangeFilters(active),
    search: active.search,
    orderBy: 'created_at',
    ascending: sort === 'oldest',
    page,
  });
  const visibleOrders = list.rows;

  // Totals for every order the filters match, computed in Postgres. Summing the
  // loaded page here would print a plausible number that describes 24 rows.
  const totals = useOrderTotals(active);

  // Tab badges count the whole table per status, and ignore the other filters —
  // they are how you see what the other statuses hold.
  const statusCounts = new Map(useDimension('status', activeStoreId).map(r => [r.key, r.order_count]));
  const totalOrders = [...statusCounts.values()].reduce((sum, n) => sum + n, 0);

  const storeProducts = pickerProducts.filter(p => p.storeId === activeStoreId);
  const allVisibleSelected = visibleOrders.length > 0 && visibleOrders.every(o => selected.has(o.id));

  // Rebuilt only when the store or the reference lists change; a new object per
  // render would restart BulkBar's state on every keystroke in the search box.
  const bulkSpec = useMemo(
    () => orderBulk(activeStoreId ?? '', { zones, salesReps }),
    [activeStoreId, zones, salesReps],
  );

  const toggle = (id: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visibleOrders.map(o => o.id)));

  const applyStatus = async (ids: string[], status: OrderStatus) => {
    setPendingId(ids.length === 1 ? ids[0] : 'bulk');
    setError('');
    const result = await setOrderStatus(ids, status);
    setPendingId(null);
    if (result.ok) setSelected(new Set());
    else setError(result.message ?? "");
  };

  /**
   * Reassignment after the fact, which is the normal case: a rep calls in sick,
   * or leaves and their orders need a new owner. Without this the rep chosen
   * while composing the order would be the only one it could ever have.
   */
  const applyAgent = async (ids: string[], agentId: string) => {
    setPendingId('bulk');
    setError('');
    const result = await setOrderAgent(ids, agentId || null);
    setPendingId(null);
    if (result.ok) setSelected(new Set());
    else setError(result.message ?? '');
  };

  const actionsVisibility = 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100';
  const actionButton =
    'inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-2.5 md:p-1.5 rounded-lg transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  const pageTotal = visibleOrders.reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-surface-900">الطلبات</h2>
          <p className="text-surface-500 mt-1">تتبع وإدارة طلبات العملاء</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm shadow-primary-500/30 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Plus size={20} />
          <span>طلب جديد</span>
        </button>
      </div>

      {error && <ErrorNote message={error} />}

      {/* Status tabs */}
      <div className="flex overflow-x-auto no-scrollbar gap-2 pb-2">
        {(['all', ...ALL_STATUSES] as const).map(status => {
          const value = status === 'all' ? '' : status;
          const count = status === 'all' ? totalOrders : (statusCounts.get(status) ?? 0);
          return (
            <button
              key={status}
              onClick={() => set('status', value)}
              aria-pressed={active.status === value}
              className={`whitespace-nowrap px-4 py-2 rounded-xl font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                active.status === value ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
              }`}
            >
              {status === 'all' ? 'الكل' : statusLabels[status]} ({count})
            </button>
          );
        })}
      </div>

      <BulkBar
        spec={bulkSpec}
        title="استيراد وتصدير الطلبات"
        hint="يقبل Excel و CSV وملفات Google Sheets المصدَّرة. الطلب الموجود يُحدَّث، والجديد يُنشأ بنفس قواعد المخزون — المطابقة بالمعرّف ثم برقم الطلب. عمود المنتجات بالصيغة: SKU * الكمية @ السعر # المقاس، ويُفصل بين المنتجات بفاصلة منقوطة. العميل يجب أن يكون موجوداً مسبقاً، والإجمالي يُحسب من السطور."
      />

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-surface-200/50 flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-surface-400">
              <Search size={20} />
            </div>
            <input
              type="search"
              value={active.search}
              onChange={e => set('search', e.target.value)}
              placeholder="ابحث برقم الطلب أو اسم العميل..."
              aria-label="ابحث في الطلبات"
              className="w-full bg-surface-50 border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all font-medium text-sm"
            />
          </div>
          <Combobox
            label="ترتيب الطلبات"
            value={sort}
            onChange={value => { setSort(value as 'newest' | 'oldest'); onPage(0); }}
            options={[
              { value: 'newest', label: 'الأحدث أولاً' },
              { value: 'oldest', label: 'الأقدم أولاً' },
            ]}
            className="md:w-48"
          />
          <button
            type="button"
            onClick={() => setShowFilters(current => !current)}
            aria-expanded={showFilters}
            className={`${quietButton} md:w-auto ${isFiltered(active) ? 'border-primary-300 text-primary-800 bg-primary-50' : ''}`}
          >
            <SlidersHorizontal size={16} />
            تصفية
          </button>
        </div>

        {showFilters && (
          <div className="p-4 border-b border-surface-200/50 bg-surface-50/60 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <Combobox
              showLabel
              label="المنطقة"
              value={active.zoneId}
              onChange={value => set('zoneId', value)}
              options={[
                { value: '', label: 'كل المناطق' },
                ...zones.map(zone => ({ value: zone.id, label: zone.name, hint: zone.code })),
              ]}
            />
            <Combobox
              showLabel
              label="المندوب"
              value={active.agentId}
              onChange={value => set('agentId', value)}
              options={[
                { value: '', label: 'كل المندوبين' },
                ...salesReps.map(rep => ({
                  value: rep.id,
                  label: rep.name,
                  hint: rep.zones.length > 0 ? rep.zones.join('، ') : 'كل المناطق',
                })),
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">من تاريخ</span>
                <input type="date" value={active.from} onChange={e => set('from', e.target.value)} className={dateField} />
              </label>
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">إلى تاريخ</span>
                <input type="date" value={active.to} onChange={e => set('to', e.target.value)} className={dateField} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">إجمالي من (د.ل)</span>
                <input type="number" min={0} inputMode="decimal" value={active.minTotal} onChange={e => set('minTotal', e.target.value)} className={dateField} />
              </label>
              <label className="block">
                <span className="block text-sm font-bold text-surface-700 mb-1.5">إلى (د.ل)</span>
                <input type="number" min={0} inputMode="decimal" value={active.maxTotal} onChange={e => set('maxTotal', e.target.value)} className={dateField} />
              </label>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => { setFilters(emptyOrderFilters(activeStoreId)); onPage(0); }}
                disabled={!isFiltered(active)}
                className={`${quietButton} disabled:opacity-50`}
              >
                <X size={16} />
                مسح المرشّحات
              </button>
            </div>
          </div>
        )}

        {selected.size > 0 && (
          <div className="p-3 bg-primary-50 border-b border-primary-100 flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm text-primary-900 me-auto">{selected.size} طلب محدد</span>
            {(['processing', 'shipped', 'delivered'] as OrderStatus[]).map(status => (
              <button
                key={status}
                onClick={() => applyStatus([...selected], status)}
                disabled={pendingId !== null}
                className="text-xs font-bold bg-white border border-primary-200 text-primary-800 rounded-lg px-3 py-2 hover:bg-primary-100 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {statusLabels[status]}
              </button>
            ))}
            {salesReps.length > 0 && (
              <Combobox
                size="sm"
                label="إسناد إلى مندوب"
                value=""
                onChange={agentId => void applyAgent([...selected], agentId)}
                options={[
                  { value: '', label: 'بدون مندوب' },
                  ...salesReps.filter(rep => rep.active).map(rep => ({
                    value: rep.id,
                    label: rep.name,
                    hint: rep.zones.length > 0 ? rep.zones.join('، ') : 'كل المناطق',
                  })),
                ]}
                disabled={pendingId !== null}
                placeholder="إسناد إلى مندوب"
                className="w-44"
              />
            )}
            <button
              onClick={() => setConfirmDelete([...selected])}
              disabled={pendingId !== null}
              className="text-xs font-bold bg-white border border-rose-200 text-rose-800 rounded-lg px-3 py-2 hover:bg-rose-50 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              حذف
            </button>
            <button
              onClick={() => setSelected(new Set())}
              aria-label="إلغاء التحديد"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-primary-800 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-surface-50/50 text-surface-500 font-medium">
              <tr>
                <th className="px-6 py-4 w-12">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="تحديد كل الطلبات المعروضة"
                    className="w-4 h-4 rounded border-surface-300 text-primary-700 focus:ring-primary-500"
                  />
                </th>
                <th className="px-6 py-4">رقم الطلب</th>
                <th className="px-6 py-4">العميل</th>
                <th className="px-6 py-4">المتجر</th>
                <th className="px-6 py-4">المنتجات</th>
                <th className="px-6 py-4">الإجمالي</th>
                <th className="px-6 py-4">الحالة</th>
                <th className="px-6 py-4">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200/50">
              {visibleOrders.map((order, i) => {
                const store = stores.find(s => s.id === order.storeId);
                const busy = pendingId === order.id || pendingId === 'bulk';
                return (
                  <motion.tr
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 10) * 0.03 }}
                    key={order.id}
                    className="hover:bg-surface-50/50 transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={() => toggle(order.id)}
                        aria-label={`تحديد الطلب ${order.orderNumber}`}
                        className="w-4 h-4 rounded border-surface-300 text-primary-700 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-surface-900">{order.orderNumber}</div>
                      <div className="text-xs text-surface-500 mt-1">{new Date(order.createdAt).toLocaleDateString('ar-LY')}</div>
                    </td>
                    <td className="px-6 py-4 font-semibold text-surface-900">{order.customerName}</td>
                    <td className="px-6 py-4 text-surface-600 font-medium">{store?.name}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        {order.items.slice(0, 2).map((item, idx) => (
                          <div key={idx} className="w-8 h-8 rounded-lg bg-surface-100 overflow-hidden shrink-0 border border-surface-200" title={`${item.productName}${item.size ? ` · ${item.size}` : ''}`}>
                            {item.image && <img src={item.image} alt="" loading="lazy" className="w-full h-full object-cover" />}
                          </div>
                        ))}
                        {order.items.length > 2 && (
                          <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center text-xs font-bold text-surface-600 border border-surface-200">
                            +{order.items.length - 2}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-black text-surface-900 tabular-nums">{money(order.total)}</td>
                    <td className="px-6 py-4">
                      <Combobox
                        size="sm"
                        label={`حالة الطلب ${order.orderNumber}`}
                        value={order.status}
                        disabled={busy}
                        onChange={value => applyStatus([order.id], value as OrderStatus)}
                        options={ALL_STATUSES.map(status => ({ value: status, label: statusLabels[status] }))}
                        tone={`border ${statusStyles[order.status]}`}
                        className="min-w-32"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className={`flex items-center gap-1 md:gap-2 transition-opacity ${actionsVisibility}`}>
                        <button
                          onClick={() => setDetailsId(order.id)}
                          className={`${actionButton} text-surface-500 hover:text-primary-700 hover:bg-primary-50`}
                          aria-label={`عرض تفاصيل ${order.orderNumber}`} title="عرض التفاصيل"
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          onClick={() => setEditing(order)}
                          disabled={busy}
                          className={`${actionButton} text-surface-500 hover:text-primary-700 hover:bg-primary-50`}
                          aria-label={`تعديل ${order.orderNumber}`} title="تعديل الطلب"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          onClick={() => applyStatus([order.id], 'shipped')}
                          disabled={busy || order.status === 'shipped'}
                          className={`${actionButton} text-surface-500 hover:text-indigo-700 hover:bg-indigo-50`}
                          aria-label={`تغيير ${order.orderNumber} إلى قيد الشحن`} title="تغيير إلى قيد الشحن"
                        >
                          <Truck size={18} />
                        </button>
                        <button
                          onClick={() => applyStatus([order.id], 'delivered')}
                          disabled={busy || order.status === 'delivered'}
                          className={`${actionButton} text-surface-500 hover:text-emerald-700 hover:bg-emerald-50`}
                          aria-label={`تغيير ${order.orderNumber} إلى تم التسليم`} title="تغيير إلى تم التسليم"
                        >
                          <CheckCircle2 size={18} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete([order.id])}
                          disabled={busy}
                          className={`${actionButton} text-surface-500 hover:text-rose-700 hover:bg-rose-50`}
                          aria-label={`حذف ${order.orderNumber}`} title="حذف الطلب"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>

            {/* Two rows on purpose: what is on screen, and what the filters
                actually select. Printing only the first is the mistake this
                table is trying not to make. */}
            {visibleOrders.length > 0 && (
              <tfoot className="bg-surface-50/80 border-t-2 border-surface-200 font-bold text-surface-900">
                <tr>
                  <td className="px-6 py-3" colSpan={5}>إجمالي هذه الصفحة ({visibleOrders.length} طلب)</td>
                  <td className="px-6 py-3 tabular-nums">{money(pageTotal)}</td>
                  <td className="px-6 py-3" colSpan={2} />
                </tr>
                {totals && (
                  <tr className="border-t border-surface-200">
                    <td className="px-6 py-3" colSpan={5}>
                      إجمالي كل النتائج ({totals.order_count.toLocaleString('en-US')} طلب · {totals.units.toLocaleString('en-US')} قطعة)
                      <span className="font-medium text-surface-500 text-xs block mt-0.5">
                        قبل الخصم {money(totals.subtotal)} · الخصم −{money(totals.discount)} · التوصيل {money(totals.delivery_fee)}
                      </span>
                    </td>
                    <td className="px-6 py-3 tabular-nums text-lg font-black">{money(totals.total)}</td>
                    <td className="px-6 py-3" colSpan={2} />
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>

        {visibleOrders.length === 0 && (
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-500">
              <ShoppingCart size={32} />
            </div>
            <h3 className="text-lg font-bold text-surface-900 mb-1">لا توجد طلبات</h3>
            <p className="text-surface-500">
              {isFiltered(active) ? 'لم يطابق أي طلب معايير البحث.' : 'أنشئ أول طلب لهذا المتجر.'}
            </p>
          </div>
        )}

        <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />
      </div>

      <OrderDetails
        order={visibleOrders.find(o => o.id === detailsId) ?? null}
        salesReps={salesReps}
        zones={zones}
        onClose={() => setDetailsId(null)}
      />

      <OrderForm
        open={creating || editing !== null}
        order={editing}
        storeId={activeStoreId ?? ''}
        products={storeProducts}
        customers={pickerCustomers}
        zones={zones}
        salesReps={salesReps}
        customerStoreIds={sharedStoreIds}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <Confirm
        open={confirmDelete !== null}
        title={confirmDelete && confirmDelete.length > 1 ? 'حذف الطلبات' : 'حذف الطلب'}
        message={
          confirmDelete && confirmDelete.length > 1
            ? `سيتم حذف ${confirmDelete.length} طلبات نهائياً. لا يمكن التراجع.`
            : 'سيتم حذف الطلب نهائياً. لا يمكن التراجع.'
        }
        confirmLabel="حذف"
        onConfirm={async () => {
          const result = await deleteOrders(confirmDelete ?? []);
          if (result.ok) setSelected(new Set());
          return result;
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
