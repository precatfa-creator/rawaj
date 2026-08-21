import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { Plus, Search, Pencil, Trash2, Package, ArrowLeftRight, LayoutGrid, Rows3, ZoomIn } from 'lucide-react';
import { motion } from 'motion/react';
import { PAGE_SIZE, useDimension, usePagedList } from '../lib/queries';
import { deleteProduct } from '../lib/mutations';
import { Confirm } from '../components/Confirm';
import { ProductForm } from '../components/forms';
import { StockForm } from '../components/StockForm';
import { Combobox } from '../components/Combobox';
import { BulkBar } from '../components/BulkBar';
import { productBulk } from '../lib/bulk';
import { Lightbox, Pagination, Thumb, initialsOf, money, toneFor } from '../components/ui';
import type { Product } from '../types';
import type { PagedProps } from '../lib/route';

const STAGGER_CAP = 8;

/**
 * Which of the two views this browser last used.
 *
 * Remembered rather than put in the URL: a filter is something you send to a
 * colleague, but "I prefer the dense list" is a personal habit that should
 * survive a refresh. Same reasoning as the remembered page size on orders.
 */
const VIEW_KEY = 'products.view';

const ProductHero: React.FC<{ product: Product }> = ({ product }) => {
  const src = product.images[0];
  const [failed, setFailed] = useState(false);
  React.useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={product.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={product.name}
      className={`w-28 h-28 rounded-2xl grid place-items-center font-black text-4xl ${toneFor(product.name)}`}
    >
      {initialsOf(product.name)}
    </span>
  );
};

const statusLabels: Record<Product['status'], string> = {
  active: 'معروض',
  draft: 'مسودة',
  out_of_stock: 'نفدت الكمية',
};

