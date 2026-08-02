// Run with: npx tsx src/lib/orderMath.check.ts
import assert from 'node:assert/strict';
import { nextOrderNumber, orderTotals } from './orderMath';
import type { Order, OrderItem } from '../types';

const item = (price: number, quantity: number): OrderItem =>
  ({ productId: 'p', productName: 'p', quantity, price, image: '' });

// subtotal = Σ price×qty, total = subtotal − discount + delivery
assert.deepEqual(orderTotals([item(120, 2), item(50, 3)], 0, 0), { subtotal: 390, total: 390 });
assert.deepEqual(orderTotals([item(120, 2)], 40, 15), { subtotal: 240, total: 215 });
assert.deepEqual(orderTotals([], 0, 20), { subtotal: 0, total: 20 });

// A discount larger than the order never produces a negative total, which the
// database's `total >= 0` check would reject anyway.
assert.deepEqual(orderTotals([item(10, 1)], 999, 0), { subtotal: 10, total: 0 });

const order = (orderNumber: string) => ({ orderNumber }) as Order;
assert.equal(nextOrderNumber([]), 'ORD-1001');
assert.equal(nextOrderNumber([order('ORD-1001'), order('ORD-1007'), order('ORD-1003')]), 'ORD-1008');
assert.equal(nextOrderNumber([order('#1042')]), 'ORD-1043');
assert.equal(nextOrderNumber([order('no-digits')]), 'ORD-1001');

console.log('orderMath.ts: all checks passed');
