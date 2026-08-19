// Run with: npx tsx src/lib/tracking.check.ts
import assert from 'node:assert/strict';
import { estimatedDeliveryDate, latestMoments, TRACK_STEPS, trackingState } from './tracking';

// Every stage of the line maps to its own circle, in order.
TRACK_STEPS.forEach((step, index) => {
  assert.deepEqual(trackingState(step.status), { index, halted: null, held: false }, step.status);
});

// A return follows a delivery, so the line stays full and the banner explains.
assert.deepEqual(trackingState('returned'), { index: TRACK_STEPS.length - 1, halted: 'returned', held: false });

// A cancellation can happen anywhere, and the row does not say where.
assert.deepEqual(trackingState('canceled'), { index: 0, halted: 'canceled', held: false });

// A status the enum grows past this file must not throw in the details view.
assert.deepEqual(trackingState('nonsense' as never), { index: 0, halted: null, held: false });

// A hold parks the order where it already is — out for delivery — instead of
// adding a rung. It is not a halt: the money is still expected.
assert.deepEqual(trackingState('waiting'), {
  index: TRACK_STEPS.findIndex(step => step.status === 'shipped'),
  halted: null,
  held: true,
});

// A partial delivery still arrived, so the line is full and nothing is halted.
// What it earned is a question for the order lines, not for the ladder.
assert.deepEqual(trackingState('delivered_partial'), {
  index: TRACK_STEPS.length - 1,
  halted: null,
  held: false,
});
assert.equal(trackingState('delivered').index, trackingState('delivered_partial').index);

// An explicit promise is preserved; otherwise the zone duration supplies an ETA.
assert.equal(
  estimatedDeliveryDate({ createdAt: '2026-08-18T23:30:00.000Z', deliveryDate: '2026-08-25' }, 3),
  '2026-08-25',
);
assert.equal(estimatedDeliveryDate({ createdAt: '2026-08-18T23:30:00.000Z' }, 3), '2026-08-21');
assert.equal(estimatedDeliveryDate({ createdAt: '2026-08-18T10:00:00.000Z' }), null);
assert.equal(estimatedDeliveryDate({ createdAt: 'not-a-date' }, 3), null);

// An order that returns to a stage it already passed reports the latest visit,
// not the first. This is the real trail of ORD-1006: confirmed on the 18th,
// reset to `new` on the 19th, then confirmed again — the ladder has to show the
// 19th, because showing the 18th is what made a status change look like it did
// nothing.
const trail = [
  { status: 'new', at: '2026-08-18T17:13:31Z' },
  { status: 'confirmed', at: '2026-08-18T18:07:19Z' },
  { status: 'new', at: '2026-08-19T14:56:21Z' },
  { status: 'confirmed', at: '2026-08-19T14:56:24Z' },
  { status: 'processing', at: '2026-08-19T14:56:30Z' },
];
const moments = latestMoments(trail);
assert.equal(moments.get('confirmed')?.at, '2026-08-19T14:56:24Z');
assert.equal(moments.get('new')?.at, '2026-08-19T14:56:21Z');
assert.equal(moments.get('processing')?.at, '2026-08-19T14:56:30Z');
// A stage never reached has no moment to print.
assert.equal(moments.get('delivered'), undefined);
assert.equal(latestMoments([]).size, 0);

console.log('tracking.check: ok');
