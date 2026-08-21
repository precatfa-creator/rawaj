import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { money } from './ui';
import { Trash2 } from 'lucide-react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { CustomerForm, NamingSeriesField } from './forms';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { createOrder, newId, orderTotals, updateOrder } from '../lib/mutations';
import { assignableReps, orderCommission, repCoversZone } from '../lib/commission';
import { searchOptions } from '../lib/queries';
import { nextVariantForOrder, variantLabel, variantSnapshot } from '../lib/variants';
import { supabase } from '../db/supabase';
import type {
  Customer, DeliveryZone, Order, OrderItem, Product, ProductVariant, ProductVariantOption, SalesRep,
} from '../types';

/** Identifies a line: two variants of the same product are two stock reservations. */
const lineKey = (item: Pick<OrderItem, 'productId' | 'variantId' | 'size'>) =>
  `${item.productId}::${item.variantId ?? item.size ?? ''}`;

const PRODUCT_PICK_COLUMNS = 'id,name,sellingPrice:selling_price,stock,images,sizes,variantOptions:variant_options';

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
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [namingSeries, setNamingSeries] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);
  const customerResolver = useRef<((customerId: string | null) => void) | null>(null);
  // Realtime will add a saved customer to `customers`, but the picker must be
  // able to select it before that round trip finishes.
  const createdCustomer = useRef<Pick<Customer, 'id' | 'name' | 'city'> | null>(null);
  /**
   * Sizes offered per product, collected as products are picked. The picker can
   * return a product from outside the preloaded slice, so its sizes are not
   * always in `products`.
   */
  const [sizesById, setSizesById] = useState<Record<string, string[]>>({});
  const [variantsById, setVariantsById] = useState<Record<string, ProductVariant[]>>({});
  const [variantOptionsById, setVariantOptionsById] = useState<Record<string, ProductVariantOption[]>>({});

  const [seeded, setSeeded] = useState<string | null>(null);
  const key = order?.id ?? 'new';
  if (open && seeded !== key) {
    setSeeded(key);
    setCustomerId(order?.customerId ?? '');
    setCustomerName(order?.customerName ?? '');
    setItems(order?.items ?? []);
    setDiscount(order?.discount ?? 0);
    setDeliveryFee(order?.deliveryFee ?? 0);
    // The column is a date, so a timestamp from an import is cut to its day —
    // <input type="date"> shows nothing at all for anything longer.
    setDeliveryDate((order?.deliveryDate ?? '').slice(0, 10));
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
    setVariantsById({});
    setVariantOptionsById(Object.fromEntries(
      (order?.items ?? []).map(item => [
        item.productId,
        products.find(product => product.id === item.productId)?.variantOptions ?? [],
      ]),
    ));
  }
  if (!open && seeded !== null) setSeeded(null);

  useEffect(() => {
    if (!open || !order) return;
    const productIds = [...new Set(order.items.map(item => item.productId))];
    if (productIds.length === 0) return;
    let active = true;
    void Promise.all([
      supabase.from('product_variants')
        .select('id,productId:product_id,optionValues:option_values,optionKey:option_key,sku,stock,active')
        .in('product_id', productIds).eq('active', true),
      supabase.from('products').select('id,variantOptions:variant_options,sizes').in('id', productIds),
    ]).then(([variantRows, productRows]) => {
        if (variantRows.error) console.error('order product variants failed', variantRows.error);
        if (productRows.error) console.error('order product options failed', productRows.error);
        if (!active) return;
        const grouped: Record<string, ProductVariant[]> = {};
        ((variantRows.data ?? []) as unknown as ProductVariant[]).forEach(variant => {
          (grouped[variant.productId] ??= []).push(variant);
        });
        setVariantsById(grouped);
        setVariantOptionsById(current => ({
          ...current,
          ...Object.fromEntries((productRows.data ?? []).map(row => [row.id, row.variantOptions ?? []])),
        }));
        setSizesById(current => ({
          ...current,
          ...Object.fromEntries((productRows.data ?? []).map(row => [row.id, row.sizes ?? []])),
        }));
      });
    return () => { active = false; };
  }, [open, order?.id]);

  // Closing a half-filled order by clicking the backdrop is the one way to lose
  // work in this dialog, so it asks first.
  const dirty =
    customerId !== (order?.customerId ?? '')
    || customerName !== (order?.customerName ?? '')
    || discount !== (order?.discount ?? 0)
    || deliveryFee !== (order?.deliveryFee ?? 0)
    || deliveryDate !== (order?.deliveryDate ?? '').slice(0, 10)
    || notes !== (order?.notes ?? '')
    || zoneId !== (order?.zoneId ?? '')
    || agentId !== (order?.agentId ?? '')
    || JSON.stringify(items) !== JSON.stringify(order?.items ?? []);

  const requestClose = () => {
    if (dirty && !window.confirm('هناك تغييرات لم تُحفظ. إغلاق الطلب دون حفظ؟')) return;
    onClose();
  };

  const { subtotal, total } = orderTotals(items, discount, deliveryFee);
  const customer = customers.find(c => c.id === customerId)
    ?? (createdCustomer.current?.id === customerId ? createdCustomer.current : undefined);
  const zone = zones.find(z => z.id === zoneId);

  const applyCustomerZone = (city: string) => {
    // The area first, then the city it sits in — a customer who wrote
    // «طرابلس» rather than a neighbourhood still gets a fee.
    const match = zones.find(z => z.active && z.name === city)
      ?? zones.find(z => z.active && z.city === city);
    if (match) { setZoneId(match.id); setDeliveryFee(match.fee); }
  };

  /** Keeps the combobox waiting while the full customer dialog is on top. */
  const openCustomerForm = (term: string) =>
    new Promise<string | null>(resolve => {
      customerResolver.current = resolve;
      setNewCustomerName(term);
    });

  const settleCustomerForm = (created: Pick<Customer, 'id' | 'name' | 'city'> | null) => {
    if (created) {
      createdCustomer.current = created;
      setCustomerId(created.id);
      setCustomerName(created.name);
      applyCustomerZone(created.city);
    }
    customerResolver.current?.(created?.id ?? null);
    customerResolver.current = null;
    setNewCustomerName(null);
  };

  // Only reps who cover the chosen zone; a rep with no zones covers all of them.
  // Whoever is already on the order stays listed even if they no longer cover
  // it, so an existing mismatch is visible instead of silently blanked.
  const zoneName = zone?.name ?? '';
  const agentOptions = assignableReps(salesReps, zoneName, order?.agentId);
  const agentOffZone = !!agentId && !repCoversZone(
    salesReps.find(r => r.id === agentId) ?? { zones: [] },
    zoneName,
  );

  const rep = salesReps.find(r => r.id === agentId);
  const availableProducts = products.filter(product => product.stock > 0);

  const reservedVariantQuantity = (variantId: string): number => {
    if (!order || ['canceled', 'returned'].includes(order.status)) return 0;
    return order.items.reduce(
      (sum, item) => sum + (item.variantId === variantId ? item.quantity : 0),
      0,
    );
  };

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
        images: (row.images ?? []), sizes: (row.sizes ?? []), variantOptions: (row.variantOptions ?? []),
      } as Product;
    }

    const sizes = product.sizes ?? [];
    const variantOptions = product.variantOptions ?? [];
    setSizesById(current => ({ ...current, [product.id]: sizes }));
    setVariantOptionsById(current => ({ ...current, [product.id]: variantOptions }));

    let productVariants = variantsById[product.id] ?? [];
    if (variantOptions.length > 0 && productVariants.length === 0) {
      const { data, error: queryError } = await supabase.from('product_variants')
        .select('id,productId:product_id,optionValues:option_values,optionKey:option_key,sku,stock,active')
        .eq('product_id', product.id).eq('active', true).order('option_key');
      if (queryError) { console.error('product variants failed', queryError); return; }
      productVariants = (data ?? []) as unknown as ProductVariant[];
      setVariantsById(current => ({ ...current, [product.id]: productVariants }));
    }

    const reservedItems = order && !['canceled', 'returned'].includes(order.status) ? order.items : [];
    const variant = nextVariantForOrder(productVariants, items, reservedItems) as ProductVariant | undefined;
    if (variantOptions.length > 0 && !variant) {
      setError('لا توجد تركيبة أخرى متاحة من هذا المنتج في المخزون.');
      return;
    }

    const size = sizes[0] ?? '';
    const target = lineKey({ productId, size, variantId: variant?.id });
    setItems(current =>
      current.some(item => lineKey(item) === target)
        ? current.map(item => lineKey(item) === target ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            price: product.sellingPrice,
            image: product.images[0] ?? '',
            ...(variant ? {
              variantId: variant.id,
              variantValues: variantSnapshot(variantOptions, variant),
            } : { size }),
          }],
    );
  };

  const setLine = (target: string, change: Partial<OrderItem>) =>
    setItems(current => current.map(item => lineKey(item) === target ? { ...item, ...change } : item));

  const removeItem = (target: string) =>
    setItems(current => current.filter(item => lineKey(item) !== target));

  const changeVariant = (
    target: string,
    variant: ProductVariant,
    options: ProductVariantOption[],
  ) => setItems(current => current.map(item => lineKey(item) === target ? {
    ...item,
    variantId: variant.id,
    variantValues: variantSnapshot(options, variant),
    size: undefined,
  } : item));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerId || items.length === 0) {
      setError('اختر عميلاً وأضف منتجاً واحداً على الأقل.');
      return;
    }
    // Two lines of the same product variant would be one line the
    // database sums anyway; catching it here explains why.
    const keys = items.map(lineKey);
    if (new Set(keys).size !== keys.length) {
      setError('هناك سطران لنفس تركيبة المنتج. ادمجهما في سطر واحد.');
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
      deliveryDate,
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
    <>
      <Modal
      open={open}
      wide
      title={isEdit ? `تعديل الطلب ${order.orderNumber}` : 'طلب جديد'}
      onClose={requestClose}
      footer={
        <>
          <button type="submit" form="order-form" disabled={busy} className={primaryButton}>
            {busy
              ? 'جارٍ الحفظ…'
              : `${isEdit ? 'حفظ التعديلات' : 'إنشاء الطلب'} · ${money(total)}`}
          </button>
          <button type="button" onClick={requestClose} className={ghostButton}>إلغاء</button>
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
            const picked = customers.find(c => c.id === value)
              ?? (createdCustomer.current?.id === value ? createdCustomer.current : undefined);
            setCustomerName(picked?.name ?? '');
            if (picked) applyCustomerZone(picked.city);
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
          onCreate={isEdit ? undefined : openCustomerForm}
          createLabel={term => `إنشاء عميل جديد باسم "${term}"`}
          placeholder="اختر عميلاً"
        />

        <div>
          <span className="block text-sm font-bold text-surface-700 mb-1.5">المنتجات</span>
          {availableProducts.length === 0 ? (
            <p className="text-sm text-surface-500 bg-surface-50 border border-surface-200 rounded-xl p-3">
              لا توجد منتجات متاحة في المخزون.
            </p>
          ) : (
            <Combobox
              label="إضافة منتج إلى الطلب"
              value=""
              onChange={productId => { if (productId) void addItem(productId); }}
              options={availableProducts.map(p => ({
                value: p.id,
                label: p.name,
                hint: `${money(p.sellingPrice)} · المخزون ${p.stock}`,
              }))}
              onSearch={async term => (await searchOptions(
                'products', PRODUCT_PICK_COLUMNS, term, { store_id: storeId }, 30, {}, { stock: 0 },
              ))
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
                const variants = variantsById[item.productId] ?? [];
                const variantOptions = variantOptionsById[item.productId] ?? [];
                const availableVariants = variants.filter(variant =>
                  variant.stock + reservedVariantQuantity(variant.id) > 0);
                return (
                  <li key={target} className="flex flex-wrap items-center gap-3 bg-surface-50 border border-surface-200 rounded-xl p-3">
                    <span className="flex-1 min-w-40 font-semibold text-surface-900 truncate">{item.productName}</span>
                    {variantOptions.length > 0 ? (
                      availableVariants.length > 0 ? (
                        <Combobox
                          size="sm"
                          label={`تركيبة ${item.productName}`}
                          value={item.variantId ?? ''}
                          onChange={id => {
                            const variant = availableVariants.find(row => row.id === id);
                            if (variant) changeVariant(target, variant, variantOptions);
                          }}
                          options={availableVariants.map(variant => ({
                            value: variant.id,
                            label: variantOptions.map(option => variant.optionValues[option.id]).filter(Boolean).join(' · '),
                            hint: `المتاح ${variant.stock + reservedVariantQuantity(variant.id)}`,
                          }))}
                          placeholder="التركيبة"
                          className="w-48"
                        />
                      ) : (
                        <span className="text-xs font-bold text-surface-600">
                          {variantLabel(item.variantValues) || 'تركيبة غير متاحة'}
                        </span>
                      )
                    ) : sizes.length > 0 ? (
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
            // Moving the order to a zone the chosen rep does not serve would
            // leave an assignment the rep picker itself would now refuse.
            const chosen = salesReps.find(r => r.id === agentId);
            if (chosen && !repCoversZone(chosen, picked?.name ?? '')) setAgentId('');
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

        <div>
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
            placeholder={zoneName ? 'اختر مندوباً' : 'اختر المنطقة أولاً'}
          />
          {agentOffZone && (
            <p className="text-xs font-bold text-amber-700 mt-1.5">
              هذا المندوب لا يغطي {zoneName || 'منطقة الطلب'}. اختر مندوباً آخر.
            </p>
          )}
          {!agentOffZone && zoneName && agentOptions.length === 0 && (
            <p className="text-xs font-bold text-amber-700 mt-1.5">
              لا يوجد مندوب يغطي {zoneName}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="الخصم (د.ل)">
            <input type="number" min={0} step="0.01" value={discount || ''} placeholder="0" onChange={e => setDiscount(Number(e.target.value))} className={fieldClass} />
          </Field>
          <Field label="رسوم التوصيل (د.ل)">
            <input type="number" min={0} step="0.01" value={deliveryFee || ''} placeholder="0" onChange={e => setDeliveryFee(Number(e.target.value))} className={fieldClass} />
          </Field>
        </div>

        <Field label="تاريخ التسليم">
          <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={fieldClass} />
        </Field>

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
      <CustomerForm
        open={!isEdit && newCustomerName !== null}
        customer={null}
        initialName={newCustomerName ?? ''}
        storeId={storeId}
        onCreated={settleCustomerForm}
        onClose={() => settleCustomerForm(null)}
      />
    </>
  );
};
