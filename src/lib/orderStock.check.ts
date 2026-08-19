import assert from 'node:assert/strict';
import { stockDeltaForTransition, statusHoldsStock } from './orderStock';
import type { OrderStatus } from '../types';

const all: OrderStatus[] = [
  'new', 'confirmed', 'processing', 'shipped', 'waiting',
  'delivered', 'delivered_partial', 'canceled', 'returned',
];
const items = [{ quantity: 2 }, { quantity: 3 }];

all.filter(status => status !== 'canceled' && status !== 'returned').forEach(status => {
  assert.equal(statusHoldsStock(status), true);
  assert.equal(stockDeltaForTransition(status, 'canceled', items), 5, `${status} → canceled returns stock`);
  assert.equal(stockDeltaForTransition(status, 'returned', items), 5, `${status} → returned returns stock`);
  assert.equal(stockDeltaForTransition('canceled', status, items), -5, `canceled → ${status} reserves stock`);
  assert.equal(stockDeltaForTransition('returned', status, items), -5, `returned → ${status} reserves stock`);
  all.filter(next => next !== 'canceled' && next !== 'returned').forEach(next => {
    assert.equal(stockDeltaForTransition(status, next, items), 0, `${status} → ${next} does not move stock twice`);
  });
});

assert.equal(stockDeltaForTransition('canceled', 'returned', items), 0);
assert.equal(stockDeltaForTransition('returned', 'canceled', items), 0);

console.log('orderStock.ts: all checks passed');
