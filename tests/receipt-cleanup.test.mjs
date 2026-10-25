import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryReceipts } from '../scripts/receipt-cleanup.mjs';

function stores(values) {
  const reads = [], writes = [];
  return {
    reads, writes,
    store({ name }) {
      assert.ok(['ercupsa-registrations', 'ercupsa-registration-receipts'].includes(name), 'photo/ticket store must never be opened');
      return {
        async *list({ prefix = '' }) {
          reads.push(['list', name, prefix]);
          const blobs = Object.keys(values[name] || {}).filter(key => key.startsWith(prefix)).map(key => ({ key }));
          yield { blobs: blobs.slice(0, 1) };
          yield { blobs: blobs.slice(1) };
        },
        async get(key) { reads.push(['get', name, key]); assert.equal(name, 'ercupsa-registrations', 'receipt bytes must never be downloaded'); return values[name][key]; },
        async set() { writes.push('set'); throw Error('Mutation forbidden'); },
        async setJSON() { writes.push('setJSON'); throw Error('Mutation forbidden'); },
        async delete() { writes.push('delete'); throw Error('Mutation forbidden'); },
      };
    },
  };
}

test('receipt inventory reads canonical and legacy references across pages without downloading files or modifying records', async () => {
  const fixture = stores({
    'ercupsa-registrations': {
      'state/event-one.json': { entries: [{ name: 'Private Person', receipt: { key: 'receipt-active' }, photos: { portrait: { key: 'photo-must-stay' } } }], deleted: [{ receiptKey: 'receipt-deleted' }] },
      'entries/event-one/legacy.json': { receipt: { key: 'receipt-superseded' } },
      'entries/event-two/legacy.json': { receipt: { key: 'receipt-missing' } },
    },
    'ercupsa-registration-receipts': { 'receipt-active': 'privatebytes', 'receipt-deleted': 'privatebytes', 'receipt-superseded': 'privatebytes', orphan: 'privatebytes' },
  });
  const report = await inventoryReceipts({ store: fixture.store, now: () => new Date('2026-10-25T12:00:00Z') });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.receiptFiles, 4);
  assert.equal(report.referencedFiles, 3);
  assert.equal(report.orphanedFiles, 1);
  assert.equal(report.missingReferencedFiles, 1);
  assert.equal(report.activeRegistrationReferences, 2);
  assert.equal(report.deletedRecordReferences, 1);
  assert.equal(report.supersededLegacyReferences, 1);
  assert.equal(report.changedFiles, 0);
  assert.deepEqual(fixture.writes, []);
  assert.ok(!JSON.stringify(report).includes('Private Person'));
  assert.ok(!JSON.stringify(report).includes('receipt-active'));
  assert.ok(!fixture.reads.some(row => row.includes('photo-must-stay')));
});

test('malformed state aborts rather than reporting an incomplete cleanup inventory', async () => {
  const fixture = stores({ 'ercupsa-registrations': { 'state/event-one.json': { entries: null } } });
  await assert.rejects(inventoryReceipts({ store: fixture.store }), /eksik envanterle/);
  assert.deepEqual(fixture.writes, []);
});
