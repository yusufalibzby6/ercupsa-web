import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createHandler } from '../netlify/functions/raffles.mjs';
import { adminLogin } from '../netlify/lib/security.mjs';
import { drawInput } from '../netlify/lib/raffles.mjs';
import { readRegistrationParticipants, checkedInRegistrationParticipants } from '../netlify/lib/raffle-registrations.mjs';
import { readRegistrationTicketOwners } from '../netlify/lib/registration-ticket-owners.mjs';
import { registrationStateKey, entryKey } from '../netlify/lib/registrations.mjs';

const at = '2026-01-01T12:00:00Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const entry = (id, extra = {}) => ({ id, eventId: 'event', name: `Form ${id}`, createdAt: at,
  classYear: '3', phone: 'PRIVATE_PHONE', answers: { private: 'PRIVATE_ANSWER' },
  ticket: { batchId: `batch-${id}`, code: `ERC-${hash(id).slice(0, 24).toUpperCase()}`, status: 'issued' }, ...extra });
const ticket = (person, extra = {}) => ({ id: `ticket-${person.id}`, event_id: 'event',
  batch_id: person.ticket.batchId, code_hash: hash(person.ticket.code), revoked: false, ...extra });
const scan = (person, extra = {}) => ({ ticketId: `ticket-${person.id}`, userId: null,
  name: 'Do not use entrance display name', enteredAt: at, ...extra });