export const Products: React.FC<PagedProps> = ({ page, onPage }) => {
  const { activeStoreId } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<Product['status'] | 'all'>('all');
  const [view, setView] = useState<'cards' | 'list'>(
    () => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'),
  );
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [moving, setMoving] = useState<Product | null>(null);

  // One page of rows; the filter, the search and the count all run in Postgres.
  const list = usePagedList<Product>({
    table: 'products',
    columns: 'id,storeId:store_id,name,description,images,purchasePrice:purchase_price,sellingPrice:selling_price,margin,sku,barcode,brand,provider,category,colors,sizes,variantOptions:variant_options,stock,minStock:min_stock,status,addedAt:added_at,salesCount:sales_count',
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
            placeholder="ابحث بالاسم أو SKU أو الرقم التسلسلي..."
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
        {/* Two readings of one list: cards answer "which one is it", the list
            answers "what do they cost and how many are left". */}
        <div role="group" aria-label="طريقة العرض" className="flex rounded-xl border border-surface-200 bg-white p-1 shrink-0">
          {([['cards', 'بطاقات', LayoutGrid], ['list', 'قائمة', Rows3]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => { setView(id); localStorage.setItem(VIEW_KEY, id); }}
              aria-pressed={view === id}
              title={label}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                view === id ? 'bg-primary-50 text-primary-800' : 'text-surface-500 hover:text-surface-800'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <BulkBar
          spec={bulkSpec}
          title="استيراد وتصدير المنتجات"
          hint="يقبل Excel و CSV وملفات Google Sheets المصدَّرة. المنتج الموجود يُحدَّث، والجديد يُضاف — المطابقة بالمعرّف ثم برمز SKU داخل هذا المتجر. الكمية الابتدائية تُطبَّق عند الإضافة فقط؛ مخزون منتج قائم يتغيّر بحركات المخزون وحدها."
        />
      </div>

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
      ) : view === 'list' ? (
        /* The dense reading: what things cost and how many are left, lined up so
           the columns can be compared down the page instead of hunted for
           across cards. */
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-auto max-h-[70dvh]">
            <table className="w-full text-sm text-right">
              <thead className="bg-surface-50 text-surface-600 sticky top-0 z-10">
                <tr>
                  <th scope="col" className="px-4 py-3 font-bold">المنتج</th>
                  <th scope="col" className="px-4 py-3 font-bold">التصنيف</th>
                  <th scope="col" className="px-4 py-3 font-bold">سعر البيع</th>
                  <th scope="col" className="px-4 py-3 font-bold">الربح</th>
                  <th scope="col" className="px-4 py-3 font-bold">المخزون</th>
                  <th scope="col" className="px-4 py-3 font-bold">مبيعة</th>
                  <th scope="col" className="px-4 py-3 font-bold">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/50">
                {visibleProducts.map(product => (
                  <tr key={product.id} className="hover:bg-surface-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Thumb src={product.images[0]} name={product.name} className="w-10 h-10" />
                        <div className="min-w-0">
                          <div className="font-bold text-surface-900 truncate">{product.name}</div>
                          {(product.variantOptions ?? []).length > 0 && (
                            <div className="text-[11px] font-bold text-primary-700">{product.variantOptions.length} خيارات متغيرة</div>
                          )}
                          <div className="text-xs text-surface-500 truncate" dir="ltr">{product.sku || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-surface-600">{product.category || '—'}</td>
                    <td className="px-4 py-3 font-bold text-surface-900 tabular-nums whitespace-nowrap">{money(product.sellingPrice)}</td>
                    <td className="px-4 py-3 font-bold text-emerald-700 tabular-nums whitespace-nowrap">{money(product.margin)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${product.stock > product.minStock ? 'bg-emerald-600' : product.stock > 0 ? 'bg-amber-600' : 'bg-rose-600'}`} />
                        <span className="tabular-nums font-bold text-surface-900">{product.stock}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-surface-500 tabular-nums">{soldByProduct.get(product.id) ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing(product)} aria-label={`تعديل ${product.name}`} title="تعديل" className={`${iconButton} text-surface-500 hover:text-primary-700`}>
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setMoving(product)} aria-label={`حركة مخزون ${product.name}`} title="حركة مخزون" className={`${iconButton} text-surface-500 hover:text-primary-700`}>
                          <ArrowLeftRight size={16} />
                        </button>
                        {product.images.length > 0 && (
                          <button onClick={() => setViewing(product)} aria-label={`عرض صور ${product.name}`} title="عرض الصور" className={`${iconButton} text-surface-500 hover:text-primary-700`}>
                            <ZoomIn size={16} />
                          </button>
                        )}
                        <button onClick={() => setConfirmDelete(product)} aria-label={`حذف ${product.name}`} title="حذف" className={`${iconButton} text-surface-500 hover:text-rose-700`}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                {product.images.length > 0 && (
                  <button
                    onClick={() => setViewing(product)}
                    aria-label={`عرض صور ${product.name}`}
                    title="عرض الصور"
                    className={`${iconButton} text-surface-600 hover:text-primary-700`}
                  >
                    <ZoomIn size={17} />
                  </button>
                )}
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

              <div
                onClick={product.images.length > 0 ? () => setViewing(product) : undefined}
                /* The hero already grows on hover; without this the gesture it
                   advertises does nothing. The zoom button above stays as the
                   keyboard and screen-reader path, so this needs no role. */
                className={`h-56 w-full relative bg-surface-100 p-4 flex items-center justify-center ${
                  product.images.length > 0 ? 'cursor-zoom-in' : ''
                }`}
              >
                {/* The card's image is a hero shot, sized to fill: it keeps its
                    own markup rather than being squeezed into `Thumb`, and
                    shares only the fallback so both views name a product the
                    same way when it has no photo. */}
                <ProductHero product={product} />
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
                {(product.variantOptions ?? []).length > 0 && (
                  <p className="text-xs font-bold text-primary-700">
                    {(product.variantOptions ?? []).map(option => option.name).join(' · ')}
                  </p>
                )}

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

      <Lightbox
        open={viewing !== null}
        images={viewing?.images ?? []}
        name={viewing?.name ?? ''}
        onClose={() => setViewing(null)}
      />

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
