import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { participantsFor, poolVersion, weightedWinners, drawInput, saveDraw, deleteDraw, paged, raffleFail } from '../netlify/lib/raffles.mjs';
import { createHandler } from '../netlify/functions/raffles.mjs';
import { adminLogin } from '../netlify/lib/security.mjs';

function memory() {
  const records = new Map(); let revision = 0;
  return {
    records,
    async get(key) { return structuredClone(records.get(key)?.data || null); },
    async getWithMetadata(key) { return structuredClone(records.get(key) || null); },
    async setJSON(key, value, options) {
      const existing = records.get(key);
      if (options.onlyIfNew && existing || options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      records.set(key, { data: structuredClone(value), etag: String(++revision) }); return { modified: true };
    },
  };
}
const events = [{ id: 'current', title: 'Güncel', date: '2026-10-07', time: '18:00' }, { id: 'past', date: '2026-09-01' }, { id: 'future', date: '2026-12-01' }];
const attendance = [
  { user_id: 'a', event_id: 'current', created_at: '2026-10-07' },
  { user_id: 'b', event_id: 'current', created_at: '2026-10-07' },
  { user_id: 'a', event_id: 'past', created_at: '2026-09-01' },
  { user_id: 'a', event_id: 'past', created_at: '2026-09-02' },
  { user_id: 'a', event_id: 'archived', created_at: '2026-08-01' },
  { user_id: 'a', event_id: 'future', created_at: '2026-09-01' },
  { user_id: 'outsider', event_id: 'past', created_at: '2026-09-01' },
];
const profiles = [{ id: 'a', name: '<img onerror=bad> Ada' }, { id: 'b', name: 'Bora' }, { id: 'outsider', name: 'Dışarıda' }];

test('claimed accounts only; distinct dated earlier events give bonus, unknown/future tickets do not', () => {
  const pool = participantsFor(events[0], events, attendance, profiles, Date.parse('2026-10-07T18:00:00+03:00'));
  assert.equal(pool.length, 2);
  assert.equal(pool.find(p => p.id === 'a').weight, 2);
  assert.equal(pool.find(p => p.id === 'b').weight, 1);
});
test('deleting a future event does not turn its early ticket claim into a past-event bonus', () => {
  const claims = attendance.filter(a => a.event_id !== 'past');
  for (const catalog of [events, events.filter(e => e.id !== 'future')]) {
    assert.equal(participantsFor(events[0], catalog, claims, profiles, Date.parse('2026-10-07T18:00:00+03:00')).find(p => p.id === 'a').weight, 1);
  }
});
test('future events before a selected future event are not treated as past participation', () => {
  const futureEvents = [{ id: 'selected', date: '2027-03-01' }, { id: 'early', date: '2027-02-01' }];
  const claims = [{ user_id: 'a', event_id: 'selected', created_at: '2026-10-01' }, { user_id: 'a', event_id: 'early', created_at: '2026-09-01' }];
  assert.equal(participantsFor(futureEvents[0], futureEvents, claims, profiles, Date.parse('2026-10-07'))[0].weight, 1);
});
test('preview version is stable across row ordering and binds names, rights, claim time and event', () => {
  const pool = participantsFor(events[0], events, attendance, profiles, Date.parse('2026-10-07T18:00:00+03:00'));
  const version = poolVersion('current', pool);
  assert.match(version, /^[a-f0-9]{64}$/);
  assert.equal(poolVersion('current', [...pool].reverse()), version);
  assert.notEqual(poolVersion('another', pool), version);
  for (const change of [{ name: 'Changed' }, { weight: 99 }, { claimedAt: '2026-10-06' }]) {
    assert.notEqual(poolVersion('current', [{ ...pool[0], ...change }, ...pool.slice(1)]), version);
  }
});
test('weighted boundaries reflect rights and winners cannot repeat', () => {
  const pool = [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }];
  assert.deepEqual([0, 1, 2, 3].map(n => weightedWinners(pool, 1, () => n)[0].id), ['a', 'a', 'a', 'b']);
  assert.deepEqual(weightedWinners(pool, 2, () => 0).map(p => p.id), ['a', 'b']);
  assert.throws(() => weightedWinners(pool, 3), error => error.code === 'RAFFLE_INVALID_SELECTION');
  assert.equal(pool.length, 2);
});
test('database paging reads beyond 1000 records and continues short server-capped pages until empty', async () => {
  const data = Array.from({ length: 1251 }, (_, id) => ({ id }));
  for (const cap of [500, 100, 37]) {
    let calls = 0;
    const all = await paged('attendance?select=user_id', async path => {
      calls++; const u = new URL('https://test/' + path), offset = Number(u.searchParams.get('offset'));
      return data.slice(offset, offset + Math.min(cap, Number(u.searchParams.get('limit'))));
    });
    assert.equal(all.length, 1251); assert.equal(calls, Math.ceil(data.length / cap) + 1);
    assert.deepEqual(all, data);
  }
});
test('database paging accepts an exact bound, rejects oversized or malformed pages and never loops unbounded', async () => {
  const all = await paged('attendance?select=user_id', async path => {
    const u = new URL('https://test/' + path), offset = Number(u.searchParams.get('offset'));
    return Array.from({ length: Math.min(Number(u.searchParams.get('limit')), 100000 - offset) }, (_, n) => ({ id: offset + n }));
  });
  assert.equal(all.length, 100000);
  await assert.rejects(paged('attendance?', async () => null), /doğrulanamadı/);
  await assert.rejects(paged('attendance?', async () => Array.from({ length: 501 }, () => ({}))), /doğrulanamadı/);
  let calls = 0;
  await assert.rejects(paged('attendance?', async () => { calls++; return [{}]; }), /çok büyük/);
  assert.equal(calls, 2001);
  await assert.rejects(paged('attendance?', async () => [{ id: 'same' }], { cursor: ['id'] }), /listesi değişti/);
});
test('keyset paging keeps later accounts when an earlier account is deleted between chunks', async () => {
  const data = Array.from({ length: 501 }, (_, n) => ({ id: String(n).padStart(4, '0') }));
  let call = 0;
  const all = await paged('profiles?order=id.asc', async path => {
    const u = new URL('https://test/' + path);
    if (call++ === 1) data.shift();
    const after = u.searchParams.get('and')?.match(/^\(id.gt.(.+)\)$/)?.[1];
    return data.filter(row => !after || row.id > after).slice(0, Number(u.searchParams.get('limit')));
  }, { cursor: ['id'] });
  assert.equal(all.length, 501); assert.equal(all.at(-1).id, '0500');
});
test('input rejects spoofed count, malformed identity and exclusion values and preserves legacy hashes', () => {
  const valid = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: ['b', 'b'] };
  const legacy = drawInput(valid);
  assert.deepEqual(legacy.excluded, ['b']);
  assert.equal(legacy.poolVersion, undefined);
  assert.notEqual(drawInput({ ...valid, poolVersion: 'a'.repeat(64) }).hash, legacy.hash);
  assert.equal(drawInput({ ...valid, poolVersion: 'A'.repeat(64) }).hash, drawInput({ ...valid, poolVersion: 'a'.repeat(64) }).hash);
  for (const change of [{ count: 0 }, { count: '2' }, { count: 201 }, { requestId: 'anything' }, { excluded: ['bad,query'] }, { poolVersion: 'bad' }]) {
    assert.throws(() => drawInput({ ...valid, ...change }), error => error.code === 'RAFFLE_INVALID_SELECTION');
  }
});
test('concurrent retries save once, payload changes conflict, deletion tombstones prevent resurrection', async () => {
  const store = memory(), input = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] });
  const create = () => ({ id: input.id, hash: input.hash, winner: randomUUID() });
  const results = await Promise.all(Array.from({ length: 6 }, () => saveDraw(store, input, create)));
  assert.equal(new Set(results.map(d => d.winner)).size, 1);
  assert.equal((await store.get('events/current.json')).draws.length, 1);
  await assert.rejects(saveDraw(store, { ...input, hash: 'changed' }, create), error => error.code === 'RAFFLE_REQUEST_CONFLICT');
  await deleteDraw(store, 'current', input.id);
  await deleteDraw(store, 'current', input.id);
  assert.deepEqual((await store.get('events/current.json')).draws, [{ id: input.id, deleted: true }]);
  await assert.rejects(saveDraw(store, input, create), error => error.code === 'RAFFLE_DRAW_DELETED');
  const next = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] });
  await saveDraw(store, next, () => ({ id: next.id, hash: next.hash }));
  assert.equal((await store.get('events/current.json')).draws.length, 2);
});
test('concurrent different draws and deletion preserve other winners and deleted tombstones', async () => {
  const store = memory();
  const inputs = Array.from({ length: 7 }, () => drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] }));
  const make = input => ({ id: input.id, hash: input.hash, participants: [{ name: 'Private' }], winners: [{ name: 'Winner' }] });
  await saveDraw(store, inputs[0], () => make(inputs[0]));
  await Promise.all([deleteDraw(store, 'current', inputs[0].id), ...inputs.slice(1).map(input => saveDraw(store, input, () => make(input)))]);
  const stored = (await store.get('events/current.json')).draws;
  assert.equal(stored.length, inputs.length);
  assert.equal(new Set(stored.map(d => d.id)).size, inputs.length);
  assert.deepEqual(stored.find(d => d.id === inputs[0].id), { id: inputs[0].id, deleted: true });
  for (const input of inputs.slice(1)) assert.deepEqual(stored.find(d => d.id === input.id), make(input));
});
test('lost write responses recover persisted result and conditional exhaustion is explicitly retryable', async () => {
  const store = memory(), input = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] });
  const commit = store.setJSON.bind(store); let first = true, selections = 0;
  store.setJSON = async (...args) => { const result = await commit(...args); if (first) { first = false; throw Error('response lost after commit'); } return result; };
  const make = () => { selections++; return { id: input.id, hash: input.hash, winner: randomUUID() }; };
  await assert.rejects(saveDraw(store, input, make), /response lost/);
  const result = await saveDraw(store, input, make);
  assert.equal(selections, 1); assert.deepEqual(result, (await store.get('events/current.json')).draws[0]);
  await assert.rejects(saveDraw({ getWithMetadata: async () => ({ data: { draws: [] } }), setJSON: () => assert.fail('unsafe write') }, input, () => ({})), /doğrulanamadı/);
  await assert.rejects(saveDraw({ getWithMetadata: async () => null, setJSON: async () => ({ modified: false }) }, input, () => ({})), error => error.status === 409 && error.code === 'RAFFLE_RETRY');
});

