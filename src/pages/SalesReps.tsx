import React, { useState } from 'react';
import { MessageCircle, Pencil, Phone, Plus, Search, Trash2, Truck, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import { useAppStore } from '../store';
import { matchesSearch } from '../lib/arabic';
import { useSalesRepTotals } from '../lib/queries';
import { describeCommission } from '../lib/commission';
import { deleteSalesRep } from '../lib/mutations';
import { Confirm } from '../components/Confirm';
import { Combobox } from '../components/Combobox';
import { SalesRepForm } from '../components/forms';
import { Card, EmptyState, Metric, PageHead, Pill, actionButton, count, money } from '../components/ui';
import type { SalesRep } from '../types';

const STAGGER_CAP = 10;

/**
 * Sales representatives, scoped to the store being managed for its numbers but
 * not for the roster: a rep works for the business, and the same person carries
 * orders for more than one store. Totals therefore count this store's orders,
 * while the list itself is every rep.
 */
export const SalesReps: React.FC = () => {
  const { salesReps, zones, activeStoreId } = useAppStore();
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('all');
  const [editing, setEditing] = useState<SalesRep | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SalesRep | null>(null);

  const totals = useSalesRepTotals(activeStoreId);

  const visible = salesReps
    .filter(rep => zone === 'all'
      || (zone === 'none' ? rep.zones.length === 0 : rep.zones.includes(zone)))
    .filter(rep => matchesSearch(rep.name, search) || matchesSearch(rep.phone, search));

  const activeCount = salesReps.filter(rep => rep.active).length;
  const commissionDue = salesReps.reduce((sum, rep) => sum + (totals.get(rep.id)?.commission_due ?? 0), 0);
  const delivered = salesReps.reduce((sum, rep) => sum + (totals.get(rep.id)?.realized_count ?? 0), 0);

  const zonesWithCommission = zones.filter(zone => zone.commissionType !== 'none');

  const zoneOptions = [
    { value: 'all', label: 'كل المناطق' },
    { value: 'none', label: 'بدون منطقة' },
    ...zones.map(z => ({ value: z.name, label: z.name, hint: z.code })),
  ];

  const iconButton =
    'w-9 h-9 grid place-items-center rounded-lg text-surface-500 transition-colors focus-visible:outline-none focus-visible:ring-2';

  return (
    <div className="space-y-6">
      <PageHead title="المندوبين" subtitle="من يوصّل الطلبات، ومنطقة كل واحد وعمولته.">
        <button onClick={() => setCreating(true)} className={actionButton}>
          <Plus size={20} />
          مندوب جديد
        </button>
      </PageHead>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric
          label="مندوبون على رأس العمل"
          value={`${count(activeCount)} / ${count(salesReps.length)}`}
          icon={<Truck size={18} />}
        />
        <Metric label="طلبات هذا المتجر" value={count(delivered)} hint="غير الملغاة والمرتجعة" />
        <Metric
          label="عمولات مستحقة"
          value={money(commissionDue)}
          hint="عن الطلبات المسلَّمة من هذا المتجر"
          icon={<Wallet size={18} />}
        />
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو رقم الهاتف…"
            aria-label="ابحث في المندوبين"
            className="w-full bg-white border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
          />
        </div>
        <Combobox label="منطقة التغطية" value={zone} onChange={setZone} options={zoneOptions} className="md:w-56" />
      </Card>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Truck size={30} />}
          title="لا يوجد مندوبون"
          body={salesReps.length === 0 ? 'أضف أول مندوب لتتمكن من إسناد الطلبات إليه.' : 'لم يطابق أي مندوب البحث.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((rep, i) => {
            const repTotals = totals.get(rep.id);
            return (
              <motion.div
                key={rep.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, STAGGER_CAP) * 0.03 }}
              >
                <Card className={`p-5 h-full flex flex-col group ${rep.active ? '' : 'opacity-70'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 grid place-items-center text-primary-800 font-black text-lg border border-primary-300/30">
                        {rep.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-lg text-surface-900 truncate">{rep.name}</h3>
                        {rep.code && <p className="text-xs text-surface-500 mt-0.5" dir="ltr">{rep.code}</p>}
                        <p className="text-sm text-surface-500 mt-0.5 truncate">
                          {rep.zones.length > 0 ? rep.zones.join('، ') : 'كل المناطق'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button
                        onClick={() => setEditing(rep)}
                        aria-label={`تعديل ${rep.name}`}
                        title="تعديل"
                        className={`${iconButton} hover:text-primary-700 hover:bg-primary-50 focus-visible:ring-primary-500`}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(rep)}
                        aria-label={`حذف ${rep.name}`}
                        title="حذف"
                        className={`${iconButton} hover:text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-500`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    <Pill tone={rep.active
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-surface-100 text-surface-600 border-surface-200'}>
                      {rep.active ? 'على رأس العمل' : 'موقوف'}
                    </Pill>
                    {rep.commission > 0 && <Pill>{money(rep.commission)} لكل طلب</Pill>}
                    {/* Zones that price their own commission override the flat
                        amount above, so the card says which ones do. */}
                    {(rep.zones.length === 0 ? [] : zonesWithCommission.filter(z => rep.zones.includes(z.name)))
                      .slice(0, 3)
                      .map(z => (
                        <Pill key={z.id} tone="bg-primary-50 text-primary-800 border-primary-200">
                          {z.name}: {describeCommission(z)}
                        </Pill>
                      ))}
                  </div>

                  <div className="space-y-2 mt-4">
                    <a
                      href={rep.phone ? `tel:${rep.phone}` : undefined}
                      className={`flex items-center gap-3 text-sm rounded-lg -m-1 p-1 ${rep.phone ? 'hover:bg-surface-50' : 'pointer-events-none opacity-60'}`}
                    >
                      <span className="w-8 h-8 rounded-lg bg-surface-100 grid place-items-center text-surface-600 shrink-0">
                        <Phone size={16} />
                      </span>
                      <span className="font-semibold text-surface-700" dir="ltr">{rep.phone || '—'}</span>
                    </a>
                    <a
                      href={rep.whatsapp ? `https://wa.me/${rep.whatsapp.replace(/\D/g, '')}` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className={`flex items-center gap-3 text-sm rounded-lg -m-1 p-1 ${rep.whatsapp ? 'hover:bg-surface-50' : 'pointer-events-none opacity-60'}`}
                    >
                      <span className="w-8 h-8 rounded-lg bg-emerald-50 grid place-items-center text-emerald-700 shrink-0">
                        <MessageCircle size={16} />
                      </span>
                      <span className="font-semibold text-surface-700" dir="ltr">{rep.whatsapp || '—'}</span>
                    </a>
                  </div>

                  {rep.note && <p className="text-xs text-surface-500 mt-3 line-clamp-2">{rep.note}</p>}

                  <dl className="grid grid-cols-3 gap-2 mt-auto pt-4 border-t border-surface-200/70 text-center">
                    <div>
                      <dt className="text-xs text-surface-500">الطلبات</dt>
                      <dd className="font-black text-sm mt-1 text-surface-900 tabular-nums">
                        {count(repTotals?.realized_count ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-surface-500">الإيرادات</dt>
                      <dd className="font-black text-sm mt-1 text-surface-900 tabular-nums">
                        {money(repTotals?.revenue ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-surface-500">العمولة</dt>
                      <dd className="font-black text-sm mt-1 text-primary-800 tabular-nums">
                        {money(repTotals?.commission_due ?? 0)}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-surface-500 leading-relaxed">
        الأرقام محسوبة من طلبات هذا المتجر المسندة إلى كل مندوب. العمولة تُحتسب عن الطلبات المسلَّمة فقط.
        حذف المندوب لا يحذف طلباته — تبقى الطلبات بدون مندوب.
      </p>

      <SalesRepForm
        open={creating || editing !== null}
        rep={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <Confirm
        open={confirmDelete !== null}
        title="حذف المندوب"
        message={`سيتم حذف "${confirmDelete?.name ?? ''}" نهائياً. الطلبات المسندة إليه ستبقى بدون مندوب.`}
        confirmLabel="حذف"
        onConfirm={() => deleteSalesRep(confirmDelete?.id ?? '')}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
