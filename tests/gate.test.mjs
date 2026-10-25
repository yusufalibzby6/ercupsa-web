import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createGateHandler } from '../netlify/functions/gate.mjs';
import { createStaffHandler } from '../netlify/functions/staff.mjs';
import { adminLogin, signedAdminCookie } from '../netlify/lib/security.mjs';

import { ADMIN_ACCOUNTS_KEY, normalizedPermissions, passwordRecord } from '../netlify/lib/admin-auth.mjs';

const oldPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = 'gate-unit-admin-only-password';
after(() => {
  if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = oldPassword;
});
const origin = 'https://site.test';
const adminCookie = adminLogin(new Request(origin, { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const claimedId = '10000000-0000-4000-8000-000000000001';
const unclaimedId = '10000000-0000-4000-8000-000000000002';
const wrongId = '10000000-0000-4000-8000-000000000003';
const revokedId = '10000000-0000-4000-8000-000000000004';
const claimedCode = 'ERC-000000000000000000000001';
const unclaimedCode = 'ERC-000000000000000000000002';
const wrongCode = 'ERC-000000000000000000000003';
const revokedCode = 'ERC-000000000000000000000004';
const hash = code => createHash('sha256').update(code).digest('hex');
const entryKey = eventId => `checkins/events/${eventId}.json`;

function memory() {
  const records = new Map(), calls = [], hooks = {};
  let revision = 0;
  return {
    records, calls, hooks,
    async get(key) {
      calls.push({ action: 'get', key });
      await hooks.read?.(key);
      return structuredClone(records.get(key)?.data || null);
    },
    async getWithMetadata(key) {
      calls.push({ action: 'getWithMetadata', key });
      await hooks.read?.(key);
      const record = structuredClone(records.get(key) || null);
      return hooks.metadata ? hooks.metadata(key, record) : record;
    },
    async list({ prefix }) {
      calls.push({ action: 'list', prefix });
      return { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) };
    },
    async setJSON(key, data, options = {}) {
      calls.push({ action: 'setJSON', key, options });
      await hooks.beforeSet?.(key, data);
      const existing = records.get(key);
      if (options.onlyIfNew && existing || options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: String(++revision) });
      await hooks.afterSet?.(key, data);
      return { modified: true };
    },
  };
}

function fixture({ cap = 500 } = {}) {
  const storage = memory(), adminStorage = memory(), registrationStorage = memory();
  const state = {
    now: new Date(), failRead: false, failEvents: false, reads: [],
    events: [{ id: 'event-one', title: 'Birinci etkinlik', date: '2026-10-07', time: '18:00', location: 'Fakülte' },
      { id: 'event-two', title: 'İkinci etkinlik', date: '2026-10-08', time: '19:00', location: 'Salon' }],
    tickets: [
      { id: claimedId, event_id: 'event-one', batch_id: 'claimed-batch', code_hash: hash(claimedCode), claimed_by: alice, revoked: false },
      { id: unclaimedId, event_id: 'event-one', batch_id: 'unclaimed-batch', code_hash: hash(unclaimedCode), claimed_by: null, revoked: false },
      { id: wrongId, event_id: 'event-two', batch_id: 'wrong-batch', code_hash: hash(wrongCode), claimed_by: null, revoked: false },
      { id: revokedId, event_id: 'event-one', batch_id: 'revoked-batch', code_hash: hash(revokedCode), claimed_by: null, revoked: true },
    ],
    attendance: [{ user_id: alice, event_id: 'event-one', ticket_id: claimedId, created_at: '2026-10-07T10:00:00Z' }],
    profiles: [{ id: alice, name: 'Ada' }, { id: bob, name: 'Bora' }],
  };
  const events = async () => { if (state.failEvents) throw Error('private events failure'); return structuredClone(state.events); };
  const read = async path => {
    state.reads.push(path);
    if (state.failRead) throw Error('private database credentials and failure details');
    const url = new URL('https://database.test/' + path);
    let rows = structuredClone(state[url.pathname.slice(1)] || []);
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith('in.(')) { const values = value.slice(4, -1).split(','); rows = rows.filter(row => values.includes(String(row[key]))); }
      if (value.startsWith('lte.')) rows = rows.filter(row => Date.parse(row[key]) <= Date.parse(value.slice(4)));
    }
    const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map(value => value.split('.')[0]);
    rows.sort((a, b) => { for (const key of order) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; } return 0; });
    const cursor = url.searchParams.get('and')?.match(/^\(([a-z_]+)\.gt\.([^)]+)\)$/);
    if (cursor) rows = rows.filter(row => row[cursor[1]] > cursor[2]);
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || cap);
    return rows.slice(offset, offset + Math.min(cap, limit));
  };
  const handler = createGateHandler({ read, events, store: () => storage, now: () => new Date(state.now), adminGetStore: () => adminStorage, registrationStore: registrationStorage });
  const staffHandler = createStaffHandler({ events, store: () => storage, now: () => new Date(state.now), uuid: randomUUID, adminGetStore: () => adminStorage });
  const request = async (action = 'participants', { method = 'GET', eventId = 'event-one', input,
    auth = true, cookie, headers = {}, rawBody } = {}) => {
    const url = new URL(origin + '/api/gate');
    url.searchParams.set('action', action);
    if (eventId !== null) url.searchParams.set('eventId', eventId);
    return handler(new Request(url, { method,
      headers: { Origin: origin, ...(cookie ? { cookie } : auth ? { cookie: adminCookie } : {}),
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(method !== 'GET' ? { body: input !== undefined ? JSON.stringify(input) : rawBody } : {}) }));
  };
  const scan = (code = claimedCode, options = {}) => request('scan', { method: 'POST', ...options,
    input: { eventId: options.eventId || 'event-one', code } });
  const manual = (userId = alice, options = {}) => request('manual', { method: 'POST', ...options,
    input: { eventId: options.eventId || 'event-one', userId } });
  const staffCookie = async () => {
    const credentials = { username: 'door-worker', password: 'synthetic-door-password', name: 'Görevli', eventIds: ['event-one'] };
    const created = await staffHandler(new Request(origin + '/api/staff?action=accounts', { method: 'POST',
      headers: { cookie: adminCookie, 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(credentials) }));
    assert.equal(created.status, 201);
    const logged = await staffHandler(new Request(origin + '/api/staff?action=login', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(credentials) }));
    assert.equal(logged.status, 200);
    return logged.headers.get('set-cookie').split(';')[0];
  };
  const delegatedCookie = async permissions => {
    const account = { id: 'delegated-admin', username: 'other-admin', name: 'Diğer yönetici', role: 'admin', active: true,
      version: randomUUID(), permissions: normalizedPermissions(permissions), ...passwordRecord('synthetic-other-admin-password') };
    await adminStorage.setJSON(ADMIN_ACCOUNTS_KEY, { revision: 'test-revision', accounts: [account] });
    return signedAdminCookie(new Request(origin), account, state.now).split(';')[0];
  };
  const staff = (method, cookie) => staffHandler(new Request(origin + '/api/staff?action=accounts&id=some-account', { method,
    headers: { cookie, Origin: origin, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ username: 'door-worker', password: 'synthetic-door-password', name: 'Görevli', eventIds: ['event-one'] }) } : {}) }));
  const session = cookie => staffHandler(new Request(origin + '/api/staff?action=session', { headers: { cookie } }));
  const formEntry = (overrides = {}) => ({ id: 'form-entry-one', eventId: 'event-one', name: 'Elif Form Sahibi', classYear: '3. Sınıf',
    createdAt: '2026-10-07T12:00:00Z', phone: 'private-phone', answers: { confidential: 'private-answer' },
    receipt: { key: 'private-receipt' }, ticket: { batchId: 'unclaimed-batch', code: unclaimedCode, status: 'issued' }, ...overrides });
  const saveForm = (entries, deleted = []) => registrationStorage.setJSON('state/event-one.json', { version: 1, eventId: 'event-one', entries, deleted });
  return { storage, adminStorage, registrationStorage, formEntry, saveForm, state, request, scan, manual, staffCookie, delegatedCookie, staff, session };
}