function fixture({ cap = 500 } = {}) {
  process.env.ADMIN_PASSWORD = 'raffle-test-admin';
  const cookie = adminLogin(new Request('https://site.test', { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
  const state = {
    failRead: false, failEvents: false,
    events: structuredClone(events),
    attendance: [...new Map(attendance.map(a => [`${a.user_id}/${a.event_id}`, a])).values()].map(a => ({ ...a })),
    profiles: structuredClone(profiles), reads: [],
  };
  const store = memory();
  const handler = createHandler({ store: () => store, events: async () => { if (state.failEvents) throw Error('events offline'); return state.events; }, read: async path => {
    state.reads.push(path);
    if (state.failRead) throw Error('database offline');
    const u = new URL('https://db.test/' + path);
    let rows = u.pathname === '/profiles' ? state.profiles : state.attendance;
    if (u.searchParams.has('event_id')) rows = rows.filter(a => a.event_id === u.searchParams.get('event_id').slice(3));
    const cutoff = u.searchParams.get('created_at');
    if (cutoff) rows = rows.filter(a => Date.parse(a.created_at) <= Date.parse(cutoff.slice(4)));
    const filter = u.searchParams.get('user_id') || u.searchParams.get('id');
    if (filter) { const ids = filter.slice(4, -1).split(','); rows = rows.filter(p => ids.includes(p.user_id || p.id)); }
    const order = (u.searchParams.get('order') || '').split(',').map(v => v.split('.')[0]);
    rows = [...rows].sort((a, b) => { for (const field of order) { if (a[field] < b[field]) return -1; if (a[field] > b[field]) return 1; } return 0; });
    const compound = u.searchParams.get('or')?.match(/^\(user_id.gt.([^,]+),and\(user_id.eq.([^,]+),event_id.gt.([^)]+)\)\)$/);
    if (compound) rows = rows.filter(r => r.user_id > compound[1] || r.user_id === compound[2] && r.event_id > compound[3]);
    const single = u.searchParams.get('and')?.match(/^\(id.gt.([^)]+)\)$/);
    if (single) rows = rows.filter(r => r.id > single[1]);
    const offset = Number(u.searchParams.get('offset'));
    return rows.slice(offset, offset + Math.min(cap, Number(u.searchParams.get('limit'))));
  } });
  async function request(method = 'GET', data, { auth = true, origin = 'https://site.test', action, eventId = 'current', requestId, rawBody, contentType = 'application/json' } = {}) {
    const url = new URL('https://site.test/api/raffles');
    url.searchParams.set('eventId', eventId);
    if (action) url.searchParams.set('action', action);
    if (requestId) url.searchParams.set('requestId', requestId);
    const r = await handler(new Request(url, { method, headers: { 'Content-Type': contentType, ...(auth ? { cookie } : {}), origin }, ...(rawBody !== undefined ? { body: rawBody } : data ? { body: JSON.stringify(data) } : {}) }));
    return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') };
  }
  return { state, store, request };
}

test('private API enforces admin/origin, recomputes weights, excludes selected accounts, persists and deletes history', async () => {
  const { state, request } = fixture({ cap: 1 });
  assert.equal((await request('GET', null, { auth: false })).status, 401);
  const initial = await request(); assert.equal(initial.cache, 'no-store'); assert.equal(initial.data.participants.length, 2);
  assert.match(initial.data.poolVersion, /^[0-9a-f]{64}$/);
  assert.ok(state.reads.some(path => path.includes('&or='))); assert.ok(state.reads.some(path => path.includes('&and=')));
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: ['b'], weights: { a: 999 }, poolVersion: initial.data.poolVersion };
  assert.equal((await request('POST', input, { origin: 'https://evil.test' })).status, 403);
  const result = await request('POST', input); assert.equal(result.status, 200);
  assert.deepEqual(result.data.draw.winners.map(p => p.id), ['a']);
  assert.equal(result.data.draw.winners[0].weight, 2);
  assert.equal(result.data.draw.poolVersion, initial.data.poolVersion);
  state.failRead = true;
  assert.deepEqual((await request('POST', input)).data.draw, result.data.draw);
  state.failRead = false;
  assert.equal((await request('POST', { ...input, count: 2 })).data.code, 'RAFFLE_REQUEST_CONFLICT');
  assert.equal((await request('POST', { ...input, requestId: randomUUID(), count: 2 })).data.code, 'RAFFLE_INVALID_SELECTION');
  assert.equal((await request('POST', { ...input, requestId: randomUUID(), excluded: ['outsider'] })).data.code, 'RAFFLE_INVALID_SELECTION');
  assert.equal((await request()).data.draws.length, 1);
  assert.equal((await request('DELETE', { eventId: 'current', id: input.requestId }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await request('DELETE', { eventId: 'current', id: input.requestId })).status, 200);
  assert.equal((await request()).data.draws.length, 0);
  assert.equal((await request('POST', input)).data.code, 'RAFFLE_DRAW_DELETED');
  assert.equal((await request('POST', { ...input, requestId: randomUUID() })).status, 200);
});

test('new draws require preview; legacy saved retries retain old hash without reading live database', async () => {
  const { state, store, request } = fixture();
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] };
  const missing = await request('POST', input);
  assert.equal(missing.status, 400); assert.equal(missing.data.code, 'RAFFLE_POOL_REQUIRED');
  assert.equal(store.records.size, 1);
  assert.equal((await store.get('events/current.json')).draws[0].failed, true);
  const legacyInput = { ...input, requestId: randomUUID() };
  const normalized = drawInput(legacyInput), legacy = { id: normalized.id, hash: normalized.hash, winners: [{ id: 'a', name: 'Ada' }] };
  await saveDraw(store, normalized, () => legacy);
  state.failRead = true; state.failEvents = true;
  assert.deepEqual((await request('POST', legacyInput)).data.draw, legacy);
});

