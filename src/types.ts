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
}

export interface Expense {
  id: string;
  title: string;
  type: 'ads' | 'shipping' | 'salary' | 'rent' | 'other';
  amount: number;
  date: string;
  storeId?: string;
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
