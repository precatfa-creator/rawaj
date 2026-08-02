// Run with: npx tsx src/lib/finance.check.ts
import assert from 'node:assert/strict';
import { buildLedger, buildMonthlyLedgers, topCustomers, topProducts, toCsv } from './finance';
import type { Customer, Order, OrderStatus, Product } from '../types';

const products = [
  { id: 'p1', name: 'سماعات', sku: 'A-1', purchasePrice: 100, sellingPrice: 150, margin: 50 },
  { id: 'p2', name: 'شاحن', sku: 'A-2', purchasePrice: 20, sellingPrice: 50, margin: 30 },
] as Product[];

const customers = [{ id: 'c1', name: 'أحمد', city: 'طرابلس' }] as Customer[];

const item = (productId: string, quantity: number, price: number) =>
  ({ productId, productName: productId, quantity, price, image: '' });

const order = (id: string, status: OrderStatus, items: Order['items'], discount: number, deliveryFee: number, createdAt: string) => {
  const grossSales = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return {
    id, orderNumber: id, storeId: 's1', customerId: 'c1', customerName: 'أحمد', items,
    subtotal: grossSales, discount, deliveryFee,
    total: Math.max(0, grossSales - discount + deliveryFee),
    status, notes: '', createdAt,
  } as Order;
};

const now = new Date(2026, 7, 15);
const orders = [
  // gross 300, discount 50, delivery 20 -> total 270; cogs 200
  order('a', 'delivered', [item('p1', 2, 150)], 50, 20, new Date(2026, 7, 3).toISOString()),
  // gross 100, no discount, delivery 10 -> total 110; cogs 40
  order('b', 'new', [item('p2', 2, 50)], 0, 10, new Date(2026, 6, 3).toISOString()),
  // canceled: excluded entirely
  order('c', 'canceled', [item('p1', 9, 150)], 0, 0, new Date(2026, 7, 4).toISOString()),
  // unknown product: revenue counts, cost cannot
  order('d', 'shipped', [item('ghost', 1, 80)], 0, 0, new Date(2026, 7, 5).toISOString()),
];

const l = buildLedger(orders, products);
assert.equal(l.grossSales, 300 + 100 + 80);
assert.equal(l.discounts, 50);
assert.equal(l.deliveryFees, 30);
assert.equal(l.netRevenue, 270 + 110 + 80);
assert.equal(l.cogs, 200 + 40);          // ghost line contributes no cost
assert.equal(l.untrackedCostLines, 1);
assert.equal(l.grossProfit, (480 - 50) - 240);
assert.equal(l.margin, ((480 - 50) - 240) / (480 - 50));
assert.equal(l.orderCount, 3);
assert.equal(l.averageOrderValue, 460 / 3);

// Empty books report zeros and nulls, never NaN.
const none = buildLedger([], products);
assert.equal(none.grossProfit, 0);
assert.equal(none.margin, null);
assert.equal(none.averageOrderValue, null);

const months = buildMonthlyLedgers(orders, products, 3, now);
assert.equal(months.length, 3);
assert.equal(months[2].name, new Date(2026, 7, 1).toLocaleDateString('ar-LY', { month: 'long' }));
assert.equal(months[2].netRevenue, 270 + 80); // August
assert.equal(months[1].netRevenue, 110);      // July
assert.equal(months[0].orderCount, 0);
assert.equal(months[0].margin, null);

const prods = topProducts(orders, products);
assert.equal(prods[0].id, 'p1');
assert.equal(prods[0].units, 2);
assert.equal(prods[0].revenue, 300);
assert.equal(prods[0].profit, 100);
assert.ok(prods.some(r => r.id === 'ghost' && r.profit === 0));

const custs = topCustomers(orders, customers);
assert.equal(custs.length, 1);
assert.equal(custs[0].orders, 3);
assert.equal(custs[0].spent, 460);
assert.equal(custs[0].city, 'طرابلس');

// CSV: BOM for Excel, quotes escaped, commas contained.
const csv = toCsv(['اسم', 'قيمة'], [['سماعات, كبيرة', 10], ['قال "مرحبا"', 5]]);
assert.ok(csv.startsWith('﻿'));
assert.ok(csv.includes('"سماعات, كبيرة"'));
assert.ok(csv.includes('"قال ""مرحبا"""'));

console.log('finance.ts: all checks passed');
