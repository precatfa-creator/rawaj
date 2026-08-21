import React, { FormEvent, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from './Modal';
import { ErrorNote } from './Confirm';
import { Combobox } from './Combobox';
import { supabase } from '../db/supabase';
import { adjustStock } from '../lib/mutations';
import type { Product, ProductVariant, StockEntry, StockKind } from '../types';

/** Label, and whether the operator's number adds to stock or comes off it. */
const KINDS: Record<StockKind, { label: string; sign: 1 | -1 | 0 }> = {
  purchase: { label: 'استلام مشتريات', sign: 1 },
  return: { label: 'مرتجع من عميل', sign: 1 },
  damage: { label: 'تلف أو فقد', sign: -1 },
  adjustment: { label: 'تسوية جرد', sign: 0 },
  sale: { label: 'بيع', sign: -1 },
  initial: { label: 'كمية ابتدائية', sign: 1 },
};

// Only the movements a person records by hand. Sales come from orders, and the
// initial quantity comes from creating the item.
const SELECTABLE: StockKind[] = ['purchase', 'return', 'damage', 'adjustment'];

const RECENT_LIMIT = 8;

/**
 * Records one inventory movement against an item.
 *
 * A stock correction is the moment somebody is most likely to be looking at the
 * wrong item, so the movement is recorded next to the item's recent history and
 * the resulting quantity is shown before the save.
 */
export const StockForm: React.FC<{
  product: Product | null;
  onClose: () => void;
}> = ({ product, onClose }) => {
  const [kind, setKind] = useState<StockKind>('purchase');
  const [amount, setAmount] = useState(0);
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<StockEntry[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState('');

  const open = product !== null;

  const [seeded, setSeeded] = useState<string | null>(null);
  if (open && seeded !== product.id) {
    setSeeded(product.id);
    setKind('purchase');
    setAmount(0);
    setCounted(product.stock);
    setNote('');
    setError('');
    setVariants([]);
    setVariantId('');
  }
  if (!open && seeded !== null) setSeeded(null);

  useEffect(() => {
    if (!product) { setHistory([]); return; }
    let active = true;
    void Promise.all([
      supabase.from('stock_entries')
        .select('id,productId:product_id,storeId:store_id,kind,quantity,balance,note,orderId:order_id,variantId:variant_id,variantBalance:variant_balance,createdAt:created_at')
        .eq('product_id', product.id).order('created_at', { ascending: false }).limit(RECENT_LIMIT),
      supabase.from('product_variants')
        .select('id,productId:product_id,optionValues:option_values,optionKey:option_key,sku,stock,active')
        .eq('product_id', product.id).eq('active', true).order('option_key'),
    ]).then(([historyRows, variantRows]) => {
      if (historyRows.error) console.error('stock history failed', historyRows.error);
      if (variantRows.error) console.error('product variants failed', variantRows.error);
      if (!active) return;
      setHistory((historyRows.data ?? []) as unknown as StockEntry[]);
      const loaded = (variantRows.data ?? []) as unknown as ProductVariant[];
      setVariants(loaded);
      setVariantId(loaded[0]?.id ?? '');
      setCounted(loaded[0]?.stock ?? product.stock);
    });
    return () => { active = false; };
  }, [product?.id]);

  if (!product) return <Modal open={false} title="" onClose={onClose}>{null}</Modal>;

  // A stocktake is entered as the number on the shelf, not as a difference —
  // that is what the person holding the clipboard actually has.
  const selectedVariant = variants.find(variant => variant.id === variantId);
  const hasVariants = (product.variantOptions ?? []).length > 0;
  const currentStock = selectedVariant?.stock ?? product.stock;
  const delta = kind === 'adjustment' ? counted - currentStock : amount * KINDS[kind].sign;
  const resulting = currentStock + delta;
  const productResulting = product.stock + delta;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (delta === 0) { setError('لا يوجد تغيير لتسجيله.'); return; }
    if (resulting < 0) { setError('الكمية المطلوب خصمها تتجاوز المخزون المتاح.'); return; }

    if (hasVariants && !selectedVariant) { setError('اختر تركيبة المنتج أولاً.'); return; }
    setBusy(true); setError('');
    const result = await adjustStock({ productId: product.id, variantId: selectedVariant?.id, kind, quantity: delta, note });
    setBusy(false);
    if (result.ok) onClose(); else setError(result.message ?? '');
  };

  return (
    <Modal
      open={open}
      title={`حركة مخزون · ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="stock-form" disabled={busy} className={primaryButton}>
            {busy ? 'جارٍ التسجيل…' : 'تسجيل الحركة'}
          </button>
          <button type="button" onClick={onClose} className={ghostButton}>إلغاء</button>
        </>
      }
    >
      <form id="stock-form" className="space-y-4" onSubmit={submit}>
        {hasVariants && (
          <Combobox
            showLabel
            label="تركيبة المنتج"
            value={variantId}
            onChange={value => {
              setVariantId(value);
              setCounted(variants.find(variant => variant.id === value)?.stock ?? 0);
            }}
            options={variants.map(variant => ({
              value: variant.id,
              label: (product.variantOptions ?? []).map(option => variant.optionValues[option.id]).filter(Boolean).join(' · '),
              hint: `المخزون ${variant.stock}`,
            }))}
            placeholder="اختر التركيبة"
          />
        )}

        <Combobox
          showLabel
          label="نوع الحركة"
          value={kind}
          onChange={value => setKind(value as StockKind)}
          options={SELECTABLE.map(value => ({ value, label: KINDS[value].label }))}
        />

        {kind === 'adjustment' ? (
          <Field label="الكمية بعد الجرد" hint={`المسجّل حالياً: ${currentStock}`}>
            <input
              type="number" min={0} value={counted || ''} placeholder="0"
              onChange={e => setCounted(Number(e.target.value))}
              required className={fieldClass}
            />
          </Field>
        ) : (
          <Field label="الكمية">
            <input
              type="number" min={1} value={amount || ''} placeholder="0"
              onChange={e => setAmount(Number(e.target.value))}
              required className={fieldClass}
            />
          </Field>
        )}

        <div className="flex items-center justify-between gap-3 bg-surface-50 border border-surface-200 rounded-xl px-4 py-3">
          <span className="text-sm font-bold text-surface-700">{hasVariants ? 'مخزون التركيبة بعد الحركة' : 'المخزون بعد الحركة'}</span>
          <span className={`font-black text-lg tabular-nums ${resulting < 0 ? 'text-rose-700' : 'text-surface-900'}`}>
            {currentStock} ← {resulting}
          </span>
        </div>
        {hasVariants && (
          <p className="text-xs text-surface-500">إجمالي مخزون المنتج بعد الحركة: {productResulting}</p>
        )}

        <Field label="ملاحظة" hint="رقم فاتورة المورّد مثلاً — يظهر في سجل الحركات.">
          <input value={note} onChange={e => setNote(e.target.value)} className={fieldClass} />
        </Field>

        {error && <ErrorNote message={error} />}
      </form>

      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-surface-700 mb-2">آخر الحركات</h3>
          <ul className="divide-y divide-surface-200/70 border border-surface-200 rounded-xl overflow-hidden">
            {history.map(entry => (
              <li key={entry.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className={`shrink-0 ${entry.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {entry.quantity > 0 ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                </span>
                <span className="font-bold text-surface-800 shrink-0">{KINDS[entry.kind]?.label ?? entry.kind}</span>
                {entry.variantId && (
                  <span className="text-xs text-primary-700 truncate">
                    {(product.variantOptions ?? []).map(option => variants.find(variant => variant.id === entry.variantId)?.optionValues[option.id]).filter(Boolean).join(' · ') || 'تركيبة قديمة'}
                  </span>
                )}
                <span className="text-surface-500 truncate flex-1">{entry.note}</span>
                <span className="tabular-nums font-bold shrink-0">
                  {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                </span>
                <span className="tabular-nums text-surface-500 shrink-0">= {entry.variantBalance ?? entry.balance}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
};