test('stale previews fence new claims, changed rights, renames and claim timestamps without storing participants or winners', async () => {
  for (const mutate of [
    state => { state.attendance.push({ user_id: 'c', event_id: 'current', created_at: '2026-10-01' }); state.profiles.push({ id: 'c', name: 'Ceren' }); },
    state => { state.attendance = state.attendance.filter(a => !(a.user_id === 'a' && a.event_id === 'past')); },
    state => { state.profiles.find(p => p.id === 'a').name = 'New Name'; },
    state => { state.attendance.find(a => a.user_id === 'a' && a.event_id === 'current').created_at = '2026-10-01'; },
  ]) {
    const { state, store, request } = fixture();
    const preview = await request(); mutate(state);
    const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: preview.data.poolVersion };
    const result = await request('POST', input);
    assert.equal(result.status, 409); assert.equal(result.data.code, 'RAFFLE_POOL_CHANGED');
    assert.equal(store.records.size, 1);
    assert.deepEqual((await store.get('events/current.json')).draws, [{ id: input.requestId, hash: drawInput(input).hash, failed: true, status: 409, code: 'RAFFLE_POOL_CHANGED', message: result.data.error }]);
    assert.deepEqual((await request('GET', null, { action: 'history' })).data.draws, []);
    assert.equal((await request('GET', null, { action: 'result', requestId: input.requestId })).data.code, 'RAFFLE_POOL_CHANGED');
    assert.equal((await request('POST', { ...input, count: 2 })).data.code, 'RAFFLE_REQUEST_CONFLICT');
  }
});

