// Run with: npx tsx src/lib/tracking.check.ts
import assert from 'node:assert/strict';
import { TRACK_STEPS, trackingState } from './tracking';

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

console.log('tracking.check: ok');
