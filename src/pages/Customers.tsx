import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Plus, Search, Pencil, Trash2, MessageCircle, Phone, Star, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { PAGE_SIZE, useDimension, usePagedList } from '../lib/queries';
import { deleteCustomer } from '../lib/mutations';
import { Confirm } from '../components/Confirm';
import { CustomerForm } from '../components/forms';
import { Combobox } from '../components/Combobox';
import { Pagination } from '../components/ui';
import type { Customer } from '../types';
import type { PagedProps } from '../lib/route';

const STAGGER_CAP = 8;
const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;

export const Customers: React.FC<PagedProps> = ({ page, onPage }) => {
  const { zones, activeStoreId } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState<Customer['status'] | 'all'>('all');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

  const list = usePagedList<Customer>({
    table: 'customers',
    columns: 'id,storeId:store_id,code,name,phone,whatsapp,city,address,orderCount:order_count,totalSpent:total_spent,lastPurchase:last_purchase,rating,status',
    match: {
      store_id: activeStoreId ?? undefined,
      city: city || undefined,
      status: status === 'all' ? undefined : status,
    },
    search: searchTerm,
    orderBy: 'name',
    ascending: true,
    page,
  });
  const visibleCustomers = list.rows;

  // Order counts and spend are grouped in Postgres over every order.
  const totals = new Map(
    useDimension('customer', activeStoreId, 1000).map(r => [r.key, { orderCount: r.order_count, totalSpent: r.revenue }]),
  );

  // Cities come from the delivery zones now, the same list the customer form
  // writes from — so the filter offers every city a customer can have, not just
  // the ones in the first 200 rows.
  const cities = zones.map(zone => zone.name).sort((a, b) => a.localeCompare(b, 'ar'));

  const iconButton =
    'inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-surface-900">العملاء</h2>
          <p className="text-surface-500 mt-1">عملاء هذا المتجر. لكل متجر قائمته الخاصة.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm shadow-primary-500/30 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Plus size={20} />
          <span>عميل جديد</span>
        </button>
      </div>

      <div className="glass-card p-4 rounded-2xl flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-surface-400">
            <Search size={20} />
          </div>
          <input
            type="search"
            placeholder="ابحث بالاسم أو رقم الهاتف..."
            aria-label="ابحث في العملاء"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); onPage(0); }}
            className="w-full bg-surface-50 border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all font-medium text-sm"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Combobox
            label="تصفية حسب المدينة"
            value={city}
            onChange={value => { setCity(value); onPage(0); }}
            options={[{ value: '', label: 'كل المدن' }, ...cities.map(name => ({ value: name, label: name }))]}
            className="sm:w-48"
          />
          <Combobox
            label="تصفية حسب التصنيف"
            value={status}
            onChange={value => { setStatus(value as Customer['status'] | 'all'); onPage(0); }}
            options={[
              { value: 'all', label: 'كل التصنيفات' },
              { value: 'active', label: 'نشط' },
              { value: 'vip', label: 'مميز' },
              { value: 'inactive', label: 'غير نشط' },
            ]}
            className="sm:w-44"
          />
        </div>
      </div>

      {visibleCustomers.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-500">
            <Users size={32} />
          </div>
          <h3 className="text-lg font-bold text-surface-900 mb-1">لا يوجد عملاء</h3>
          <p className="text-surface-500">
            {searchTerm || city || status !== 'all' ? 'لم يطابق أي عميل معايير البحث.' : 'أضف أول عميل للبدء.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {visibleCustomers.map((customer, i) => {
            const totalsFor = totals.get(customer.id);
            return (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i, STAGGER_CAP) * 0.05 }}
                key={customer.id}
                className="glass-card p-6 rounded-2xl flex flex-col group relative"
              >
                <div className="absolute top-4 left-4 flex gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                  <button
                    onClick={() => setEditing(customer)}
                    aria-label={`تعديل ${customer.name}`}
                    title="تعديل"
                    className={`${iconButton} text-surface-500 hover:text-primary-700 hover:bg-primary-50`}
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(customer)}
                    aria-label={`حذف ${customer.name}`}
                    title="حذف"
                    className={`${iconButton} text-surface-500 hover:text-rose-700 hover:bg-rose-50`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>

                <div className="flex items-center gap-4 mb-5">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center text-primary-800 font-black text-2xl shadow-sm border border-primary-300/30 shrink-0">
                    {customer.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-surface-900 text-lg flex items-center gap-2 truncate">
                      <span className="truncate">{customer.name}</span>
                      {customer.status === 'vip' && (
                        <Star size={14} className="fill-amber-500 text-amber-500 shrink-0" aria-label="عميل مميز" />
                      )}
                    </h3>
                    <p className="text-surface-500 text-sm font-medium mt-0.5">{customer.city || 'بدون مدينة'}</p>
                  </div>
                </div>

                <div className="space-y-3 mb-6">
                  <a
                    href={customer.phone ? `tel:${customer.phone}` : undefined}
                    className={`flex items-center gap-3 text-sm rounded-lg -m-1 p-1 ${customer.phone ? 'hover:bg-surface-50' : 'pointer-events-none opacity-60'}`}
                  >
                    <span className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center text-surface-600 shrink-0">
                      <Phone size={16} />
                    </span>
                    <span className="font-semibold text-surface-700" dir="ltr">{customer.phone || '—'}</span>
                  </a>
                  <a
                    href={customer.whatsapp ? `https://wa.me/${customer.whatsapp.replace(/\D/g, '')}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex items-center gap-3 text-sm rounded-lg -m-1 p-1 ${customer.whatsapp ? 'hover:bg-surface-50' : 'pointer-events-none opacity-60'}`}
                  >
                    <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700 shrink-0">
                      <MessageCircle size={16} />
                    </span>
                    <span className="font-semibold text-surface-700" dir="ltr">{customer.whatsapp || '—'}</span>
                  </a>
                </div>

                <div className="mt-auto grid grid-cols-2 gap-4 pt-4 border-t border-surface-200/50">
                  <div>
                    <p className="text-xs text-surface-500 mb-1 font-medium">الطلبات</p>
                    <p className="font-bold text-surface-900 text-lg tabular-nums">{totalsFor?.orderCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-500 mb-1 font-medium">إجمالي المشتريات</p>
                    <p className="font-bold text-primary-800 text-lg tabular-nums">{money(totalsFor?.totalSpent ?? 0)}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />

      <CustomerForm
        open={creating || editing !== null}
        customer={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <Confirm
        open={confirmDelete !== null}
        title="حذف العميل"
        message={`سيتم حذف "${confirmDelete?.name ?? ''}" نهائياً. لا يمكن التراجع.`}
        confirmLabel="حذف"
        onConfirm={() => deleteCustomer(confirmDelete?.id ?? '')}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
