// Run with: npx tsx src/lib/orderMath.check.ts
import assert from 'node:assert/strict';
import {
  deliveredOf, deliveredTotals, deliveredUnits, isShort, nextOrderNumber, orderedUnits, orderTotals,
} from './orderMath';
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

// --- partial delivery ---

const line = (quantity: number, price: number, deliveredQuantity?: number): OrderItem =>
  ({ productId: 'p', productName: 'ص', quantity, price, image: '', deliveredQuantity }) as OrderItem;

// A line written before partial delivery existed has no field, and means "all
// of it" — the reading every historic order depends on.
assert.equal(deliveredOf(line(3, 10)), 3);
assert.equal(deliveredOf(line(3, 10, 2)), 2);
assert.equal(deliveredOf(line(3, 10, 0)), 0);

// A stored value can never invent revenue or go negative, whatever is in the row.
assert.equal(deliveredOf(line(3, 10, 99)), 3);
assert.equal(deliveredOf(line(3, 10, -5)), 0);

assert.equal(orderedUnits([line(3, 10), line(2, 5)]), 5);
assert.equal(deliveredUnits([line(3, 10, 1), line(2, 5)]), 3);

// "Short" is what separates a partial delivery from a full one.
assert.equal(isShort([line(3, 10), line(2, 5)]), false);
assert.equal(isShort([line(3, 10, 3), line(2, 5)]), false);
assert.equal(isShort([line(3, 10, 2), line(2, 5)]), true);

// Goods at what arrived; delivery fee whole; discount by the delivered share.
// 2 of 4 units at 100 = 200 of 400, so half the 40 discount applies.
const half = deliveredTotals([line(4, 100, 2)], 40, 12);
assert.equal(half.subtotal, 200);
assert.equal(half.total, 200 - 20 + 12);

// A full delivery through the same function matches the ordinary total, so the
// two paths can never disagree about an order that arrived complete.
const whole = deliveredTotals([line(4, 100)], 40, 12);
assert.deepEqual(whole, orderTotals([line(4, 100)], 40, 12));

// Nothing delivered earns nothing but the trip; never a negative total.
assert.equal(deliveredTotals([line(4, 100, 0)], 40, 12).total, 12);
assert.equal(deliveredTotals([line(4, 100, 0)], 40, 0).total, 0);

// An empty order divides by no goods rather than by zero.
assert.equal(deliveredTotals([], 40, 12).total, 12);

console.log('orderMath.ts: all checks passed');
