import React, { FormEvent, useRef, useState } from 'react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { ImageUploader } from './ImageUploader';
import { useAppStore } from '../store';
import { splitList } from '../lib/text';
import {
  createCategory, createCity, createMunicipality, createZoneScope,
  newId, saveCustomer, saveProduct, saveSalesRep, saveStore, saveZone,
  type CustomerDraft, type ProductDraft, type SalesRepDraft, type WriteResult, type ZoneDraft,
} from '../lib/mutations';
import type { Customer, DeliveryZone, Product, SalesRep, Store, ZoneRegion } from '../types';

/** Shared submit plumbing: pending state, and a failure the user can read. */
const useSubmit = (onDone: () => void) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = (write: () => Promise<WriteResult>) => async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await write();
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.message ?? "");
  };

  return { busy, error, setError, submit };
};

/**
 * The series a new document will be numbered from.
 *
 * Frappe puts this on the form itself, and for the same reason: the person
 * creating the document is the one who knows whether it belongs in this year's
 * run or in a separate one. Hidden while editing — a document keeps the number
 * it was given.
 */
export const NamingSeriesField: React.FC<{
  doctype: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}> = ({ doctype, value, onChange, label = 'تسلسل الترقيم', hint }) => {
  const { documentNaming } = useAppStore();
  const config = documentNaming.find(item => item.doctype === doctype);
  if (!config) return null;

  return (
    <div>
      <Combobox
        showLabel
        label={label}
        value={value || config.defaultSeries}
        onChange={onChange}
        options={config.series.map(series => ({
          value: series,
          label: series,
          hint: describeSeries(series),
        }))}
      />
      {hint && <p className="text-xs text-surface-500 mt-1.5">{hint}</p>}
    </div>
  );
};

