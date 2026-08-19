// Run with: npx tsx src/lib/auditText.check.ts
import assert from 'node:assert/strict';
import { auditChanges, auditSummary, auditValue, fieldLabel } from './auditText';

// Column names become Arabic; an unknown one is printed rather than hidden.
assert.equal(fieldLabel('delivery_fee'), 'التوصيل');
assert.equal(fieldLabel('mystery_column'), 'mystery_column');

// Values read as values: money formatted, dates localized, blanks marked.
assert.equal(auditValue('total', 207), '207 د.ل');
assert.equal(auditValue('total', '207'), '207 د.ل');
assert.equal(auditValue('notes', ''), '—');
assert.equal(auditValue('active', false), 'لا');
assert.equal(auditValue('items', [1, 2, 3]), '3 عنصر');
assert.match(auditValue('delivery_date', '2026-08-19'), /2026/);
// A page that knows the names lends them.
assert.equal(auditValue('agent_id', 'a1', (field, value) => (field === 'agent_id' && value === 'a1' ? 'علي' : undefined)), 'علي');

// An update carries both sides of every field it touched.
const update = auditChanges('UPDATE', { status: { from: 'new', to: 'returned' } });
assert.deepEqual(update, [{ field: 'status', label: 'الحالة', from: 'جديد', to: 'مرتجع' }]);

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
  'غيّر الحالة من جديد إلى ملغي',
);
assert.equal(
  auditSummary('UPDATE', auditChanges('UPDATE', { notes: { from: '', to: 'x' }, total: { from: 1, to: 2 } })),
  'عدّل الملاحظات، الإجمالي',
);
assert.equal(auditSummary('UPDATE', [], 'الطلب'), 'لا تفاصيل حقول');

console.log('auditText.ts: all checks passed');
