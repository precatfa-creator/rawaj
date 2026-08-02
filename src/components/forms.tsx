import React, { FormEvent, useState } from 'react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { ImageUploader } from './ImageUploader';
import {
  newId, saveCustomer, saveProduct, saveStore,
  type CustomerDraft, type ProductDraft, type WriteResult,
} from '../lib/mutations';
import type { Customer, Product, Store } from '../types';

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
        <Field label="الفئة">
          <input value={draft.category} onChange={e => set('category', e.target.value)} className={fieldClass} />
        </Field>
        <Field label="سعر الشراء (د.ل)">
          <input type="number" min={0} step="0.01" value={draft.purchasePrice} onChange={e => set('purchasePrice', Number(e.target.value))} required className={fieldClass} />
        </Field>
        <Field label="سعر البيع (د.ل)" hint={`الربح المحتسب: ${margin.toLocaleString('en-US')} د.ل`}>
          <input type="number" min={0} step="0.01" value={draft.sellingPrice} onChange={e => set('sellingPrice', Number(e.target.value))} required className={fieldClass} />
        </Field>
        <Field label="المخزون">
          <input type="number" min={0} value={draft.stock} onChange={e => set('stock', Number(e.target.value))} required className={fieldClass} />
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

// ---- customer ----

export const CustomerForm: React.FC<{
  open: boolean; customer: Customer | null; onClose: () => void;
}> = ({ open, customer, onClose }) => {
  const isNew = !customer;
  const [draft, setDraft] = useState<CustomerDraft>({
    id: '', name: '', phone: '', whatsapp: '', city: '', address: '', status: 'active',
  });
  const { busy, error, submit } = useSubmit(onClose);

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
        <Field label="المدينة">
          <input value={draft.city} onChange={e => set('city', e.target.value)} className={fieldClass} />
        </Field>
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
    </Modal>
  );
};
