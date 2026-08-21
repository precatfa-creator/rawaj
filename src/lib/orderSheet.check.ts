// Run with: npx tsx src/lib/orderSheet.check.ts
import assert from 'node:assert/strict';
import { formatOrderItems, parseOrderItems } from './orderSheet';
import type { OrderItem } from '../types';

const item = (productId: string, quantity: number, price: number, size?: string): OrderItem =>
  ({ productId, productName: `اسم ${productId}`, quantity, price, image: '', ...(size ? { size } : {}) });

const skus = new Map([['p1', 'SKU-1']]);

// An item with a SKU is written by SKU; one without falls back to its name, so
// the cell still identifies something a person can look up.
assert.equal(formatOrderItems([item('p1', 2, 120)], skus), 'SKU-1 * 2 @ 120');
assert.equal(formatOrderItems([item('p2', 1, 50)], skus), 'اسم p2 * 1 @ 50');
assert.equal(
  formatOrderItems([item('p1', 2, 120, 'M'), item('p1', 1, 120, 'L')], skus),
  'SKU-1 * 2 @ 120 # M ؛ SKU-1 * 1 @ 120 # L',
);

const variantItem: OrderItem = {
  ...item('p1', 3, 120),
  variantId: 'black-s',
  variantValues: [{ option: 'اللون', value: 'أسود' }, { option: 'المقاس', value: 'S' }],
};
assert.equal(formatOrderItems([variantItem], skus), 'SKU-1 * 3 @ 120 # اللون: أسود · المقاس: S');
assert.equal(parseOrderItems(formatOrderItems([variantItem], skus)).lines[0].size, 'اللون: أسود · المقاس: S');

// What was written reads back unchanged.
const round = parseOrderItems(formatOrderItems([item('p1', 2, 120, 'M')], skus));
assert.deepEqual(round.lines, [{ ident: 'SKU-1', quantity: 2, price: 120, size: 'M' }]);
assert.deepEqual(round.invalid, []);

// Typed by hand: Latin and Arabic separators, 'x' for the multiplier, spacing
// wherever the typist felt like it, and no price at all.
const typed = parseOrderItems('SKU-1 x 3; SKU-2*1@ 45 ;  SKU-3 * 2 # XL');
assert.deepEqual(typed.lines, [
  { ident: 'SKU-1', quantity: 3 },
  { ident: 'SKU-2', quantity: 1, price: 45 },
  { ident: 'SKU-3', quantity: 2, size: 'XL' },
]);

// Arabic-Indic digits are digits.
assert.deepEqual(parseOrderItems('SKU-1 * ٤').lines, [{ ident: 'SKU-1', quantity: 4 }]);

// A product name with spaces stays one identifier.
assert.deepEqual(parseOrderItems('قميص قطن أزرق * 2').lines, [{ ident: 'قميص قطن أزرق', quantity: 2 }]);

// Nonsense is reported rather than imported as a zero-quantity line.
const bad = parseOrderItems('SKU-1 * 0 ؛ بلا كمية ؛ * 5');
assert.deepEqual(bad.lines, []);
assert.deepEqual(bad.invalid, ['SKU-1 * 0', 'بلا كمية', '* 5']);

// An empty cell is not an error — it means "leave the lines alone".
assert.deepEqual(parseOrderItems('   '), { lines: [], invalid: [] });

console.log('orderSheet.ts: all checks passed');
