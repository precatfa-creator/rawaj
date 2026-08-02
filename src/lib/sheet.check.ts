// Run with: npx tsx src/lib/sheet.check.ts
import assert from 'node:assert/strict';
import { parseCsv, toBoolean, toCsv, toNumber, toRows } from './sheet';

// --- parsing ---

assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);

// CRLF from Excel is one row break, not two.
assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);

// A quoted field owns its commas, its newlines and its doubled quotes.
assert.deepEqual(
  parseCsv('name,note\n"طرابلس, الوسط","سطر\nثانٍ"\n'),
  [['name', 'note'], ['طرابلس, الوسط', 'سطر\nثانٍ']],
);
assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);

// Excel's UTF-8 BOM must not become part of the first header.
assert.deepEqual(parseCsv('﻿code,name\n00,طرابلس'), [['code', 'name'], ['00', 'طرابلس']]);

// Empty trailing lines are export noise; a genuinely empty cell is not.
assert.deepEqual(parseCsv('a,b\n1,\n\n\n'), [['a', 'b'], ['1', '']]);

// A file with no trailing newline still yields its last row.
assert.deepEqual(parseCsv('a,b\n1,2'), parseCsv('a,b\n1,2\n'));

// --- header mapping ---

const rows = toRows(parseCsv('  code , name \n 00 , طرابلس '));
assert.deepEqual(rows, [{ code: '00', name: 'طرابلس' }]);

// A short row (trailing columns omitted by the editor) reads as empty, not undefined.
assert.deepEqual(toRows([['a', 'b'], ['1']]), [{ a: '1', b: '' }]);

// Header order is irrelevant — columns are matched by name.
assert.deepEqual(toRows(parseCsv('name,code\nطرابلس,00'))[0].code, '00');

assert.deepEqual(toRows([]), []);

// --- writing ---

// Quoting is applied only where a reader would otherwise mis-split the row.
assert.equal(toCsv(['a', 'b'], [{ a: 'x,y', b: 'plain' }]), 'a,b\r\n"x,y",plain');
assert.equal(toCsv(['a'], [{ a: 'say "hi"' }]), 'a\r\n"say ""hi"""');

// A column absent from the row object writes as empty, not "undefined".
assert.equal(toCsv(['a', 'b'], [{ a: '1' }]), 'a,b\r\n1,');

// The round trip is the property that matters: what we export, we can re-import.
const original = [{ name: 'طرابلس, الوسط', note: 'سطر\nثانٍ', fee: '12.5' }];
assert.deepEqual(toRows(parseCsv(toCsv(['name', 'note', 'fee'], original))), original);

// --- cell values ---

assert.equal(toNumber('12.5'), 12.5);
assert.equal(toNumber(' 1,250 '), 1250);
assert.equal(toNumber('١٢٫٥'), 12.5); // Arabic-Indic digits + Arabic decimal separator
assert.equal(toNumber('۳۵'), 35); // eastern Arabic digits
assert.equal(toNumber('25 د.ل'), 25); // trailing currency word
assert.equal(toNumber('-3'), -3);

// A cell that is not a number at all must not become NaN and poison the row.
assert.equal(toNumber(''), 0);
assert.equal(toNumber('غير محدد'), 0);
assert.equal(toNumber('', 3), 3); // caller-supplied default, e.g. delivery days

assert.equal(toBoolean('نعم'), true);
assert.equal(toBoolean('لا'), false);
assert.equal(toBoolean('FALSE'), false);
assert.equal(toBoolean('0'), false);
assert.equal(toBoolean(''), true); // blank keeps the column's own default
assert.equal(toBoolean('', false), false);
assert.equal(toBoolean('ربما', false), false); // unrecognised falls back, never throws

console.log('sheet.ts: all checks passed');