test('gate data and mutations require an operator; staff event scope is enforced on every route', async () => {
  const { request, scan, manual, staffCookie, state, storage } = fixture();
  assert.equal((await request('events', { auth: false, eventId: null })).status, 401);
  assert.equal((await request('participants', { auth: false })).status, 401);
  assert.equal((await scan(claimedCode, { auth: false, headers: { Authorization: 'Bearer ordinary-user', 'x-admin-password': process.env.ADMIN_PASSWORD } })).status, 401);
  assert.equal(state.reads.length, 0);
  assert.equal(storage.calls.length, 0);
  const cookie = await staffCookie();
  const scoped = await request('events', { cookie, eventId: null });
  assert.equal(scoped.status, 200);
  assert.deepEqual((await scoped.json()).events.map(e => e.id), ['event-one']);
  const all = await request('events', { eventId: null });
  assert.deepEqual((await all.json()).events.map(e => e.id), ['event-one', 'event-two']);
  assert.equal((await request('participants', { cookie })).status, 200);
  const reads = state.reads.length;
  assert.equal((await request('participants', { cookie, eventId: 'event-two' })).status, 403);
  assert.equal((await scan(wrongCode, { cookie, eventId: 'event-two' })).status, 403);
  assert.equal((await manual(alice, { cookie, eventId: 'event-two' })).status, 403);
  assert.equal(state.reads.length, reads);
  state.now = new Date(state.now.getTime() + 8 * 60 * 60 * 1000 + 1);
  assert.equal((await scan(claimedCode, { cookie })).status, 401);
});

