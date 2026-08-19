import React, { useEffect, useState } from 'react';
import { PackageMinus } from 'lucide-react';
import { Modal, ghostButton, primaryButton } from './Modal';
import { ErrorNote } from './Confirm';
import { money } from './ui';
import { deliveredTotals, deliveredOf, isShort } from '../lib/orderMath';
import type { Order, OrderItem } from '../types';
import type { WriteResult } from '../lib/mutations';

/**
 * Recording what actually reached the customer.
 *
 * A partial delivery is the one status change that cannot be expressed by the
 * status alone: "some of it arrived" is not a fact until somebody says which
 * lines and how many. So the change is not applied until this is filled in, and
 * what it writes is per-line rather than a note somebody has to interpret later.
 *
 * The line is checked by default at its full quantity, because the common case
 * is one short line in an otherwise complete order — starting from empty would
 * make the operator re-enter what they already know.
 */
export const PartialDeliveryPrompt: React.FC<{
  order: Order | null;
  onSubmit: (items: OrderItem[]) => Promise<WriteResult>;
  onClose: () => void;
}> = ({ order, onSubmit, onClose }) => {
  const [lines, setLines] = useState<OrderItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!order) return;
    // Seeded from whatever the order already records, so reopening the dialog
    // on an order already marked partial shows the numbers it was given.
    setLines(order.items.map(item => ({ ...item, deliveredQuantity: deliveredOf(item) })));
    setError('');
  }, [order?.id]);

  if (!order) return null;

  const setLine = (index: number, delivered: number) =>
    setLines(current => current.map((item, at) =>
      at === index
        ? { ...item, deliveredQuantity: Math.max(0, Math.min(item.quantity, Math.floor(delivered || 0))) }
        : item));

  const totals = deliveredTotals(lines, order.discount, order.deliveryFee);
  const short = isShort(lines);
  const nothing = lines.every(item => deliveredOf(item) === 0);

  const submit = async () => {
    if (nothing) {
      setError('لم تحدد أي صنف سُلّم. إن لم يصل شيء فالطلب مرتجع أو ملغي، لا تسليم جزئي.');
      return;
    }
    if (!short) {
      setError('كل الأصناف مسلّمة بالكامل — اختر «تسليم كامل» بدلاً من الجزئي.');
      return;
    }
    setBusy(true);
    const result = await onSubmit(lines);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.message ?? 'تعذر حفظ التسليم الجزئي.');
  };

  return (
    <Modal
      open
      wide
      title={`تسليم جزئي · ${order.orderNumber}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => void submit()} disabled={busy} className={primaryButton}>
            <PackageMinus size={16} />
            {busy ? 'جارٍ الحفظ…' : 'تأكيد التسليم الجزئي'}
          </button>
          <button type="button" onClick={onClose} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <p className="text-sm text-surface-600 mb-4">
        حدّد الأصناف التي وصلت العميل فعلاً، وعدّل الكمية إن وصل جزء منها.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-surface-200">
        <table className="w-full text-sm text-right">
          <thead className="bg-surface-50 text-surface-600">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-bold w-12">سُلّم</th>
              <th scope="col" className="px-3 py-2.5 font-bold">الصنف</th>
              <th scope="col" className="px-3 py-2.5 font-bold w-20">المطلوب</th>
              <th scope="col" className="px-3 py-2.5 font-bold w-28">المُسلَّم</th>
              <th scope="col" className="px-3 py-2.5 font-bold w-28">القيمة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200/70">
            {lines.map((item, index) => {
              const delivered = deliveredOf(item);
              return (
                <tr key={`${item.productId}::${item.size ?? ''}`} className={delivered === 0 ? 'bg-surface-50/60' : ''}>
                  <td className="px-3 py-2.5">
                    {/* The checkbox is a shortcut for the two ends of the number
                        field beside it — all of them, or none. */}
                    <input
                      type="checkbox"
                      checked={delivered > 0}
                      onChange={event => setLine(index, event.target.checked ? item.quantity : 0)}
                      aria-label={`سُلّم ${item.productName}`}
                      className="w-4 h-4 rounded border-surface-300 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`font-bold ${delivered === 0 ? 'text-surface-400 line-through' : 'text-surface-900'}`}>
                      {item.productName}
                    </span>
                    {item.size && <span className="text-xs text-surface-500 mr-2">({item.size})</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-surface-600">{item.quantity}</td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min={0}
                      max={item.quantity}
                      step={1}
                      value={delivered}
                      onChange={event => setLine(index, Number(event.target.value))}
                      aria-label={`الكمية المسلّمة من ${item.productName}`}
                      className="w-20 bg-white border border-surface-200 rounded-lg px-2 py-1.5 text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums font-bold text-surface-900">
                    {money(item.price * delivered)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The number the operator is actually deciding about, kept in view. */}
      <dl className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-teal-900">قيمة الأصناف المسلّمة</dt>
          <dd className="font-bold tabular-nums text-teal-900">{money(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-3 text-xs text-teal-800">
          <dt>الخصم بنسبة ما سُلّم · التوصيل كاملاً</dt>
          <dd className="tabular-nums">−{money(order.discount)} · +{money(order.deliveryFee)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-teal-200 pt-1.5">
          <dt className="font-black text-teal-900">الإجمالي المحصَّل</dt>
          <dd className="font-black tabular-nums text-teal-900">{money(totals.total)}</dd>
        </div>
      </dl>

      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
    </Modal>
  );
};
