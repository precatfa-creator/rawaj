import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Store, Product, Customer, City, DeliveryZone, DocumentNaming, Municipality, SalesRep, ZoneScope } from '../types';
import { DEFAULT_SETTINGS, loadSettings, saveSetting, type UserSettings } from '../lib/settings';
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
 * Products, orders, categories and financial data are scoped to the open store.
 * Customers, sales reps and effective zones are scoped to the active business
 * group, so linked stores can work with the shared roster without changing
 * store-attributed reporting.
 */
export const PICKER_LIMIT = 200;

interface AppState {
  stores: Store[];
  /** The open store's effective zones: its own, plus the shared defaults. */
  zones: DeliveryZone[];
  /** Category names for this store's item picker. */
  categories: string[];
  /** المدينة الكبرى / النطاق الجغرافي / البلدية — the masters a zone links to. */
  cities: City[];
  zoneScopes: ZoneScope[];
  municipalities: Municipality[];
  salesReps: SalesRep[];
  /** Store ids in the active business group whose shared rosters are visible. */
  sharedStoreIds: string[];
  pickerProducts: Product[];
  pickerCustomers: Customer[];
  /** True when a picker list was truncated at PICKER_LIMIT. */
  pickersTruncated: boolean;
  /** How each doctype is numbered. Global, not per store. */
  documentNaming: DocumentNaming[];
  /** This user's own preferences; nobody else can read or write them. */
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<boolean>;
  activeStoreId: string | null;
  setActiveStore: (id: string | null) => void;
  loading: boolean;
  failedResources: string[];
  reload: () => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

const storeColumns = 'id,storeCode:store_code,name,image,facebookPage:facebook_page,mobileNumber:mobile_number,businessGroupId:business_group_id,productCount:product_count,customerCount:customer_count,orderCount:order_count,totalProfit:total_profit,lastActivity:last_activity';
const productColumns = 'id,storeId:store_id,name,description,images,purchasePrice:purchase_price,sellingPrice:selling_price,margin,sku,barcode,brand,provider,category,defaultSerial:default_serial,colors,sizes,variantOptions:variant_options,stock,minStock:min_stock,status,addedAt:added_at,salesCount:sales_count';
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
  const [cities, setCities] = useState<City[]>([]);
  const [zoneScopes, setZoneScopes] = useState<ZoneScope[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [sharedStoreIds, setSharedStoreIds] = useState<string[]>([]);
  const [pickerProducts, setPickerProducts] = useState<Product[]>([]);
  const [pickerCustomers, setPickerCustomers] = useState<Customer[]>([]);
  const [pickersTruncated, setPickersTruncated] = useState(false);
  const [documentNaming, setDocumentNaming] = useState<DocumentNaming[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
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
      const { data, error } = await supabase.rpc('business_group_zones', { p_store_id: activeStoreId });
      if (error) return reportError('delivery_zones', error);
      reportSuccess('delivery_zones');
      if (active) setZones((data ?? []).map(zoneFromRow).sort(byCode));
    };

    /**
     * The three hierarchy masters a zone links to. Shared, so they load once and
     * do not depend on the open store.
     */
    // Preferences, not business data: no realtime subscription, and a failure
    // falls back to the defaults rather than blocking the app.
    const loadUserSettings = async () => {
      const loaded = await loadSettings();
      if (active) setSettings(loaded);
    };

    const loadHierarchy = async () => {
      const [cityRows, scopeRows, muniRows] = await Promise.all([
        supabase.from('cities').select('id,name,region,active').order('name'),
        supabase.from('zone_scopes').select('id,cityId:city_id,name').order('name'),
        supabase.from('municipalities').select('id,name').order('name'),
      ]);
      const failed = cityRows.error || scopeRows.error || muniRows.error;
      if (failed) return reportError('zone_hierarchy', failed);
      reportSuccess('zone_hierarchy');
      if (!active) return;
      setCities((cityRows.data ?? []) as unknown as City[]);
      setZoneScopes((scopeRows.data ?? []) as unknown as ZoneScope[]);
      setMunicipalities((muniRows.data ?? []) as unknown as Municipality[]);
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
      if (sharedStoreIds.length > 0) request = request.in('store_id', sharedStoreIds);
      const { data, error } = await request;
      if (error) return reportError('sales_reps', error);
      reportSuccess('sales_reps');
      if (active) setSalesReps((data ?? []) as unknown as SalesRep[]);
    };

    /**
     * Through the RPC for the same reason zones are: a store's effective config
     * is its own row where it has one and the shared default otherwise, and
     * `next_document_name` resolves it the same way. Two answers to "which
     * series is in force" would mean documents numbered by a pattern the
     * settings screen never showed.
     */
    const loadDocumentNaming = async () => {
      const { data, error } = await supabase.rpc('store_document_naming', { p_store_id: activeStoreId });
      if (error) return reportError('document_naming', error);
      reportSuccess('document_naming');
      if (!active) return;
      setDocumentNaming((data ?? []).map((row: Record<string, unknown>) => ({
        doctype: row.doctype as string,
        label: row.label as string,
        series: (row.series ?? []) as string[],
        defaultSeries: row.default_series as string,
        perStore: row.per_store as boolean,
        storeKey: row.store_key as string,
      })).sort((a, b) => a.label.localeCompare(b.label, 'ar')));
    };

    const loadPickers = async () => {
      const productQuery = supabase.from('products').select(productColumns).order('name').limit(PICKER_LIMIT);
      const customerQuery = supabase.from('customers').select(customerColumns).order('name').limit(PICKER_LIMIT);
      const [products, customers] = await Promise.all([
        activeStoreId ? productQuery.eq('store_id', activeStoreId) : productQuery,
        sharedStoreIds.length > 0 ? customerQuery.in('store_id', sharedStoreIds) : customerQuery,
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
        loadStores(), loadZones(), loadHierarchy(), loadCategories(), loadUserSettings(), loadSalesReps(), loadDocumentNaming(), loadPickers(),
      ]);
      if (active) setLoading(false);
    };

    void loadAll();

    const channel = supabase
      .channel('reference-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => void loadStores())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_zones' }, () => void loadZones())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cities' }, () => void loadHierarchy())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zone_scopes' }, () => void loadHierarchy())
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
    // Everything but `stores` is scoped to the open store, so switching store
    // reloads them rather than showing the previous store's.
  }, [reloadToken, activeStoreId, stores.length, sharedStoreIds.join(',')]);

  useEffect(() => {
    const active = stores.find(store => store.id === activeStoreId);
    const next = active
      ? stores.filter(store => store.businessGroupId === active.businessGroupId).map(store => store.id)
      : [];
    setSharedStoreIds(current => current.join(',') === next.join(',') ? current : next);
  }, [stores, activeStoreId]);

  const reload = () => setReloadToken(token => token + 1);

  /**
   * Applied locally first: a preference toggle should feel instant, and the only
   * way it can fail is the write, which puts the old value straight back.
   */
  const updateSetting = async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const previous = settings[key];
    setSettings(current => ({ ...current, [key]: value }));
    const ok = await saveSetting(key, value);
    if (!ok) setSettings(current => ({ ...current, [key]: previous }));
    return ok;
  };

  return (
    <AppContext.Provider value={{
      stores, zones, categories, cities, zoneScopes, municipalities, salesReps, sharedStoreIds, pickerProducts, pickerCustomers, pickersTruncated,
      documentNaming, settings, updateSetting, activeStoreId, setActiveStore: setActiveStoreId, loading, failedResources, reload,
    }}>
      {loading ? (
        <div className="min-h-dvh flex items-center justify-center bg-surface-50">
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