/** `ORD-.YYYY.-.####` reads as `ORD-2026-0001` to everyone except its author. */
export const describeSeries = (series: string): string => {
  const now = new Date();
  const prefix = series
    .replace('.YYYY.', String(now.getFullYear()))
    .replace('.YY.', String(now.getFullYear()).slice(2))
    .replace('.MM.', `${now.getMonth() + 1}`.padStart(2, '0'))
    .replace('.DD.', `${now.getDate()}`.padStart(2, '0'))
    .replace(/\.?#+$/, '');
  const width = series.match(/#+$/)?.[0].length ?? 4;
  return `${prefix}${'1'.padStart(width, '0')}`;
};

const Footer: React.FC<{ busy: boolean; onCancel: () => void; label: string }> = ({ busy, onCancel, label }) => (
  <>
    <button type="submit" form="entity-form" disabled={busy} className={primaryButton}>
      {busy ? 'جارٍ الحفظ…' : label}
    </button>
    <button type="button" onClick={onCancel} className={ghostButton}>إلغاء</button>
  </>
);

// ---- delivery zone ----

export const REGIONS: Record<ZoneRegion, { label: string; tone: string }> = {
  tripolitania: { label: 'طرابلس', tone: 'bg-primary-50 text-primary-800 border-primary-200' },
  cyrenaica: { label: 'برقة', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
  fezzan: { label: 'فزان', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
};

/**
 * Lives here rather than on the zones page because the customer form opens it
 * too: a customer's city is a zone, and the zone you need is the one that does
 * not exist yet.
 *
 * Its form id is `zone-form`, not the `entity-form` the other three share — when
 * this opens on top of the customer dialog, two forms answering to the same id
 * would send the outer dialog's submit button to whichever the DOM found first.
 */
export const ZoneForm: React.FC<{
  open: boolean;
  zone: DeliveryZone | null;
  onClose: () => void;
  /** Given the saved zone's name, so a caller can select what it just created. */
  onCreated?: (name: string) => void;
  /** Prefills the name when opened straight from a search that found nothing. */
  initialName?: string;
}> = ({ open, zone, onClose, onCreated, initialName = '' }) => {
  const isNew = !zone;
  const { activeStoreId, cities, zoneScopes, municipalities } = useAppStore();
  // A default belongs to every store, so editing it here produces this store's
  // own copy. Worth saying out loud on the form rather than surprising someone.
  const isSharedDefault = !isNew && !zone?.storeId;
  const [draft, setDraft] = useState<ZoneDraft>({
    id: '', code: '', name: '', region: 'tripolitania',
    cityId: null, scopeId: null, municipalityId: null,
    altName: '', fee: 0, deliveryTimeDays: 3,
    active: true, commissionType: 'none', commissionValue: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = zone?.id ?? `new:${initialName}`;
  if (open && seeded !== key) {
    setSeeded(key);
    setError('');
    setDraft({
      id: zone?.id ?? newId(),
      code: zone?.code ?? '',
      name: zone?.name ?? initialName,
      region: zone?.region ?? 'tripolitania',
      cityId: zone?.cityId ?? null,
      scopeId: zone?.scopeId ?? null,
      municipalityId: zone?.municipalityId ?? null,
      altName: zone?.altName ?? '',
      fee: zone?.fee ?? 0,
      deliveryTimeDays: zone?.deliveryTimeDays ?? 3,
      active: zone?.active ?? true,
      commissionType: zone?.commissionType ?? 'none',
      commissionValue: zone?.commissionValue ?? 0,
      storeId: zone?.storeId ?? null,
    });
  }
  if (!open && seeded !== null) setSeeded(null);

  const set = <K extends keyof ZoneDraft>(field: K, value: ZoneDraft[K]) =>
    setDraft(current => ({ ...current, [field]: value }));

  // Only the chosen city's scopes: «غرب طرابلس» offered while editing a
  // Benghazi area is an invitation to file it wrong.
  const scopesOfCity = zoneScopes.filter(scope => scope.cityId === draft.cityId);

  return (
    <Modal
      open={open}
      title={isNew ? 'منطقة توصيل جديدة' : 'تعديل المنطقة'}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="zone-form" disabled={busy} className={primaryButton}>
            {busy ? 'جارٍ الحفظ…' : isNew ? 'إضافة المنطقة' : 'حفظ التعديلات'}
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
          const result = await saveZone(draft, isNew, activeStoreId);
          setBusy(false);
          if (!result.ok) { setError(result.message ?? ''); return; }
          if (isNew) onCreated?.(draft.name.trim());
          onClose();
        }}
      >
        {isSharedDefault && (
          <p className="text-xs text-primary-900 bg-primary-50 border border-primary-200 rounded-xl p-3 leading-relaxed">
            هذه منطقة من القائمة المشتركة. الحفظ ينشئ نسخة خاصة بهذا المتجر ولا يغيّر ما تراه المتاجر الأخرى.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-4">
          <Field label="رقم المنطقة" hint={isNew ? 'يُرقَّم تلقائياً.' : undefined}>
            <input
              value={draft.code}
              onChange={e => set('code', e.target.value)}
              dir="ltr"
              inputMode="numeric"
              placeholder={isNew ? 'تلقائي' : ''}
              className={`${fieldClass} text-center tabular-nums`}
            />
          </Field>
          <Field label="اسم المنطقة">
            <input value={draft.name} onChange={e => set('name', e.target.value)} required className={fieldClass} />
          </Field>
        </div>
        <Combobox
          showLabel
          label="الإقليم"
          value={draft.region}
          onChange={value => set('region', value as ZoneRegion)}
          options={Object.entries(REGIONS).map(([value, { label }]) => ({ value, label }))}
        />
        {/* The three levels are records, not typed strings: a city entered with
            a trailing space used to become a second city in every filter and a
            second branch in the tree. Anything genuinely missing can still be
            added from the picker, so the link never blocks the work. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Combobox
            showLabel
            label="المدينة الكبرى"
            value={draft.cityId ?? ''}
            // Changing the city drops the scope: a scope belongs to one city,
            // and keeping it would file the area under a scope of another city.
            onChange={value => setDraft(current => ({ ...current, cityId: value || null, scopeId: null }))}
            options={cities.map(city => ({ value: city.id, label: city.name, hint: REGIONS[city.region]?.label }))}
            onCreate={async term => (await createCity(term)) ?? ''}
            createLabel={term => `إضافة مدينة "${term}"`}
          />
          <Combobox
            showLabel
            label="النطاق الجغرافي"
            value={draft.scopeId ?? ''}
            onChange={value => set('scopeId', value || null)}
            disabled={!draft.cityId}
            placeholder={draft.cityId ? 'اختر…' : 'اختر المدينة أولاً'}
            options={scopesOfCity.map(scope => ({ value: scope.id, label: scope.name }))}
            onCreate={draft.cityId
              ? async term => (await createZoneScope(term, draft.cityId as string)) ?? ''
              : undefined}
            createLabel={term => `إضافة نطاق "${term}"`}
          />
          <Combobox
            showLabel
            label="البلدية"
            value={draft.municipalityId ?? ''}
            onChange={value => set('municipalityId', value || null)}
            options={municipalities.map(item => ({ value: item.id, label: item.name }))}
            onCreate={async term => (await createMunicipality(term)) ?? ''}
            createLabel={term => `إضافة بلدية "${term}"`}
          />
        </div>
        <Field label="الاسم البديل" hint="اسم إنجليزي أو اسم قديم يساعد في البحث.">
          <input value={draft.altName} onChange={e => set('altName', e.target.value)} dir="auto" className={fieldClass} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="رسوم التوصيل (د.ل)">
            <input type="number" min={0} step="0.5" value={draft.fee || ''} placeholder="0" onChange={e => set('fee', Number(e.target.value))} className={fieldClass} />
          </Field>
          <Field label="مدة التوصيل (أيام)">
            <input type="number" min={1} value={draft.deliveryTimeDays} onChange={e => set('deliveryTimeDays', Number(e.target.value))} className={fieldClass} />
          </Field>
        </div>

        {/* The rep's cut comes out of this zone's delivery fee. 'none' leaves the
            rep's own flat commission in charge, which is what every zone meant
            before this field existed. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            showLabel
            label="عمولة المندوب"
            value={draft.commissionType}
            onChange={value => set('commissionType', value as ZoneDraft['commissionType'])}
            options={[
              { value: 'none', label: 'عمولة المندوب الثابتة' },
              { value: 'percent', label: 'نسبة من رسوم التوصيل' },
              { value: 'fixed', label: 'مبلغ ثابت لكل طلب' },
            ]}
          />
          {draft.commissionType !== 'none' && (
            <Field
              label={draft.commissionType === 'percent' ? 'النسبة (%)' : 'المبلغ (د.ل)'}
              hint={draft.commissionType === 'percent'
                ? `${Math.round(draft.fee * draft.commissionValue / 100).toLocaleString('en-US')} د.ل على رسوم ${draft.fee}`
                : 'عن كل طلب مسلَّم في هذه المنطقة.'}
            >
              <input
                type="number"
                min={0}
                max={draft.commissionType === 'percent' ? 100 : undefined}
                step="0.5"
                value={draft.commissionValue || ''}
                placeholder="0"
                onChange={e => set('commissionValue', Number(e.target.value))}
                className={fieldClass}
              />
            </Field>
          )}
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

// ---- store ----

export const StoreForm: React.FC<{
  open: boolean; store: Store | null; onClose: () => void;
}> = ({ open, store, onClose }) => {
  const isNew = !store;
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [facebookPage, setFacebookPage] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const { busy, error, submit } = useSubmit(onClose);

  // Re-seed the fields whenever a different record is opened.
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = store?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setName(store?.name ?? '');
    setImage(store?.image ?? '');
    setFacebookPage(store?.facebookPage ?? '');
    setMobileNumber(store?.mobileNumber ?? '');
  }
  if (!open && seeded !== null) setSeeded(null);

  return (
    <Modal
      open={open}
      title={isNew ? 'متجر جديد' : 'تعديل المتجر'}
      onClose={onClose}
      footer={<Footer busy={busy} onCancel={onClose} label={isNew ? 'إنشاء المتجر' : 'حفظ التعديلات'} />}
    >
      <form
        id="entity-form"
        className="space-y-4"
        onSubmit={submit(() => saveStore({ id: store?.id ?? newId(), name, image, facebookPage, mobileNumber }, isNew))}
      >
        <Field label="اسم المتجر">
          <input value={name} onChange={e => setName(e.target.value)} required className={fieldClass} />
        </Field>
        <Field label="رقم هاتف المتجر" hint="يستخدمه مالك المتجر لتأكيد طلبات ربط المتاجر لاحقاً.">
          <input value={mobileNumber} onChange={e => setMobileNumber(e.target.value)} dir="ltr" type="tel" className={fieldClass} />
        </Field>
        {/* One image, so the gallery uploader is capped at 1 rather than duplicated. */}
        <ImageUploader
          images={image ? [image] : []}
          onChange={images => setImage(images[0] ?? '')}
          max={1}
          label="صورة المتجر"
          hint="تظهر على بطاقة المتجر."
        />
        <Field label="صفحة فيسبوك">
          <input
            value={facebookPage}
            onChange={e => setFacebookPage(e.target.value)}
            dir="ltr"
            type="url"
            placeholder="https://facebook.com/…"
            className={fieldClass}
          />
        </Field>
        {error && <ErrorNote message={error} />}
      </form>
    </Modal>
  );
};

// ---- product ----

export const ProductForm: React.FC<{
  open: boolean; product: Product | null; storeId: string; onClose: () => void;
}> = ({ open, product, storeId, onClose }) => {
  const isNew = !product;
  const { categories } = useAppStore();
  const [draft, setDraft] = useState<ProductDraft>({
    id: '', storeId, name: '', description: '', sku: '', defaultSerial: '', category: '',
    purchasePrice: 0, sellingPrice: 0, stock: 0, minStock: 0, status: 'active', images: [], sizes: [],
    namingSeries: '',
  });
  // Held as the text the user is typing, not as the parsed array: splitting on
  // every keystroke would delete the separator the moment it was typed.
  const [sizesText, setSizesText] = useState('');
  const { busy, error, submit } = useSubmit(onClose);

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = product?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setDraft({
      id: product?.id ?? newId(),
      storeId,
      name: product?.name ?? '',
      description: product?.description ?? '',
      sku: product?.sku ?? '',
      defaultSerial: product?.defaultSerial ?? '',
      category: product?.category ?? '',
      purchasePrice: product?.purchasePrice ?? 0,
      sellingPrice: product?.sellingPrice ?? 0,
      stock: product?.stock ?? 0,
      minStock: product?.minStock ?? 0,
      status: product?.status ?? 'active',
      images: product?.images ?? [],
      sizes: product?.sizes ?? [],
      namingSeries: '',
    });
    setSizesText((product?.sizes ?? []).join('، '));
  }
  if (!open && seeded !== null) setSeeded(null);

  const set = <K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) =>
    setDraft(current => ({ ...current, [field]: value }));

  const margin = draft.sellingPrice - draft.purchasePrice;

  // An item saved before its category was deleted still shows its own value,
  // rather than silently reading as "no category".
  const categoryOptions = [...new Set([...categories, draft.category].filter(Boolean))]
    .map(name => ({ value: name, label: name }));

  return (
    <Modal
      open={open}
      wide
      title={isNew ? 'إضافة منتج' : 'تعديل المنتج'}
      onClose={onClose}
      footer={<Footer busy={busy} onCancel={onClose} label={isNew ? 'إضافة المنتج' : 'حفظ التعديلات'} />}
    >
      <form
        id="entity-form"
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        onSubmit={submit(() => saveProduct({ ...draft, sizes: splitList(sizesText) }, isNew))}
      >
        <div className="sm:col-span-2">
          <Field label="اسم المنتج">
            <input value={draft.name} onChange={e => set('name', e.target.value)} required className={fieldClass} />
          </Field>
        </div>
        <Field label="رمز SKU" hint={isNew ? 'اتركه فارغاً ليُولَّد من تسلسل الترقيم.' : undefined}>
          <input value={draft.sku} onChange={e => set('sku', e.target.value)} dir="ltr" className={fieldClass} />
        </Field>
        {isNew && !draft.sku.trim() && (
          <NamingSeriesField
            doctype="products"
            value={draft.namingSeries ?? ''}
            onChange={value => set('namingSeries', value)}
          />
        )}
        <Field label="الرقم التسلسلي الافتراضي" hint="يُستخدم عند عدم تسجيل رقم خاص بالقطعة.">
          <input value={draft.defaultSerial} onChange={e => set('defaultSerial', e.target.value)} dir="ltr" className={fieldClass} />
        </Field>
        {/* The value written is the category *name*: products.category stays a
            text column, which is what order_lines and the reports group on. */}
        <Combobox
          showLabel
          label="الفئة"
          value={draft.category}
          onChange={value => set('category', value)}
          options={categoryOptions}
          onCreate={name => createCategory(name, storeId)}
          createLabel={term => `إضافة فئة "${term}"`}
          placeholder="اختر فئة…"
        />
        <Field label="سعر الشراء (د.ل)">
          <input type="number" min={0} step="0.01" value={draft.purchasePrice || ''} placeholder="0" onChange={e => set('purchasePrice', Number(e.target.value))} required className={fieldClass} />
        </Field>
        <Field label="سعر البيع (د.ل)" hint={`الربح المحتسب: ${margin.toLocaleString('en-US')} د.ل`}>
          <input type="number" min={0} step="0.01" value={draft.sellingPrice || ''} placeholder="0" onChange={e => set('sellingPrice', Number(e.target.value))} required className={fieldClass} />
        </Field>
        {/* Editable exactly once. After creation the quantity is the running
            total of the stock ledger, and typing over it would be a silent lie:
            saveProduct drops `stock` from every update. */}
        <Field
          label={isNew ? 'الكمية الابتدائية' : 'المخزون الحالي'}
          hint={isNew ? undefined : 'يتغيّر بحركات المخزون فقط — استخدم «حركة مخزون».'}
        >
          <input
            type="number"
            min={0}
            value={draft.stock || ''}
            placeholder="0"
            onChange={e => set('stock', Number(e.target.value))}
            required={isNew}
            readOnly={!isNew}
            aria-readonly={!isNew}
            tabIndex={isNew ? undefined : -1}
            className={`${fieldClass} ${isNew ? '' : 'bg-surface-100 text-surface-500 cursor-not-allowed'}`}
          />
        </Field>
        <Field label="حد التنبيه">
          <input type="number" min={0} value={draft.minStock || ''} placeholder="0" onChange={e => set('minStock', Number(e.target.value))} required className={fieldClass} />
        </Field>
        {/* One quantity per item, not per size: the ledger counts pieces, and
            splitting stock by size would need a row per variant. The sizes
            listed here are what an order line can choose from. */}
        <div className="sm:col-span-2">
          <Field label="المقاسات" hint="افصل بينها بفاصلة — تظهر كخيارات عند إضافة المنتج إلى طلب. اتركها فارغة إن كان المنتج بمقاس واحد.">
            <input
              value={sizesText}
              onChange={e => setSizesText(e.target.value)}
              placeholder="S، M، L، XL"
              className={fieldClass}
            />
          </Field>
        </div>
        <Combobox
          showLabel
          label="الحالة"
          value={draft.status}
          onChange={value => set('status', value as ProductDraft['status'])}
          options={[
            { value: 'active', label: 'معروض' },
            { value: 'draft', label: 'مسودة' },
            { value: 'out_of_stock', label: 'نفدت الكمية' },
          ]}
        />

        <div className="sm:col-span-2">
          <ImageUploader images={draft.images} onChange={images => set('images', images)} />
        </div>
        <div className="sm:col-span-2">
          <Field label="الوصف">
            <textarea value={draft.description} onChange={e => set('description', e.target.value)} rows={3} className={fieldClass} />
          </Field>
        </div>
        {error && <div className="sm:col-span-2"><ErrorNote message={error} /></div>}
      </form>
    </Modal>
  );
};

// ---- sales representative ----

export const SalesRepForm: React.FC<{
  open: boolean; rep: SalesRep | null; onClose: () => void;
}> = ({ open, rep, onClose }) => {
  const isNew = !rep;
  const { zones, activeStoreId } = useAppStore();
  const [draft, setDraft] = useState<SalesRepDraft>({
    id: '', storeId: '', name: '', phone: '', whatsapp: '', zones: [], commission: 0,
    active: true, note: '', namingSeries: '',
  });
  const { busy, error, submit } = useSubmit(onClose);

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = rep?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setDraft({
      id: rep?.id ?? newId(),
      // A rep works for the store they were added in.
      storeId: rep?.storeId ?? activeStoreId ?? '',
      name: rep?.name ?? '',
      phone: rep?.phone ?? '',
      whatsapp: rep?.whatsapp ?? '',
      zones: rep?.zones ?? [],
      commission: rep?.commission ?? 0,
      active: rep?.active ?? true,
      note: rep?.note ?? '',
      namingSeries: '',
    });
  }
  if (!open && seeded !== null) setSeeded(null);

  const set = <K extends keyof SalesRepDraft>(field: K, value: SalesRepDraft[K]) =>
    setDraft(current => ({ ...current, [field]: value }));

  const toggleZone = (name: string) =>
    setDraft(current => ({
      ...current,
      zones: current.zones.includes(name)
        ? current.zones.filter(zone => zone !== name)
        : [...current.zones, name],
    }));

  return (
    <Modal
      open={open}
      wide
      title={isNew ? 'مندوب جديد' : 'تعديل المندوب'}
      onClose={onClose}
      footer={<Footer busy={busy} onCancel={onClose} label={isNew ? 'إضافة المندوب' : 'حفظ التعديلات'} />}
    >
      <form id="entity-form" className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={submit(() => saveSalesRep(draft, isNew))}>
        {isNew ? (
          <NamingSeriesField
            doctype="sales_reps"
            value={draft.namingSeries ?? ''}
            onChange={value => set('namingSeries', value)}
            label="تسلسل ترقيم المندوب"
          />
        ) : rep?.code ? (
          <Field label="رقم المندوب">
            <input value={rep.code} readOnly dir="ltr" tabIndex={-1}
              className={`${fieldClass} bg-surface-100 text-surface-500 cursor-not-allowed`} />
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="الاسم">
            <input value={draft.name} onChange={e => set('name', e.target.value)} required className={fieldClass} />
          </Field>
        </div>
        <Field label="رقم الهاتف">
          <input value={draft.phone} onChange={e => set('phone', e.target.value)} dir="ltr" type="tel" inputMode="tel" className={fieldClass} />
        </Field>
        <Field label="واتساب">
          <input value={draft.whatsapp} onChange={e => set('whatsapp', e.target.value)} dir="ltr" type="tel" inputMode="tel" className={fieldClass} />
        </Field>
        {/* A rep covers as many zones as they cover — one رقم واحد per rep was
            the thing being worked around by leaving the field empty. Selecting
            none still means "every zone", which is what empty always meant. */}
        <div className="sm:col-span-2">
          <span className="block text-sm font-bold text-surface-700 mb-1.5">مناطق التغطية</span>
          {zones.length === 0 ? (
            <p className="text-sm text-surface-500 bg-surface-50 border border-surface-200 rounded-xl p-3">
              لا توجد مناطق بعد. أضف منطقة توصيل أولاً.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border border-surface-200 rounded-xl p-3 bg-surface-50">
                {zones.map(zone => {
                  const picked = draft.zones.includes(zone.name);
                  return (
                    <label
                      key={zone.id}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold cursor-pointer transition-colors ${
                        picked
                          ? 'bg-primary-50 border-primary-300 text-primary-900'
                          : 'bg-white border-surface-200 text-surface-700 hover:border-surface-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggleZone(zone.name)}
                        className="w-4 h-4 rounded border-surface-300 text-primary-700 focus:ring-primary-500"
                      />
                      <span className="tabular-nums text-xs text-surface-500">{zone.code}</span>
                      {zone.name}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-surface-500 mt-1.5">
                {draft.zones.length === 0
                  ? 'بدون تحديد يغطي المندوب كل المناطق.'
                  : `${draft.zones.length} منطقة محددة.`}
              </p>
            </>
          )}
        </div>
        <Field label="العمولة لكل طلب مسلَّم (د.ل)" hint="تُستخدم للمناطق التي لا تحدّد عمولة خاصة بها.">
          <input
            type="number" min={0} step="0.5" value={draft.commission || ''} placeholder="0"
            onChange={e => set('commission', Number(e.target.value))}
            className={fieldClass}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات">
            <input value={draft.note} onChange={e => set('note', e.target.value)} className={fieldClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-3 bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox" checked={draft.active}
              onChange={e => set('active', e.target.checked)}
              className="w-4 h-4 rounded border-surface-300 text-primary-700 focus:ring-primary-500"
            />
            <span className="font-bold text-sm text-surface-800">المندوب على رأس العمل</span>
          </label>
        </div>
        {error && <div className="sm:col-span-2"><ErrorNote message={error} /></div>}
      </form>
    </Modal>
  );
};

// ---- customer ----

export const CustomerForm: React.FC<{
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  /** Prefills the name when launched from an unmatched customer search. */
  initialName?: string;
  /** Explicit when the form is nested in a store-scoped workflow such as an order. */
  storeId?: string;
  /** Lets the launching picker select the customer immediately after saving. */
  onCreated?: (customer: Pick<Customer, 'id' | 'name' | 'city'>) => void;
}> = ({ open, customer, onClose, initialName = '', storeId, onCreated }) => {
  const isNew = !customer;
  const { zones, activeStoreId } = useAppStore();
  const [draft, setDraft] = useState<CustomerDraft>({
    id: '', storeId: '', name: '', phone: '', whatsapp: '', city: '', address: '',
    status: 'active', namingSeries: '',
  });
  const { busy, error, submit } = useSubmit(() => {
    if (isNew) onCreated?.({ id: draft.id, name: draft.name.trim(), city: draft.city });
    onClose();
  });
  const [newZoneName, setNewZoneName] = useState<string | null>(null);
  const zoneResolver = useRef<((name: string | null) => void) | null>(null);

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = customer?.id ?? `new:${storeId ?? activeStoreId ?? ''}:${initialName}`;
  if (open && seeded !== key) {
    setSeeded(key);
    setDraft({
      id: customer?.id ?? newId(),
      // The same person shopping at two stores is two customers, one per store.
      storeId: customer?.storeId ?? storeId ?? activeStoreId ?? '',
      name: customer?.name ?? initialName,
      phone: customer?.phone ?? '',
      whatsapp: customer?.whatsapp ?? '',
      city: customer?.city ?? '',
      address: customer?.address ?? '',
      status: customer?.status ?? 'active',
      namingSeries: '',
    });
  }
  if (!open && seeded !== null) setSeeded(null);

  const set = <K extends keyof CustomerDraft>(field: K, value: CustomerDraft[K]) =>
    setDraft(current => ({ ...current, [field]: value }));

  // A customer saved before their zone was renamed keeps showing their own city
  // rather than reading as blank.
  const cityOptions = [
    ...zones.map(zone => ({
      value: zone.name,
      label: zone.name,
      hint: `${zone.code}${zone.city ? ` · ${zone.city}` : ''}`,
    })),
    ...(draft.city && !zones.some(zone => zone.name === draft.city)
      ? [{ value: draft.city, label: draft.city, hint: 'خارج مناطق التوصيل' }]
      : []),
  ];

  /**
   * Opens the zone dialog and does not settle until it closes, so the combobox
   * can select the zone that was just created — or carry on unchanged if the
   * user backed out. `null` means "handled here", so a cancel is not reported as
   * a failure.
   */
  const openZoneForm = (term: string) =>
    new Promise<string | null>(resolve => {
      zoneResolver.current = resolve;
      setNewZoneName(term);
    });

  const settleZoneForm = (name: string | null) => {
    zoneResolver.current?.(name);
    zoneResolver.current = null;
    setNewZoneName(null);
  };

  return (
    <Modal
      open={open}
      wide
      title={isNew ? 'عميل جديد' : 'تعديل العميل'}
      onClose={onClose}
      footer={<Footer busy={busy} onCancel={onClose} label={isNew ? 'إضافة العميل' : 'حفظ التعديلات'} />}
    >
      <form id="entity-form" className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={submit(() => saveCustomer(draft, isNew))}>
        {isNew ? (
          <NamingSeriesField
            doctype="customers"
            value={draft.namingSeries ?? ''}
            onChange={value => set('namingSeries', value)}
            label="تسلسل ترقيم العميل"
          />
        ) : customer?.code ? (
          <Field label="رقم العميل">
            <input value={customer.code} readOnly dir="ltr" tabIndex={-1}
              className={`${fieldClass} bg-surface-100 text-surface-500 cursor-not-allowed`} />
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="الاسم">
            <input value={draft.name} onChange={e => set('name', e.target.value)} required className={fieldClass} />
          </Field>
        </div>
        <Field label="رقم الهاتف">
          <input value={draft.phone} onChange={e => set('phone', e.target.value)} dir="ltr" type="tel" inputMode="tel" className={fieldClass} />
        </Field>
        <Field label="واتساب">
          <input value={draft.whatsapp} onChange={e => set('whatsapp', e.target.value)} dir="ltr" type="tel" inputMode="tel" className={fieldClass} />
        </Field>
        {/* The city IS a delivery zone — that link is what lets an order prefill
            its delivery fee. The value stored stays the zone name, because
            order_lines and the city report group on customers.city as text. */}
        <Combobox
          showLabel
          label="المدينة"
          value={draft.city}
          onChange={value => set('city', value)}
          options={cityOptions}
          onCreate={openZoneForm}
          createLabel={term => `إضافة منطقة "${term}"`}
          placeholder="اختر منطقة…"
        />
        <Combobox
          showLabel
          label="التصنيف"
          value={draft.status}
          onChange={value => set('status', value as CustomerDraft['status'])}
          options={[
            { value: 'active', label: 'نشط' },
            { value: 'vip', label: 'مميز' },
            { value: 'inactive', label: 'غير نشط' },
          ]}
        />
        <div className="sm:col-span-2">
          <Field label="العنوان">
            <input value={draft.address} onChange={e => set('address', e.target.value)} className={fieldClass} />
          </Field>
        </div>
        {error && <div className="sm:col-span-2"><ErrorNote message={error} /></div>}
      </form>

      {/* Rendered inside this dialog so its own combobox popup escapes to the
          right layer: a <dialog> opened with showModal() sits in the browser's
          top layer, and anything portaled to <body> paints underneath it. */}
      <ZoneForm
        open={newZoneName !== null}
        zone={null}
        initialName={newZoneName ?? ''}
        onCreated={name => settleZoneForm(name)}
        onClose={() => settleZoneForm(null)}
      />
    </Modal>
  );
};
