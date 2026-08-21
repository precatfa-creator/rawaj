import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { useAppStore } from '../store';
import { PAGE_SIZE, usePagedList } from '../lib/queries';
import { Combobox } from '../components/Combobox';
import { searchOptions } from '../lib/queries';
import { Card, DataTable, EmptyState, PageHead, Pagination, Pill, count } from '../components/ui';
import type { StockEntry, StockKind } from '../types';
import type { PagedProps } from '../lib/route';

/** Same labels the movement dialog uses; sales and initial quantities appear here too. */
const KIND_LABELS: Record<StockKind, string> = {
  purchase: 'استلام مشتريات',
  return: 'مرتجع من عميل',
  damage: 'تلف أو فقد',
  adjustment: 'تسوية جرد',
  sale: 'بيع',
  initial: 'كمية ابتدائية',
};

const KIND_TONES: Record<StockKind, string> = {
  purchase: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  return: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  damage: 'bg-rose-50 text-rose-800 border-rose-200',
  adjustment: 'bg-amber-50 text-amber-800 border-amber-200',
  sale: 'bg-blue-50 text-blue-800 border-blue-200',
  initial: 'bg-surface-100 text-surface-700 border-surface-200',
};

/** The row plus the embedded product, which is what a person reads it by. */
interface MovementRow extends StockEntry {
  product: { name: string; sku: string; variantOptions: Array<{ id: string; name: string }> } | null;
  variant: { optionValues: Record<string, string> } | null;
}

const COLUMNS =
  'id,productId:product_id,storeId:store_id,kind,quantity,balance,note,orderId:order_id,variantId:variant_id,variantBalance:variant_balance,createdAt:created_at,product:products(name,sku,variantOptions:variant_options),variant:product_variants(optionValues:option_values)';

/**
 * Every inventory movement in this store, newest first.
 *
 * The ledger already existed — `products.stock` is its running total — but the
 * only way to read it was eight rows deep inside one item's dialog. A stock
 * number nobody can explain is the thing this page fixes.
 */
export const StockMovements: React.FC<PagedProps> = ({ page, onPage }) => {
  const { activeStoreId, pickerProducts } = useAppStore();
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState('');

  // No `search` here on purpose: stock_entries has no generated search_text
  // column, so an ilike would filter on something that does not exist. The
  // product picker is the search.
  const list = usePagedList<MovementRow>({
    table: 'stock_entries',
    columns: COLUMNS,
    match: {
      store_id: activeStoreId ?? undefined,
      product_id: productId || undefined,
      kind: kind || undefined,
    },
    orderBy: 'created_at',
    page,
  });

  const storeProducts = pickerProducts.filter(product => product.storeId === activeStoreId);

  return (
    <div className="space-y-6">
      <PageHead title="سجل حركات المخزون" subtitle="كل حركة دخلت أو خرجت من المخزون، ورصيد المنتج بعدها.">
        <Pill tone="bg-primary-50 text-primary-800 border-primary-200">
          <History size={14} />
          للقراءة فقط
        </Pill>
      </PageHead>

      <Card className="p-3 flex flex-col md:flex-row gap-3">
        <Combobox
          label="المنتج"
          value={productId}
          onChange={value => { setProductId(value); onPage(0); }}
          options={[
            { value: '', label: 'كل المنتجات' },
            ...storeProducts.map(product => ({
              value: product.id,
              label: product.name,
              hint: product.sku || undefined,
            })),
          ]}
          onSearch={async term => [
            { value: '', label: 'كل المنتجات' },
            ...(await searchOptions('products', 'id,name,sku', term, { store_id: activeStoreId ?? undefined }))
              .map(row => ({
                value: row.id as string,
                label: row.name as string,
                hint: (row.sku as string) || undefined,
              })),
          ]}
          className="md:flex-1"
        />
        <Combobox
          label="نوع الحركة"
          value={kind}
          onChange={value => { setKind(value); onPage(0); }}
          options={[
            { value: '', label: 'كل الأنواع' },
            ...(Object.keys(KIND_LABELS) as StockKind[]).map(value => ({ value, label: KIND_LABELS[value] })),
          ]}
          className="md:w-56"
        />
      </Card>

      {list.total === 0 && !list.loading ? (
        <EmptyState
          icon={<History size={30} />}
          title="لا توجد حركات"
          body={productId || kind
            ? 'لم تطابق أي حركة هذه المرشّحات.'
            : 'ستظهر هنا حركات المخزون: المشتريات، المبيعات، التلف وتسويات الجرد.'}
        />
      ) : (
        <Card className="overflow-hidden">
          <DataTable headers={['الوقت', 'المنتج', 'نوع الحركة', 'الكمية', 'الرصيد بعدها', 'الملاحظة']}>
            {list.rows.map(entry => (
              <tr key={entry.id} className="hover:bg-surface-50/60 transition-colors">
                <td className="px-5 py-3.5 text-surface-600 whitespace-nowrap tabular-nums">
                  {new Date(entry.createdAt).toLocaleString('ar-LY')}
                </td>
                <td className="px-5 py-3.5 font-bold text-surface-900">
                  {entry.product?.name ?? 'منتج محذوف'}
                  {entry.product?.sku && (
                    <span className="block text-xs font-medium text-surface-500" dir="ltr">{entry.product.sku}</span>
                  )}
                  {entry.variant && (
                    <span className="block text-xs font-medium text-primary-700">
                      {(entry.product?.variantOptions ?? []).map(option => entry.variant?.optionValues[option.id]).filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <Pill tone={KIND_TONES[entry.kind]}>{KIND_LABELS[entry.kind] ?? entry.kind}</Pill>
                </td>
                <td className={`px-5 py-3.5 font-black tabular-nums ${entry.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  <span className="inline-flex items-center gap-1">
                    {entry.quantity > 0 ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
                    {entry.quantity > 0 ? '+' : ''}{count(entry.quantity)}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-surface-700 tabular-nums">{count(entry.variantBalance ?? entry.balance)}</td>
                <td className="px-5 py-3.5 text-surface-500">{entry.note || '—'}</td>
              </tr>
            ))}
          </DataTable>
          <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />
        </Card>
      )}

      <p className="text-xs text-surface-500 leading-relaxed">
        السجل لا يُعدَّل ولا يُحذف: كل تصحيح يُسجَّل كحركة جديدة، وتعديل طلب يُسجَّل كتسوية تحمل رقم الطلب في ملاحظتها.
        الرصيد المعروض هو مخزون المنتج مباشرة بعد الحركة.
      </p>
    </div>
  );
};
