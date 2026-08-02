import type { Customer, Order, OrderStatus, Product, Store } from '../types';

export interface MonthTotals {
  key: string;
  name: string;
  sales: number;
  profit: number;
  orderCount: number;
  /** Average order value for the month; 0 when the month had no orders. */
  aov: number;
}

export interface NamedTotal {
  name: string;
  value: number;
}

export interface StatusTotal extends NamedTotal {
  status: OrderStatus;
}

export interface OpsKpis {
  /** Average value of a realized order, or null with no realized orders. */
  averageOrderValue: number | null;
  /** Share of all orders that reached delivered, 0-1, or null with no orders. */
  completionRate: number | null;
  /** Mean customer rating normalised to 0-1, or null when nobody has rated. */
  satisfaction: number | null;
}

export interface DashboardStats {
  totalSales: number;
  totalProfit: number;
  months: MonthTotals[];
  /** Percent change vs the previous month, or null when there is no baseline. */
  salesTrend: number | null;
  profitTrend: number | null;
  salesByStore: NamedTotal[];
  ordersByStatus: StatusTotal[];
  salesByCategory: NamedTotal[];
  ops: OpsKpis;
}

export const statusLabels: Record<OrderStatus, string> = {
  new: 'جديد',
  confirmed: 'تم التأكيد',
  processing: 'قيد التجهيز',
  shipped: 'قيد الشحن',
  delivered: 'تم التسليم',
  canceled: 'ملغي',
  returned: 'مرتجع',
};

// Canceled and returned orders never became revenue, so they stay out of every total.
export const isRealized = (order: Order) =>
  order.status !== 'canceled' && order.status !== 'returned';

export interface StoreTotals {
  productCount: number;
  orderCount: number;
  customerCount: number;
  totalSales: number;
  totalProfit: number;
}

export interface CustomerTotals {
  orderCount: number;
  totalSpent: number;
  lastPurchase: string | null;
}

/**
 * `stores.product_count`, `customers.total_spent`, `products.sales_count` and
 * friends are stored columns that nothing keeps up to date — a product created
 * through the app never bumps them. Every counter shown in the UI is derived
 * from the rows instead, so the columns can drift without lying to anyone.
 */
export const deriveStoreTotals = (
  stores: Store[],
  products: Product[],
  orders: Order[],
): Map<string, StoreTotals> => {
  const marginByProductId = new Map<string, number>(products.map(p => [p.id, p.margin]));
  const totals = new Map<string, StoreTotals>(
    stores.map(store => [
      store.id,
      { productCount: 0, orderCount: 0, customerCount: 0, totalSales: 0, totalProfit: 0 },
    ]),
  );
  const customersByStore = new Map<string, Set<string>>(stores.map(s => [s.id, new Set<string>()]));

  products.forEach(product => {
    const entry = totals.get(product.storeId);
    if (entry) entry.productCount += 1;
  });

  orders.forEach(order => {
    const entry = totals.get(order.storeId);
    if (!entry) return;
    entry.orderCount += 1;
    customersByStore.get(order.storeId)?.add(order.customerId);
    if (!isRealized(order)) return;
    entry.totalSales += order.total;
    entry.totalProfit += order.items.reduce(
      (sum, item) => sum + (marginByProductId.get(item.productId) ?? 0) * item.quantity,
      0,
    );
  });

  customersByStore.forEach((set, storeId) => {
    const entry = totals.get(storeId);
    if (entry) entry.customerCount = set.size;
  });

  return totals;
};

export const deriveCustomerTotals = (orders: Order[]): Map<string, CustomerTotals> => {
  const totals = new Map<string, CustomerTotals>();
  orders.forEach(order => {
    const entry = totals.get(order.customerId) ?? { orderCount: 0, totalSpent: 0, lastPurchase: null };
    entry.orderCount += 1;
    if (isRealized(order)) entry.totalSpent += order.total;
    if (!entry.lastPurchase || order.createdAt > entry.lastPurchase) entry.lastPurchase = order.createdAt;
    totals.set(order.customerId, entry);
  });
  return totals;
};

