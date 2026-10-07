import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { participantsFor, weightedWinners, drawInput, saveDraw, deleteDraw, paged } from '../netlify/lib/raffles.mjs';
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
test('claimed accounts only; distinct earlier events give bonus, future tickets do not', () => {
  const pool = participantsFor(events[0], events, attendance, profiles, Date.parse('2026-10-07T18:00:00+03:00'));
  assert.equal(pool.length, 2);
  assert.equal(pool.find(p => p.id === 'a').weight, 3);
  assert.equal(pool.find(p => p.id === 'b').weight, 1);
});
test('future events before a selected future event are not treated as past participation', () => {
  const futureEvents = [{ id: 'selected', date: '2027-03-01' }, { id: 'early', date: '2027-02-01' }];
  const claims = [{ user_id: 'a', event_id: 'selected', created_at: '2026-10-01' }, { user_id: 'a', event_id: 'early', created_at: '2026-09-01' }];
  assert.equal(participantsFor(futureEvents[0], futureEvents, claims, profiles, Date.parse('2026-10-07'))[0].weight, 1);
});
test('weighted boundaries reflect rights and winners cannot repeat', () => {
  const pool = [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }];
  assert.deepEqual([0, 1, 2, 3].map(n => weightedWinners(pool, 1, () => n)[0].id), ['a', 'a', 'a', 'b']);
  assert.deepEqual(weightedWinners(pool, 2, () => 0).map(p => p.id), ['a', 'b']);
  assert.throws(() => weightedWinners(pool, 3), /kişi sayısını/);
  assert.equal(pool.length, 2);
});
test('database paging reads beyond 1000 records without silently truncating', async () => {
  const data = Array.from({ length: 1251 }, (_, id) => ({ id }));
  let calls = 0;
  const all = await paged('attendance?select=user_id', async path => {
    calls++; const u = new URL('https://test/' + path);
    return data.slice(Number(u.searchParams.get('offset')), Number(u.searchParams.get('offset')) + 500);
  });
  assert.equal(all.length, 1251); assert.equal(calls, 3);
});
test('input rejects spoofed count, malformed identity and exclusion values', () => {
  const valid = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: ['b', 'b'] };
  assert.deepEqual(drawInput(valid).excluded, ['b']);
  for (const change of [{ count: 0 }, { count: '2' }, { count: 201 }, { requestId: 'anything' }, { excluded: ['bad,query'] }]) assert.throws(() => drawInput({ ...valid, ...change }));
});
test('concurrent retries save once, payload changes conflict, deletion tombstones prevent resurrection', async () => {
  const store = memory(), input = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] });
  const create = () => ({ id: input.id, hash: input.hash, winner: randomUUID() });
  const results = await Promise.all(Array.from({ length: 6 }, () => saveDraw(store, input, create)));
  assert.equal(new Set(results.map(d => d.winner)).size, 1);
  assert.equal((await store.get('events/current.json')).draws.length, 1);
  await assert.rejects(saveDraw(store, { ...input, hash: 'changed' }, create), /farklı/);
  await deleteDraw(store, 'current', input.id);
  await deleteDraw(store, 'current', input.id);
  assert.deepEqual((await store.get('events/current.json')).draws, [{ id: input.id, deleted: true }]);
  await assert.rejects(saveDraw(store, input, create), /silindi/);
  const next = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] });
  await saveDraw(store, next, () => ({ id: next.id, hash: next.hash }));
  assert.equal((await store.get('events/current.json')).draws.length, 2);
});
test('failed conditional writes and missing etags never report success', async () => {
  const input = drawInput({ requestId: randomUUID(), eventId: 'current', count: 1, excluded: [] });
  await assert.rejects(saveDraw({ getWithMetadata: async () => ({ data: { draws: [] } }), setJSON: () => assert.fail('unsafe write') }, input, () => ({})), /doğrulanamadı/);
  await assert.rejects(saveDraw({ getWithMetadata: async () => null, setJSON: async () => ({ modified: false }) }, input, () => ({})), /değişti/);
});
test('private API enforces admin/origin, recomputes weights, excludes selected accounts, persists and deletes history', async () => {
  process.env.ADMIN_PASSWORD = 'raffle-test-admin';
  const cookie = adminLogin(new Request('https://site.test', { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
  const store = memory(); let failRead = false;
  const handler = createHandler({ store: () => store, events: async () => events, read: async path => {
    if (failRead) throw Error('offline');
    const u = new URL('https://db.test/' + path);
    let rows = u.pathname === '/profiles' ? profiles : attendance;
    if (u.searchParams.has('event_id')) rows = rows.filter(a => a.event_id === u.searchParams.get('event_id').slice(3));
    const filter = u.searchParams.get('user_id') || u.searchParams.get('id');
    if (filter) { const ids = filter.slice(4, -1).split(','); rows = rows.filter(p => ids.includes(p.user_id || p.id)); }
    const offset = Number(u.searchParams.get('offset'));
    return rows.slice(offset, offset + Number(u.searchParams.get('limit')));
  } });
  async function request(method = 'GET', data, auth = true, origin = 'https://site.test') {
    const r = await handler(new Request('https://site.test/api/raffles?eventId=current', { method, headers: { 'Content-Type': 'application/json', ...(auth ? { cookie } : {}), origin }, ...(data ? { body: JSON.stringify(data) } : {}) }));
    return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') };
  }
  assert.equal((await request('GET', null, false)).status, 401);
  const initial = await request(); assert.equal(initial.cache, 'no-store'); assert.equal(initial.data.participants.length, 2);
  const input = { requestId: randomUUID(), eventId: 'current', count: 1, excluded: ['b'], weights: { a: 999 } };
  assert.equal((await request('POST', input, true, 'https://evil.test')).status, 403);
  const result = await request('POST', input); assert.equal(result.status, 200);
  assert.deepEqual(result.data.draw.winners.map(p => p.id), ['a']);
  assert.equal(result.data.draw.winners[0].weight, 3);
  failRead = true;
  assert.deepEqual((await request('POST', input)).data.draw, result.data.draw); // persisted retry works even if database unavailable
  failRead = false;
  assert.equal((await request('POST', { ...input, count: 2 })).status, 409);
  assert.equal((await request('POST', { ...input, requestId: randomUUID(), count: 2 })).status, 400);
  assert.equal((await request('POST', { ...input, requestId: randomUUID(), excluded: ['outsider'] })).status, 409);
  assert.equal((await request()).data.draws.length, 1);
  assert.equal((await request('DELETE', { eventId: 'current', id: input.requestId })).status, 200);
  assert.equal((await request()).data.draws.length, 0);
  assert.equal((await request('POST', input)).status, 409);
  assert.equal((await request('POST', { ...input, requestId: randomUUID() })).status, 200);
});