function memory() {
  const values = new Map(); let revision = 0;
  return { values,
    async get(key) { return structuredClone(values.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(values.get(key) ?? null); },
    async setJSON(key, data, options = {}) {
      const existing = values.get(key);
      if (options.onlyIfNew && existing || options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      values.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true };
    },
    async list({ prefix }) { return { blobs: [...values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
async function fixture({ entries = [entry('a'), entry('b')], cap = 500 } = {}) {
  process.env.ADMIN_PASSWORD = 'raffle-entrance-test-only';
  const cookie = adminLogin(new Request('https://site.test', { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
  const registrationStore = memory(), drawStore = memory();
  await registrationStore.setJSON(registrationStateKey('event'), { version: 1, eventId: 'event', entries, deleted: [] });
  const state = { entries: entries.map(person => scan(person)), tickets: entries.map(person => ticket(person)),
    reads: [], ownerReads: 0, checkinReads: 0, registrationReads: 0,
    failOwners: false, failCheckins: false, failDatabase: false, overrideDatabase: undefined };
  const handler = createHandler({ store: () => drawStore,
    events: async () => [{ id: 'event', title: 'Test etkinliği', date: '2026-01-01', time: '12:00' }],
    registrations: async eventId => { state.registrationReads++; return readRegistrationParticipants(eventId, registrationStore); },
    ticketOwners: async eventId => {
      state.ownerReads++; if (state.failOwners) throw Error('owner storage unavailable');
      return readRegistrationTicketOwners(eventId, { store: registrationStore });
    },
    checkins: async () => { state.checkinReads++; if (state.failCheckins) throw Error('entrance storage unavailable'); return structuredClone(state.entries); },
    read: async path => {
      state.reads.push(path);
      if (state.failDatabase) throw Error('database unavailable');
      if (state.overrideDatabase !== undefined) return state.overrideDatabase;
      const url = new URL(`https://database.test/${path}`);
      assert.equal(url.pathname, '/tickets', 'form entrance mode never consults claims or profiles');
      assert.equal(url.searchParams.get('event_id'), 'eq.event');
      const ids = url.searchParams.get('id').slice(4, -1).split(',');
      const after = url.searchParams.get('and')?.match(/^\(id.gt.([^)]+)\)$/)?.[1];
      return structuredClone(state.tickets.filter(row => ids.includes(row.id) && (!after || row.id > after))
        .sort((a, b) => a.id.localeCompare(b.id)).slice(0, Math.min(cap, Number(url.searchParams.get('limit')))));
    },
  });
  async function request(method = 'GET', payload, options = {}) {
    const url = new URL('https://site.test/api/raffles?eventId=event');
    if (options.source !== null) url.searchParams.set('source', options.source || 'registrations');
    if (!options.action) url.searchParams.set('checkedInOnly', String(options.checkedInOnly ?? true));
    if (options.action) url.searchParams.set('action', options.action);
    if (options.requestId) url.searchParams.set('requestId', options.requestId);
    const result = await handler(new Request(url, { method, headers: { cookie, 'Content-Type': 'application/json', origin: 'https://site.test' },
      ...(payload ? { body: JSON.stringify(payload) } : {}) }));
    return { status: result.status, data: await result.json() };
  }
  const input = preview => ({ requestId: randomUUID(), eventId: 'event', source: 'registrations', checkedInOnly: true,
    loyaltyBonus: false, checkinBonus: false, count: 1, excluded: [], poolVersion: preview.poolVersion });
  return { state, request, input, registrationStore, drawStore };
}

test('form entrance pool includes unclaimed personal tickets, uses form identities and exposes no private ticket proofs', async () => {
  const people = [entry('a'), entry('b'), entry('pending', { ticket: { ...entry('pending').ticket, status: 'pending' } })];
  const { state, request } = await fixture({ entries: people });
  state.entries = [scan(people[0], { userId: 'unrelated-account', name: people[1].name }), scan(people[2]),
    { ticketId: 'no-form-ticket', userId: people[1].id, name: people[1].name, enteredAt: at }];
  state.tickets.push({ ...ticket(entry('outside')), id: 'no-form-ticket' });
  const preview = await request();
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.participants.map(person => [person.id, person.name, person.weight, person.previous]),
    [['a', 'Form a', 1, 0], ['pending', 'Form pending', 1, 0]]);
  for (const person of preview.data.participants) {
    assert.deepEqual(Object.keys(person).sort(), ['createdAt', 'enteredAt', 'id', 'name', 'previous', 'weight']);
    assert.equal(person.enteredAt, at);
  }
  const serialized = JSON.stringify(preview.data);
  for (const secret of ['PRIVATE_', 'batch-a', people[0].ticket.code, hash(people[0].ticket.code), 'unrelated-account']) assert.ok(!serialized.includes(secret));
  assert.equal(state.registrationReads, 0);
  assert.equal(preview.data.checkedInOnly, true); assert.equal(preview.data.checkinBonus, false);
});

test('form entrance eligibility requires exact live event, batch and code hash; revoked, missing and deleted tickets leave the pool', async () => {
  for (const mutate of [
    ({ state }) => { state.tickets[0].event_id = 'another-event'; },
    ({ state }) => { state.tickets[0].batch_id = 'another-batch'; },
    ({ state }) => { state.tickets[0].code_hash = 'a'.repeat(64); },
    ({ state }) => { state.tickets[0].revoked = true; },
    ({ state }) => { state.tickets = []; },
    async ({ registrationStore }) => {
      const current = await registrationStore.get(registrationStateKey('event'));
      current.deleted.push({ id: 'a' }); await registrationStore.setJSON(registrationStateKey('event'), current);
      await registrationStore.setJSON(entryKey('event', 'a'), entry('a'));
    },
  ]) {
    const fixtureState = await fixture({ entries: [entry('a')] });
    const preview = (await fixtureState.request()).data;
    assert.equal(preview.participants.length, 1);
    await mutate(fixtureState);
    const fresh = await fixtureState.request(); assert.equal(fresh.status, 200); assert.deepEqual(fresh.data.participants, []);
    const stale = await fixtureState.request('POST', fixtureState.input(preview));
    assert.equal(stale.status, 409); assert.equal(stale.data.code, 'RAFFLE_POOL_CHANGED');
  }
});

test('form all-record mode stays independent of entrance stores and retains exact legacy input and pool hashes', async () => {
  const { state, request } = await fixture();
  state.failOwners = state.failCheckins = state.failDatabase = true;
  const preview = await request('GET', null, { checkedInOnly: false });
  assert.equal(preview.status, 200); assert.equal(preview.data.participants.length, 2);
  assert.equal(state.ownerReads, 0); assert.equal(state.checkinReads, 0); assert.equal(state.reads.length, 0);
  const snapshot = preview.data.participants.map(({ id, weight, name, createdAt }) => ({ id, weight, name, createdAt })).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(preview.data.poolVersion, hash(JSON.stringify({ eventId: 'event', participants: snapshot, source: 'registrations' })));
  const legacy = { requestId: randomUUID(), eventId: 'event', count: 1, excluded: [], source: 'registrations', poolVersion: preview.data.poolVersion };
  const normalized = { id: legacy.requestId, eventId: 'event', count: 1, excluded: [], source: 'registrations', poolVersion: preview.data.poolVersion };
  assert.equal(drawInput(legacy).hash, hash(JSON.stringify(normalized)));
  const draw = await request('POST', legacy);
  assert.equal(draw.status, 200); assert.equal(draw.data.draw.checkedInOnly, false); assert.equal(draw.data.draw.loyaltyBonus, false);
});

test('form entrance mode binds previews, request identities and history even with the same people, without adding bonus chances', async () => {
  const { request, input, drawStore } = await fixture();
  const ordinary = (await request('GET', null, { checkedInOnly: false })).data;
  const checked = (await request()).data;
  assert.notEqual(ordinary.poolVersion, checked.poolVersion);
  const wrongPreview = await request('POST', { ...input(checked), poolVersion: ordinary.poolVersion });
  assert.equal(wrongPreview.data.code, 'RAFFLE_POOL_CHANGED');
  const submission = { ...input(checked), count: 1, excluded: ['b'] };
  const saved = await request('POST', submission);
  assert.equal(saved.status, 200); assert.equal(saved.data.draw.checkedInOnly, true);
  assert.equal(saved.data.draw.source, 'registrations'); assert.equal(saved.data.draw.loyaltyBonus, false);
  assert.deepEqual(saved.data.draw.winners.map(person => [person.id, person.weight]), [['a', 1]]);
  const conflict = await request('POST', { ...submission, checkedInOnly: false, poolVersion: ordinary.poolVersion });
  assert.equal(conflict.data.code, 'RAFFLE_REQUEST_CONFLICT');
  assert.equal((await request('GET', null, { action: 'history' })).data.draws[0].checkedInOnly, true);
  const prior = { id: randomUUID(), eventId: 'event', winners: [{ id: 'legacy' }], participants: [] };
  const history = await drawStore.get('events/event.json'); history.draws.push(prior); await drawStore.setJSON('events/event.json', history);
  const old = (await request('GET', null, { action: 'history' })).data.draws.at(-1);
  assert.deepEqual(old, { ...prior, source: 'qr' });
  for (const flag of ['loyaltyBonus', 'checkinBonus']) {
    const rejected = await request('POST', { ...input(checked), [flag]: true });
    assert.equal(rejected.status, 400); assert.equal(rejected.data.code, 'RAFFLE_INVALID_SELECTION');
  }
});

test('form entrance previews fence later scans and timestamp changes while future scans cannot qualify', async () => {
  for (const mutate of [
    state => { state.entries.push(scan(entry('b'))); },
    state => { state.entries[0].enteredAt = '2026-01-01T12:01:00Z'; },
  ]) {
    const { state, request, input } = await fixture(); state.entries = [scan(entry('a'))];
    const preview = (await request()).data; mutate(state);
    const changed = await request('POST', input(preview));
    assert.equal(changed.status, 409); assert.equal(changed.data.code, 'RAFFLE_POOL_CHANGED');
  }
  const { state, request } = await fixture(); state.entries[0].enteredAt = '2099-01-01T00:00:00Z';
  assert.deepEqual((await request()).data.participants.map(person => person.id), ['b']);
});

test('entrance, owner and database outages or malformed proofs fail closed without an all-record fallback or saved draw', async () => {
  for (const mutate of [
    state => { state.failOwners = true; }, state => { state.failCheckins = true; }, state => { state.failDatabase = true; },
    state => { state.entries = null; }, state => { state.entries[0].ticketId = 'bad/query'; },
    state => { state.entries[0].enteredAt = 'not a date'; }, state => { state.entries.push(state.entries[0]); },
    state => { state.overrideDatabase = null; }, state => { state.overrideDatabase = {}; },
    state => { state.overrideDatabase = [{ ...state.tickets[0], id: 'bad/query' }]; },
    state => { state.tickets[0].revoked = undefined; }, state => { state.tickets[0].code_hash = 'invalid'; },
  ]) {
    const { state, request, input, drawStore } = await fixture(); mutate(state);
    assert.equal((await request()).status, 503);
    const failed = await request('POST', input({ poolVersion: 'a'.repeat(64) }));
    assert.equal(failed.status, 503); assert.equal(drawStore.values.size, 0); assert.equal(state.registrationReads, 0);
  }
  const owners = [{ id: 'a', name: 'Ada', createdAt: at, batchId: 'batch-a', codeHash: 'a'.repeat(64) }];
  await assert.rejects(checkedInRegistrationParticipants('event', [...owners, owners[0]], [], async () => []), error => error.status === 503);
});

test('checked form reads batch scanned IDs, continues short keyset pages and never adds unscanned form rows', async () => {
  const people = Array.from({ length: 102 }, (_, index) => entry(String(index).padStart(3, '0')));
  const { state, request } = await fixture({ entries: people, cap: 7 });
  state.entries.pop();
  const preview = await request();
  assert.equal(preview.status, 200); assert.equal(preview.data.participants.length, 101);
  assert.ok(state.reads.some(path => path.includes('&and=')), 'short pages are not mistaken for end of results');
  assert.ok(state.reads.every(path => new URL(`https://db.test/${path}`).searchParams.get('id').slice(4, -1).split(',').length <= 100));
});

test('checked form draw lost-response retries preserve winners through source outages, prize updates and deletion', async () => {
  const { state, request, input, drawStore } = await fixture();
  const preview = (await request()).data, submission = { ...input(preview), excluded: ['b'] };
  const commit = drawStore.setJSON.bind(drawStore); let first = true;
  drawStore.setJSON = async (...args) => { const result = await commit(...args); if (first) { first = false; throw Error('lost write response'); } return result; };
  assert.equal((await request('POST', submission)).status, 503);
  state.failOwners = state.failCheckins = state.failDatabase = true;
  const result = (await request('GET', null, { action: 'result', requestId: submission.requestId })).data.draw;
  assert.equal(result.checkedInOnly, true); assert.equal(result.winners[0].id, 'a');
  assert.deepEqual((await request('POST', submission)).data.draw, result);
  const prize = await request('POST', { eventId: 'event', id: result.id, winnerId: 'a', delivered: true }, { action: 'prize' });
  assert.equal(prize.data.draw.winners[0].prizeDelivered, true); assert.equal(prize.data.draw.checkedInOnly, true);
  assert.equal((await request('DELETE', { eventId: 'event', id: result.id })).status, 200);
  assert.equal((await request('POST', submission)).data.code, 'RAFFLE_DRAW_DELETED');
});
