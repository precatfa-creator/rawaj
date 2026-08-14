import React, { useMemo, useState } from 'react';
import { MapPin, Plus, Pencil, Trash2, Truck, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useAppStore } from '../store';
import { matchesSearch } from '../lib/arabic';
import { deleteZone } from '../lib/mutations';
import { Confirm } from '../components/Confirm';
import { Combobox } from '../components/Combobox';
import { BulkBar } from '../components/BulkBar';
import { REGIONS, ZoneForm } from '../components/forms';
import { zoneBulk } from '../lib/bulk';
import { Card, EmptyState, Metric, PageHead, Pill, actionButton, count, money } from '../components/ui';
import type { DeliveryZone } from '../types';

const regionOptions = [
  { value: 'all', label: 'كل المناطق' },
  ...Object.entries(REGIONS).map(([value, { label }]) => ({ value, label })),
];

export const Zones: React.FC = () => {
  const { zones, pickerCustomers: customers, activeStoreId } = useAppStore();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('all');
  const [editing, setEditing] = useState<DeliveryZone | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeliveryZone | null>(null);

  // Rebuilt only when the store changes; a new object per render would restart
  // BulkBar's state on every keystroke in the search box.
  const bulkSpec = useMemo(() => zoneBulk(activeStoreId), [activeStoreId]);

  const visible = zones
    .filter(zone => region === 'all' || zone.region === region)
    .filter(zone =>
      matchesSearch(zone.name, search)
      || matchesSearch(zone.capital, search)
      || matchesSearch(zone.code, search));

  const activeCount = zones.filter(zone => zone.active).length;
  const priced = zones.filter(zone => zone.fee > 0);

  // Customers whose city does not match any zone name or capital are unreachable
  // by the zone list as it stands.
  const unmatched = customers.filter(
    customer => customer.city && !zones.some(z => z.name === customer.city || z.capital === customer.city),
  ).length;

  return (
    <div className="space-y-6">
      <PageHead title="مناطق التوصيل" subtitle="تغطية التوصيل ورسومها حسب مناطق ليبيا الإدارية.">
        <button onClick={() => setCreating(true)} className={actionButton}>
          <Plus size={20} />
          منطقة جديدة
        </button>
      </PageHead>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label="مناطق مفعّلة" value={`${count(activeCount)} / ${count(zones.length)}`} icon={<MapPin size={18} />} />
        <Metric
          label="مناطق مسعّرة"
          value={`${count(priced.length)} / ${count(zones.length)}`}
          hint={priced.length === 0 ? 'لم تُحدَّد أي رسوم بعد' : undefined}
          icon={<Truck size={18} />}
        />
        <Metric label="عملاء خارج التغطية" value={count(unmatched)} tone={unmatched > 0 ? 'negative' : 'default'} hint="مدينتهم لا تطابق أي منطقة" />
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث برقم المنطقة أو اسمها أو المدينة…"
            aria-label="ابحث في المناطق"
            className="w-full bg-white border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
          />
        </div>
        <Combobox label="الإقليم" value={region} onChange={setRegion} options={regionOptions} className="md:w-56" />
      </Card>

      <BulkBar
        spec={bulkSpec}
        title="استيراد وتصدير المناطق"
        hint="يقبل Excel و CSV وملفات Google Sheets المصدَّرة. المنطقة الموجودة تُحدَّث، والجديدة تُضاف. الملف المصدَّر يصلح كقالب معبَّأ — عدّله وأعد استيراده. اترك رقم المنطقة فارغاً ليُرقَّم تلقائياً."
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={<MapPin size={30} />}
          title="لا توجد مناطق"
          body={zones.length === 0 ? 'شغّل ترحيل قاعدة البيانات لتحميل مناطق ليبيا، أو أضف منطقة يدوياً.' : 'لم تطابق أي منطقة البحث.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((zone, i) => (
            <motion.div
              key={zone.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.03 }}
            >
              <Card className={`p-5 h-full flex flex-col group ${zone.active ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-black text-lg text-surface-900 truncate flex items-center gap-2">
                      <span className="shrink-0 rounded-lg bg-surface-100 border border-surface-200 px-2 py-0.5 text-sm tabular-nums text-surface-600">
                        {zone.code}
                      </span>
                      <span className="truncate">{zone.name}</span>
                    </h3>
                    <p className="text-sm text-surface-500 mt-0.5 truncate">
                      {zone.capital ? `المركز: ${zone.capital}` : 'بدون مركز محدّد'}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    <button onClick={() => setEditing(zone)} aria-label={`تعديل ${zone.name}`} title="تعديل"
                      className="w-9 h-9 grid place-items-center rounded-lg text-surface-500 hover:text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => setConfirmDelete(zone)} aria-label={`حذف ${zone.name}`} title="حذف"
                      className="w-9 h-9 grid place-items-center rounded-lg text-surface-500 hover:text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <Pill tone={REGIONS[zone.region].tone}>{REGIONS[zone.region].label}</Pill>
                  <Pill tone={zone.active ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-surface-100 text-surface-600 border-surface-200'}>
                    {zone.active ? 'متاح' : 'موقوف'}
                  </Pill>
                  {/* Which rows this store has taken over, and which are still
                      the shared ones every store sees. */}
                  <Pill tone={zone.storeId
                    ? 'bg-primary-50 text-primary-800 border-primary-200'
                    : 'bg-surface-100 text-surface-600 border-surface-200'}>
                    {zone.storeId ? 'خاصة بهذا المتجر' : 'من القائمة المشتركة'}
                  </Pill>
                </div>

                <dl className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-surface-200/70 text-center">
                  <div>
                    <dt className="text-xs text-surface-500">الرسوم</dt>
                    <dd className={`font-black text-sm mt-1 tabular-nums ${zone.fee > 0 ? 'text-surface-900' : 'text-surface-400'}`}>
                      {zone.fee > 0 ? money(zone.fee) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-surface-500">المدة</dt>
                    <dd className="font-black text-sm mt-1 text-surface-900 tabular-nums">{zone.deliveryTimeDays} أيام</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-surface-500">عمولة المندوب</dt>
                    <dd className={`font-black text-sm mt-1 ${zone.commissionType === 'none' ? 'text-surface-400' : 'text-primary-800'}`}>
                      {zone.commissionType === 'percent'
                        ? money(zone.fee * zone.commissionValue / 100)
                        : zone.commissionType === 'fixed'
                          ? money(zone.commissionValue)
                          : '—'}
                      {zone.commissionType === 'percent' && (
                        <span className="block text-xs font-bold text-surface-500 tabular-nums">{zone.commissionValue}%</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <p className="text-xs text-surface-500 leading-relaxed">
        الأسماء والأقاليم والمراكز مأخوذة من التقسيم الإداري الليبي (22 شعبية).
        الرسوم تبدأ من صفر لأنه لا يوجد مصدر عام لأسعار التوصيل — حدّدها بنفسك. مدة التوصيل تقدير أولي قابل للتعديل.
      </p>

      <ZoneForm open={creating || editing !== null} zone={editing} onClose={() => { setCreating(false); setEditing(null); }} />

      {/* A zone this store owns is deleted; one from the shared catalogue cannot
          be — it belongs to every store — so it is switched off for this store
          only, through a copy. The dialog says which of the two will happen. */}
      <Confirm
        open={confirmDelete !== null}
        title={confirmDelete?.storeId ? 'حذف المنطقة' : 'إيقاف المنطقة لهذا المتجر'}
        message={confirmDelete?.storeId
          ? `سيتم حذف "${confirmDelete?.name ?? ''}" نهائياً.`
          : `"${confirmDelete?.name ?? ''}" من القائمة المشتركة. سيتم إيقافها لهذا المتجر فقط، وتبقى متاحة للمتاجر الأخرى.`}
        confirmLabel={confirmDelete?.storeId ? 'حذف' : 'إيقاف'}
        onConfirm={() => confirmDelete
          ? deleteZone(confirmDelete, activeStoreId)
          : Promise.resolve({ ok: true })}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