test('claimed and unclaimed valid tickets enter once; dashboard separates claims from physical entries', async () => {
  const { scan, request, state, storage } = fixture({ cap: 1 });
  const first = await scan();
  assert.equal(first.status, 200);
  const entered = await first.json();
  assert.equal(entered.status, 'entered');
  assert.equal(entered.entry.userId, alice);
  assert.equal(entered.entry.name, 'Ada');
  assert.equal(entered.entry.method, 'qr');
  assert.equal(entered.entry.enteredAt, state.now.toISOString());
  const second = await scan(unclaimedCode);
  const unclaimed = await second.json();
  assert.equal(second.status, 200);
  assert.equal(unclaimed.entry.userId, null);
  assert.equal(unclaimed.entry.name, 'Bilet sahibi');
  const repeated = await scan();
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { ...entered, status: 'already' });
  const dashboard = await request();
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.headers.get('cache-control'), 'no-store');
  const data = await dashboard.json();
  assert.deepEqual(data.summary, { claimed: 1, entered: 2 });
  assert.equal(data.participants.length, 1);
  assert.equal(data.participants[0].id, alice);
  assert.equal(data.participants[0].enteredAt, state.now.toISOString());
  assert.equal(data.entries.length, 2);
  const publicText = JSON.stringify({ entered, unclaimed, data });
  const persistedText = JSON.stringify((await storage.get(entryKey('event-one'))).entries);
  for (const secret of [claimedCode, unclaimedCode, hash(claimedCode), hash(unclaimedCode)]) {
    assert.equal(publicText.includes(secret), false);
    assert.equal(persistedText.includes(secret), false);
  }
});

