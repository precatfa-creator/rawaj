import React, { FormEvent, useRef, useState } from 'react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { ImageUploader } from './ImageUploader';
import { useAppStore } from '../store';
import {
  createCategory, newId, saveCustomer, saveProduct, saveSalesRep, saveStore, saveZone,
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

const Footer: React.FC<{ busy: boolean; onCancel: () => void; label: string }> = ({ busy, onCancel, label }) => (
  <>
    <button type="submit" form="entity-form" disabled={busy} className={primaryButton}>
      {busy ? 'جارٍ الحفظ...' : label}
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
  const [draft, setDraft] = useState<ZoneDraft>({
    id: '', code: '', name: '', region: 'tripolitania', capital: '', fee: 0, deliveryTimeDays: 3, active: true,
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
          if (!result.ok) { setError(result.message ?? ''); return; }
          if (isNew) onCreated?.(draft.name.trim());
          onClose();
        }}
      >
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

// ---- store ----

export const StoreForm: React.FC<{
  open: boolean; store: Store | null; onClose: () => void;
}> = ({ open, store, onClose }) => {
  const isNew = !store;
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [facebookPage, setFacebookPage] = useState('');
  const { busy, error, submit } = useSubmit(onClose);

  // Re-seed the fields whenever a different record is opened.
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = store?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setName(store?.name ?? '');
    setImage(store?.image ?? '');
    setFacebookPage(store?.facebookPage ?? '');
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
        onSubmit={submit(() => saveStore({ id: store?.id ?? newId(), name, image, facebookPage }, isNew))}
      >
        <Field label="اسم المتجر">
          <input value={name} onChange={e => setName(e.target.value)} required className={fieldClass} />
        </Field>
        {/* One image, so the gallery uploader is capped at 1 rather than duplicated. */}
        <ImageUploader
          images={image ? [image] : []}
          onChange={images => setImage(images[0] ?? '')}
          max={1}
          label="صورة المتجر"
          hint="تظهر على بطاقة المتجر."
        />
        <Field label="صفحة فيسبوك" hint="كثير من المتاجر لا تملك موقعاً، فقط صفحة.">
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
    purchasePrice: 0, sellingPrice: 0, stock: 0, minStock: 0, status: 'active', images: [],
  });
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
    });
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
      <form id="entity-form" className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={submit(() => saveProduct(draft, isNew))}>
        <div className="sm:col-span-2">
          <Field label="اسم المنتج">
            <input value={draft.name} onChange={e => set('name', e.target.value)} required className={fieldClass} />
          </Field>
        </div>
        <Field label="رمز SKU">
          <input value={draft.sku} onChange={e => set('sku', e.target.value)} dir="ltr" className={fieldClass} />
        </Field>
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
          onCreate={createCategory}
          createLabel={term => `إضافة فئة "${term}"`}
          placeholder="اختر فئة…"
        />
        <Field label="سعر الشراء (د.ل)">
          <input type="number" min={0} step="0.01" value={draft.purchasePrice} onChange={e => set('purchasePrice', Number(e.target.value))} required className={fieldClass} />
        </Field>
        <Field label="سعر البيع (د.ل)" hint={`الربح المحتسب: ${margin.toLocaleString('en-US')} د.ل`}>
          <input type="number" min={0} step="0.01" value={draft.sellingPrice} onChange={e => set('sellingPrice', Number(e.target.value))} required className={fieldClass} />
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
            value={draft.stock}
            onChange={e => set('stock', Number(e.target.value))}
            required={isNew}
            readOnly={!isNew}
            aria-readonly={!isNew}
            tabIndex={isNew ? undefined : -1}
            className={`${fieldClass} ${isNew ? '' : 'bg-surface-100 text-surface-500 cursor-not-allowed'}`}
          />
        </Field>
        <Field label="حد التنبيه">
          <input type="number" min={0} value={draft.minStock} onChange={e => set('minStock', Number(e.target.value))} required className={fieldClass} />
        </Field>
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
  const { zones } = useAppStore();
  const [draft, setDraft] = useState<SalesRepDraft>({
    id: '', name: '', phone: '', whatsapp: '', zone: '', commission: 0, active: true, note: '',
  });
  const { busy, error, submit } = useSubmit(onClose);

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = rep?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setDraft({
      id: rep?.id ?? newId(),
      name: rep?.name ?? '',
      phone: rep?.phone ?? '',
      whatsapp: rep?.whatsapp ?? '',
      zone: rep?.zone ?? '',
      commission: rep?.commission ?? 0,
      active: rep?.active ?? true,
      note: rep?.note ?? '',
    });
  }
  if (!open && seeded !== null) setSeeded(null);

  const set = <K extends keyof SalesRepDraft>(field: K, value: SalesRepDraft[K]) =>
    setDraft(current => ({ ...current, [field]: value }));

  const zoneOptions = [
    { value: '', label: 'كل المناطق' },
    ...zones.map(zone => ({ value: zone.name, label: zone.name, hint: zone.code })),
  ];

  return (
    <Modal
      open={open}
      wide
      title={isNew ? 'مندوب جديد' : 'تعديل المندوب'}
      onClose={onClose}
      footer={<Footer busy={busy} onCancel={onClose} label={isNew ? 'إضافة المندوب' : 'حفظ التعديلات'} />}
    >
      <form id="entity-form" className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={submit(() => saveSalesRep(draft, isNew))}>
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
        <Combobox
          showLabel
          label="منطقة التغطية"
          value={draft.zone}
          onChange={value => set('zone', value)}
          options={zoneOptions}
        />
        <Field label="العمولة لكل طلب مسلَّم (د.ل)">
          <input
            type="number" min={0} step="0.5" value={draft.commission}
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
  open: boolean; customer: Customer | null; onClose: () => void;
}> = ({ open, customer, onClose }) => {
  const isNew = !customer;
  const { zones } = useAppStore();
  const [draft, setDraft] = useState<CustomerDraft>({
    id: '', name: '', phone: '', whatsapp: '', city: '', address: '', status: 'active',
  });
  const { busy, error, submit } = useSubmit(onClose);
  const [newZoneName, setNewZoneName] = useState<string | null>(null);
  const zoneResolver = useRef<((name: string | null) => void) | null>(null);

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = customer?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setDraft({
      id: customer?.id ?? newId(),
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      whatsapp: customer?.whatsapp ?? '',
      city: customer?.city ?? '',
      address: customer?.address ?? '',
      status: customer?.status ?? 'active',
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
      hint: `${zone.code}${zone.capital ? ` · ${zone.capital}` : ''}`,
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
