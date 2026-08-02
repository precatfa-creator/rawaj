import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { Plus, Search, Pencil, Trash2, Package, ArrowLeftRight } from 'lucide-react';
import { motion } from 'motion/react';
import { PAGE_SIZE, useDimension, usePagedList } from '../lib/queries';
import { deleteProduct } from '../lib/mutations';
import { Confirm } from '../components/Confirm';
import { ProductForm } from '../components/forms';
import { StockForm } from '../components/StockForm';
import { Combobox } from '../components/Combobox';
import { BulkBar } from '../components/BulkBar';
import { productBulk } from '../lib/bulk';
import { Pagination } from '../components/ui';
import type { Product } from '../types';
import type { PagedProps } from '../lib/route';

const STAGGER_CAP = 8;
const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} د.ل`;

const statusLabels: Record<Product['status'], string> = {
  active: 'معروض',
  draft: 'مسودة',
  out_of_stock: 'نفدت الكمية',
};

export const Products: React.FC<PagedProps> = ({ page, onPage }) => {
  const { activeStoreId } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<Product['status'] | 'all'>('all');
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [moving, setMoving] = useState<Product | null>(null);

  // One page of rows; the filter, the search and the count all run in Postgres.
  const list = usePagedList<Product>({
    table: 'products',
    columns: 'id,storeId:store_id,name,description,images,purchasePrice:purchase_price,sellingPrice:selling_price,margin,sku,barcode,brand,provider,category,colors,sizes,stock,minStock:min_stock,status,addedAt:added_at,salesCount:sales_count',
    match: { store_id: activeStoreId ?? undefined, status: status === 'all' ? undefined : status },
    search: searchTerm,
    orderBy: 'name',
    ascending: true,
    page,
  });
  const visibleProducts = list.rows;

  // Rebuilt only when the store changes; a new object per render would restart
  // BulkBar's state on every keystroke in the search box.
  const bulkSpec = useMemo(() => productBulk(activeStoreId ?? ''), [activeStoreId]);

  // Units sold comes from the same SQL grouping the reports use.
  const soldByProduct = new Map(useDimension('product', activeStoreId, 500).map(r => [r.key, r.units]));

  // Any filter change invalidates the current offset.
  const resetTo = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); onPage(0); };

  const iconButton =
    'inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-lg bg-white/90 backdrop-blur shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-surface-900">المنتجات</h2>
          <p className="text-surface-500 mt-1">إدارة منتجاتك ومخزونك</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm shadow-primary-500/30 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Plus size={20} />
          <span>إضافة منتج</span>
        </button>
      </div>

      <div className="glass-card p-4 rounded-2xl flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-surface-400">
            <Search size={20} />
          </div>
          <input
            type="search"
            placeholder="ابحث بالاسم أو SKU..."
            aria-label="ابحث في المنتجات"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); onPage(0); }}
            className="w-full bg-surface-50 border border-surface-200 rounded-xl py-2.5 pr-10 pl-4 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all font-medium text-sm"
          />
        </div>
        <Combobox
          label="تصفية حسب الحالة"
          value={status}
          onChange={resetTo(setStatus as (v: string) => void)}
          options={[
            { value: 'all', label: 'كل الحالات' },
            { value: 'active', label: 'معروض' },
            { value: 'draft', label: 'مسودة' },
            { value: 'out_of_stock', label: 'نفدت الكمية' },
          ]}
          className="md:w-52"
        />
      </div>

      <BulkBar
        spec={bulkSpec}
        title="استيراد وتصدير المنتجات"
        hint="يقبل Excel و CSV وملفات Google Sheets المصدَّرة. المنتج الموجود يُحدَّث، والجديد يُضاف — المطابقة بالمعرّف ثم برمز SKU داخل هذا المتجر. الكمية الابتدائية تُطبَّق عند الإضافة فقط؛ مخزون منتج قائم يتغيّر بحركات المخزون وحدها."
      />

      {visibleProducts.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-20 h-20 bg-surface-100 rounded-full flex items-center justify-center mx-auto mb-4 text-surface-500">
            <Package size={32} />
          </div>
          <h3 className="text-lg font-bold text-surface-900 mb-1">لا توجد منتجات</h3>
          <p className="text-surface-500">
            {searchTerm || status !== 'all' ? 'لم يطابق أي منتج معايير البحث.' : 'أضف أول منتج لهذا المتجر.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {visibleProducts.map((product, i) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i, STAGGER_CAP) * 0.05 }}
              key={product.id}
              className="glass-card rounded-2xl overflow-hidden flex flex-col group relative"
            >
              <div className="absolute top-3 left-3 z-10 flex gap-1.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <button
                  onClick={() => setEditing(product)}
                  aria-label={`تعديل ${product.name}`}
                  title="تعديل"
                  className={`${iconButton} text-surface-600 hover:text-primary-700`}
                >
                  <Pencil size={17} />
                </button>
                <button
                  onClick={() => setMoving(product)}
                  aria-label={`حركة مخزون ${product.name}`}
                  title="حركة مخزون"
                  className={`${iconButton} text-surface-600 hover:text-primary-700`}
                >
                  <ArrowLeftRight size={17} />
                </button>
                <button
                  onClick={() => setConfirmDelete(product)}
                  aria-label={`حذف ${product.name}`}
                  title="حذف"
                  className={`${iconButton} text-surface-600 hover:text-rose-700`}
                >
                  <Trash2 size={17} />
                </button>
              </div>

              <div className="h-56 w-full relative bg-surface-100 p-4 flex items-center justify-center">
                {product.images[0] ? (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                ) : (
                  <Package size={40} className="text-surface-400" />
                )}
                {product.status !== 'active' && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
                    <span className={`px-3 py-1.5 rounded-lg font-bold text-sm ${
                      product.status === 'out_of_stock' ? 'bg-rose-100 text-rose-800' : 'bg-surface-200 text-surface-800'
                    }`}>
                      {statusLabels[product.status]}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <div className="text-xs text-surface-500 font-medium mb-1 flex items-center justify-between gap-2">
                  <span dir="ltr" className="truncate">{product.sku || '—'}</span>
                  {product.category && (
                    <span className="text-primary-800 bg-primary-50 px-2 py-0.5 rounded text-xs font-bold shrink-0">{product.category}</span>
                  )}
                </div>
                <h3 className="font-bold text-surface-900 text-lg leading-tight mb-2 line-clamp-2">{product.name}</h3>

                <div className="mt-auto pt-4 flex flex-col gap-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-surface-500 mb-0.5">سعر البيع</p>
                      <p className="font-black text-xl text-surface-900 tabular-nums">{money(product.sellingPrice)}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-xs text-surface-500 mb-0.5">الربح</p>
                      <p className="font-bold text-emerald-700 tabular-nums">{money(product.margin)}</p>
                    </div>
                  </div>

                  <div className="h-px w-full bg-surface-200/50" />

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${product.stock > product.minStock ? 'bg-emerald-600' : product.stock > 0 ? 'bg-amber-600' : 'bg-rose-600'}`} />
                      <span className="text-surface-600 font-medium">
                        المخزون: <strong className="text-surface-900 tabular-nums">{product.stock}</strong>
                      </span>
                    </div>
                    <span className="text-surface-500 text-xs tabular-nums">
                      {soldByProduct.get(product.id) ?? 0} مبيعة
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Pagination page={page} total={list.total} pageSize={PAGE_SIZE} onPage={onPage} loading={list.loading} />

      <ProductForm
        open={creating || editing !== null}
        product={editing}
        storeId={activeStoreId ?? ''}
        onClose={() => { setCreating(false); setEditing(null); }}
      />

      <StockForm product={moving} onClose={() => setMoving(null)} />

      <Confirm
        open={confirmDelete !== null}
        title="حذف المنتج"
        message={`سيتم حذف "${confirmDelete?.name ?? ''}" نهائياً. لا يمكن التراجع.`}
        confirmLabel="حذف"
        onConfirm={() => deleteProduct(confirmDelete?.id ?? '', confirmDelete?.images ?? [])}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
};
