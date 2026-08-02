// Run with: npx tsx src/lib/arabic.check.ts
import assert from 'node:assert/strict';
import { matchesSearch, normalizeArabic } from './arabic';

assert.equal(normalizeArabic('أَحْمَد'), 'احمد'); // hamza + diacritics
assert.equal(normalizeArabic('فاطمة'), 'فاطمه'); // taa marbuta
assert.equal(normalizeArabic('مصطـــفى'), 'مصطفي'); // tatweel + alef maqsura

assert.ok(matchesSearch('أحمد علي', 'احمد'));
assert.ok(matchesSearch('فاطمة الزهراء', 'فاطمه'));
assert.ok(matchesSearch('مُصْطَفى', 'مصطفي'));
assert.ok(matchesSearch('SKU-ABC-1', 'abc'));
assert.ok(matchesSearch('أي منتج', '')); // empty query matches everything

assert.ok(!matchesSearch('أحمد', 'محمد'));
assert.ok(!matchesSearch('طرابلس', 'بنغازي'));

console.log('arabic.ts: all checks passed');