/** Units sold per product, counted from realized order lines. */
export const deriveProductSales = (orders: Order[]): Map<string, number> => {
  const sold = new Map<string, number>();
  orders.filter(isRealized).forEach(order => {
    order.items.forEach(item => {
      sold.set(item.productId, (sold.get(item.productId) ?? 0) + item.quantity);
    });
  });
  return sold;
};

const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

const percentChange = (current: number, previous: number) =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

/**
 * Orders carry no profit column, so profit is derived from each line item's product
 * margin. An item whose product is missing contributes 0 rather than a guess — an
 * understated profit is safer than an invented one.
 */
/** Sums values into a keyed bucket map, skipping keys with no readable name. */
const totalsByName = (entries: Array<[string | undefined, number]>): NamedTotal[] => {
  const totals = new Map<string, number>();
  entries.forEach(([name, value]) => {
    if (!name) return;
    totals.set(name, (totals.get(name) ?? 0) + value);
  });
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
};

export const buildDashboardStats = (
  orders: Order[],
  products: Product[],
  monthCount: number,
  now: Date = new Date(),
  stores: Store[] = [],
  customers: Customer[] = [],
): DashboardStats => {
  const marginByProductId = new Map<string, number>(products.map(p => [p.id, p.margin]));
  const categoryByProductId = new Map<string, string>(products.map(p => [p.id, p.category]));
  const storeNameById = new Map<string, string>(stores.map(s => [s.id, s.name]));

  const orderProfit = (order: Order) =>
    order.items.reduce(
      (sum, item) => sum + (marginByProductId.get(item.productId) ?? 0) * item.quantity,
      0,
    );

  const realized = orders.filter(isRealized);

  const months: MonthTotals[] = Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - index), 1);
    return {
      key: monthKey(date),
      name: date.toLocaleDateString('ar-LY', { month: 'long' }),
      sales: 0,
      profit: 0,
      orderCount: 0,
      aov: 0,
    };
  });
  const monthByKey = new Map(months.map(month => [month.key, month]));

  realized.forEach(order => {
    const bucket = monthByKey.get(monthKey(new Date(order.createdAt)));
    if (!bucket) return; // older than the window
    bucket.sales += order.total;
    bucket.profit += orderProfit(order);
    bucket.orderCount += 1;
  });
  months.forEach(month => {
    month.aov = month.orderCount > 0 ? month.sales / month.orderCount : 0;
  });

  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];

  const ordersByStatus = (Object.keys(statusLabels) as OrderStatus[])
    .map(status => ({
      status,
      name: statusLabels[status],
      value: orders.filter(order => order.status === status).length,
    }))
    .filter(entry => entry.value > 0);

  const rated = customers.filter(customer => customer.rating > 0);
  const delivered = orders.filter(order => order.status === 'delivered').length;
  const totalSales = realized.reduce((sum, order) => sum + order.total, 0);

  return {
    totalSales,
    totalProfit: realized.reduce((sum, order) => sum + orderProfit(order), 0),
    months,
    salesTrend: lastMonth ? percentChange(thisMonth.sales, lastMonth.sales) : null,
    profitTrend: lastMonth ? percentChange(thisMonth.profit, lastMonth.profit) : null,
    salesByStore: totalsByName(realized.map(order => [storeNameById.get(order.storeId), order.total])),
    ordersByStatus,
    salesByCategory: totalsByName(
      realized.flatMap(order =>
        order.items.map(
          item =>
            [categoryByProductId.get(item.productId), item.price * item.quantity] as [
              string | undefined,
              number,
            ],
        ),
      ),
    ),
    ops: {
      averageOrderValue: realized.length > 0 ? totalSales / realized.length : null,
      completionRate: orders.length > 0 ? delivered / orders.length : null,
      satisfaction:
        rated.length > 0
          ? rated.reduce((sum, customer) => sum + customer.rating, 0) / rated.length / 5
          : null,
    },
  };
};