test('ERC ticket links accept only the site or canonical ticket page and reject unrelated QR values', async () => {
  const { scan, state, storage } = fixture();
  const invalid = ['not-a-ticket', 'ERC-ABC', 'ERC-' + 'G'.repeat(24),
    `https://foreign.test/biletler.html?ticket=${claimedCode}`,
    `https://site.test/other.html?ticket=${claimedCode}`,
    `https://ercupsa.com.tr@foreign.test/biletler.html?ticket=${claimedCode}`,
    `https://user:password@ercupsa.com.tr/biletler.html?ticket=${claimedCode}`,
    `javascript:${claimedCode}`, `https://ercupsa.com.tr/biletler.html#ticket=${claimedCode}`];
  for (const code of invalid) {
    const result = await scan(code);
    assert.equal(result.status, 400, code);
    assert.equal((await result.json()).code, 'GATE_INVALID_CODE');
  }
  assert.equal(state.reads.length, 0);
  assert.equal(storage.calls.length, 0);
  for (const code of [claimedCode.toLowerCase(), `https://site.test/biletler.html?ticket=${claimedCode}`,
    `https://ercupsa.com.tr/biletler.html?code=${claimedCode}`, `https://www.ercupsa.com.tr/biletler.html?ticket=${claimedCode}`]) {
    const result = await scan(code);
    assert.equal(result.status, 200, code);
  }
  assert.equal((await storage.get(entryKey('event-one'))).entries.length, 1);
});

test('wrong-event, revoked, unknown and mismatched manual tickets never create an entry', async () => {
  const { scan, manual, storage, state } = fixture();
  for (const [code, error] of [[wrongCode, 'GATE_WRONG_EVENT'], [revokedCode, 'GATE_INVALID_TICKET'], ['ERC-' + 'F'.repeat(24), 'GATE_INVALID_TICKET']]) {
    const result = await scan(code);
    assert.equal(result.status, 409);
    assert.equal((await result.json()).code, error);
  }
  assert.equal((await manual(bob)).status, 404);
  state.tickets.find(t => t.id === claimedId).claimed_by = bob;
  assert.equal((await manual(alice)).status, 409);
  state.tickets.find(t => t.id === claimedId).claimed_by = alice;
  state.tickets.find(t => t.id === claimedId).revoked = true;
  assert.equal((await manual(alice)).status, 409);
  assert.equal(storage.records.has(entryKey('event-one')), false);
  assert.equal(storage.calls.filter(c => c.action === 'setJSON').length, 0);
});

test('manual admission and simultaneous QR scans share one atomic ticket entry', async () => {
  const { scan, manual, storage, request } = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => i % 2 ? manual() : scan()));
  const outcomes = [];
  for (const result of results) {
    assert.equal(result.status, 200, await result.clone().text());
    outcomes.push(await result.json());
  }
  assert.equal(outcomes.filter(r => r.status === 'entered').length, 1);
  assert.equal(outcomes.filter(r => r.status === 'already').length, 9);
  assert.equal(new Set(outcomes.map(r => r.entry.enteredAt)).size, 1);
  const entries = (await storage.get(entryKey('event-one'))).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ticketId, claimedId);
  assert.deepEqual((await (await request()).json()).summary, { claimed: 1, entered: 1 });
});

test('concurrent different ticket entries preserve each admission across CAS retries', async () => {
  const { scan, state, storage } = fixture();
  const codes = [claimedCode, unclaimedCode];
  for (let i = 5; i < 11; i++) {
    const code = `ERC-${String(i).padStart(24, '0')}`;
    codes.push(code);
    state.tickets.push({ id: randomUUID(), event_id: 'event-one', code_hash: hash(code), claimed_by: null, revoked: false });
  }
  const results = await Promise.all(codes.map(code => scan(code)));
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.equal((await result.json()).status, 'entered');
  }
  const entries = (await storage.get(entryKey('event-one'))).entries;
  assert.equal(entries.length, codes.length);
  assert.equal(new Set(entries.map(e => e.ticketId)).size, codes.length);
  const mutations = storage.calls.filter(c => c.action === 'setJSON');
  assert.ok(mutations.some(call => call.options.onlyIfMatch));
  assert.ok(mutations.every(call => call.options.onlyIfNew || call.options.onlyIfMatch));
});

