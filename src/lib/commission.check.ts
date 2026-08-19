// Run with: npx tsx src/lib/commission.check.ts
import assert from 'node:assert/strict';
import { assignableReps, orderCommission, repCoversZone } from './commission';
import type { DeliveryZone, SalesRep } from '../types';

const zone = (commissionType: DeliveryZone['commissionType'], commissionValue: number) =>
  ({ commissionType, commissionValue }) as DeliveryZone;

// A percentage is taken off the delivery fee the order charged, not off goods.
assert.equal(orderCommission(40, zone('percent', 50), 7), 20);
assert.equal(orderCommission(0, zone('percent', 50), 7), 0);

// A flat zone amount ignores both the fee and the rep's own rate.
assert.equal(orderCommission(40, zone('fixed', 12), 7), 12);

// 'none', and an order with no zone at all, fall back to the rep.
assert.equal(orderCommission(40, zone('none', 99), 7), 7);
assert.equal(orderCommission(40, undefined, 7), 7);
assert.equal(orderCommission(40, undefined, 0), 0);

const rep = (zones: string[]) => ({ zones }) as SalesRep;

// No zones means every zone; a named zone matches only itself.
assert.equal(repCoversZone(rep([]), 'طرابلس'), true);
assert.equal(repCoversZone(rep(['طرابلس', 'مصراتة']), 'مصراتة'), true);
assert.equal(repCoversZone(rep(['طرابلس']), 'بنغازي'), false);
// An order with no zone chosen is not a mismatch — there is nothing to mismatch.
assert.equal(repCoversZone(rep(['طرابلس']), ''), true);

// --- who an order may actually be handed to ---

const named = (id: string, zones: string[], active = true) => ({ id, name: id, zones, active }) as SalesRep;
const roster = [
  named('tripoli', ['طرابلس']),
  named('benghazi', ['بنغازي']),
  named('everywhere', []),
  named('retired', ['طرابلس'], false),
];

// Only reps serving the zone, and only active ones. A rep with no zones serves all.
assert.deepEqual(
  assignableReps(roster, 'طرابلس').map(r => r.id),
  ['tripoli', 'everywhere'],
);
assert.deepEqual(
  assignableReps(roster, 'بنغازي').map(r => r.id),
  ['benghazi', 'everywhere'],
);

// An inactive rep is never offered, even for a zone they cover.
assert.equal(assignableReps(roster, 'طرابلس').some(r => r.id === 'retired'), false);

// No zone yet: nothing to contradict, so every active rep is offered.
assert.deepEqual(
  assignableReps(roster, '').map(r => r.id),
  ['tripoli', 'benghazi', 'everywhere'],
);

// A zone nobody covers offers only the reps who cover everything.
assert.deepEqual(assignableReps(roster, 'سبها').map(r => r.id), ['everywhere']);

// Whoever is already assigned stays listed even when they no longer cover the
// zone — the mismatch has to be visible to be corrected, not silently blanked.
assert.deepEqual(
  assignableReps(roster, 'بنغازي', 'tripoli').map(r => r.id),
  ['tripoli', 'benghazi', 'everywhere'],
);
// ...and that applies to an inactive rep still holding the order.
assert.equal(assignableReps(roster, 'طرابلس', 'retired').some(r => r.id === 'retired'), true);

console.log('commission.ts: all checks passed');
