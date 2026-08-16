import React, { useState } from 'react';
import { useAppStore } from '../store';
import { Plus, Package, ShoppingCart, TrendingUp, ChevronLeft, Store as StoreIcon, Pencil, Trash2, Facebook } from 'lucide-react';
import { motion } from 'motion/react';
import { useStoreTotals } from '../lib/queries';
import { deleteStore } from '../lib/mutations';
import { Confirm } from '../components/Confirm';
import { StoreForm } from '../components/forms';
import type { Store } from '../types';

const formatNumber = (value: number) => Math.round(value).toLocaleString('en-US');

// Caps the entrance stagger so a long list still finishes appearing quickly.
const STAGGER_CAP = 8;

export const Stores: React.FC<{ onOpenStore: (storeId: string) => void }> = ({ onOpenStore }) => {
  const { stores } = useAppStore();
  const [editing, setEditing] = useState<Store | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Store | null>(null);

  const totals = useStoreTotals();

  const iconButton =
    'inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg bg-white/90 backdrop-blur shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-surface-900">متاجرك</h3>
          <p className="text-surface-500 mt-1">افتح متجراً لإدارة منتجاته وطلباته وعملائه.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm shadow-primary-500/30 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Plus size={20} />
          <span>متجر جديد</span>
        </button>
      </div>

      {stores.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-500">
            <StoreIcon size={32} />
          </div>
          <h4 className="text-lg font-bold text-surface-900 mb-1">لا توجد متاجر بعد</h4>
          <p className="text-surface-500 mb-5">أنشئ متجرك الأول لتبدأ تسجيل المنتجات والطلبات.</p>
          <button
            onClick={() => setCreating(true)}
            className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <Plus size={20} />
            إنشاء متجر
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stores.map((store, i) => {
            const totalsFor = totals.get(store.id);
            return (
              <motion.div
                key={store.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, STAGGER_CAP) * 0.06 }}
                className="glass-card rounded-2xl overflow-hidden flex flex-col group relative"
              >
                <div className="absolute top-3 left-3 z-10 flex gap-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                  <button
                    onClick={() => setEditing(store)}
                    aria-label={`تعديل ${store.name}`}
                    title="تعديل"
                    className={`${iconButton} text-surface-600 hover:text-primary-700`}
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(store)}
                    aria-label={`حذف ${store.name}`}
                    title="حذف"
                    className={`${iconButton} text-surface-600 hover:text-rose-700`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>

                {/* Outside the card button: an <a> inside a <button> is invalid. */}
                {store.facebookPage && (
                  <a
                    href={store.facebookPage}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`صفحة ${store.name} على فيسبوك`}
                    title="صفحة فيسبوك"
                    className={`${iconButton} absolute top-3 right-3 z-10 text-surface-600 hover:text-[#1877f2]`}
                  >
                    <Facebook size={17} />
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => onOpenStore(store.id)}
                  aria-label={`فتح ${store.name}`}
                  className="flex-1 flex flex-col text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
                >
                  <div className="h-48 w-full relative overflow-hidden bg-surface-200">
                    {store.image && (
                      <img
                        src={store.image}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-surface-900/80 to-transparent" />
                    <div className="absolute bottom-4 right-4 left-4">
                      <h4 className="text-2xl font-black text-white drop-shadow-md">{store.name}</h4>
                      <p className="text-surface-100 text-sm font-medium mt-1 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        {totalsFor?.order_count ?? 0} طلب مسجّل
                      </p>
                      <p className="text-surface-200 text-xs font-mono mt-1" dir="ltr">{store.storeCode}</p>
                    </div>
                  </div>

                  <div className="p-5 flex-1 flex flex-col">
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { icon: TrendingUp, label: 'الأرباح', value: `${formatNumber(totalsFor?.total_profit ?? 0)} د.ل` },
                        { icon: ShoppingCart, label: 'الطلبات', value: formatNumber(totalsFor?.order_count ?? 0) },
                        { icon: Package, label: 'المنتجات', value: formatNumber(totalsFor?.product_count ?? 0) },
                      ].map(metric => (
                        <div key={metric.label} className="bg-surface-50 border border-surface-200 rounded-xl p-3 text-center">
                          <metric.icon size={16} className="mx-auto text-surface-500 mb-1.5" />
                          <b className="block text-sm font-black text-surface-900 tabular-nums">{metric.value}</b>
                          <span className="text-xs text-surface-500">{metric.label}</span>
                        </div>
                      ))}
                    </div>

                    {/* The doorway: the arrow steps toward the leading edge on the way in. */}
                    <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-100 group-hover:bg-primary-50 px-4 py-3 transition-colors">
                      <span className="font-bold text-surface-900 group-hover:text-primary-800 transition-colors">
                        إدارة المتجر
                      </span>
                      <ChevronLeft
                        size={20}
                        className="text-surface-500 group-hover:text-primary-700 transition-[color,transform] duration-300 group-hover:-translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                      />
                    </div>
                  </div>
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      <StoreForm
        open={creating || editing !== null}
        store={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <Confirm
        open={confirmDelete !== null}
        title="حذف المتجر"
        message={`سيتم حذف "${confirmDelete?.name ?? ''}" وكل منتجاته نهائياً. لا يمكن التراجع.`}
        confirmLabel="حذف"
        onConfirm={() => deleteStore(confirmDelete?.id ?? '')}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