test('an unclaimed admission resolves to its account after a later ticket claim without a second entry', async () => {
  const { scan, state, request, manual, storage } = fixture();
  assert.equal((await scan(unclaimedCode)).status, 200);
  state.tickets.find(t => t.id === unclaimedId).claimed_by = bob;
  state.attendance.push({ user_id: bob, event_id: 'event-one', ticket_id: unclaimedId, created_at: '2026-10-07T19:00:00Z' });
  const dashboard = await request();
  const data = await dashboard.json();
  assert.deepEqual(data.summary, { claimed: 2, entered: 1 });
  assert.equal(data.participants.find(p => p.id === bob).enteredAt, state.now.toISOString());
  assert.equal(data.entries[0].userId, bob);
  assert.equal(data.entries[0].name, 'Bora');
  const repeated = await manual(bob);
  assert.equal((await repeated.json()).status, 'already');
  assert.equal((await storage.get(entryKey('event-one'))).entries.length, 1);
});

test('personal form tickets show their registrant before account claim and preserve ownership when a different account claims them', async () => {
  const { formEntry, saveForm, scan, state, request, storage, registrationStorage } = fixture({ cap: 1 });
  await saveForm([formEntry()]);
  const first = await (await scan(unclaimedCode)).json();
  assert.equal(first.status, 'entered');
  assert.deepEqual({ name: first.entry.name, userId: first.entry.userId, registrationId: first.entry.registrationId, classYear: first.entry.classYear },
    { name: 'Elif Form Sahibi', userId: null, registrationId: 'form-entry-one', classYear: '3. Sınıf' });
  state.tickets.find(ticket => ticket.id === unclaimedId).claimed_by = bob;
  state.attendance.push({ user_id: bob, event_id: 'event-one', ticket_id: unclaimedId, created_at: '2026-10-07T19:00:00Z' });
  const repeated = await (await scan(unclaimedCode)).json();
  assert.equal(repeated.status, 'already');
  assert.equal(repeated.entry.name, 'Elif Form Sahibi');
  assert.equal(repeated.entry.accountName, 'Bora'); assert.equal(repeated.entry.userId, bob);
  assert.equal(repeated.entry.enteredAt, first.entry.enteredAt);
  const data = await (await request()).json();
  const participant = data.participants.find(person => person.id === bob);
  assert.equal(participant.name, 'Elif Form Sahibi'); assert.equal(participant.accountName, 'Bora');
  assert.equal(data.entries[0].name, 'Elif Form Sahibi'); assert.equal(data.entries[0].accountName, 'Bora');
  assert.equal(data.entries[0].classYear, '3. Sınıf');
  assert.equal((await storage.get(entryKey('event-one'))).entries.length, 1);
  assert.equal(registrationStorage.calls.filter(call => call.action === 'setJSON').length, 1);
  const details = JSON.stringify({ first, repeated, data, stored: await storage.get(entryKey('event-one')) });
  for (const secret of [unclaimedCode, hash(unclaimedCode), 'private-phone', 'private-answer', 'private-receipt']) assert.equal(details.includes(secret), false);
});

test('existing gate admissions are enriched from actual form ticket proof without changing physical entry records', async () => {
  const { formEntry, saveForm, request, storage, state } = fixture();
  await storage.setJSON(entryKey('event-one'), { entries: [{ ticketId: unclaimedId, userId: null, name: 'Bilet sahibi', enteredAt: state.now.toISOString(), method: 'qr' }] });
  await saveForm([formEntry({ ticket: { batchId: 'unclaimed-batch', code: unclaimedCode, status: 'pending' } })]);
  const before = structuredClone(await storage.get(entryKey('event-one')));
  const data = await (await request()).json();
  assert.equal(data.entries[0].name, 'Elif Form Sahibi');
  assert.equal(data.entries[0].registrationId, 'form-entry-one');
  assert.deepEqual(await storage.get(entryKey('event-one')), before);
  assert.equal(storage.calls.filter(call => call.action === 'setJSON').length, 1);
});

