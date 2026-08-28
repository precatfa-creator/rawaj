import assert from 'node:assert/strict';
import {
  addOptionValues, matchingVariants, nextVariantForOrder, variantCombinations, variantKey, variantLabel,
  variantSnapshot,
} from './variants';

const options = [
  { id: 'color', name: 'اللون', values: ['أسود', 'أحمر'] },
  { id: 'size', name: 'المقاس', values: ['S', 'L'] },
];
const combinations = variantCombinations(options);

assert.equal(combinations.length, 4);
assert.deepEqual(combinations[0], { color: 'أسود', size: 'S' });
assert.deepEqual(combinations[3], { color: 'أحمر', size: 'L' });
assert.notEqual(variantKey(options, combinations[0]), variantKey(options, combinations[1]));
assert.deepEqual(variantSnapshot(options, { optionValues: combinations[0] }), [
  { option: 'اللون', value: 'أسود' },
  { option: 'المقاس', value: 'S' },
]);
assert.equal(variantLabel(variantSnapshot(options, { optionValues: combinations[0] })), 'اللون: أسود · المقاس: S');
assert.deepEqual(variantCombinations([{ id: 'x', name: 'x', values: [] }]), []);

const stocks = [{ id: 'black-x', stock: 3 }, { id: 'black-s', stock: 1 }, { id: 'red-l', stock: 2 }];
assert.equal(nextVariantForOrder(stocks, [])?.id, 'black-x');
assert.equal(nextVariantForOrder(stocks, [{ variantId: 'black-x', quantity: 1 }])?.id, 'black-s');
assert.equal(nextVariantForOrder(stocks, [
  { variantId: 'black-x', quantity: 1 }, { variantId: 'black-s', quantity: 1 },
])?.id, 'red-l');
assert.equal(nextVariantForOrder(stocks, [
  { variantId: 'black-x', quantity: 1 }, { variantId: 'black-s', quantity: 1 },
  { variantId: 'red-l', quantity: 2 },
])?.id, 'black-x', 'after each variant has a line, use remaining stock');
assert.equal(nextVariantForOrder(
  [{ id: 'black-x', stock: 2 }],
  [{ variantId: 'black-x', quantity: 3 }],
  [{ variantId: 'black-x', quantity: 3 }],
)?.id, 'black-x', 'editing may reuse the quantity already reserved by that order');
assert.equal(nextVariantForOrder([{ id: 'sold', stock: 0 }], []), undefined);

assert.deepEqual(addOptionValues([], 'أسود'), ['أسود']);
assert.deepEqual(addOptionValues(['أسود'], ' أحمر '), ['أسود', 'أحمر'], 'a typed value is trimmed');
assert.deepEqual(addOptionValues(['أسود'], 'أسود'), ['أسود'], 'a repeat would duplicate a matrix row');
assert.deepEqual(addOptionValues(['S'], 'M، L, M'), ['S', 'M', 'L'], 'one paste may carry several values');
assert.deepEqual(addOptionValues(['S'], '  '), ['S'], 'blur on an empty field adds nothing');

// The picker row: a blank axis is a wildcard.
const matrix = combinations.map(optionValues => ({ optionValues }));
assert.equal(matchingVariants(matrix, options, {}).length, 4, 'no pick targets the whole matrix');
assert.equal(matchingVariants(matrix, options, { color: 'أسود' }).length, 2, 'one axis picks a whole block');
assert.deepEqual(
  matchingVariants(matrix, options, { color: 'أسود', size: 'L' }).map(row => row.optionValues),
  [{ color: 'أسود', size: 'L' }],
);
assert.deepEqual(matchingVariants(matrix, options, { color: 'أزرق' }), [], 'a value no row carries targets nothing');
assert.equal(matchingVariants(matrix, options, { color: '' }).length, 4, 'an empty string is not a filter');

console.log('variant checks passed');
