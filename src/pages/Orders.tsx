import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Plus, Search, Eye, Truck, CheckCircle2, ShoppingCart, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { OrderStatus } from '../types';
import { statusLabels } from '../lib/dashboardStats';
import { PAGE_SIZE, useDimension, usePagedList } from '../lib/queries';
import { deleteOrders, setOrderStatus } from '../lib/mutations';
import { Confirm, ErrorNote } from '../components/Confirm';
import { OrderDetails, OrderForm } from '../components/orderForms';
import { Combobox } from '../components/Combobox';
import { Pagination } from '../components/ui';
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

export const Orders: React.FC<PagedProps> = ({ page, onPage }) => {
  const { stores, pickerProducts, pickerCustomers, zones, activeStoreId } = useAppStore();
  const [activeFilter, setActiveFilter] = useState<OrderStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  const list = usePagedList<Order>({
    table: 'orders',
    columns: 'id,orderNumber:order_number,storeId:store_id,customerId:customer_id,customerName:customer_name,items,subtotal,discount,deliveryFee:delivery_fee,total,status,notes,createdAt:created_at,deliveryDate:delivery_date,agentId:agent_id',
    match: { store_id: activeStoreId ?? undefined, status: activeFilter === 'all' ? undefined : activeFilter },
    search: searchTerm,
    orderBy: 'created_at',
    ascending: sort === 'oldest',
    page,
  });
  const visibleOrders = list.rows;

  // Tab badges count the whole table per status. Counting the loaded page here
  // would show plausible numbers that describe 24 rows instead of the store.
  const statusCounts = new Map(useDimension('status', activeStoreId).map(r => [r.key, r.order_count]));
  const totalOrders = [...statusCounts.values()].reduce((sum, n) => sum + n, 0);

  const storeProducts = pickerProducts.filter(p => p.storeId === activeStoreId);
  const allVisibleSelected = visibleOrders.length > 0 && visibleOrders.every(o => selected.has(o.id));

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

  const actionsVisibility = 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100';
  const actionButton =
    'inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-0 md:min-h-0 p-2.5 md:p-1.5 rounded-lg transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

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
          const count = status === 'all' ? totalOrders : (statusCounts.get(status) ?? 0);
          return (
            <button
              key={status}
              onClick={() => { setActiveFilter(status); onPage(0); }}
              aria-pressed={activeFilter === status}
              className={`whitespace-nowrap px-4 py-2 rounded-xl font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                activeFilter === status ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
              }`}
            >
              {status === 'all' ? 'الكل' : statusLabels[status]} ({count})
            </button>
          );
        })}
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-surface-200/50 flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-surface-400">
              <Search size={20} />
            </div>
            <input
              type="search"
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); onPage(0); }}
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
        </div>

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
                          <div key={idx} className="w-8 h-8 rounded-lg bg-surface-100 overflow-hidden shrink-0 border border-surface-200" title={item.productName}>
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
          </table>
        </div>

        {visibleOrders.length === 0 && (
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-500">
              <ShoppingCart size={32} />
            </div>
            <h3 className="text-lg font-bold text-surface-900 mb-1">لا توجد طلبات</h3>
            <p className="text-surface-500">
              {searchTerm || activeFilter !== 'all' ? 'لم يطابق أي طلب معايير البحث.' : 'أنشئ أول طلب لهذا المتجر.'}
            </p>
          </div>
        )}

        <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />
      </div>

      <OrderDetails order={visibleOrders.find(o => o.id === detailsId) ?? null} onClose={() => setDetailsId(null)} />

      <OrderForm
        open={creating}
        storeId={activeStoreId ?? ''}
        products={storeProducts}
        customers={pickerCustomers}
        orders={visibleOrders}
        zones={zones}
        onClose={() => setCreating(false)}
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