test('cancelled and waitlisted registrations cannot enter even when database revocation has failed', async () => {
  for (const registrationStatus of ['cancelled', 'waitlisted']) {
    const { formEntry, saveForm, scan, state, storage } = fixture();
    await saveForm([formEntry({ registrationStatus })]);
    assert.equal(state.tickets.find(ticket => ticket.id === unclaimedId).revoked, false);
    const result = await scan(unclaimedCode);
    assert.equal(result.status, 409);
    assert.equal((await result.json()).code, 'GATE_INVALID_TICKET');
    assert.equal(await storage.get(entryKey('event-one')), null);
    assert.equal((await scan(claimedCode)).status, 200, 'an unrelated manual batch ticket remains usable');
  }
});

test('later cancellation or deletion never removes a real entrance and its proved historical owner', async () => {
  for (const deleted of [false, true]) {
    const { formEntry, saveForm, scan, state, storage, request } = fixture();
    const entry = formEntry();
    await saveForm([entry]);
    assert.equal((await scan(unclaimedCode)).status, 200);
    const before = await storage.get(entryKey('event-one'));
    if (deleted) await saveForm([], [{ ...entry }]);
    else await saveForm([{ ...entry, registrationStatus: 'cancelled' }]);
    assert.equal((await scan(unclaimedCode)).status, 409);
    state.tickets.find(ticket => ticket.id === unclaimedId).revoked = true;
    const dashboard = await (await request()).json();
    assert.equal(dashboard.entries.length, 1);
    assert.equal(dashboard.entries[0].name, entry.name);
    assert.equal(dashboard.entries[0].registrationId, entry.id);
    assert.deepEqual(await storage.get(entryKey('event-one')), before);
  }
});

test('form owners require both canonical batch and code hash proof; deleted registrations and unrelated form names never match', async () => {
  for (const reservation of [
    { batchId: 'another-batch', code: unclaimedCode, status: 'issued' },
    { batchId: 'unclaimed-batch', code: claimedCode, status: 'issued' },
    undefined,
  ]) {
    const { formEntry, saveForm, scan } = fixture();
    await saveForm([formEntry({ name: 'Ada', ticket: reservation })]);
    const result = await (await scan(unclaimedCode)).json();
    assert.equal(result.entry.name, 'Bilet sahibi'); assert.equal(result.entry.registrationId, undefined);
  }
  const { formEntry, saveForm, scan, request } = fixture();
  await saveForm([formEntry()]);
  assert.equal((await (await scan(unclaimedCode)).json()).entry.name, 'Elif Form Sahibi');
  await saveForm([], [{ id: 'form-entry-one' }]);
  const repeated = await (await scan(unclaimedCode)).json();
  assert.equal(repeated.status, 'already'); assert.equal(repeated.entry.registrationId, undefined);
  assert.equal(repeated.entry.name, 'Bilet sahibi');
  const entries = (await (await request()).json()).entries;
  assert.equal(entries[0].registrationId, undefined); assert.equal(entries[0].name, 'Bilet sahibi');
});

test('event authorization precedes private registration reads and malformed owner state never admits a ticket', async () => {
  const { saveForm, formEntry, registrationStorage, scan, staffCookie, storage, request } = fixture();
  await saveForm([formEntry()]);
  const cookie = await staffCookie(); registrationStorage.calls.length = 0;
  assert.equal((await scan(wrongCode, { cookie, eventId: 'event-two' })).status, 403);
  assert.equal((await request('participants', { cookie, eventId: 'event-two' })).status, 403);
  assert.equal((await scan(unclaimedCode, { auth: false })).status, 401);
  assert.equal(registrationStorage.calls.length, 0);
  await saveForm([formEntry({ ticket: { batchId: 'unclaimed-batch', code: 'broken', status: 'issued' } })]);
  assert.equal((await scan(unclaimedCode, { cookie })).status, 503);
  assert.equal(storage.records.has(entryKey('event-one')), false);
});

