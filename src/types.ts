export type OrderStatus = 'new' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'canceled' | 'returned';

export interface Store {
  id: string;
  name: string;
  image: string;
  facebookPage: string;
  productCount: number;
  customerCount: number;
  orderCount: number;
  totalProfit: number;
  lastActivity: string;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  description: string;
  images: string[];
  purchasePrice: number;
  sellingPrice: number;
  margin: number;
  sku: string;
  barcode: string;
  brand: string;
  provider: string;
  category: string;
  defaultSerial: string;
  colors: string[];
  sizes: string[];
  stock: number;
  minStock: number;
  status: 'active' | 'draft' | 'out_of_stock';
  addedAt: string;
  salesCount: number;
}

export interface Customer {
  id: string;
  /** Customers belong to one store; the same person in two stores is two rows. */
  storeId: string;
  /** Issued by the customer naming series. Empty on rows created before it. */
  code: string;
  name: string;
  phone: string;
  whatsapp: string;
  city: string;
  address: string;
  orderCount: number;
  totalSpent: number;
  lastPurchase: string;
  rating: number; // 1-5
  status: 'active' | 'inactive' | 'vip';
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  image: string;
  /** Chosen from the product's `sizes` when it has any. Empty when it does not. */
  size?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  storeId: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  notes: string;
  createdAt: string;
  deliveryDate?: string;
  agentId?: string;
  /** Delivery zone the order was composed against; drives the rep's commission. */
  zoneId?: string;
  /** The naming series the order number came from, e.g. `ORD-.YYYY.-.####`. */
  namingSeries?: string;
}

/**
 * How one kind of document is numbered — the Frappe model: a doctype offers a
 * list of series and defaults to one of them.
 *
 * A series is a pattern: `ORD-.YYYY.-.####` yields ORD-2026-0001. `.YYYY.`
 * `.YY.` `.MM.` `.DD.` are replaced when the document is created, and the run of
 * `#` is the counter, its length the zero-padding.
 */
export interface DocumentNaming {
  /** The table the documents live in: 'orders', 'customers', … */
  doctype: string;
  label: string;
  series: string[];
  defaultSeries: string;
  /** true counts per store, so every store's first document is number 1. */
  perStore: boolean;
}

export interface NamingCounter {
  prefix: string;
  /** Store id, or '' for a doctype counted globally. */
  storeKey: string;
  current: number;
}

/** Why stock moved. 'sale' and 'initial' are written by the system, not chosen. */
export type StockKind = 'purchase' | 'sale' | 'return' | 'damage' | 'adjustment' | 'initial';

export interface StockEntry {
  id: string;
  productId: string;
  storeId: string;
  kind: StockKind;
  /** Signed delta: +5 received, -2 sold. */
  quantity: number;
  /** Stock immediately after this movement. */
  balance: number;
  note: string;
  orderId?: string;
  createdAt: string;
}

export type ZoneRegion = 'tripolitania' | 'cyrenaica' | 'fezzan';

/**
 * How a rep is paid for delivering into a zone. 'none' means the zone says
 * nothing and the rep's own flat commission applies.
 */
export type CommissionType = 'none' | 'fixed' | 'percent';

export interface DeliveryZone {
  id: string;
  /** Sequential, operator-facing zone number: '00', '01', … Assigned by Postgres. */
  code: string;
  name: string;
  region: ZoneRegion;
  capital: string;
  areaKm2: number;
  fee: number;
  deliveryTimeDays: number;
  active: boolean;
  commissionType: CommissionType;
  /** A percentage of the delivery fee, or a flat amount — read per `commissionType`. */
  commissionValue: number;
  /**
   * Null for the shared default catalogue every store starts from. Set once a
   * store edits a zone: that store then works with its own copy, and `sourceId`
   * points at the default the copy replaced.
   */
  storeId?: string | null;
  sourceId?: string | null;
}

export interface Expense {
  id: string;
  title: string;
  type: 'ads' | 'shipping' | 'salary' | 'rent' | 'other';
  amount: number;
  date: string;
  storeId?: string;
}

export interface SalesRep {
  id: string;
  storeId: string;
  /** Issued by the rep naming series. Empty on rows created before it. */
  code: string;
  name: string;
  phone: string;
  whatsapp: string;
  /** Delivery zone names covered, matching DeliveryZone.name. Empty = all zones. */
  zones: string[];
  /** Flat amount per delivered order, used where the zone sets no commission. */
  commission: number;
  active: boolean;
  note: string;
  createdAt: string;
}

export type UserRole = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}
