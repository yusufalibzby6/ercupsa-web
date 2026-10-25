import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readStatistics, readYearbookStatistics, statisticsFilters, trackingKey } from '../netlify/lib/statistics.mjs';
import { appendAudit, auditOperation, projectAuditOperation } from '../netlify/lib/event-audit.mjs';
import { createStatisticsHandler } from '../netlify/functions/statistics.mjs';
import { createEventAuditHandler } from '../netlify/functions/event-audit.mjs';
import { adminLogin, signedAdminCookie } from '../netlify/lib/security.mjs';
import { operationHistory } from '../netlify/lib/event-state.mjs';

const oldPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = 'statistics-synthetic-password';
after(() => { if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = oldPassword; });
const origin = 'https://site.test';
const now = () => new Date('2026-10-25T12:00:00.000Z');
const at = '2026-10-24T12:00:00.000Z';
const actor = { id: 'owner', username: 'basadmin', password: 'PRIVATE_PASSWORD', phone: 'PRIVATE_PHONE' };
const event = (id = 'one') => ({ id, title: `Etkinlik ${id}`, category: 'Konferans', date: '2026-10-22', time: '18:00', location: 'Salon', description: '', registrationUrl: '', poster: '', images: [], published: true });
const code = n => `ERC-${String(n).padStart(24, 'A')}`;
const hash = n => createHash('sha256').update(code(n)).digest('hex');
const row = (id, extra = {}) => ({ id, eventId: 'one', name: 'PRIVATE_PARTICIPANT', phone: 'PRIVATE_PHONE', ...extra });
function memory() {
  const data = new Map(), calls = [], hook = { beforeSet: null }; let revision = 0;
  return { data, calls, hook,
    seed(key, value) { data.set(key, { data: structuredClone(value), etag: String(++revision) }); },
    async get(key) { calls.push(['get', key]); return structuredClone(data.get(key)?.data ?? null); },
    async getWithMetadata(key) { calls.push(['metadata', key]); return structuredClone(data.get(key) ?? null); },
    async list({ prefix }) { calls.push(['list', prefix]); return { blobs: [...data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async setJSON(key, value, options = {}) {
      calls.push(['write', key]); await hook.beforeSet?.(key, value);
      const old = data.get(key);
      if (options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch !== old?.etag) return { modified: false };
      data.set(key, { data: structuredClone(value), etag: String(++revision) }); return { modified: true };
    } };
}
function fixture(catalog = [event()]) {
  const content = memory(), registrations = memory(), operations = memory(), admins = memory(), reads = [];
  if (catalog !== null) content.seed('events.json', catalog);
  const stores = { 'ercupsa-content': content, 'ercupsa-registrations': registrations, 'ercupsa-operations': operations };
  const getStore = name => { assert.ok(stores[name], `Unexpected store ${name}`); return stores[name]; };
  const state = { tickets: [] };
  const read = async query => {
    reads.push(query); assert.match(query, /^tickets\?/); assert.doesNotMatch(query, /attendance|profiles|email|name/);
    // The pagination helper performs a final empty request using an id cursor.
    if (query.includes('&and=')) return [];
    const ids = query.match(/id=in\.\(([^)]+)\)/)?.[1].split(',') || [];
    return state.tickets.filter(ticket => ids.includes(ticket.id));
  };
  const stats = createStatisticsHandler({ getStore, read, now, adminStore: () => admins });
  const audit = createEventAuditHandler({ getStore, adminStore: () => admins });
  const owner = () => adminLogin(new Request(origin, { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
  const delegate = permissions => {
    const account = { id: 'delegate', username: 'delegate', name: 'Yetkili', active: true, role: 'admin', version: 'one', salt: 'a'.repeat(32), passwordHash: 'b'.repeat(64), permissions };
    admins.seed('accounts/state.json', { revision: 'one', accounts: [account] });
    return signedAdminCookie(new Request(origin), account).split(';')[0];
  };
  const request = async (handler, path, { method = 'GET', input, cookie = owner(), requestOrigin = origin } = {}) => {
    const result = await handler(new Request(origin + path, { method, headers: { Cookie: cookie, Origin: requestOrigin, ...(input ? { 'content-type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) }));
    return { status: result.status, data: await result.json() };
  };
  return { content, registrations, operations, admins, state, reads, getStore, read, stats, audit, delegate, request };
}
function seedApplications(f) {
  f.registrations.seed('state/one.json', { version: 1, eventId: 'one', form: { enabled: true, maxRegistrations: 4 }, deleted: [], entries: [
    row('main-one', { ticket: { status: 'issued', batchId: 'batch-one', code: code(1) } }),
    row('main-two', { registrationStatus: 'main' }),
    row('wait-one', { registrationStatus: 'waitlisted', sequence: 3 }),
    row('cancel-one', { registrationStatus: 'cancelled', ticket: { status: 'revoked', batchId: 'batch-one', code: code(2) } }),
  ] });
}

test('statistics preserve unknown historical coverage and never turn starter events into verified activity', async () => {
  const empty = fixture(null), report = await readStatistics({ getStore: empty.getStore, read: empty.read, now });
  assert.equal(report.summary.eventCount, 0); assert.equal(report.events.length, 0); assert.equal(empty.reads.length, 0);
  const legacy = fixture(), unknown = await readStatistics({ getStore: legacy.getStore, read: legacy.read, now });
  assert.equal(unknown.events[0].applications, null); assert.equal(unknown.events[0].entered, null); assert.equal(unknown.events[0].noShows, null);
  assert.equal(unknown.summary.applications, null); assert.equal(unknown.summary.coverage.eventsWithEntryData, 0);
  assert.equal([...legacy.registrations.data.keys()].length, 0, 'read must not migrate legacy storage');
});

test('registration, QR/manual entrance, and historical cancelled tickets remain distinct', async () => {
  const f = fixture(); seedApplications(f);
  f.operations.seed('checkins/events/one.json', { entries: [
    { ticketId: 'ticket-one', method: 'qr', enteredAt: at },
    { ticketId: 'ticket-cancelled', method: 'qr', enteredAt: at },
    { ticketId: 'ticket-manual', method: 'manual', enteredAt: at },
  ] });
  f.state.tickets = [
    { id: 'ticket-one', event_id: 'one', batch_id: 'batch-one', code_hash: hash(1) },
    { id: 'ticket-cancelled', event_id: 'one', batch_id: 'batch-one', code_hash: hash(2) },
    { id: 'ticket-manual', event_id: 'one', batch_id: 'manual-batch', code_hash: hash(3) },
  ];
  const report = await readStatistics({ getStore: f.getStore, read: f.read, now }), value = report.events[0];
  assert.deepEqual([value.applications, value.main, value.waitlisted, value.cancelled], [4, 2, 1, 1]);
  assert.deepEqual([value.entered, value.qrEntered, value.manualEntered, value.registeredEntered], [3, 2, 1, 1]);
  assert.equal(value.noShows, null); assert.equal(value.occupancy, 50);
  f.operations.seed(trackingKey('one'), { revision: 'complete-one', trackingComplete: true, completedAt: at });
  const complete = await readStatistics({ getStore: f.getStore, read: f.read, now });
  assert.equal(complete.events[0].noShows, 1); assert.equal(complete.summary.entered, 3);
  for (const secret of ['PRIVATE_PARTICIPANT', 'PRIVATE_PHONE', code(1), hash(1)]) assert.ok(!JSON.stringify(complete).includes(secret));
});

test('no-shows remain unknown before an event starts even with a completed old tracking flag', async () => {
  const f = fixture([{ ...event(), date: '2027-06-01' }]); seedApplications(f);
  f.operations.seed(trackingKey('one'), { revision: 'complete-one', trackingComplete: true });
  const report = await readStatistics({ getStore: f.getStore, read: f.read, now });
  assert.equal(report.events[0].entered, 0); assert.equal(report.events[0].noShows, null);
});

test('statistics filters validate real dates and yearbooks receive only verified public aggregates', async () => {
  for (const query of ['from=2026-02-30', 'from=2026-12-01&to=2026-01-01', 'eventId=../private']) assert.throws(() => statisticsFilters(new URLSearchParams(query)));
  const f = fixture([event(), { ...event('two'), date: '2026-09-01' }]); seedApplications(f);
  const selected = await readStatistics({ getStore: f.getStore, read: f.read, now, filters: statisticsFilters(new URLSearchParams('from=2026-10-01&to=2026-10-31')) });
  assert.equal(selected.summary.eventCount, 1);
  const yearbook = await readYearbookStatistics(['one'], { getStore: f.getStore, read: f.read, now });
  assert.equal(yearbook.eventCount, 1); assert.equal(yearbook.applications, 4); assert.equal(yearbook.entered, null);
  assert.ok(!Object.hasOwn(yearbook, 'noShows')); assert.ok(!Object.hasOwn(yearbook, 'events'));
  await assert.rejects(readYearbookStatistics(['missing'], { getStore: f.getStore, read: f.read, now }), error => error.status === 409);
});

test('duplicate or future entry ledgers fail instead of inflating participation', async () => {
  for (const entries of [[{ ticketId: 'one', method: 'qr', enteredAt: at }, { ticketId: 'one', method: 'qr', enteredAt: at }],
    [{ ticketId: 'one', method: 'qr', enteredAt: '2030-01-01T12:00:00Z' }], [{ ticketId: 'one', method: 'unknown', enteredAt: at }]]) {
    const f = fixture(); seedApplications(f); f.operations.seed('checkins/events/one.json', { entries });
    await assert.rejects(readStatistics({ getStore: f.getStore, read: f.read, now }), error => error.status === 503);
  }
});

test('reports and audit require their explicit permissions before reading participant storage', async () => {
  const f = fixture();
  for (const cookie of ['', 'ercupsa_admin=9999999999999.invalid', 'ercupsa_gate=staff']) {
    assert.equal((await f.request(f.stats, '/api/statistics', { cookie })).status, 401);
    assert.equal((await f.request(f.audit, '/api/event-audit', { cookie })).status, 401);
  }
  const cookie = f.delegate(['events.view', 'events.manage']);
  assert.equal((await f.request(f.stats, '/api/statistics', { cookie })).status, 403);
  assert.equal((await f.request(f.audit, '/api/event-audit', { cookie })).status, 403);
  assert.equal(f.content.calls.length, 0); assert.equal(f.registrations.calls.length, 0); assert.equal(f.operations.calls.length, 0);
  const reader = f.delegate(['statistics.view']);
  assert.equal((await f.request(f.stats, '/api/statistics', { cookie: reader })).status, 200);
  assert.equal((await f.request(f.stats, '/api/statistics?action=complete', { method: 'POST', cookie: reader, input: { eventId: 'one', trackingComplete: true, expectedRevision: '' } })).status, 403);
});

test('tracking completion uses CAS, audit and explicit entrance-manage permission', async () => {
  const f = fixture(); seedApplications(f);
  const first = await f.request(f.stats, '/api/statistics?action=complete', { method: 'POST', input: { eventId: 'one', trackingComplete: true, expectedRevision: '' } });
  assert.equal(first.status, 200); const revision = first.data.tracking.revision;
  const saved = f.operations.data.get(trackingKey('one')).data;
  assert.equal(saved.audit.length, 1); assert.equal(saved.audit[0].actor.username, 'basadmin');
  assert.deepEqual(saved.audit[0].after, { trackingComplete: true });
  const conflict = await f.request(f.stats, '/api/statistics?action=complete', { method: 'POST', input: { eventId: 'one', trackingComplete: false, expectedRevision: '' } });
  assert.equal(conflict.status, 409);
  const duplicate = await f.request(f.stats, '/api/statistics?action=complete', { method: 'POST', input: { eventId: 'one', trackingComplete: true, expectedRevision: '' } });
  assert.equal(duplicate.status, 200); assert.equal(f.operations.data.get(trackingKey('one')).data.audit.length, 1);
  const results = await Promise.all([true, false].map(value => f.request(f.stats, '/api/statistics?action=complete', { method: 'POST', input: { eventId: 'one', trackingComplete: value, expectedRevision: revision } })));
  assert.ok(results.every(result => [200, 409].includes(result.status)));
  const concurrent = fixture();
  const simultaneous = await Promise.all([1, 2].map(() => concurrent.request(concurrent.stats, '/api/statistics?action=complete', { method: 'POST', input: { eventId: 'one', trackingComplete: true, expectedRevision: '' } })));
  assert.deepEqual(simultaneous.map(result => result.status), [200, 200]);
  assert.equal(concurrent.operations.data.get(trackingKey('one')).data.audit.length, 1);
  assert.equal(concurrent.operations.data.get(trackingKey('one')).data.trackingComplete, true);
  const future = fixture([{ ...event(), date: '2027-06-01' }]);
  assert.equal((await future.request(future.stats, '/api/statistics?action=complete', { method: 'POST', input: { eventId: 'one', trackingComplete: true, expectedRevision: '' } })).status, 409);
  assert.equal((await f.request(f.stats, '/api/statistics?action=complete', { method: 'POST', requestOrigin: 'https://attacker.test', input: { eventId: 'one', trackingComplete: false, expectedRevision: revision } })).status, 403);
});

test('safe audit projection retains actor and changes without participant or ticket secrets', () => {
  const operation = auditOperation({ id: 'operation-one', type: 'capacity.change', at, actor, eventId: 'one', relatedId: 'registration-one',
    before: { maxRegistrations: 20, phone: 'PRIVATE_PHONE', name: 'PRIVATE_PARTICIPANT' },
    after: { maxRegistrations: 30, enabled: true, ticket: code(1), receipt: 'PRIVATE_RECEIPT' } });
  assert.deepEqual(operation.actor, { id: 'owner', username: 'basadmin' });
  assert.deepEqual(operation.before, { maxRegistrations: 20 }); assert.deepEqual(operation.after, { maxRegistrations: 30, enabled: true });
  const state = {}; appendAudit(state, operation); appendAudit(state, operation); assert.equal(state.audit.length, 1);
  assert.ok(!JSON.stringify(state).includes('PRIVATE'));
  assert.equal(projectAuditOperation({ type: 'update', at: 'invalid' }, 'one'), null);
  assert.deepEqual(projectAuditOperation({ type: 'update', at }, 'one'), projectAuditOperation({ type: 'update', at }, 'one'));
});

test('event history preserves earlier operations beyond the former twenty-operation window', () => {
  let state = {};
  for (let index = 0; index < 35; index++) state = { operations: operationHistory(state, 'update', at, actor, `operation-${index}`) };
  assert.equal(state.operations.length, 35); assert.equal(state.operations[0].id, 'operation-0');
  assert.equal(state.operations.at(-1).id, 'operation-34'); assert.ok(!JSON.stringify(state).includes('PRIVATE'));
});

test('event audit combines existing event and registration history, safely filters Turkey dates and paginates', async () => {
  const eventOperation = { id: 'created-one', type: 'create', at, actor };
  const f = fixture([{ ...event(), operations: [eventOperation] }]); seedApplications(f);
  const state = f.registrations.data.get('state/one.json').data;
  state.audit = Array.from({ length: 55 }, (_, index) => ({ id: `audit-${index}`, type: 'registration.promote', at: '2026-10-24T21:30:00.000Z', eventId: 'one', actor,
    before: { status: 'waitlisted', phone: 'PRIVATE_PHONE' }, after: { status: 'main', name: 'PRIVATE_PARTICIPANT' } }));
  const first = await f.request(f.audit, '/api/event-audit?from=2026-10-25&to=2026-10-25');
  assert.equal(first.status, 200); assert.equal(first.data.total, 55); assert.equal(first.data.operations.length, 50); assert.equal(first.data.totalPages, 2);
  assert.ok(!JSON.stringify(first.data).includes('PRIVATE'));
  const second = await f.request(f.audit, '/api/event-audit?from=2026-10-25&to=2026-10-25&page=2');
  assert.equal(second.data.operations.length, 5);
  const created = await f.request(f.audit, '/api/event-audit?type=create'); assert.equal(created.data.total, 1);
  assert.equal(created.data.operations[0].id, 'created-one');
  assert.equal((await f.request(f.audit, '/api/event-audit?page=NaN')).status, 400);
  assert.equal((await f.request(f.audit, '/api/event-audit', { method: 'POST', input: {} })).status, 405);
});
