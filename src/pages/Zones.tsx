import React, { useMemo, useState } from 'react';
import {
  MapPin, Plus, Pencil, Trash2, Truck, Search, LayoutGrid, ListTree, ChevronLeft, Languages, X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAppStore } from '../store';
import { matchesSearch, normalizeArabic } from '../lib/arabic';
import { deleteZone } from '../lib/mutations';
import { groupByCity } from '../lib/zones';
import { Confirm } from '../components/Confirm';
import { Combobox } from '../components/Combobox';
import { BulkBar } from '../components/BulkBar';
import { REGIONS, ZoneForm } from '../components/forms';
import { zoneBulk } from '../lib/bulk';
import { Card, EmptyState, Metric, PageHead, Pill, actionButton, count, money } from '../components/ui';
import type { DeliveryZone } from '../types';

const regionOptions = [
  { value: 'all', label: 'كل الأقاليم' },
  ...Object.entries(REGIONS).map(([value, { label }]) => ({ value, label })),
];

const STATE_OPTIONS = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'active', label: 'متاحة فقط' },
  { value: 'inactive', label: 'موقوفة فقط' },
  { value: 'priced', label: 'مسعّرة فقط' },
  { value: 'unpriced', label: 'بدون رسوم' },
  { value: 'mine', label: 'خاصة بهذا المتجر' },
  { value: 'translate', label: 'تحتاج تعريباً' },
];

const passesState = (zone: DeliveryZone, state: string) => {
  switch (state) {
    case 'active': return zone.active;
    case 'inactive': return !zone.active;
    case 'priced': return zone.fee > 0;
    case 'unpriced': return zone.fee <= 0;
    case 'mine': return Boolean(zone.storeId);
    case 'translate': return zone.needsTranslation;
    default: return true;
  }
};

const commissionText = (zone: DeliveryZone) =>
  zone.commissionType === 'percent' ? money(zone.fee * zone.commissionValue / 100)
    : zone.commissionType === 'fixed' ? money(zone.commissionValue)
      : '—';

const regionInfo = (region: DeliveryZone['region']) => REGIONS[region] ?? {
  label: region || 'غير محدد',
  tone: 'bg-surface-100 text-surface-600 border-surface-200',
};

