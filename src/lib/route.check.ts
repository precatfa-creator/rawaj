// Run with: npx tsx src/lib/route.check.ts
import assert from 'node:assert/strict';
import { buildHash, parseHash, DEFAULT_STORE_SECTION } from './route';

// Portal
assert.deepEqual(parseHash(''), { view: 'stats', storeId: null, page: 0 });
assert.deepEqual(parseHash('#/'), { view: 'stats', storeId: null, page: 0 });
assert.deepEqual(parseHash('#/stores'), { view: 'stores', storeId: null, page: 0 });
assert.deepEqual(parseHash('#/users'), { view: 'users', storeId: null, page: 0 });
// Unknown portal view falls back rather than rendering nothing.
assert.deepEqual(parseHash('#/nonsense'), { view: 'stats', storeId: null, page: 0 });

// Store
assert.deepEqual(parseHash('#/store/s1/orders'), { view: 'orders', storeId: 's1', page: 0 });
assert.deepEqual(parseHash('#/store/s1'), { view: DEFAULT_STORE_SECTION, storeId: 's1', page: 0 });
assert.deepEqual(parseHash('#/store/s1/bogus'), { view: DEFAULT_STORE_SECTION, storeId: 's1', page: 0 });
assert.deepEqual(parseHash('#/store/a%20b/finances'), { view: 'finances', storeId: 'a b', page: 0 });

// Round-trips
for (const hash of ['#/', '#/stores', '#/users', '#/store/s1/orders', '#/store/s1/reports']) {
  assert.equal(buildHash(parseHash(hash)), hash, `round-trip failed for ${hash}`);
}
assert.equal(buildHash({ view: 'stats', storeId: null, page: 0 }), '#/');
assert.equal(buildHash({ view: 'zones', storeId: 'x/y', page: 0 }), '#/store/x%2Fy/zones');

// Page is 1-based in the URL, 0-based in state, and omitted on page 1.
assert.equal(parseHash('#/store/s1/orders?p=3').page, 2);
assert.equal(parseHash('#/stores?p=2').page, 1);
assert.equal(parseHash('#/store/s1/orders?p=1').page, 0);
assert.equal(parseHash('#/store/s1/orders?p=0').page, 0);
assert.equal(parseHash('#/store/s1/orders?p=abc').page, 0);
assert.equal(parseHash('#/store/s1/orders?p=-4').page, 0);
assert.equal(buildHash({ view: 'orders', storeId: 's1', page: 2 }), '#/store/s1/orders?p=3');
assert.equal(buildHash({ view: 'orders', storeId: 's1', page: 0 }), '#/store/s1/orders');
for (const hash of ['#/store/s1/orders?p=4', '#/stores?p=7']) {
  assert.equal(buildHash(parseHash(hash)), hash, `page round-trip failed for ${hash}`);
}

console.log('route.ts: all checks passed');
