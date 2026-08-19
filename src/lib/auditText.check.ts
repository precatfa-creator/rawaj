// Run with: npx tsx src/lib/auditText.check.ts
import assert from 'node:assert/strict';
import {
  auditChanges, auditFields, auditSummary, auditValue, emptyAuditFilter, fieldLabel,
  isAuditFiltered, matchesAudit, nextAuditPage,
} from './auditText';

// Column names become Arabic; an unknown one is printed rather than hidden.
assert.equal(fieldLabel('delivery_fee'), 'التوصيل');
assert.equal(fieldLabel('mystery_column'), 'mystery_column');

// Values read as values: money formatted, dates localized, blanks marked.
assert.equal(auditValue('total', 207), '207 د.ل');
assert.equal(auditValue('total', '207'), '207 د.ل');
assert.equal(auditValue('notes', ''), '—');
assert.equal(auditValue('active', false), 'لا');
// Arrays with no shape worth spelling out still report their size. Not `items`:
// order lines have their own rendering below.
assert.equal(auditValue('sizes', ['S', 'M', 'L']), '3 عنصر');
assert.match(auditValue('delivery_date', '2026-08-19'), /2026/);
// A page that knows the names lends them.
assert.equal(auditValue('agent_id', 'a1', (field, value) => (field === 'agent_id' && value === 'a1' ? 'علي' : undefined)), 'علي');

// An update carries both sides of every field it touched.
const update = auditChanges('UPDATE', { status: { from: 'new', to: 'returned' } });
assert.deepEqual(update, [{ field: 'status', label: 'الحالة', from: 'طلب شحن', to: 'مرتجع' }]);

// A creation drops the bookkeeping columns and has no "before".
const insert = auditChanges('INSERT', { id: 'x', store_id: 's1', created_at: '2026-08-18', total: 207 });
assert.deepEqual(insert.map(change => change.field), ['total']);
assert.equal(insert[0].from, null);

// The headline names a status move, because that is what the log is scanned for.
assert.equal(auditSummary('INSERT', insert, 'طلباً'), 'أنشأ طلباً');
assert.equal(auditSummary('DELETE', insert, 'طلباً'), 'حذف طلباً');
// The reason rides along with the status rather than being counted as another
// field, because it is part of the same sentence.
assert.equal(
  auditSummary('UPDATE', auditChanges('UPDATE', {
    status: { from: 'new', to: 'canceled' },
    status_reason: { from: '', to: 'العميل ألغى' },
  })),
  'غيّر الحالة من طلب شحن إلى ملغي',
);
assert.equal(
  auditSummary('UPDATE', auditChanges('UPDATE', { notes: { from: '', to: 'x' }, total: { from: 1, to: 2 } })),
  'عدّل الملاحظات، الإجمالي',
);
assert.equal(auditSummary('UPDATE', [], 'الطلب'), 'لا تفاصيل حقول');

// Editing a quantity leaves the number of lines identical, so a count reported
// a real change as no change: "1 عنصر ← 1 عنصر". The lines carry their
// quantities now, and the diff reads.
const oneAt = (quantity: number) => [{ productName: 'فستان احمر', size: '', quantity, price: 195 }];
assert.equal(auditValue('items', oneAt(1)), 'فستان احمر ×1');
assert.notEqual(auditValue('items', oneAt(1)), auditValue('items', oneAt(2)));

// Size separates two lines of the same product that would otherwise look equal.
assert.equal(auditValue('items', [{ productName: 'قميص', size: 'L', quantity: 3 }]), 'قميص (L) ×3');

// A long order stays a readable cell, and an emptied one is not "0 عنصر".
assert.equal(auditValue('items', []), '—');
assert.match(
  auditValue('items', Array.from({ length: 6 }, () => ({ productName: 'ص', quantity: 1 }))),
  /و2 أخرى$/,
);

// A malformed line prints rather than crashing the log.
assert.equal(auditValue('items', [{ quantity: 'x' }]), 'صنف ×؟');

// The change list is what the drawer actually renders, so pin it end to end.
const qtyEdit = auditChanges('UPDATE', { items: { from: oneAt(1), to: oneAt(2) } });
assert.equal(qtyEdit[0].label, 'المنتجات');
assert.equal(qtyEdit[0].from, 'فستان احمر ×1');
assert.equal(qtyEdit[0].to, 'فستان احمر ×2');

// --- filtering and paging the log ---

const logRow = (
  action: string,
  actorId: string | null,
  data: Record<string, unknown> | null,
) => ({ action, actorId, data });

const statusRow = logRow('UPDATE', 'amal', { status: { from: 'new', to: 'confirmed' } });
const repRow = logRow('UPDATE', 'sami', { agent_id: { from: null, to: 'r1' } });
const madeRow = logRow('INSERT', 'amal', { id: 'x', store_id: 's', total: 100, status: 'new' });
const log = [statusRow, repRow, madeRow];

// A blank filter narrows nothing.
assert.equal(log.filter(row => matchesAudit(row, emptyAuditFilter)).length, 3);
assert.equal(isAuditFiltered(emptyAuditFilter), false);
assert.equal(isAuditFiltered({ ...emptyAuditFilter, field: 'status' }), true);

// Each axis narrows on its own...
assert.deepEqual(log.filter(row => matchesAudit(row, { ...emptyAuditFilter, action: 'INSERT' })), [madeRow]);
assert.deepEqual(log.filter(row => matchesAudit(row, { ...emptyAuditFilter, actor: 'sami' })), [repRow]);
// ...and `status` matches both the update that changed it and the row that created it.
assert.deepEqual(
  log.filter(row => matchesAudit(row, { ...emptyAuditFilter, field: 'status' })),
  [statusRow, madeRow],
);

// ...and together they intersect rather than accumulate.
assert.deepEqual(
  log.filter(row => matchesAudit(row, { action: 'UPDATE', field: 'status', actor: 'amal' })),
  [statusRow],
);
assert.deepEqual(
  log.filter(row => matchesAudit(row, { action: 'INSERT', field: 'status', actor: 'sami' })),
  [],
);

// Bookkeeping columns are not offered as filters on a creation row, but the
// real ones are — the filter list and the rendered diff read the same source.
assert.equal(auditFields('INSERT', madeRow.data).includes('store_id'), false);
assert.equal(auditFields('INSERT', madeRow.data).includes('total'), true);
assert.deepEqual(auditFields('UPDATE', statusRow.data), ['status']);
assert.deepEqual(auditFields('UPDATE', null), []);

// An unattributed row is reachable: the system actor filters as the empty id.
assert.equal(matchesAudit(logRow('UPDATE', null, {}), { ...emptyAuditFilter, actor: '' }), true);

// Paging grows 20 → 70 → 170 → 370, then 200 at a time, and never goes backwards.
assert.equal(nextAuditPage(20), 70);
assert.equal(nextAuditPage(70), 170);
assert.equal(nextAuditPage(170), 370);
assert.equal(nextAuditPage(370), 570);
assert.equal(nextAuditPage(570), 770);
// A count between steps still advances to the next step rather than stalling.
assert.equal(nextAuditPage(45), 70);

console.log('auditText.ts: all checks passed');
