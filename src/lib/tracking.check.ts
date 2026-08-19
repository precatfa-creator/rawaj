// Run with: npx tsx src/lib/tracking.check.ts
import assert from 'node:assert/strict';
import { estimatedDeliveryDate, TRACK_STEPS, trackingState } from './tracking';

// Every stage of the line maps to its own circle, in order.
TRACK_STEPS.forEach((step, index) => {
  assert.deepEqual(trackingState(step.status), { index, halted: null }, step.status);
});

// A return follows a delivery, so the line stays full and the banner explains.
assert.deepEqual(trackingState('returned'), { index: TRACK_STEPS.length - 1, halted: 'returned' });

// A cancellation can happen anywhere, and the row does not say where.
assert.deepEqual(trackingState('canceled'), { index: 0, halted: 'canceled' });

// A status the enum grows past this file must not throw in the details view.
assert.deepEqual(trackingState('nonsense' as never), { index: 0, halted: null });

// An explicit promise is preserved; otherwise the zone duration supplies an ETA.
assert.equal(
  estimatedDeliveryDate({ createdAt: '2026-08-18T23:30:00.000Z', deliveryDate: '2026-08-25' }, 3),
  '2026-08-25',
);
assert.equal(estimatedDeliveryDate({ createdAt: '2026-08-18T23:30:00.000Z' }, 3), '2026-08-21');
assert.equal(estimatedDeliveryDate({ createdAt: '2026-08-18T10:00:00.000Z' }), null);
assert.equal(estimatedDeliveryDate({ createdAt: 'not-a-date' }, 3), null);

console.log('tracking.check: ok');
