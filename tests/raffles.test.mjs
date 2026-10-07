import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { participantsFor, poolVersion, drawChances, weightedWinners, drawInput, saveDraw, deleteDraw, updatePrize, paged, raffleFail } from '../netlify/lib/raffles.mjs';
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
test('disabling loyalty gives equal first-choice odds and preserves the verified preview', () => {
  const base = [{ id: 'a', previous: 2, weight: 3 }, { id: 'b', previous: 0, weight: 1 }];
  const version = poolVersion('current', base);
  const equal = drawChances(base, false);
  assert.deepEqual([0, 1].map(ticket => weightedWinners(equal, 1, () => ticket)[0].id), ['a', 'b']);
  assert.deepEqual(weightedWinners(equal, 2, () => 0).map(p => p.id), ['a', 'b']);
  assert.deepEqual(equal.map(p => p.previous), [2, 0]);
  assert.deepEqual(drawChances(base, true).map(p => p.weight), [3, 1]);
  assert.equal(poolVersion('current', base), version);
  assert.deepEqual(base.map(p => p.weight), [3, 1]);
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
  assert.equal(Object.hasOwn(legacy, 'loyaltyBonus'), false);
  const weighted = drawInput({ ...valid, loyaltyBonus: true });
  const equal = drawInput({ ...valid, loyaltyBonus: false });
  assert.equal(weighted.loyaltyBonus, true); assert.equal(equal.loyaltyBonus, false);
  assert.notEqual(weighted.hash, legacy.hash); assert.notEqual(equal.hash, weighted.hash);
  for (const field of ['checkedInOnly', 'checkinBonus']) {
    assert.equal(Object.hasOwn(legacy, field), false);
    assert.equal(drawInput({ ...valid, [field]: true })[field], true);
    assert.equal(drawInput({ ...valid, [field]: false })[field], false);
    assert.notEqual(drawInput({ ...valid, [field]: true }).hash, drawInput({ ...valid, [field]: false }).hash);
    assert.notEqual(drawInput({ ...valid, [field]: false }).hash, legacy.hash);
    for (const invalid of ['false', 0, null, {}]) {
      assert.throws(() => drawInput({ ...valid, [field]: invalid }), error => error.code === 'RAFFLE_INVALID_SELECTION');
    }
  }
  for (const change of [{ count: 0 }, { count: '2' }, { count: 201 }, { requestId: 'anything' }, { excluded: ['bad,query'] }, { poolVersion: 'bad' }, { loyaltyBonus: 'false' }, { loyaltyBonus: 0 }, { loyaltyBonus: null }]) {
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
    profiles: structuredClone(profiles), reads: [], checkins: {}, checkinReads: [], failCheckins: false,
  };
  const store = memory();
  const handler = createHandler({ store: () => store, events: async () => { if (state.failEvents) throw Error('events offline'); return state.events; }, checkins: async eventId => {
    state.checkinReads.push(eventId);
    if (state.failCheckins) throw Error('checkins offline');
    return structuredClone(state.checkins[eventId] || []);
  }, read: async path => {
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
  async function request(method = 'GET', data, { auth = true, origin = 'https://site.test', action, eventId = 'current', requestId, rawBody, contentType = 'application/json', checkedInOnly, checkinBonus } = {}) {
    const url = new URL('https://site.test/api/raffles');
    url.searchParams.set('eventId', eventId);
    if (action) url.searchParams.set('action', action);
    if (requestId) url.searchParams.set('requestId', requestId);
    if (checkedInOnly !== undefined) url.searchParams.set('checkedInOnly', String(checkedInOnly));
    if (checkinBonus !== undefined) url.searchParams.set('checkinBonus', String(checkinBonus));
    const r = await handler(new Request(url, { method, headers: { 'Content-Type': contentType, ...(auth ? { cookie } : {}), origin }, ...(rawBody !== undefined ? { body: rawBody } : data ? { body: JSON.stringify(data) } : {}) }));
    return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') };
  }
  return { state, store, request };
}

test('API saves the chosen chance mode with authoritative rights and refuses mode changes on the same draw ID', async () => {
  const { state, request } = fixture();
  const preview = (await request()).data;
  for (const mode of [false, true, undefined]) {
    const input = { requestId: randomUUID(), eventId: 'current', count: 2, excluded: [], poolVersion: preview.poolVersion,
      ...(mode !== undefined ? { loyaltyBonus: mode } : {}), weights: { a: 9999, b: 0 } };
    const result = await request('POST', input);
    assert.equal(result.status, 200);
    const draw = result.data.draw;
    assert.equal(draw.loyaltyBonus, mode !== false);
    assert.deepEqual(draw.participants.map(p => p.weight).sort(), mode === false ? [1, 1] : [1, 2]);
    assert.equal(draw.participants.find(p => p.id === 'a').previous, 1);
    assert.equal(new Set(draw.winners.map(p => p.id)).size, 2);
    assert.ok(draw.winners.every(p => p.weight === (mode === false ? 1 : 1 + p.previous)));
    assert.equal((await request()).data.poolVersion, preview.poolVersion);
    state.failRead = true;
    assert.deepEqual((await request('POST', input)).data.draw, draw);
    assert.equal((await request('POST', { ...input, loyaltyBonus: mode === false })).data.code, 'RAFFLE_REQUEST_CONFLICT');
    assert.deepEqual((await request('GET', null, { action: 'result', requestId: input.requestId })).data.draw, draw);
    state.failRead = false;
  }
  const history = (await request('GET', null, { action: 'history' })).data.draws;
  assert.deepEqual(history.map(d => d.loyaltyBonus), [true, true, false]);
});

test('an equal-chance draw with a lost response recovers its mode and respects exclusions', async () => {
  const { state, store, request } = fixture();
  const preview = (await request()).data;
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: ['b'], poolVersion: preview.poolVersion, loyaltyBonus: false };
  const commit = store.setJSON.bind(store); let first = true;
  store.setJSON = async (...args) => { const result = await commit(...args); if (first) { first = false; throw Error('lost equal draw response'); } return result; };
  assert.equal((await request('POST', input)).status, 503);
  state.failRead = true; state.failEvents = true;
  const recovered = (await request('GET', null, { action: 'result', requestId: input.requestId })).data.draw;
  assert.equal(recovered.loyaltyBonus, false);
  assert.deepEqual(recovered.winners.map(p => [p.id, p.weight]), [['a', 1]]);
  assert.equal(recovered.winners[0].previous, 1);
  assert.deepEqual((await request('POST', input)).data.draw, recovered);
  assert.equal((await request('POST', { ...input, loyaltyBonus: true })).data.code, 'RAFFLE_REQUEST_CONFLICT');
});

test('entry-only preview admits claimed accounts through user or ticket links and fences later entrance changes', async () => {
  const { state, request } = fixture();
  state.attendance.find(a => a.user_id === 'a' && a.event_id === 'current').ticket_id = 'ticket-a';
  state.attendance.find(a => a.user_id === 'b' && a.event_id === 'current').ticket_id = 'ticket-b';
  state.checkins.current = [
    { ticketId: 'ticket-a', userId: null, name: 'Ada', enteredAt: '2026-10-07T12:00:00Z' },
    { ticketId: 'unclaimed', userId: 'outsider', name: 'Dışarıda', enteredAt: '2026-10-07T12:00:00Z' },
  ];
  const ordinary = (await request()).data;
  assert.equal(ordinary.participants.length, 2);
  assert.equal(state.checkinReads.length, 0, 'legacy mode must work without entrance storage');
  const query = { checkedInOnly: true };
  const preview = (await request('GET', null, query)).data;
  assert.deepEqual(preview.participants.map(p => p.id), ['a']);
  assert.notEqual(preview.poolVersion, ordinary.poolVersion);
  state.checkins.current.push({ ticketId: 'ticket-b', userId: 'b', name: 'Bora', enteredAt: '2026-10-07T12:00:00Z' });
  const stale = await request('POST', { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], checkedInOnly: true, poolVersion: preview.poolVersion });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'RAFFLE_POOL_CHANGED');
  const fresh = (await request('GET', null, query)).data;
  assert.deepEqual(fresh.participants.map(p => p.id).sort(), ['a', 'b']);
  const input = { requestId: randomUUID(), eventId: 'current', count: 2, excluded: [], checkedInOnly: true, poolVersion: fresh.poolVersion };
  const result = await request('POST', input);
  assert.equal(result.status, 200); assert.equal(result.data.draw.checkedInOnly, true);
  assert.equal(result.data.draw.checkinBonus, false);
  assert.deepEqual(result.data.draw.winners.map(p => p.id).sort(), ['a', 'b']);
  state.failRead = true; state.failEvents = true; state.failCheckins = true;
  assert.deepEqual((await request('POST', input)).data.draw, result.data.draw);
  assert.equal((await request('POST', { ...input, checkedInOnly: false })).data.code, 'RAFFLE_REQUEST_CONFLICT');
});

test('real-entry bonuses use distinct known past events and link a null entrance account through its claimed ticket', async () => {
  const { state, request } = fixture();
  state.events.push({ id: 'claimed-only', date: '2026-08-01' });
  state.attendance.push({ user_id: 'a', event_id: 'claimed-only', ticket_id: 'ticket-unused', created_at: '2026-08-01' });
  state.attendance.find(a => a.user_id === 'a' && a.event_id === 'past').ticket_id = 'ticket-past';
  state.attendance.find(a => a.user_id === 'a' && a.event_id === 'future').ticket_id = 'ticket-future';
  state.checkins.past = [
    { ticketId: 'ticket-past', userId: null, enteredAt: '2026-09-01T12:00:00Z' },
    { ticketId: 'ticket-another', userId: 'a', enteredAt: '2026-09-01T12:01:00Z' },
  ];
  state.checkins.future = [{ ticketId: 'ticket-future', userId: 'a', enteredAt: '2026-09-01T12:00:00Z' }];
  state.checkins.archived = [{ ticketId: 'ticket-unknown', userId: 'a', enteredAt: '2026-08-01T12:00:00Z' }];
  const base = (await request()).data;
  assert.equal(base.participants.find(p => p.id === 'a').previous, 2);
  const entered = (await request('GET', null, { checkinBonus: true })).data;
  assert.equal(entered.participants.find(p => p.id === 'a').previous, 1);
  assert.equal(entered.participants.find(p => p.id === 'a').weight, 2);
  assert.equal(entered.participants.find(p => p.id === 'b').weight, 1);
  assert.ok(!state.checkinReads.includes('future'), 'future events cannot grant entrance bonuses');
  assert.ok(!state.checkinReads.includes('archived'), 'unknown event dates cannot grant entrance bonuses');
  const input = { requestId: randomUUID(), eventId: 'current', count: 2, excluded: [], poolVersion: entered.poolVersion, checkinBonus: true, loyaltyBonus: false };
  const result = await request('POST', input);
  assert.equal(result.status, 200);
  assert.equal(result.data.draw.checkinBonus, true);
  assert.deepEqual(result.data.draw.winners.map(p => p.weight), [1, 1]);
  assert.equal(result.data.draw.winners.find(p => p.id === 'a').previous, 1);
});

test('entry query modes reject malformed booleans, fail closed on storage outages and require matching preview', async () => {
  const { state, request } = fixture();
  for (const field of ['checkedInOnly', 'checkinBonus']) {
    for (const value of ['0', 'TRUE', '', 'true,or(user_id.gt.a)']) {
      const invalid = await request('GET', null, { [field]: value });
      assert.equal(invalid.status, 400);
    }
  }
  assert.equal(state.reads.length, 0);
  const base = (await request()).data;
  state.failCheckins = true;
  assert.equal((await request()).status, 200);
  assert.equal((await request('GET', null, { checkedInOnly: true })).status, 503);
  state.failCheckins = false;
  const mismatched = await request('POST', { requestId: randomUUID(), eventId: 'current', count: 1, excluded: [], poolVersion: base.poolVersion, checkedInOnly: true });
  assert.equal(mismatched.data.code, 'RAFFLE_POOL_CHANGED');
});

test('prize delivery API enforces admin/origin and only updates saved winners with a strict boolean', async () => {
  const { state, request } = fixture();
  const preview = (await request()).data;
  const input = { requestId: randomUUID(), eventId: 'current', count: 2, excluded: [], poolVersion: preview.poolVersion };
  const saved = (await request('POST', input)).data.draw;
  const prize = { eventId: 'current', id: saved.id, winnerId: 'a', delivered: true };
  const query = { action: 'prize' };
  assert.equal((await request('POST', prize, { ...query, auth: false })).status, 401);
  assert.equal((await request('POST', prize, { ...query, origin: 'https://evil.test' })).status, 403);
  for (const delivered of ['true', 1, null]) {
    assert.equal((await request('POST', { ...prize, delivered }, query)).status, 400);
  }
  assert.equal((await request('POST', { ...prize, winnerId: 'outsider' }, query)).status, 404);
  assert.equal((await request('POST', { ...prize, winnerId: '../a' }, query)).status, 400);
  state.failRead = true; state.failEvents = true; state.failCheckins = true;
  const updated = await request('POST', prize, query);
  assert.equal(updated.status, 200);
  const winner = updated.data.draw.winners.find(p => p.id === 'a');
  assert.equal(winner.prizeDelivered, true);
  assert.equal(winner.prizeDeliveredBy, 'admin');
  assert.ok(Number.isFinite(Date.parse(winner.prizeDeliveredAt)));
  assert.deepEqual(updated.data.draw.participants, saved.participants);
  assert.deepEqual(updated.data.draw.winners.map(p => p.id), saved.winners.map(p => p.id));
  const again = (await request('POST', prize, query)).data.draw;
  assert.equal(again.winners.find(p => p.id === 'a').prizeDeliveredAt, winner.prizeDeliveredAt);
  assert.equal((await request('GET', null, { action: 'history' })).data.draws[0].winners.find(p => p.id === 'a').prizeDelivered, true);
  const reset = (await request('POST', { ...prize, delivered: false }, query)).data.draw.winners.find(p => p.id === 'a');
  assert.equal(reset.prizeDelivered, false);
  assert.ok(!reset.prizeDeliveredAt); assert.ok(!reset.prizeDeliveredBy);
});

test('concurrent prize updates preserve distinct winners and deletion fences an in-flight delivery', { timeout: 3000 }, async () => {
  const store = memory(), input = drawInput({ requestId: randomUUID(), eventId: 'current', count: 2, excluded: [] });
  const draw = { id: input.id, hash: input.hash, eventId: 'current', participants: [{ id: 'a' }, { id: 'b' }], winners: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bora' }] };
  await saveDraw(store, input, () => draw);
  await Promise.all(['a', 'b'].map(id => updatePrize(store, 'current', input.id, id, true)));
  const delivered = (await store.get('events/current.json')).draws[0];
  assert.deepEqual(delivered.winners.map(p => p.prizeDelivered), [true, true]);
  assert.equal(Object.hasOwn(delivered, 'loyaltyBonus'), false, 'prize updates preserve legacy draw metadata');
  const reached = deferred(), release = deferred(), commit = store.setJSON.bind(store);
  let pause = true;
  store.setJSON = async (...args) => {
    if (pause) { pause = false; reached.resolve(); await release.promise; }
    return commit(...args);
  };
  const updating = updatePrize(store, 'current', input.id, 'a', false);
  await reached.promise;
  await deleteDraw(store, 'current', input.id);
  release.resolve();
  await assert.rejects(updating, error => error.code === 'RAFFLE_DRAW_DELETED');
  assert.deepEqual((await store.get('events/current.json')).draws, [{ id: input.id, deleted: true }]);
});

test('a lost prize write response recovers the same delivery without touching saved draw identity', async () => {
  const { store, request } = fixture();
  const preview = (await request()).data;
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: ['b'], poolVersion: preview.poolVersion };
  const original = (await request('POST', input)).data.draw;
  const prize = { eventId: 'current', id: original.id, winnerId: 'a', delivered: true };
  const commit = store.setJSON.bind(store); let first = true;
  store.setJSON = async (...args) => { const result = await commit(...args); if (first) { first = false; throw Error('lost prize response'); } return result; };
  assert.equal((await request('POST', prize, { action: 'prize' })).status, 503);
  const recovered = (await request('GET', null, { action: 'result', requestId: original.id })).data.draw;
  assert.equal(recovered.winners[0].prizeDelivered, true);
  assert.deepEqual((await request('POST', prize, { action: 'prize' })).data.draw, recovered);
  assert.equal(recovered.hash, original.hash); assert.equal(recovered.poolVersion, original.poolVersion);
  assert.deepEqual((await request('POST', input)).data.draw, recovered);
});

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