export const Zones: React.FC = () => {
  const { zones, pickerCustomers: customers, activeStoreId } = useAppStore();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('all');
  const [city, setCity] = useState('all');
  const [scope, setScope] = useState('all');
  const [municipality, setMunicipality] = useState('all');
  const [state, setState] = useState('all');
  const [view, setView] = useState<'grid' | 'tree'>('tree');
  const [openCities, setOpenCities] = useState<string[]>([]);
  const [closedCities, setClosedCities] = useState<string[]>([]);
  const [openScopes, setOpenScopes] = useState<string[]>([]);
  const [openMunicipalities, setOpenMunicipalities] = useState<string[]>([]);
  const [editing, setEditing] = useState<DeliveryZone | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeliveryZone | null>(null);

  // Rebuilt only when the store changes; a new object per render would restart
  // BulkBar's state on every keystroke in the search box.
  const bulkSpec = useMemo(() => zoneBulk(activeStoreId), [activeStoreId]);

  // Scopes and municipalities are offered for the chosen city only. Listing all
  // 71 scopes when one city is selected would mostly offer empty results.
  const cityOptions = useMemo(() => [
    { value: 'all', label: 'كل المدن' },
    ...[...new Set(zones.map(z => z.city).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ar'))
      .map(value => ({ value, label: value })),
  ], [zones]);

  const scopeOptions = useMemo(() => [
    { value: 'all', label: 'كل النطاقات' },
    ...[...new Set(zones.filter(z => city === 'all' || z.city === city).map(z => z.scope).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ar'))
      .map(value => ({ value, label: value })),
  ], [zones, city]);

  const municipalityOptions = useMemo(() => [
    { value: 'all', label: 'كل البلديات' },
    ...[...new Set(zones.filter(z => city === 'all' || z.city === city).map(z => z.municipality).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ar'))
      .map(value => ({ value, label: value })),
  ], [zones, city]);

  const visible = useMemo(() => zones
    .filter(zone => region === 'all' || zone.region === region)
    .filter(zone => city === 'all' || zone.city === city)
    .filter(zone => scope === 'all' || zone.scope === scope)
    .filter(zone => municipality === 'all' || zone.municipality === municipality)
    .filter(zone => passesState(zone, state))
    .filter(zone =>
      matchesSearch(zone.name, search)
      || matchesSearch(zone.city, search)
      || matchesSearch(zone.scope, search)
      || matchesSearch(zone.municipality, search)
      || matchesSearch(zone.altName, search)
      || matchesSearch(zone.code, search)),
    [zones, region, city, scope, municipality, state, search]);

  const tree = useMemo(() => groupByCity(visible), [visible]);
  const filtered = search !== '' || [region, city, scope, municipality, state].some(v => v !== 'all');

  const clearFilters = () => {
    setSearch(''); setRegion('all'); setCity('all');
    setScope('all'); setMunicipality('all'); setState('all');
  };

  const activeCount = zones.filter(zone => zone.active).length;
  const priced = zones.filter(zone => zone.fee > 0);
  const cityCount = new Set(zones.map(z => z.city).filter(Boolean)).size;

  // Customers whose city matches no area, no city and no municipality cannot be
  // reached by the list as it stands.
  const unmatched = customers.filter(customer => {
    const city = normalizeArabic(customer.city);
    return Boolean(city) && !zones.some(zone => zone.active && [
      zone.name, zone.city, zone.municipality, zone.altName, zone.scope,
    ].some(value => normalizeArabic(value) === city));
  }).length;

  const hierarchyKey = (...parts: string[]) => parts.join('\u001f');

  const toggleCity = (name: string) => {
    const isOpen = openCities.includes(name) || (tree.length === 1 && !closedCities.includes(name));
    if (isOpen) {
      setOpenCities(open => open.filter(city => city !== name));
      setClosedCities(closed => closed.includes(name) ? closed : [...closed, name]);
    } else {
      setOpenCities(open => open.includes(name) ? open : [...open, name]);
      setClosedCities(closed => closed.filter(city => city !== name));
    }
  };

  const toggleOpen = (setter: React.Dispatch<React.SetStateAction<string[]>>, key: string) =>
    setter(open => open.includes(key) ? open.filter(item => item !== key) : [...open, key]);

  const actions = (zone: DeliveryZone) => (
    <div className="flex gap-1 shrink-0">
      <button onClick={() => setEditing(zone)} aria-label={`تعديل ${zone.name}`} title="تعديل"
        className="w-9 h-9 grid place-items-center rounded-lg text-surface-500 hover:text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <Pencil size={16} />
      </button>
      <button onClick={() => setConfirmDelete(zone)} aria-label={`حذف ${zone.name}`} title="حذف"
        className="w-9 h-9 grid place-items-center rounded-lg text-surface-500 hover:text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHead
        title="مناطق التوصيل"
        subtitle="المدينة الكبرى ← النطاق الجغرافي ← المنطقة ← البلدية."
      >
        <button onClick={() => setCreating(true)} className={actionButton}>
          <Plus size={20} />
          منطقة جديدة
        </button>
      </PageHead>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Metric label="مناطق مفعّلة" value={`${count(activeCount)} / ${count(zones.length)}`} icon={<MapPin size={18} />} />
        <Metric label="المدن المغطّاة" value={count(cityCount)} icon={<ListTree size={18} />} />
        <Metric
          label="مناطق مسعّرة"
          value={`${count(priced.length)} / ${count(zones.length)}`}
          hint={priced.length === 0 ? 'لم تُحدَّد أي رسوم بعد' : undefined}
          icon={<Truck size={18} />}
        />
        <Metric label="عملاء خارج التغطية" value={count(unmatched)} tone={unmatched > 0 ? 'negative' : 'default'} hint="مدينتهم لا تطابق أي منطقة" />
      </div>

      <Card className="p-3 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالرقم أو المنطقة أو المدينة أو البلدية…"
              aria-label="ابحث في المناطق"
              className="w-full bg-white border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
            />
          </div>
          {/* Two views of one list: the tree answers "what do we cover in this
              city", the grid answers "what does this area cost". */}
          <div role="group" aria-label="طريقة العرض" className="flex rounded-xl border border-surface-200 bg-white p-1 shrink-0">
            {([['tree', 'شجرة', ListTree], ['grid', 'بطاقات', LayoutGrid]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  view === id ? 'bg-primary-50 text-primary-800' : 'text-surface-500 hover:text-surface-800'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <BulkBar
            spec={bulkSpec}
            title="استيراد وتصدير المناطق"
            hint="يقبل Excel و CSV وملفات Google Sheets المصدَّرة. المنطقة الموجودة تُحدَّث، والجديدة تُضاف. الملف المصدَّر يصلح كقالب معبَّأ — عدّله وأعد استيراده. اترك رقم المنطقة فارغاً ليُرقَّم تلقائياً."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <Combobox label="المدينة الكبرى" value={city}
            onChange={value => { setCity(value); setScope('all'); setMunicipality('all'); }}
            options={cityOptions} />
          <Combobox label="النطاق الجغرافي" value={scope} onChange={setScope} options={scopeOptions} />
          <Combobox label="البلدية" value={municipality} onChange={setMunicipality} options={municipalityOptions} />
          <Combobox label="الإقليم" value={region} onChange={setRegion} options={regionOptions} />
          <Combobox label="الحالة" value={state} onChange={setState} options={STATE_OPTIONS} />
        </div>

        {filtered && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm font-bold text-surface-600">
              {count(visible.length)} من {count(zones.length)} منطقة
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold text-surface-600 hover:text-surface-900 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X size={15} />
              مسح المرشّحات
            </button>
          </div>
        )}
      </Card>


      {visible.length === 0 ? (
        <EmptyState
          icon={<MapPin size={30} />}
          title="لا توجد مناطق"
          body={zones.length === 0
            ? 'شغّل ترحيل قاعدة البيانات لتحميل مناطق ليبيا، أو أضف منطقة يدوياً.'
            : 'لم تطابق أي منطقة هذه المرشّحات.'}
        />
      ) : view === 'tree' ? (
        <div className="space-y-3">
          {tree.map(node => {
            // A narrow search opens its only city by default, but an explicit
            // close wins so the accordion never becomes impossible to collapse.
            const open = openCities.includes(node.city)
              || (tree.length === 1 && !closedCities.includes(node.city));
            return (
              <Card key={node.city} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleCity(node.city)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 p-4 text-right hover:bg-surface-50/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <ChevronLeft size={18} className={`shrink-0 text-surface-400 transition-transform ${open ? '-rotate-90' : ''}`} />
                    <span className="min-w-0">
                      <span className="block font-black text-surface-900 truncate">{node.city}</span>
                      <span className="block text-xs text-surface-500 mt-0.5">
                        {count(node.scopes.length)} نطاق · {count(node.zones.length)} منطقة
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-surface-500 tabular-nums">
                    {count(node.zones.filter(z => z.fee > 0).length)} مسعّرة
                  </span>
                </button>

                {open && (
                  <div className="border-t border-surface-200/70 divide-y divide-surface-200/70">
                    {node.scopes.map(scopeNode => {
                      const scopeKey = hierarchyKey(node.city, scopeNode.scope);
                      const scopeOpen = openScopes.includes(scopeKey);
                      return (
                        <div key={scopeNode.scope}>
                          <button
                            type="button"
                            onClick={() => toggleOpen(setOpenScopes, scopeKey)}
                            aria-expanded={scopeOpen}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right hover:bg-surface-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <ChevronLeft size={16} className={`shrink-0 text-surface-400 transition-transform ${scopeOpen ? '-rotate-90' : ''}`} />
                              <span className="font-black text-sm text-primary-800 truncate">{scopeNode.scope}</span>
                            </span>
                            <span className="shrink-0 text-xs font-bold text-surface-500 tabular-nums">{count(scopeNode.zones.length)} منطقة</span>
                          </button>

                          {scopeOpen && (
                            <div className="border-t border-surface-200/60">
                              {scopeNode.municipalities.map(municipalityNode => {
                                const municipalityKey = hierarchyKey(node.city, scopeNode.scope, municipalityNode.municipality);
                                const municipalityOpen = openMunicipalities.includes(municipalityKey);
                                return (
                                  <div key={municipalityNode.municipality} className="border-b border-surface-200/60 last:border-b-0">
                                    <button
                                      type="button"
                                      onClick={() => toggleOpen(setOpenMunicipalities, municipalityKey)}
                                      aria-expanded={municipalityOpen}
                                      className="w-full flex items-center justify-between gap-3 px-7 py-2.5 text-right hover:bg-surface-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                                    >
                                      <span className="flex items-center gap-2 min-w-0">
                                        <ChevronLeft size={15} className={`shrink-0 text-surface-400 transition-transform ${municipalityOpen ? '-rotate-90' : ''}`} />
                                        <span className="text-sm font-bold text-surface-700 truncate">بلدية {municipalityNode.municipality}</span>
                                      </span>
                                      <span className="shrink-0 text-xs font-bold text-surface-400 tabular-nums">{count(municipalityNode.zones.length)}</span>
                                    </button>

                                    {municipalityOpen && (
                                      <ul className="px-7 pb-2 space-y-1">
                                        {municipalityNode.zones.map(zone => (
                                          <li
                                            key={zone.id}
                                            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-50 ${zone.active ? '' : 'opacity-60'}`}
                                          >
                                            <span className="shrink-0 rounded bg-surface-100 border border-surface-200 px-1.5 py-0.5 text-xs tabular-nums text-surface-600">
                                              {zone.code}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                              <span className="block text-sm font-bold text-surface-900 truncate">
                                                {zone.name}
                                                {zone.needsTranslation && (
                                                  <Languages size={13} className="inline-block mr-1.5 text-amber-600" aria-label="يحتاج تعريباً" />
                                                )}
                                              </span>
                                            </span>
                                            <span className={`shrink-0 text-sm font-black tabular-nums ${zone.fee > 0 ? 'text-surface-900' : 'text-surface-400'}`}>
                                              {zone.fee > 0 ? money(zone.fee) : '—'}
                                            </span>
                                            {actions(zone)}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
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
                      {[zone.city, zone.scope].filter(Boolean).join(' ← ') || 'بدون تصنيف'}
                    </p>
                  </div>
                  <div className="transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    {actions(zone)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <Pill tone={regionInfo(zone.region).tone}>{regionInfo(zone.region).label}</Pill>
                  {zone.municipality && (
                    <Pill tone="bg-surface-100 text-surface-600 border-surface-200">بلدية {zone.municipality}</Pill>
                  )}
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
                  {zone.needsTranslation && (
                    <Pill tone="bg-amber-50 text-amber-800 border-amber-200">يحتاج تعريباً</Pill>
                  )}
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
                      {commissionText(zone)}
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
        المناطق مأخوذة من OpenStreetMap والبلديات من وزارة الحكم المحلي — التفاصيل والفجوات في
        <span dir="ltr" className="font-mono"> docs/libya-areas.md</span>.
        الرسوم تبدأ من صفر لأنه لا يوجد مصدر عام لأسعار التوصيل — حدّدها بنفسك، أو صدّر الجدول وسعّره دفعة واحدة وأعد استيراده.
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
