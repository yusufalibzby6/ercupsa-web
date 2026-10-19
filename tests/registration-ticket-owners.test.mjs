import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readRegistrationTicketOwners } from '../netlify/lib/registration-ticket-owners.mjs';

const eventId = 'event-one', key = `state/${eventId}.json`, prefix = `entries/${eventId}/`;
const code = 'ERC-' + '1'.repeat(24);
const entry = (overrides = {}) => ({ id: 'entry-one', eventId, name: 'Elif Daş', classYear: '3. Sınıf',
  createdAt: '2026-10-07T10:00:00.000Z', phone: 'private-phone', email: 'private-email',
  answers: { confidential: 'private-answer' }, receipt: { key: 'private-receipt' },
  ticket: { batchId: 'batch-one', code, status: 'issued', reservedAt: '2026-10-07T10:00:00.000Z' }, ...overrides });
const state = entries => ({ version: 1, eventId, entries, deleted: [] });
function memory(records) {
  return { records: new Map(records), reads: [], lists: 0,
    async get(key, options) { this.reads.push({ key, options }); return structuredClone(this.records.get(key) ?? null); },
    async list({ prefix }) { this.lists++; return { blobs: [...this.records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; } };
}

test('form ticket owners return only live minimal private projections and strong reads', async () => {
  const deleted = entry({ id: 'entry-deleted', ticket: { batchId: 'batch-deleted', code: 'ERC-' + '2'.repeat(24), status: 'issued' } });
  const store = memory([[key, { ...state([entry(), entry({ id: 'no-ticket', ticket: undefined }), deleted]), deleted: [{ id: deleted.id }] }],
    [`${prefix}legacy-copy.json`, entry({ id: 'legacy-copy' })]]);
  const people = await readRegistrationTicketOwners(eventId, { store });
  assert.deepEqual(people, [{ id: 'entry-one', name: 'Elif Daş', classYear: '3. Sınıf', createdAt: '2026-10-07T10:00:00.000Z',
    batchId: 'batch-one', codeHash: createHash('sha256').update(code).digest('hex') }]);
  assert.equal(store.lists, 0);
  assert.deepEqual(store.reads, [{ key, options: { type: 'json', consistency: 'strong' } }]);
  for (const secret of [code, 'private-phone', 'private-email', 'private-answer', 'private-receipt']) assert.equal(JSON.stringify(people).includes(secret), false);
});

test('pending durable reservations are projected for consumers to verify against a committed database ticket', async () => {
  const person = entry({ classYear: undefined, ticket: { batchId: 'batch-one', code, status: 'pending' } });
  const store = memory([[key, state([person])]]);
  const owners = await readRegistrationTicketOwners(eventId, { store });
  assert.equal(owners.length, 1); assert.equal(owners[0].classYear, '');
  assert.equal(owners[0].codeHash, createHash('sha256').update(code).digest('hex'));
});

test('legacy entries are read once, then a newly established authoritative state wins over stale copies', async () => {
  const store = memory([[`${prefix}entry-one.json`, entry()]]), get = store.get.bind(store);
  store.get = async (entryKey, options) => {
    const value = await get(entryKey, options);
    if (entryKey.startsWith(prefix)) store.records.set(key, { ...state([]), deleted: [{ id: 'entry-one' }] });
    return value;
  };
  assert.deepEqual(await readRegistrationTicketOwners(eventId, { store }), []);
  assert.equal(store.reads.filter(read => read.key === key).length, 2);
  assert.ok(store.reads.every(read => read.options.consistency === 'strong'));
  const legacy = memory([[`${prefix}entry-one.json`, entry()]]);
  assert.equal((await readRegistrationTicketOwners(eventId, { store: legacy }))[0].name, 'Elif Daş');
});

test('corrupt owner ledgers and reservations fail closed rather than identifying the wrong person', async () => {
  const cases = [
    { ...state([]), version: 2 }, { ...state([]), eventId: 'another-event' }, { ...state([]), deleted: null },
    state([entry({ eventId: 'another-event' })]), state([entry({ id: 'bad,id' })]),
    state([entry({ name: '' })]), state([entry({ name: 'unsafe\u0000name' })]),
    state([entry({ createdAt: 'invalid' })]), state([entry({ classYear: { wrong: true } })]),
    state([entry({ ticket: { batchId: 'bad,id', code, status: 'issued' } })]),
    state([entry({ ticket: { batchId: 'batch-one', code: 'bad', status: 'issued' } })]),
    state([entry({ ticket: { batchId: 'batch-one', code, status: 'unknown' } })]),
    state([entry(), entry()]), state([entry(), entry({ id: 'another-entry' })]),
    { ...state([]), deleted: [{ id: 'bad,id' }] },
  ];
  for (const corrupt of cases) await assert.rejects(readRegistrationTicketOwners(eventId, { store: memory([[key, corrupt]]) }), error => error.status === 503);
  const wrongLegacyKey = memory([[`${prefix}wrong-id.json`, entry()]]);
  await assert.rejects(readRegistrationTicketOwners(eventId, { store: wrongLegacyKey }), error => error.status === 503);
});