test('result and history recovery bypass live event/catalog outages; missing results are safe and deleted draws stay deleted', async () => {
  const { state, store, request } = fixture();
  const preview = await request();
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: preview.data.poolVersion };
  const originalSet = store.setJSON.bind(store); let loseResponse = true;
  store.setJSON = async (...args) => { const committed = await originalSet(...args); if (loseResponse) { loseResponse = false; throw Error('lost response'); } return committed; };
  assert.equal((await request('POST', input)).status, 503);
  assert.equal(store.records.size, 1);
  state.failRead = true; state.failEvents = true;
  const recovered = await request('GET', null, { action: 'result', requestId: input.requestId });
  assert.equal(recovered.status, 200); assert.equal(recovered.cache, 'no-store'); assert.equal(recovered.data.draw.id, input.requestId);
  assert.deepEqual((await request('GET', null, { action: 'history' })).data.draws, [recovered.data.draw]);
  assert.equal((await request('GET', null, { action: 'result', requestId: randomUUID() })).data.draw, null);
  assert.equal((await request('GET', null, { action: 'result', requestId: input.requestId, auth: false })).status, 401);
  assert.equal((await request('GET', null, { action: 'history', auth: false })).status, 401);
  assert.deepEqual((await request('POST', input)).data.draw, recovered.data.draw);
  assert.equal((await request('DELETE', { eventId: 'current', id: input.requestId })).status, 200);
  const deleted = await request('GET', null, { action: 'result', requestId: input.requestId });
  assert.equal(deleted.status, 409); assert.equal(deleted.data.code, 'RAFFLE_DRAW_DELETED');
  assert.deepEqual((await request('GET', null, { action: 'history' })).data.draws, []);
  assert.equal((await request('POST', input)).data.code, 'RAFFLE_DRAW_DELETED');
});

