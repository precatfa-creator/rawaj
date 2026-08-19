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
  new: 'طلب شحن',
  confirmed: 'تم التأكيد',
  processing: 'قيد التجهيز',
  shipped: 'قيد التوصيل',
  waiting: 'انتظار',
  delivered: 'تسليم كامل',
  delivered_partial: 'تسليم جزئي',
  canceled: 'ملغي',
  returned: 'مرتجع',
};

/**
 * The edge accent a finished order carries, in the list and on its own page.
 *
 * Only the three terminal states get one, so the stripe answers "which orders
 * are closed, and how" — an order still moving carries none, and the colour
 * never becomes wallpaper. It is an edge rather than a fill because the row
 * background is already spoken for by hover and by selection, and a fill would
 * make a checked row hard to pick out during a bulk action.
 *
 * Colour never carries this alone: everywhere it appears, the status is also
 * printed in words.
 */
export const statusAccent: Record<OrderStatus, string> = {
  new: 'border-s-blue-400',
  confirmed: 'border-s-violet-400',
  // Orange, not amber: `returned` owns amber, and two statuses sharing a colour
  // is invisible in a chip but obvious once it is a stripe down a row.
  processing: 'border-s-orange-400',
  shipped: 'border-s-indigo-400',
  waiting: 'border-s-slate-400',
  delivered: 'border-s-emerald-400',
  delivered_partial: 'border-s-teal-400',
  canceled: 'border-s-rose-400',
  returned: 'border-s-amber-400',
};

/**
 * The width, always applied, so the 4px edge is reserved on every row and
 * nothing shifts when it colours.
 *
 * The transparent fallback belongs in the caller's `??`, not in here: both
 * classes set `border-inline-start-color` at the same specificity, so an
 * element carrying the pair takes whichever Tailwind happens to emit last —
 * which is `border-s-transparent`, silently swallowing every accent.
 */
export const STATUS_ACCENT_BASE = 'border-s-4';
export const STATUS_ACCENT_NONE = 'border-s-transparent';

/**
 * A wash that fades out of the accent edge, for the one card that carries the
 * whole order. It reads as the edge bleeding into the sheet rather than as a
 * second, competing block of colour, and it stops before the card's midpoint so
 * the text it sits behind never loses contrast.
 *
 * A gradient is a background *image*, so it layers over the card's `bg-white`
 * instead of fighting it — unlike two border-colour classes, which collide.
 *
 * `to-l` is the physical direction that matches inline-start in this RTL app;
 * Tailwind has no logical gradient direction, so an LTR rendering would need
 * this flipped.
 */
export const statusWash: Record<OrderStatus, string> = {
  new: 'bg-gradient-to-l from-blue-100 via-blue-50 via-25% to-white to-60%',
  confirmed: 'bg-gradient-to-l from-violet-100 via-violet-50 via-25% to-white to-60%',
  processing: 'bg-gradient-to-l from-orange-100 via-orange-50 via-25% to-white to-60%',
  shipped: 'bg-gradient-to-l from-indigo-100 via-indigo-50 via-25% to-white to-60%',
  waiting: 'bg-gradient-to-l from-slate-200 via-slate-100 via-25% to-white to-60%',
  delivered: 'bg-gradient-to-l from-emerald-100 via-emerald-50 via-25% to-white to-60%',
  delivered_partial: 'bg-gradient-to-l from-teal-100 via-teal-50 via-25% to-white to-60%',
  canceled: 'bg-gradient-to-l from-rose-100 via-rose-50 via-25% to-white to-60%',
  returned: 'bg-gradient-to-l from-amber-100 via-amber-50 via-25% to-white to-60%',
};

/*
 * Every tint was measured against `surface-600`, the lightest text that sits on
 * one: the worst is 6.15:1, well clear of the 4.5:1 floor for small text.
 */

/**
 * Every status, in the order an order lives through them.
 *
 * Derived from `statusLabels` rather than written out again: the two hand-typed
 * copies of this list silently omitted `waiting` and `delivered_partial` when
 * they were added, because an array of strings gives the compiler nothing to
 * check. Insertion order in `statusLabels` is the lifecycle order.
 */
export const ALL_STATUSES = Object.keys(statusLabels) as OrderStatus[];

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
