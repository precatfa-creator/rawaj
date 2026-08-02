import React, { useState } from 'react';
import { MapPin, Plus, Pencil, Trash2, Truck, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useAppStore } from '../store';
import { matchesSearch } from '../lib/arabic';
import { deleteZone, newId, saveZone, type ZoneDraft } from '../lib/mutations';
import { Confirm, ErrorNote } from '../components/Confirm';
import { Combobox } from '../components/Combobox';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from '../components/Modal';
import { Card, EmptyState, Metric, PageHead, Pill, actionButton, count, money } from '../components/ui';
import type { DeliveryZone, ZoneRegion } from '../types';

const REGIONS: Record<ZoneRegion, { label: string; tone: string }> = {
  tripolitania: { label: 'طرابلس', tone: 'bg-primary-50 text-primary-800 border-primary-200' },
  cyrenaica: { label: 'برقة', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
  fezzan: { label: 'فزان', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
};

const regionOptions = [
  { value: 'all', label: 'كل المناطق' },
  ...Object.entries(REGIONS).map(([value, { label }]) => ({ value, label })),
];

const ZoneForm: React.FC<{ open: boolean; zone: DeliveryZone | null; onClose: () => void }> = ({ open, zone, onClose }) => {
  const isNew = !zone;
  const [draft, setDraft] = useState<ZoneDraft>({
    id: '', name: '', region: 'tripolitania', capital: '', fee: 0, deliveryTimeDays: 3, active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = zone?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setError('');
    setDraft({
      id: zone?.id ?? newId(),
      name: zone?.name ?? '',
      region: zone?.region ?? 'tripolitania',
      capital: zone?.capital ?? '',
      fee: zone?.fee ?? 0,
      deliveryTimeDays: zone?.deliveryTimeDays ?? 3,
      active: zone?.active ?? true,
    });
  }
  if (!open && seeded !== null) setSeeded(null);

  const set = <K extends keyof ZoneDraft>(field: K, value: ZoneDraft[K]) =>
    setDraft(current => ({ ...current, [field]: value }));

  return (
    <Modal
      open={open}
      title={isNew ? 'منطقة توصيل جديدة' : 'تعديل المنطقة'}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="zone-form" disabled={busy} className={primaryButton}>
            {busy ? 'جارٍ الحفظ...' : isNew ? 'إضافة المنطقة' : 'حفظ التعديلات'}
          </button>
          <button type="button" onClick={onClose} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <form
        id="zone-form"
        className="space-y-4"
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true); setError('');
          const result = await saveZone(draft, isNew);
          setBusy(false);
          if (result.ok) onClose(); else setError(result.message ?? '');
        }}
      >
        <Field label="اسم المنطقة">
          <input value={draft.name} onChange={e => set('name', e.target.value)} required className={fieldClass} />
        </Field>
        <Combobox
          showLabel
          label="الإقليم"
          value={draft.region}
          onChange={value => set('region', value as ZoneRegion)}
          options={Object.entries(REGIONS).map(([value, { label }]) => ({ value, label }))}
        />
        <Field label="المدينة الرئيسية">
          <input value={draft.capital} onChange={e => set('capital', e.target.value)} className={fieldClass} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="رسوم التوصيل (د.ل)">
            <input type="number" min={0} step="0.5" value={draft.fee} onChange={e => set('fee', Number(e.target.value))} className={fieldClass} />
          </Field>
          <Field label="مدة التوصيل (أيام)">
            <input type="number" min={1} value={draft.deliveryTimeDays} onChange={e => set('deliveryTimeDays', Number(e.target.value))} className={fieldClass} />
          </Field>
        </div>
        <label className="flex items-center gap-3 bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 cursor-pointer">
          <input type="checkbox" checked={draft.active} onChange={e => set('active', e.target.checked)} className="w-4 h-4 rounded border-surface-300 text-primary-700 focus:ring-primary-500" />
          <span className="font-bold text-sm text-surface-800">التوصيل متاح لهذه المنطقة</span>
        </label>
        {error && <ErrorNote message={error} />}
      </form>
    </Modal>
  );
};

export const Zones: React.FC = () => {
  const { zones, pickerCustomers: customers } = useAppStore();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('all');
  const [editing, setEditing] = useState<DeliveryZone | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeliveryZone | null>(null);

  const visible = zones
    .filter(zone => region === 'all' || zone.region === region)
    .filter(zone => matchesSearch(zone.name, search) || matchesSearch(zone.capital, search));

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
            placeholder="ابحث باسم المنطقة أو المدينة…"
            aria-label="ابحث في المناطق"
            className="w-full bg-white border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
          />
        </div>
        <Combobox label="الإقليم" value={region} onChange={setRegion} options={regionOptions} className="md:w-56" />
      </Card>

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
                    <h3 className="font-black text-lg text-surface-900 truncate">{zone.name}</h3>
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
                </div>

                <dl className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-surface-200/70 text-center">
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

      <Confirm
        open={confirmDelete !== null}
        title="حذف المنطقة"
        message={`سيتم حذف "${confirmDelete?.name ?? ''}" نهائياً.`}
        confirmLabel="حذف"
        onConfirm={() => deleteZone(confirmDelete?.id ?? '')}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
