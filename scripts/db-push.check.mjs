// Run with: node scripts/db-push.check.mjs
//
// The push itself cannot be rehearsed, but the decision of WHAT to push can:
// skipping a version already applied, and running the rest oldest first. Get
// that wrong and a migration is either replayed or silently never run.
import assert from 'node:assert/strict';
import { pendingMigrations } from './db-push.mjs';

const files = [
  '20260828000000_order_delivery_date.sql',
  '20260801000000_initial_schema.sql',
  '20260827000000_order_status_stock.sql',
  'README.md',
];

const pending = pendingMigrations(files, new Set(['20260801000000']));

assert.deepEqual(pending.map((m) => m.version), ['20260827000000', '20260828000000']);
assert.equal(pending[0].name, 'order_status_stock');
assert.deepEqual(pendingMigrations(files, new Set(['20260801000000', '20260827000000', '20260828000000'])), []);

console.log('db-push checks passed');
