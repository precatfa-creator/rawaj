import React, { FormEvent, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { NamingSeriesField } from './forms';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { createOrder, newId, orderTotals, updateOrder } from '../lib/mutations';
import { statusLabels } from '../lib/dashboardStats';
import { orderCommission, repCoversZone } from '../lib/commission';
import { searchOptions } from '../lib/queries';
import type { Customer, DeliveryZone, Order, OrderItem, Product, SalesRep } from '../types';

const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;

/** Identifies a line: the same product in two sizes is two lines, not one. */
const lineKey = (item: Pick<OrderItem, 'productId' | 'size'>) => `${item.productId}::${item.size ?? ''}`;

const PRODUCT_PICK_COLUMNS = 'id,name,sellingPrice:selling_price,stock,images,sizes';

/**
 * Composing a new order, and editing an existing one.
 *
 * One component for both because the fields, the totals and the stock rules are
 * the same either way — the only difference is which mutation runs at the end.
 * An edit goes through `update_order_with_stock`, so the item changes move stock
 * and leave ledger rows behind rather than quietly rewriting a row.
 */
export const OrderForm: React.FC<{
  open: boolean;
  /** Null composes a new order; a row edits that order. */
  order?: Order | null;
  storeId: string;
  products: Product[];
  customers: Customer[];
  zones: DeliveryZone[];
  salesReps: SalesRep[];
  customerStoreIds?: string[];
  onClose: () => void;
}> = ({ open, order = null, storeId, products, customers, zones, salesReps, customerStoreIds = [storeId], onClose }) => {
  const isEdit = order !== null;
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [notes, setNotes] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [namingSeries, setNamingSeries] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /**
   * Sizes offered per product, collected as products are picked. The picker can
   * return a product from outside the preloaded slice, so its sizes are not
   * always in `products`.
   */
  const [sizesById, setSizesById] = useState<Record<string, string[]>>({});

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = order?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setCustomerId(order?.customerId ?? '');
    setCustomerName(order?.customerName ?? '');
    setItems(order?.items ?? []);
    setDiscount(order?.discount ?? 0);
    setDeliveryFee(order?.deliveryFee ?? 0);
    setNotes(order?.notes ?? '');
    setZoneId(order?.zoneId ?? '');
    setAgentId(order?.agentId ?? '');
    setNamingSeries(order?.namingSeries ?? '');
    setError('');
    setSizesById(Object.fromEntries(
      (order?.items ?? []).map(item => [
        item.productId,
        products.find(product => product.id === item.productId)?.sizes ?? [],
      ]),
    ));
  }
  if (!open && seeded !== null) setSeeded(null);

  const { subtotal, total } = orderTotals(items, discount, deliveryFee);
  const customer = customers.find(c => c.id === customerId);
  const zone = zones.find(z => z.id === zoneId);

  // Reps covering the chosen zone come first; a rep with no zones covers all of
  // them, and the rest stay selectable rather than disappearing.
  const zoneName = zone?.name ?? '';
  const agentOptions = salesReps
    .filter(rep => rep.active)
    .sort((a, b) => Number(repCoversZone(b, zoneName)) - Number(repCoversZone(a, zoneName)));

  const rep = salesReps.find(r => r.id === agentId);

  const addItem = async (productId: string) => {
    // The picker can return a product outside the preloaded slice, so fall back
    // to fetching the row rather than silently ignoring the pick.
    let product = products.find(p => p.id === productId);
    if (!product) {
      const [row] = await searchOptions('products', PRODUCT_PICK_COLUMNS, '', {}, 1000)
        .then(rows => rows.filter(r => r.id === productId));
      if (!row) return;
      product = {
        id: row.id, name: row.name, sellingPrice: Number(row.sellingPrice),
        images: (row.images ?? []), sizes: (row.sizes ?? []),
      } as Product;
    }

    const sizes = product.sizes ?? [];
    setSizesById(current => ({ ...current, [product.id]: sizes }));

    const size = sizes[0] ?? '';
    const target = lineKey({ productId, size });
    setItems(current =>
      current.some(item => lineKey(item) === target)
        ? current.map(item => lineKey(item) === target ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            price: product.sellingPrice,
            image: product.images[0] ?? '',
            size,
          }],
    );
  };

  const setLine = (target: string, change: Partial<OrderItem>) =>
    setItems(current => current.map(item => lineKey(item) === target ? { ...item, ...change } : item));

  const removeItem = (target: string) =>
    setItems(current => current.filter(item => lineKey(item) !== target));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerId || items.length === 0) {
      setError('اختر عميلاً وأضف منتجاً واحداً على الأقل.');
      return;
    }
    // Two lines of the same product in the same size would be one line the
    // database sums anyway; catching it here explains why.
    const keys = items.map(lineKey);
    if (new Set(keys).size !== keys.length) {
      setError('هناك سطران لنفس المنتج بنفس المقاس. ادمجهما في سطر واحد.');
      return;
    }

    setBusy(true);
    setError('');
    const draft = {
      customerId,
      customerName: customer?.name ?? customerName,
      items,
      discount,
      deliveryFee,
      notes: notes.trim(),
      agentId,
      zoneId,
    };
    const result = isEdit
      ? await updateOrder({ id: order.id, ...draft })
      : await createOrder({
          id: newId(),
          // Left blank on purpose: Postgres takes the next number from this
          // store's counter for the chosen series, so two stores can each have
          // their own ORD-2026-0001.
          orderNumber: '',
          storeId,
          namingSeries,
          ...draft,
        });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.message ?? "");
  };

  return (
    <Modal
      open={open}
      wide
      title={isEdit ? `تعديل الطلب ${order.orderNumber}` : 'طلب جديد'}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="order-form" disabled={busy} className={primaryButton}>
            {busy
              ? 'جارٍ الحفظ...'
              : `${isEdit ? 'حفظ التعديلات' : 'إنشاء الطلب'} · ${money(total)}`}
          </button>
          <button type="button" onClick={onClose} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <form id="order-form" className="space-y-5" onSubmit={submit}>
        {isEdit && (
          <p className="text-xs text-surface-600 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
            تغيير الكميات يحرّك المخزون ويسجّل حركة لكل منتج تغيّرت كميته، ويُحفظ التعديل في سجل التدقيق.
            حالة الطلب تُغيَّر من جدول الطلبات، لا من هنا.
          </p>
        )}

        {!isEdit && (
          <NamingSeriesField
            doctype="orders"
            value={namingSeries}
            onChange={setNamingSeries}
            label="تسلسل ترقيم الطلب"
            hint="لكل متجر عدّاده الخاص، فيبدأ ترقيم كل متجر من 1."
          />
        )}

        <Combobox
          showLabel
          label="العميل"
          value={customerId}
          onChange={value => {
            setCustomerId(value);
            const picked = customers.find(c => c.id === value);
            setCustomerName(picked?.name ?? '');
            // Prefill the fee from the customer's city when it maps to a zone.
            // The area first, then the city it sits in — a customer who wrote
            // «طرابلس» rather than a neighbourhood still gets a fee.
            const match = zones.find(z => z.active && z.name === picked?.city)
              ?? zones.find(z => z.active && z.city === picked?.city);
            if (match) { setZoneId(match.id); setDeliveryFee(match.fee); }
          }}
          // The order being edited may belong to a customer outside the preloaded
          // slice; without their own option the field would read as "اختر عميلاً"
          // over an order that has one.
          options={[
            ...(customerId && !customers.some(c => c.id === customerId)
              ? [{ value: customerId, label: customerName || customerId }]
              : []),
            ...customers.map(c => ({ value: c.id, label: c.name, hint: c.city || 'بدون مدينة' })),
          ]}
          // Scoped to this store: customers belong to one store now, and an
          // order can only be for a customer of the store it belongs to.
          onSearch={async term => (await searchOptions('customers', 'id,name,city', term, {}, 30, { store_id: customerStoreIds }))
            .map(row => ({ value: row.id as string, label: row.name as string, hint: (row.city as string) || 'بدون مدينة' }))}
          placeholder="اختر عميلاً"
        />

        <div>
          <span className="block text-sm font-bold text-surface-700 mb-1.5">المنتجات</span>
          {products.length === 0 ? (
            <p className="text-sm text-surface-500 bg-surface-50 border border-surface-200 rounded-xl p-3">
              لا توجد منتجات في هذا المتجر. أضف منتجاً أولاً.
            </p>
          ) : (
            <Combobox
              label="إضافة منتج إلى الطلب"
              value=""
              onChange={productId => { if (productId) void addItem(productId); }}
              options={products.map(p => ({
                value: p.id,
                label: p.name,
                hint: `${money(p.sellingPrice)} · المخزون ${p.stock}`,
              }))}
              onSearch={async term => (await searchOptions('products', PRODUCT_PICK_COLUMNS, term, { store_id: storeId }))
                .map(row => ({
                  value: row.id as string,
                  label: row.name as string,
                  hint: `${money(Number(row.sellingPrice))} · المخزون ${row.stock}`,
                }))}
              placeholder="أضف منتجاً…"
            />
          )}

          {items.length > 0 && (
            <ul className="mt-3 space-y-2">
              {items.map(item => {
                const target = lineKey(item);
                const sizes = sizesById[item.productId] ?? [];
                return (
                  <li key={target} className="flex flex-wrap items-center gap-3 bg-surface-50 border border-surface-200 rounded-xl p-3">
                    <span className="flex-1 min-w-40 font-semibold text-surface-900 truncate">{item.productName}</span>
                    {sizes.length > 0 ? (
                      <Combobox
                        size="sm"
                        label={`مقاس ${item.productName}`}
                        value={item.size ?? ''}
                        onChange={size => setLine(target, { size })}
                        options={sizes.map(size => ({ value: size, label: size }))}
                        placeholder="المقاس"
                        className="w-28"
                      />
                    ) : item.size ? (
                      // A size recorded when the product still offered it stays
                      // visible rather than vanishing from the order it belongs to.
                      <span className="text-xs font-bold text-surface-600 bg-white border border-surface-200 rounded-lg px-2 py-1.5">
                        {item.size}
                      </span>
                    ) : null}
                    <span className="text-sm text-surface-500 tabular-nums">{money(item.price)}</span>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={e => setLine(target, { quantity: Math.max(1, Number(e.target.value)) })}
                      aria-label={`الكمية من ${item.productName}`}
                      className="w-20 bg-white border border-surface-200 rounded-lg px-2 py-1.5 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(target)}
                      aria-label={`إزالة ${item.productName}`}
                      className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-surface-500 hover:text-rose-700 hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Combobox
          showLabel
          label="منطقة التوصيل"
          value={zoneId}
          onChange={value => {
            setZoneId(value);
            const picked = zones.find(z => z.id === value);
            if (picked) setDeliveryFee(picked.fee);
          }}
          options={[
            { value: '', label: 'بدون منطقة' },
            ...zones.filter(z => z.active || z.id === zoneId).map(z => ({
              value: z.id,
              label: z.name,
              hint: `${money(z.fee)} · ${z.deliveryTimeDays} أيام`,
            })),
          ]}
          placeholder="اختر منطقة لتعبئة الرسوم"
        />

        <Combobox
          showLabel
          label="المندوب"
          value={agentId}
          onChange={setAgentId}
          options={[
            { value: '', label: 'بدون مندوب' },
            ...agentOptions.map(option => ({
              value: option.id,
              label: option.name,
              hint: option.zones.length > 0 ? option.zones.join('، ') : 'كل المناطق',
            })),
          ]}
          placeholder="اختر مندوباً"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="الخصم (د.ل)">
            <input type="number" min={0} step="0.01" value={discount} onChange={e => setDiscount(Number(e.target.value))} className={fieldClass} />
          </Field>
          <Field label="رسوم التوصيل (د.ل)">
            <input type="number" min={0} step="0.01" value={deliveryFee} onChange={e => setDeliveryFee(Number(e.target.value))} className={fieldClass} />
          </Field>
        </div>

        <Field label="ملاحظات">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={fieldClass} />
        </Field>

        <dl className="bg-surface-50 border border-surface-200 rounded-xl p-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-surface-500">المجموع الفرعي</dt><dd className="font-bold tabular-nums">{money(subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-surface-500">الخصم</dt><dd className="font-bold tabular-nums">−{money(discount)}</dd></div>
          <div className="flex justify-between"><dt className="text-surface-500">التوصيل</dt><dd className="font-bold tabular-nums">{money(deliveryFee)}</dd></div>
          {rep && (
            <div className="flex justify-between">
              <dt className="text-surface-500">عمولة المندوب عند التسليم</dt>
              <dd className="font-bold tabular-nums">{money(orderCommission(deliveryFee, zone, rep.commission))}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-surface-200 pt-1.5 mt-1.5"><dt className="font-bold text-surface-900">الإجمالي</dt><dd className="font-black text-lg tabular-nums">{money(total)}</dd></div>
        </dl>

        {error && <ErrorNote message={error} />}
      </form>
    </Modal>
  );
};

export const OrderDetails: React.FC<{
  order: Order | null;
  salesReps: SalesRep[];
  zones: DeliveryZone[];
  onClose: () => void;
}> = ({ order, salesReps, zones, onClose }) => {
  const rep = salesReps.find(item => item.id === order?.agentId);
  const zone = zones.find(item => item.id === order?.zoneId);

  return (
    <Modal open={!!order} wide title={order ? `الطلب ${order.orderNumber}` : ''} onClose={onClose}>
      {order && (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['العميل', order.customerName],
              ['الحالة', statusLabels[order.status]],
              ['التاريخ', new Date(order.createdAt).toLocaleDateString('ar-LY')],
              ['المنطقة', zone?.name ?? 'بدون منطقة'],
              ['المندوب', rep?.name ?? 'بدون مندوب'],
              ...(rep
                ? [['عمولة المندوب', `${Math.round(orderCommission(order.deliveryFee, zone, rep.commission)).toLocaleString('en-US')} د.ل`]]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="bg-surface-50 border border-surface-200 rounded-xl p-3">
                <dt className="text-surface-500 text-xs">{label}</dt>
                <dd className="font-bold text-surface-900 mt-1">{value}</dd>
              </div>
            ))}
          </dl>

          <ul className="space-y-2">
            {order.items.map((item, index) => (
              <li key={`${item.productId}-${item.size ?? ''}-${index}`} className="flex items-center gap-3 border border-surface-200 rounded-xl p-3">
                {item.image && <img src={item.image} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover border border-surface-200" />}
                <span className="flex-1 font-semibold text-surface-900 truncate">
                  {item.productName}
                  {item.size && <span className="text-surface-500 font-medium"> · مقاس {item.size}</span>}
                </span>
                <span className="text-sm text-surface-500 tabular-nums">{item.quantity} × {money(item.price)}</span>
                <span className="font-bold tabular-nums">{money(item.quantity * item.price)}</span>
              </li>
            ))}
          </ul>

          <dl className="bg-surface-50 border border-surface-200 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-surface-500">المجموع الفرعي</dt><dd className="font-bold tabular-nums">{money(order.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-surface-500">الخصم</dt><dd className="font-bold tabular-nums">−{money(order.discount)}</dd></div>
            <div className="flex justify-between"><dt className="text-surface-500">التوصيل</dt><dd className="font-bold tabular-nums">{money(order.deliveryFee)}</dd></div>
            <div className="flex justify-between border-t border-surface-200 pt-1.5 mt-1.5"><dt className="font-bold text-surface-900">الإجمالي</dt><dd className="font-black text-lg tabular-nums">{money(order.total)}</dd></div>
          </dl>

          {order.notes && (
            <div>
              <h3 className="text-sm font-bold text-surface-700 mb-1.5">ملاحظات</h3>
              <p className="text-surface-700 bg-surface-50 border border-surface-200 rounded-xl p-3">{order.notes}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