test('API conditional conflicts keep a retryable request and the same payload can later succeed', async () => {
  const { store, request } = fixture();
  const preview = await request();
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: preview.data.poolVersion };
  const commit = store.setJSON.bind(store); let attempts = 0;
  store.setJSON = async () => { attempts++; return { modified: false }; };
  const conflict = await request('POST', input);
  assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'RAFFLE_RETRY');
  assert.equal(attempts, 12); assert.equal(store.records.size, 0);
  assert.equal((await request('GET', null, { action: 'result', requestId: input.requestId })).data.draw, null);
  store.setJSON = commit;
  const result = await request('POST', input);
  assert.equal(result.status, 200); assert.equal(result.data.draw.id, input.requestId);
  assert.equal((await request('GET', null, { action: 'history' })).data.draws.length, 1);
});

test('POST body failures are definite invalid selections before database reads or writes', async () => {
  const { state, store, request } = fixture();
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: Array.from({ length: 3000 }, () => randomUUID()), poolVersion: 'a'.repeat(64) };
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 100000);
  const oversized = await request('POST', input);
  assert.equal(oversized.status, 413); assert.equal(oversized.data.code, 'RAFFLE_INVALID_SELECTION');
  const malformed = await request('POST', null, { rawBody: '{' });
  assert.equal(malformed.status, 400); assert.equal(malformed.data.code, 'RAFFLE_INVALID_SELECTION');
  const wrongType = await request('POST', { ...input, excluded: [] }, { contentType: 'text/plain' });
  assert.equal(wrongType.status, 415); assert.equal(wrongType.data.code, 'RAFFLE_INVALID_SELECTION');
  assert.equal(state.reads.length, 0); assert.equal(store.records.size, 0);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('a stale-preview rejection that wins CAS fences an earlier validated draw before returning terminal error', { timeout: 3000 }, async () => {
  const { state, store, request } = fixture();
  const preview = await request();
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: preview.data.poolVersion };
  const reached = deferred(), release = deferred();
  const commit = store.setJSON.bind(store); let paused = false;
  store.setJSON = async (...args) => {
    if (!paused && args[1].draws[0].id === input.requestId && !args[1].draws[0].failed) {
      paused = true; reached.resolve(); await release.promise;
    }
    return commit(...args);
  };
  const original = request('POST', input);
  await reached.promise;
  state.attendance.push({ user_id: 'c', event_id: 'current', created_at: '2026-10-01' });
  state.profiles.push({ id: 'c', name: 'Late Claim' });
  const retry = await request('POST', input);
  assert.equal(retry.status, 409); assert.equal(retry.data.code, 'RAFFLE_POOL_CHANGED');
  release.resolve();
  const first = await original;
  assert.equal(first.status, 409); assert.equal(first.data.code, 'RAFFLE_POOL_CHANGED');
  const ledger = (await store.get('events/current.json')).draws;
  assert.equal(ledger.length, 1); assert.equal(ledger[0].failed, true);
  assert.equal(ledger[0].participants, undefined); assert.equal(ledger[0].winners, undefined);
  assert.deepEqual((await request('GET', null, { action: 'history' })).data.draws, []);
  assert.equal((await request('GET', null, { action: 'result', requestId: input.requestId })).data.code, 'RAFFLE_POOL_CHANGED');
  assert.equal((await request('DELETE', { eventId: 'current', id: input.requestId })).status, 200);
  assert.equal((await request('POST', input)).data.code, 'RAFFLE_DRAW_DELETED');
});

