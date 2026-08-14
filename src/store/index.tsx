import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Store, Product, Customer, DeliveryZone, DocumentNaming, SalesRep } from '../types';
import { supabase } from '../db/supabase';
import { byCode, zoneFromRow } from '../lib/zones';

/**
 * Only the small, bounded tables live here now.
 *
 * Products, customers and orders are paged per screen through `usePagedList`,
 * and every total comes from a SQL aggregate — nothing loads a whole table to
 * count it. `pickerProducts` / `pickerCustomers` are the exception: the order
 * composer needs selectable lists, so it gets a capped slice rather than the
 * full table.
 *
 * Almost everything here is scoped to the open store: customers, sales reps,
 * categories and zones all belong to one store now, so they reload when the
 * store changes rather than showing another store's records.
 */
export const PICKER_LIMIT = 200;

interface AppState {
  stores: Store[];
  /** The open store's effective zones: its own, plus the shared defaults. */
  zones: DeliveryZone[];
  /** Category names for this store's item picker. */
  categories: string[];
  salesReps: SalesRep[];
  pickerProducts: Product[];
  pickerCustomers: Customer[];
  /** True when a picker list was truncated at PICKER_LIMIT. */
  pickersTruncated: boolean;
  /** How each doctype is numbered. Global, not per store. */
  documentNaming: DocumentNaming[];
  activeStoreId: string | null;
  setActiveStore: (id: string | null) => void;
  loading: boolean;
  failedResources: string[];
  reload: () => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

const storeColumns = 'id,name,image,facebookPage:facebook_page,productCount:product_count,customerCount:customer_count,orderCount:order_count,totalProfit:total_profit,lastActivity:last_activity';
const productColumns = 'id,storeId:store_id,name,description,images,purchasePrice:purchase_price,sellingPrice:selling_price,margin,sku,barcode,brand,provider,category,defaultSerial:default_serial,colors,sizes,stock,minStock:min_stock,status,addedAt:added_at,salesCount:sales_count';
const salesRepColumns = 'id,storeId:store_id,code,name,phone,whatsapp,zones,commission,active,note,createdAt:created_at';
const customerColumns = 'id,storeId:store_id,code,name,phone,whatsapp,city,address,orderCount:order_count,totalSpent:total_spent,lastPurchase:last_purchase,rating,status';

const resourceLabels: Record<string, string> = {
  stores: 'المتاجر',
  products: 'المنتجات',
  customers: 'العملاء',
  delivery_zones: 'مناطق التوصيل',
  categories: 'الفئات',
  sales_reps: 'المندوبين',
  document_naming: 'تسمية المستندات',
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [stores, setStores] = useState<Store[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [pickerCustomers, setPickerCustomers] = useState<Customer[]>([]);
  const [pickersTruncated, setPickersTruncated] = useState(false);
  const [documentNaming, setDocumentNaming] = useState<DocumentNaming[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedResources, setFailedResources] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    const reportError = (resource: string, error: unknown) => {
      console.error(`Failed to load ${resource} from Supabase:`, error);
      if (active) setFailedResources(prev => (prev.includes(resource) ? prev : [...prev, resource]));
    };
    const reportSuccess = (resource: string) => {
      if (active) setFailedResources(prev => prev.filter(item => item !== resource));
    };

    const loadStores = async () => {
      const { data, error } = await supabase.from('stores').select(storeColumns).order('name');
      if (error) return reportError('stores', error);
      reportSuccess('stores');
      if (active) setStores((data ?? []) as unknown as Store[]);
    };

    /**
     * Through the RPC, not the table: a store's effective list is its own zones
     * plus the shared defaults it has not replaced, and that rule lives in
     * Postgres so every reader gets the same answer.
     */
    const loadZones = async () => {
      const { data, error } = await supabase.rpc('store_zones', { p_store_id: activeStoreId });
      if (error) return reportError('delivery_zones', error);
      reportSuccess('delivery_zones');
      if (active) setZones((data ?? []).map(zoneFromRow).sort(byCode));
    };

    const loadCategories = async () => {
      let request = supabase.from('categories').select('name').order('name');
      if (activeStoreId) request = request.eq('store_id', activeStoreId);
      const { data, error } = await request;
      if (error) return reportError('categories', error);
      reportSuccess('categories');
      if (active) setCategories((data ?? []).map(row => row.name as string));
    };

    const loadSalesReps = async () => {
      let request = supabase.from('sales_reps').select(salesRepColumns).order('name');
      if (activeStoreId) request = request.eq('store_id', activeStoreId);
      const { data, error } = await request;
      if (error) return reportError('sales_reps', error);
      reportSuccess('sales_reps');
      if (active) setSalesReps((data ?? []) as unknown as SalesRep[]);
    };

    const loadDocumentNaming = async () => {
      const { data, error } = await supabase
        .from('document_naming')
        .select('doctype,label,series,defaultSeries:default_series,perStore:per_store')
        .order('label');
      if (error) return reportError('document_naming', error);
      reportSuccess('document_naming');
      if (active) setDocumentNaming((data ?? []) as unknown as DocumentNaming[]);
    };

    const loadPickers = async () => {
      const productQuery = supabase.from('products').select(productColumns).order('name').limit(PICKER_LIMIT);
      const customerQuery = supabase.from('customers').select(customerColumns).order('name').limit(PICKER_LIMIT);
      const [products, customers] = await Promise.all([
        activeStoreId ? productQuery.eq('store_id', activeStoreId) : productQuery,
        activeStoreId ? customerQuery.eq('store_id', activeStoreId) : customerQuery,
      ]);
      if (products.error) reportError('products', products.error); else reportSuccess('products');
      if (customers.error) reportError('customers', customers.error); else reportSuccess('customers');
      if (!active) return;
      const productRows = (products.data ?? []) as unknown as Product[];
      const customerRows = (customers.data ?? []) as unknown as Customer[];
      setPickerProducts(productRows);
      setPickerCustomers(customerRows);
      setPickersTruncated(productRows.length >= PICKER_LIMIT || customerRows.length >= PICKER_LIMIT);
    };

    const loadAll = async () => {
      setLoading(true);
      await Promise.all([
        loadStores(), loadZones(), loadCategories(), loadSalesReps(), loadDocumentNaming(), loadPickers(),
      ]);
      if (active) setLoading(false);
    };

    void loadAll();

    const channel = supabase
      .channel('reference-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => void loadStores())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_zones' }, () => void loadZones())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => void loadCategories())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_reps' }, () => void loadSalesReps())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_naming' }, () => void loadDocumentNaming())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => void loadPickers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => void loadPickers())
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
    // Everything but `stores` and the naming config is scoped to the open store,
    // so switching store reloads them rather than showing the previous store's.
  }, [reloadToken, activeStoreId]);

  const reload = () => setReloadToken(token => token + 1);

  return (
    <AppContext.Provider value={{
      stores, zones, categories, salesReps, pickerProducts, pickerCustomers, pickersTruncated,
      documentNaming, activeStoreId, setActiveStore: setActiveStoreId, loading, failedResources, reload,
    }}>
      {loading ? (
        <div className="min-h-screen flex items-center justify-center bg-surface-50">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {failedResources.length > 0 && (
            <div
              role="alert"
              dir="rtl"
              className="bg-rose-50 border-b border-rose-200 text-rose-800 px-4 py-3 flex flex-wrap items-center gap-3"
            >
              <AlertCircle size={20} className="shrink-0" />
              <p className="font-bold text-sm flex-1 min-w-60">
                تعذر تحميل {failedResources.map(item => resourceLabels[item] ?? item).join('، ')}. الأرقام المعروضة غير مكتملة.
              </p>
              <button
                type="button"
                onClick={reload}
                className="inline-flex items-center gap-2 bg-rose-700 hover:bg-rose-800 text-white font-bold text-sm rounded-xl px-4 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
              >
                <RefreshCw size={16} />
                إعادة المحاولة
              </button>
            </div>
          )}
          {children}
        </>
      )}
    </AppContext.Provider>
  );
};

export const useAppStore = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppStore must be used within an AppProvider');
  }
  return context;
};