test('lost admission write responses are recovered as duplicates and missing ETags fail closed', async () => {
  const { scan, storage } = fixture();
  let first = true;
  storage.hooks.afterSet = () => { if (first) { first = false; throw Error('synthetic response lost after commit'); } };
  const failed = await scan();
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('synthetic response'), false);
  delete storage.hooks.afterSet;
  const recovered = await scan();
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).status, 'already');
  const saved = await storage.get(entryKey('event-one'));
  storage.hooks.metadata = (_key, record) => record ? { data: record.data } : record;
  assert.equal((await scan(unclaimedCode)).status, 503);
  assert.deepEqual(await storage.get(entryKey('event-one')), saved);
});

test('conditional conflicts are bounded and database/catalog failures never admit tickets', async () => {
  const { scan, storage, state } = fixture();
  const set = storage.setJSON;
  let attempts = 0;
  storage.setJSON = async () => { attempts++; return { modified: false }; };
  const conflict = await scan();
  assert.equal(conflict.status, 409);
  assert.ok(attempts > 1 && attempts <= 24);
  assert.equal(storage.records.size, 0);
  storage.setJSON = set;
  for (const failure of ['failRead', 'failEvents']) {
    state[failure] = true;
    const result = await scan();
    assert.equal(result.status, 503);
    const detail = await result.text();
    assert.equal(detail.includes('private'), false);
    assert.equal(storage.records.size, 0);
    state[failure] = false;
  }
});

test('foreign-origin mutations, malformed bodies and event/user query injections are rejected without admission', async () => {
  const { scan, manual, request, storage, state } = fixture();
  assert.equal((await scan(claimedCode, { headers: { Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await manual(alice, { headers: { Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await request('scan', { method: 'POST', rawBody: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('scan', { method: 'POST', rawBody: '{bad', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await request('participants', { eventId: 'event-one,query' })).status, 400);
  assert.equal((await manual('person,query')).status, 400);
  assert.equal(storage.records.size, 0);
  assert.equal(state.reads.length, 0);
});


test('delegated attendance viewers read participants but cannot admit people or manage gate accounts', async () => {
  const { delegatedCookie, request, scan, manual, staff, session, storage, state } = fixture();
  const cookie = await delegatedCookie(['attendance.view']);
  assert.equal((await request('events', { eventId: null, cookie })).status, 200);
  assert.equal((await request('participants', { cookie })).status, 200);
  const operator = (await (await session(cookie)).json()).operator;
  assert.equal(operator.role, 'admin'); assert.equal(operator.canManage, false);
  state.reads.length = 0; storage.calls.length = 0;
  assert.equal((await scan(claimedCode, { cookie })).status, 403);
  assert.equal((await manual(alice, { cookie })).status, 403);
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await staff(method, cookie)).status, 403);
  assert.equal(state.reads.length, 0); assert.equal(storage.calls.length, 0);
});

test('delegated attendance managers can scan, but live permission removal stops reads and writes', async () => {
  const { delegatedCookie, request, scan, staff, session, storage, adminStorage, state } = fixture();
  const cookie = await delegatedCookie(['attendance.manage']);
  assert.equal((await (await session(cookie)).json()).operator.canManage, true);
  assert.equal((await scan(claimedCode, { cookie })).status, 200);
  assert.equal((await staff('POST', cookie)).status, 403);
  const saved = await adminStorage.get(ADMIN_ACCOUNTS_KEY);
  saved.accounts[0].permissions = [];
  await adminStorage.setJSON(ADMIN_ACCOUNTS_KEY, saved);
  state.reads.length = 0; storage.calls.length = 0;
  assert.equal((await request('events', { eventId: null, cookie })).status, 403);
  assert.equal((await request('participants', { cookie })).status, 403);
  assert.equal((await scan(unclaimedCode, { cookie })).status, 403);
  assert.equal(state.reads.length, 0); assert.equal(storage.calls.length, 0);
  saved.accounts[0].active = false;
  await adminStorage.setJSON(ADMIN_ACCOUNTS_KEY, saved);
  assert.equal((await session(cookie)).status, 401);
});