test('an earlier valid draw that wins CAS replaces a concurrent stale-preview rejection with its identical saved result', { timeout: 3000 }, async () => {
  const { state, store, request } = fixture();
  const preview = await request();
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: preview.data.poolVersion };
  const validReached = deferred(), validRelease = deferred(), rejectedReached = deferred(), rejectedRelease = deferred();
  const commit = store.setJSON.bind(store); let validPaused = false, rejectionPaused = false;
  store.setJSON = async (...args) => {
    const candidate = args[1].draws[0];
    if (candidate.failed && !rejectionPaused) {
      rejectionPaused = true; rejectedReached.resolve(); await rejectedRelease.promise;
    } else if (!candidate.failed && !validPaused) {
      validPaused = true; validReached.resolve(); await validRelease.promise;
    }
    return commit(...args);
  };
  const original = request('POST', input);
  await validReached.promise;
  state.attendance.push({ user_id: 'c', event_id: 'current', created_at: '2026-10-01' });
  state.profiles.push({ id: 'c', name: 'Late Claim' });
  const retry = request('POST', input);
  await rejectedReached.promise;
  validRelease.resolve();
  const first = await original;
  assert.equal(first.status, 200);
  rejectedRelease.resolve();
  const repeated = await retry;
  assert.equal(repeated.status, 200); assert.deepEqual(repeated.data.draw, first.data.draw);
  assert.equal(first.data.draw.participants.length, 2);
  assert.deepEqual((await request('GET', null, { action: 'history' })).data.draws, [first.data.draw]);
  assert.deepEqual((await request('GET', null, { action: 'result', requestId: input.requestId })).data.draw, first.data.draw);
});

test('uncertain rejection writes retain their request identity and reveal the committed rejection on recovery', async () => {
  const store = memory(), input = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: 'a'.repeat(64) });
  const commit = store.setJSON.bind(store); let first = true;
  store.setJSON = async (...args) => { const result = await commit(...args); if (first) { first = false; throw Error('rejection response lost'); } return result; };
  await assert.rejects(saveDraw(store, input, () => raffleFail(409, 'RAFFLE_POOL_CHANGED', 'Changed')), /rejection response lost/);
  await assert.rejects(saveDraw(store, input, () => assert.fail('rejected request cannot select winners')), error => error.code === 'RAFFLE_POOL_CHANGED');
  assert.deepEqual((await store.get('events/current.json')).draws, [{ id: input.id, hash: input.hash, failed: true, status: 409, code: 'RAFFLE_POOL_CHANGED', message: 'Changed' }]);
});
