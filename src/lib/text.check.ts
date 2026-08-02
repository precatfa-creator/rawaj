// Run with: npx tsx src/lib/text.check.ts
import assert from 'node:assert/strict';
import { trimRow } from './text';

// The point of the helper: two spellings of one city stop being two cities.
assert.deepEqual(trimRow({ city: '  طرابلس  ' }), { city: 'طرابلس' });
assert.equal(trimRow({ city: ' طرابلس' }).city, trimRow({ city: 'طرابلس ' }).city);

// Whitespace-only input collapses to empty, which the NOT NULL DEFAULT '' columns accept.
assert.deepEqual(trimRow({ capital: '   ' }), { capital: '' });

// Non-strings must survive untouched — stock 0 and active false are meaningful.
assert.deepEqual(
  trimRow({ stock: 0, active: false, last_purchase: null, fee: 12.5 }),
  { stock: 0, active: false, last_purchase: null, fee: 12.5 },
);

// Arrays are element-wise: images/colors/sizes are text[] columns.
assert.deepEqual(
  trimRow({ images: [' a.jpg', 'b.jpg '], sizes: [] }),
  { images: ['a.jpg', 'b.jpg'], sizes: [] },
);

// Keys are preserved exactly, including ones whose value is undefined.
assert.deepEqual(Object.keys(trimRow({ a: ' x ', b: undefined })), ['a', 'b']);

console.log('text.ts: all checks passed');
