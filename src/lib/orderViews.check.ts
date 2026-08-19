import assert from 'node:assert/strict';
import { groupOrders } from './orderViews';
import type { Order, OrderStatus } from '../types';

const labels = {
  new: 'جديد', confirmed: 'مؤكد', processing: 'تجهيز', shipped: 'توصيل', waiting: 'انتظار',
  delivered: 'كامل', delivered_partial: 'جزئي', canceled: 'ملغي', returned: 'مرتجع',
} satisfies Record<OrderStatus, string>;

const order = (patch: Partial<Order>): Order => ({
  id: 'o1', orderNumber: 'ORD-1', storeId: 's1', customerId: 'c1', customerName: 'سارة',
  items: [
    { productId: 'p1', productName: 'فستان', quantity: 2, price: 100, image: '' },
    { productId: 'p1', productName: 'فستان', quantity: 1, price: 100, image: '', size: 'L' },
    { productId: 'p2', productName: 'حذاء', quantity: 1, price: 50, image: '' },
  ],
  subtotal: 350, discount: 0, deliveryFee: 10, total: 360, status: 'new', notes: '',
  createdAt: '2026-08-19T10:00:00Z', agentId: 'r1',
  ...patch,
});

const orders = [
  order({}),
  order({
    id: 'o2', orderNumber: 'ORD-2', customerId: 'c2', customerName: 'آمنة', agentId: undefined,
    status: 'delivered', items: [{ productId: 'p1', productName: 'فستان', quantity: 1, price: 90, image: '' }],
    subtotal: 90, total: 100,
  }),
];

const customers = groupOrders(orders, 'customer', [], labels);
assert.deepEqual(customers.map(group => group.label), ['آمنة', 'سارة']);
assert.equal(customers.find(group => group.key === 'c1')?.total, 360);

const reps = groupOrders(orders, 'rep', [{ id: 'r1', name: 'علي' }], labels);
assert.deepEqual(reps.map(group => group.label), ['بدون مندوب', 'علي']);

const statuses = groupOrders(orders, 'status', [], labels);
assert.deepEqual(statuses.map(group => group.key), ['new', 'delivered']);

const items = groupOrders(orders, 'item', [], labels);
const dress = items.find(group => group.key === 'p1');
assert.equal(dress?.orderCount, 2, 'an order is counted once even when the product has two size lines');
assert.equal(dress?.units, 4);
assert.equal(dress?.total, 390);
assert.deepEqual(dress?.orders.map(item => item.id), ['o1', 'o2']);
assert.equal(items.find(group => group.key === 'p2')?.totalKind, 'lines');

console.log('orderViews.ts: all checks passed');
