// Run with: npx tsx src/lib/commission.check.ts
import assert from 'node:assert/strict';
import { orderCommission, repCoversZone } from './commission';
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

console.log('commission.ts: all checks passed');
