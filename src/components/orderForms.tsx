import React, { FormEvent, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { createOrder, newId, orderTotals } from '../lib/mutations';
import { statusLabels } from '../lib/dashboardStats';
import { searchOptions } from '../lib/queries';
import type { Customer, DeliveryZone, Order, OrderItem, Product, SalesRep } from '../types';

const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;

export const OrderForm: React.FC<{
  open: boolean;
  storeId: string;
  products: Product[];
  customers: Customer[];
  orders: Order[];
  zones: DeliveryZone[];
  salesReps: SalesRep[];
  onClose: () => void;
}> = ({ open, storeId, products, customers, orders, zones, salesReps, onClose }) => {
  const [customerId, setCustomerId] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [notes, setNotes] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setCustomerId('');
    setItems([]);
    setDiscount(0);
    setDeliveryFee(0);
    setNotes('');
    setZoneId('');
    setAgentId('');
    setError('');
  }
  if (!open && seeded) setSeeded(false);

  const { subtotal, total } = orderTotals(items, discount, deliveryFee);
  const customer = customers.find(c => c.id === customerId);

  // Reps covering the chosen zone come first; a rep with no zone covers all of
  // them, and the rest stay selectable rather than disappearing.
  const zoneName = zones.find(z => z.id === zoneId)?.name ?? '';
  const covers = (rep: SalesRep) => !rep.zone || !zoneName || rep.zone === zoneName;
  const agentOptions = salesReps
    .filter(rep => rep.active)
    .sort((a, b) => Number(covers(b)) - Number(covers(a)));

  const addItem = async (productId: string) => {
    // The picker can return a product outside the preloaded slice, so fall back
    // to fetching the row rather than silently ignoring the pick.
    let product = products.find(p => p.id === productId);
    if (!product) {
      const [row] = await searchOptions('products', 'id,name,sellingPrice:selling_price,images', '', {}, 1000)
        .then(rows => rows.filter(r => r.id === productId));
      if (!row) return;
      product = { id: row.id, name: row.name, sellingPrice: Number(row.sellingPrice), images: (row.images ?? []) } as Product;
    }
    setItems(current =>
      current.some(item => item.productId === productId)
        ? current.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            price: product.sellingPrice,
            image: product.images[0] ?? '',
          }],
    );
  };

  const setQuantity = (productId: string, quantity: number) =>
    setItems(current => current.map(item => item.productId === productId ? { ...item, quantity } : item));

  const removeItem = (productId: string) =>
    setItems(current => current.filter(item => item.productId !== productId));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer || items.length === 0) {
      setError('اختر عميلاً وأضف منتجاً واحداً على الأقل.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await createOrder({
      id: newId(),
      orderNumber: '', // generated in Postgres from the full table
      storeId,
      customerId: customer.id,
      customerName: customer.name,
      items,
      discount,
      deliveryFee,
      notes: notes.trim(),
      agentId,
    });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.message ?? "");
  };

  return (
    <Modal
      open={open}
      wide
      title="طلب جديد"
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="order-form" disabled={busy} className={primaryButton}>
            {busy ? 'جارٍ الإنشاء...' : `إنشاء الطلب · ${money(total)}`}
          </button>
          <button type="button" onClick={onClose} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <form id="order-form" className="space-y-5" onSubmit={submit}>
        <Combobox
          showLabel
          label="العميل"
          value={customerId}
          onChange={value => {
            setCustomerId(value);
            // Prefill the fee from the customer's city when it maps to a zone.
            const city = customers.find(c => c.id === value)?.city;
            const match = zones.find(z => z.active && (z.name === city || z.capital === city));
            if (match) { setZoneId(match.id); setDeliveryFee(match.fee); }
          }}
          options={customers.map(c => ({ value: c.id, label: c.name, hint: c.city || 'بدون مدينة' }))}
          onSearch={async term => (await searchOptions('customers', 'id,name,city', term))
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
              onSearch={async term => (await searchOptions('products', 'id,name,sellingPrice:selling_price,stock', term, { store_id: storeId }))
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
              {items.map(item => (
                <li key={item.productId} className="flex items-center gap-3 bg-surface-50 border border-surface-200 rounded-xl p-3">
                  <span className="flex-1 font-semibold text-surface-900 truncate">{item.productName}</span>
                  <span className="text-sm text-surface-500 tabular-nums">{money(item.price)}</span>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={e => setQuantity(item.productId, Math.max(1, Number(e.target.value)))}
                    aria-label={`الكمية من ${item.productName}`}
                    className="w-20 bg-white border border-surface-200 rounded-lg px-2 py-1.5 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    aria-label={`إزالة ${item.productName}`}
                    className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-surface-500 hover:text-rose-700 hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Combobox
          showLabel
          label="منطقة التوصيل"
          value={zoneId}
          onChange={value => {
            setZoneId(value);
            const zone = zones.find(z => z.id === value);
            if (zone) setDeliveryFee(zone.fee);
          }}
          options={[
            { value: '', label: 'بدون منطقة' },
            ...zones.filter(z => z.active).map(z => ({
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
            ...agentOptions.map(rep => ({
              value: rep.id,
              label: rep.name,
              hint: rep.zone || 'كل المناطق',
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
          <div className="flex justify-between border-t border-surface-200 pt-1.5 mt-1.5"><dt className="font-bold text-surface-900">الإجمالي</dt><dd className="font-black text-lg tabular-nums">{money(total)}</dd></div>
        </dl>

        {error && <ErrorNote message={error} />}
      </form>
    </Modal>
  );
};

export const OrderDetails: React.FC<{
  order: Order | null; salesReps: SalesRep[]; onClose: () => void;
}> = ({ order, salesReps, onClose }) => (
  <Modal open={!!order} wide title={order ? `الطلب ${order.orderNumber}` : ''} onClose={onClose}>
    {order && (
      <div className="space-y-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            ['العميل', order.customerName],
            ['الحالة', statusLabels[order.status]],
            ['التاريخ', new Date(order.createdAt).toLocaleDateString('ar-LY')],
            ['المندوب', salesReps.find(rep => rep.id === order.agentId)?.name ?? 'بدون مندوب'],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface-50 border border-surface-200 rounded-xl p-3">
              <dt className="text-surface-500 text-xs">{label}</dt>
              <dd className="font-bold text-surface-900 mt-1">{value}</dd>
            </div>
          ))}
        </dl>

        <ul className="space-y-2">
          {order.items.map((item, index) => (
            <li key={`${item.productId}-${index}`} className="flex items-center gap-3 border border-surface-200 rounded-xl p-3">
              {item.image && <img src={item.image} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover border border-surface-200" />}
              <span className="flex-1 font-semibold text-surface-900 truncate">{item.productName}</span>
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
