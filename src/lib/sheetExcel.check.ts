// Run with: npx tsx src/lib/sheetExcel.check.ts
//
// The .xlsx half of sheet.ts, which the CSV checks cannot reach: exceljs is a
// dynamic import, so nothing in sheet.check.ts ever loads it. Excel is the
// format named first in the import UI, and cellText() has to flatten a union
// (formula results, rich text, dates, errors) that no CSV ever produces.
//
// exceljs runs in Node, so the whole round trip is testable here — build a
// workbook the way Excel would, hand it to readSheet as a File, and read it back.
import assert from 'node:assert/strict';
import { loadWorkbookClass, readSheet } from './sheet';

// Resolved the same way the app resolves it, so this also proves the CJS/ESM
// interop the browser depends on.
const Workbook = await loadWorkbookClass();

const workbook = new Workbook();
const sheet = workbook.addWorksheet('data');

sheet.addRow(['رقم المنطقة', 'اسم المنطقة', 'رسوم التوصيل', 'تاريخ', 'ملاحظة']);

// A plain row, with the leading zero Excel loves to eat kept as text.
sheet.addRow(['00', 'طرابلس', 12.5, new Date(Date.UTC(2026, 0, 15)), 'عادي']);

// A formula cell: what the operator sees is the computed result.
sheet.addRow([
  '01',
  'بنغازي',
  { formula: 'C2*2', result: 25 },
  new Date(Date.UTC(2026, 0, 16)),
  'محسوب',
]);

// Rich text: one logical value split across runs by the editor's formatting.
sheet.addRow([
  '02',
  { richText: [{ text: 'وادي ' }, { text: 'الحياة' }] },
  0,
  null,
  '',
]);

const rows = await readSheet(
  new File([await workbook.xlsx.writeBuffer()], 'zones.xlsx'),
);

assert.equal(rows.length, 3);

assert.equal(rows[0]['رقم المنطقة'], '00'); // the leading zero survives
assert.equal(rows[0]['اسم المنطقة'], 'طرابلس');
assert.equal(rows[0]['رسوم التوصيل'], '12.5');
assert.equal(rows[0]['تاريخ'], '2026-01-15');

// A formula reads as its result, not as "=C2*2".
assert.equal(rows[1]['رسوم التوصيل'], '25');

// Rich text reads as the joined string a person would see.
assert.equal(rows[2]['اسم المنطقة'], 'وادي الحياة');

// Empty and null cells read as '', never 'null' or 'undefined'.
assert.equal(rows[2]['تاريخ'], '');
assert.equal(rows[2]['ملاحظة'], '');

// The header keys are the Arabic labels the bulk specs actually look up.
assert.deepEqual(
  Object.keys(rows[0]),
  ['رقم المنطقة', 'اسم المنطقة', 'رسوم التوصيل', 'تاريخ', 'ملاحظة'],
);

// A sheet with only a header row is not an error — it is the blank template.
const emptyBook = new Workbook();
emptyBook.addWorksheet('data').addRow(['اسم المنطقة']);
assert.deepEqual(
  await readSheet(new File([await emptyBook.xlsx.writeBuffer()], 'blank.xlsx')),
  [],
);

console.log('sheet.ts (xlsx): all checks passed');
