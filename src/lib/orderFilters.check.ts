// Run with: npx tsx src/lib/orderFilters.check.ts
import assert from 'node:assert/strict';
import { dayEnd, dayStart, emptyOrderFilters, isFiltered, orderRangeFilters, orderTotalsArgs } from './orderFilters';

const base = emptyOrderFilters('store-1');

// A blank filter set adds no comparisons: every value is empty, so usePagedList
// skips all four.
assert.deepEqual(orderRangeFilters(base).map(filter => filter.value), ['', '', '', '']);
assert.equal(isFiltered(base), false);
assert.equal(isFiltered({ ...base, zoneId: 'z1' }), true);

// A day is a whole day in local time, not midnight-to-midnight UTC.
const start = dayStart('2026-08-14');
const end = dayEnd('2026-08-14');
assert.equal(new Date(start).getFullYear(), 2026);
assert.equal(new Date(start).getHours(), 0);
assert.equal(new Date(end).getHours(), 23);
assert.equal(new Date(end).getMinutes(), 59);
assert.ok(new Date(end).getTime() > new Date(start).getTime());

// The list and the totals RPC read the same bounds, or the totals row would
// describe a different set of orders than the rows above it.
const filters = { ...base, from: '2026-08-01', to: '2026-08-14', minTotal: '50', maxTotal: '' };
const ranges = orderRangeFilters(filters);
const args = orderTotalsArgs(filters);
assert.equal(ranges[0].value, args.p_from);
assert.equal(ranges[1].value, args.p_to);
assert.equal(args.p_min_total, 50);
assert.equal(args.p_max_total, null);
assert.equal(args.p_store_id, 'store-1');
assert.equal(args.p_status, null);

// Arabic search is normalised on the way to Postgres, matching how search_text
// is generated there.
assert.equal(orderTotalsArgs({ ...base, search: 'أحمد' }).p_search, 'احمد');
assert.equal(orderTotalsArgs(base).p_search, null);

console.log('orderFilters.ts: all checks passed');
