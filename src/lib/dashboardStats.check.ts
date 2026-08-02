// Run with: npx tsx src/lib/dashboardStats.check.ts
import assert from 'node:assert/strict';
import { buildDashboardStats, deriveCustomerTotals, deriveProductSales, deriveStoreTotals } from './dashboardStats';
import type { Customer, Order, OrderStatus, Product, Store } from '../types';

const products = [
  { id: 'p1', storeId: 's1', margin: 10, category: 'إلكترونيات' },
  { id: 'p2', storeId: 's2', margin: 25, category: 'عطور' },
] as Product[];

const stores = [
  { id: 's1', name: 'متجر الإلكترونيات' },
  { id: 's2', name: 'متجر العطور' },
] as Store[];

const customers = [
  { id: 'c1', rating: 5 },
  { id: 'c2', rating: 3 },
  { id: 'c3', rating: 0 }, // never rated, must not drag the mean down
] as Customer[];

const order = (
  id: string,
  total: number,
  status: OrderStatus,
  createdAt: string,
  items: Order['items'],
  storeId = 's1',
) =>
  ({ id, orderNumber: id, storeId, customerId: 'c1', customerName: 'x', items, subtotal: total, discount: 0, deliveryFee: 0, total, status, notes: '', createdAt }) as Order;

const item = (productId: string, quantity: number, price = 0) =>
  ({ productId, productName: productId, quantity, price, image: '' });

const now = new Date(2026, 7, 15); // Aug 2026

const orders = [
  order('a', 300, 'delivered', new Date(2026, 7, 2).toISOString(), [item('p1', 2, 50), item('p2', 1, 200)]), // profit 45
  order('b', 100, 'new', new Date(2026, 6, 20).toISOString(), [item('p1', 1, 100)]), // profit 10, July
  order('c', 999, 'canceled', new Date(2026, 7, 5).toISOString(), [item('p2', 4, 250)]), // excluded
  order('d', 50, 'returned', new Date(2026, 7, 6).toISOString(), [item('p1', 1, 50)]), // excluded
  order('e', 70, 'shipped', new Date(2026, 7, 9).toISOString(), [item('unknown', 3, 20)], 's2'), // profit 0, unknown product
  order('f', 500, 'delivered', new Date(2025, 0, 1).toISOString(), [item('p2', 2, 250)], 's2'), // outside window
];

const stats = buildDashboardStats(orders, products, 6, now, stores, customers);

// Totals span every realized order, including ones outside the chart window.
assert.equal(stats.totalSales, 300 + 100 + 70 + 500);
assert.equal(stats.totalProfit, 45 + 10 + 0 + 50);

// Canceled and returned never count.
assert.ok(!stats.months.some(m => m.sales === 999));

assert.equal(stats.months.length, 6);
const august = stats.months[5];
const july = stats.months[4];
assert.equal(august.sales, 370); // 300 + 70
assert.equal(august.profit, 45); // unknown product contributes 0
assert.equal(july.sales, 100);
assert.equal(july.profit, 10);
assert.equal(stats.months[0].sales, 0); // March, no orders

// 100 -> 370 is +270%
assert.equal(Math.round(stats.salesTrend!), 270);
assert.equal(Math.round(stats.profitTrend!), 350); // 10 -> 45

// No baseline means no fabricated trend.
const noBaseline = buildDashboardStats([orders[0]], products, 6, now);
assert.equal(noBaseline.salesTrend, null);
assert.equal(noBaseline.profitTrend, null);

// Average order value per month, 0 for months with no orders.
assert.equal(august.orderCount, 2);
assert.equal(august.aov, 185); // 370 / 2
assert.equal(stats.months[0].aov, 0);

// Sales by store: realized only, sorted desc, store names resolved.
assert.deepEqual(stats.salesByStore, [
  { name: 'متجر العطور', value: 570 }, // e 70 + f 500
  { name: 'متجر الإلكترونيات', value: 400 }, // a 300 + b 100
]);

// Status counts include canceled/returned and omit statuses with no orders.
const statusMap = Object.fromEntries(stats.ordersByStatus.map(s => [s.status, s.value]));
assert.deepEqual(statusMap, { new: 1, shipped: 1, delivered: 2, canceled: 1, returned: 1 });
assert.ok(!stats.ordersByStatus.some(s => s.status === 'processing'));

// Category revenue uses line price x quantity; unknown products are dropped, not zeroed in.
const categoryMap = Object.fromEntries(stats.salesByCategory.map(c => [c.name, c.value]));
assert.deepEqual(categoryMap, { عطور: 200 + 500, إلكترونيات: 100 + 100 });

// Ops KPIs.
assert.equal(stats.ops.averageOrderValue, 970 / 4);
assert.equal(stats.ops.completionRate, 2 / 6);
assert.equal(stats.ops.satisfaction, 4 / 5); // mean of 5 and 3, unrated excluded

// Empty account reports zeros and nulls, never NaN.
const empty = buildDashboardStats([], [], 6, now);
assert.equal(empty.totalSales, 0);
assert.equal(empty.totalProfit, 0);
assert.equal(empty.salesTrend, null);
assert.deepEqual(empty.salesByStore, []);
assert.deepEqual(empty.ordersByStatus, []);
assert.deepEqual(empty.salesByCategory, []);
assert.equal(empty.ops.averageOrderValue, null);
assert.equal(empty.ops.completionRate, null);
assert.equal(empty.ops.satisfaction, null);

// ---- derived counters (these replace the stored *_count / total_* columns) ----

const storeTotals = deriveStoreTotals(stores, products, orders);

const s1 = storeTotals.get('s1')!;
assert.equal(s1.productCount, 1); // only p1 lives in s1
assert.equal(s1.orderCount, 4); // a, b, c(canceled), d(returned) — counted, unlike revenue
assert.equal(s1.totalSales, 400); // canceled/returned excluded
assert.equal(s1.totalProfit, 55); // a 45 + b 10
assert.equal(s1.customerCount, 1); // every fixture order uses c1

const s2 = storeTotals.get('s2')!;
assert.equal(s2.productCount, 1); // p2
assert.equal(s2.orderCount, 2);
assert.equal(s2.totalSales, 570);

// A store with no rows reports zeros rather than being absent from the map.
assert.deepEqual(
  deriveStoreTotals([{ id: 'empty', name: 'x' } as Store], [], []).get('empty'),
  { productCount: 0, orderCount: 0, customerCount: 0, totalSales: 0, totalProfit: 0 },
);

const customerTotals = deriveCustomerTotals(orders);
const c1 = customerTotals.get('c1')!;
assert.equal(c1.orderCount, 6); // every order, including canceled and returned
assert.equal(c1.totalSpent, 970); // realized only
assert.equal(c1.lastPurchase, orders[4].createdAt); // order 'e', Aug 9, is the newest

const sold = deriveProductSales(orders);
assert.equal(sold.get('p1'), 2 + 1); // a(2) + b(1); returned d(1) excluded
assert.equal(sold.get('p2'), 1 + 2); // a(1) + f(2); canceled c(4) and returned d excluded
assert.equal(sold.get('unknown'), 3); // counted even though no product row matches
assert.equal(sold.get('missing'), undefined);

console.log('dashboardStats.ts: all checks passed');
