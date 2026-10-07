import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createStaffHandler } from '../netlify/functions/staff.mjs';
import { adminLogin } from '../netlify/lib/security.mjs';
import community from '../netlify/functions/community.mjs';
import { createHandler as createRafflesHandler } from '../netlify/functions/raffles.mjs';
import { createRegistrationsHandler } from '../netlify/functions/registrations.mjs';

const oldPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = 'staff-unit-admin-only-password';
after(() => {
  if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = oldPassword;
});
const origin = 'https://site.test';
const adminCookie = adminLogin(new Request(origin, { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
const credentials = { username: 'door-worker', password: 'synthetic-door-password', name: 'Kapı görevlisi', eventIds: ['event-one'] };

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

function fixture() {
  const storage = memory();
  const events = [{ id: 'event-one', title: 'Birinci etkinlik' }, { id: 'event-two', title: 'İkinci etkinlik' }];
  const state = { now: new Date(), failEvents: false };
  const makeHandler = () => createStaffHandler({ store: () => storage,
    events: async () => { if (state.failEvents) throw Error('private catalog failure'); return structuredClone(events); },
    now: () => new Date(state.now), uuid: randomUUID });
  const handler = makeHandler();
  const request = async (action = 'session', { method = 'GET', input, cookie, auth = false, id,
    headers = {}, rawBody, handler: selectedHandler = handler } = {}) => {
    const url = new URL(origin + '/api/staff');
    url.searchParams.set('action', action);
    if (id) url.searchParams.set('id', id);
    return selectedHandler(new Request(url, { method,
      headers: { Origin: origin, 'x-nf-client-connection-ip': '192.0.2.15',
        ...(auth ? { cookie: adminCookie } : cookie ? { cookie } : {}),
        ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(method !== 'GET' ? { body: input !== undefined ? JSON.stringify(input) : rawBody } : {}) }));
  };
  const create = async (overrides = {}) => {
    const result = await request('accounts', { method: 'POST', auth: true, input: { ...credentials, ...overrides } });
    assert.equal(result.status, 201, await result.clone().text());
    return (await result.json()).account;
  };
  const login = async (input = credentials, options = {}) => request('login', { method: 'POST', input: { username: input.username, password: input.password }, ...options });
  return { storage, events, state, request, create, login, makeHandler };
}

test('staff management requires a signed administrator session and rejects foreign mutations before I/O', async () => {
  const { request, storage } = fixture();
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await request('accounts', { method, input: method === 'POST' ? credentials : undefined,
      id: randomUUID(), headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).status, 401);
  }
  assert.equal((await request('session', { headers: { cookie: adminCookie + 'tampered' } })).status, 401);
  assert.equal(storage.calls.length, 0);
  for (const action of ['accounts', 'login', 'logout']) {
    assert.equal((await request(action, { method: 'POST', auth: true, input: credentials,
      headers: { Origin: 'https://foreign.test' } })).status, 403);
  }
  assert.equal(storage.calls.length, 0);
});

test('staff passwords use independent salts; account responses and lists never expose credentials', async () => {
  const { create, request, storage } = fixture();
  const first = await create();
  const second = await create({ username: 'second-worker', name: 'İkinci görevli' });
  assert.notEqual(first.id, second.id);
  const list = await request('accounts', { auth: true });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  const data = await list.json();
  assert.equal(data.accounts.length, 2);
  assert.deepEqual(data.events.map(e => e.id), ['event-one', 'event-two']);
  const stored = (await storage.get('staff/state.json')).accounts;
  assert.equal(stored.length, 2);
  assert.notEqual(stored[0].salt, stored[1].salt);
  assert.notEqual(stored[0].passwordHash, stored[1].passwordHash);
  for (const account of stored) {
    assert.ok(account.passwordHash && account.salt);
    assert.notEqual(account.passwordHash, credentials.password);
    assert.equal(Object.hasOwn(account, 'password'), false);
  }
  const publicText = JSON.stringify({ first, second, data });
  for (const secret of [credentials.password, ...stored.flatMap(a => [a.passwordHash, a.salt])]) assert.equal(publicText.includes(secret), false);
});

test('staff account inputs enforce password bounds, scoped events and unique normalized usernames', async () => {
  const { create, request, storage } = fixture();
  const invalid = [{ password: 'short' }, { password: 'x'.repeat(129) }, { password: 12345678 },
    { username: '../worker' }, { username: '' }, { name: '' }, { eventIds: ['unknown'] },
    { eventIds: ['event-one,query'] }, { eventIds: 'event-one' }, { eventIds: [] }];
  for (const change of invalid) {
    const result = await request('accounts', { method: 'POST', auth: true, input: { ...credentials, ...change } });
    assert.equal(result.status, 400, JSON.stringify(change));
    assert.equal((await storage.get('staff/state.json'))?.accounts?.length || 0, 0);
  }
  await create();
  const duplicate = await request('accounts', { method: 'POST', auth: true, input: { ...credentials, username: 'DOOR-WORKER' } });
  assert.equal(duplicate.status, 409);
  assert.equal((await storage.get('staff/state.json')).accounts.length, 1);
});

test('signed staff sessions are private, scoped, expire, and immediately stop after account revocation', async () => {
  const { create, login, request, state } = fixture();
  const account = await create();
  const logged = await login();
  assert.equal(logged.status, 200);
  const fullCookie = logged.headers.get('set-cookie');
  assert.match(fullCookie, /^ercupsa_gate=.*HttpOnly.*SameSite=Strict.*Secure/);
  const cookie = fullCookie.split(';')[0];
  assert.equal(fullCookie.includes(credentials.password), false);
  const session = await request('session', { cookie });
  assert.equal(session.status, 200);
  const { operator } = await session.json();
  assert.equal(operator.role, 'staff');
  assert.deepEqual(operator.eventIds, ['event-one']);
  assert.equal(operator.id, account.id);
  assert.equal((await request('session', { cookie: cookie + 'x' })).status, 401);
  assert.equal((await request('session', { cookie: cookie.slice(0, -1) + 'é' })).status, 401);
  assert.equal((await request('accounts', { cookie })).status, 401);
  const revoked = await request('accounts', { method: 'DELETE', auth: true, id: account.id });
  assert.equal(revoked.status, 200);
  assert.equal((await request('session', { cookie })).status, 401);
  assert.equal((await login()).status, 401);

  await create({ username: 'expiry-worker' });
  const expiryCookie = (await login({ ...credentials, username: 'expiry-worker' })).headers.get('set-cookie').split(';')[0];
  state.now = new Date(state.now.getTime() + 8 * 60 * 60 * 1000 + 1);
  assert.equal((await request('session', { cookie: expiryCookie })).status, 401);
});

test('staff sessions cannot authorize community, raffle, registration or account administration', async () => {
  const { create, login, request } = fixture();
  await create();
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  const denyDb = () => assert.fail('staff must not reach private admin data');
  const routes = [
    [community, '/api/community?action=admin'],
    [createRafflesHandler({ store: denyDb, read: denyDb, events: denyDb }), '/api/raffles?eventId=event-one'],
    [createRegistrationsHandler({ getStore: denyDb, readEvents: denyDb }), '/api/registrations?action=admin&event_id=event-one'],
  ];
  for (const [handler, path] of routes) {
    const result = await handler(new Request(origin + path, { headers: { cookie } }));
    assert.equal(result.status, 401, path);
  }
  assert.equal((await request('accounts', { method: 'POST', cookie, input: credentials })).status, 401);
});

test('login attempts are limited durably across handler instances and reset after the window', async () => {
  const { create, login, makeHandler, state, request } = fixture();
  await create();
  for (let i = 0; i < 10; i++) {
    const result = await login({ ...credentials, password: 'wrong-synthetic-password' }, { handler: makeHandler() });
    assert.equal(result.status, 401);
  }
  assert.equal((await login(credentials, { handler: makeHandler() })).status, 429);
  // A different event account name does not escape the IP/account bucket by changing case.
  assert.equal((await login({ ...credentials, username: 'DOOR-WORKER' })).status, 429);
  state.now = new Date(state.now.getTime() + 15 * 60 * 1000 + 1);
  const result = await login();
  assert.equal(result.status, 200);
  assert.equal((await request('session', { cookie: result.headers.get('set-cookie').split(';')[0] })).status, 200);
});

test('concurrent account creations preserve distinct users and prevent duplicate usernames', async () => {
  const { request, storage } = fixture();
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => request('accounts', {
    method: 'POST', auth: true, input: { ...credentials, username: `parallel-worker-${i}` },
  })));
  for (const result of results) assert.equal(result.status, 201);
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => request('accounts', {
    method: 'POST', auth: true, input: credentials,
  })));
  assert.deepEqual(duplicates.map(r => r.status).sort(), [201, 409, 409, 409]);
  const stored = (await storage.get('staff/state.json')).accounts;
  assert.equal(stored.length, 5);
  assert.equal(new Set(stored.map(a => a.id)).size, 5);
});

test('concurrent password attempts cannot exceed the account limit and rotating names cannot bypass the IP limit', async () => {
  const concurrent = fixture();
  await concurrent.create();
  const attempts = await Promise.all(Array.from({ length: 12 }, () => concurrent.login({
    ...credentials, password: 'wrong-synthetic-password',
  }, { handler: concurrent.makeHandler() })));
  assert.equal(attempts.filter(result => result.status === 401).length, 10);
  assert.equal(attempts.filter(result => result.status === 429).length, 2);

  const rotating = fixture();
  const rateKey = 'staff/rates/' + createHash('sha256').update('192.0.2.15').digest('hex');
  rotating.storage.records.set(rateKey, { etag: 'seed', data: {
    hits: 49, expires: rotating.state.now.getTime() + 15 * 60 * 1000,
  } });
  assert.equal((await rotating.login({ username: 'first-unknown', password: 'synthetic-password' })).status, 401);
  assert.equal((await rotating.login({ username: 'second-unknown', password: 'synthetic-password' }, {
    handler: rotating.makeHandler(),
  })).status, 429);
  const rateRecords = [...rotating.storage.records].filter(([key]) => key.startsWith('staff/rates/'));
  assert.ok(rateRecords.every(([key]) => /^staff\/rates\/[a-f0-9]{64}$/.test(key)));
  const text = JSON.stringify(rateRecords);
  for (const privateValue of ['192.0.2.15', 'first-unknown', 'second-unknown', 'synthetic-password']) assert.equal(text.includes(privateValue), false);
});

test('missing CAS metadata, storage errors and malformed login bodies fail closed without secret details', async () => {
  const { create, login, request, storage } = fixture();
  await create();
  const before = structuredClone((await storage.get('staff/state.json')).accounts);
  storage.hooks.metadata = (key, record) => key === 'staff/state.json' ? { data: record.data } : record;
  assert.equal((await request('accounts', { method: 'POST', auth: true,
    input: { ...credentials, username: 'unsafe-write' } })).status, 503);
  assert.deepEqual((await storage.get('staff/state.json')).accounts, before);
  delete storage.hooks.metadata;
  storage.hooks.read = () => { throw Error('private storage credentials and details'); };
  const failed = await login();
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('private storage'), false);
  delete storage.hooks.read;
  assert.equal((await request('login', { method: 'POST', rawBody: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('login', { method: 'POST', rawBody: '{bad', headers: { 'Content-Type': 'application/json' } })).status, 400);
});
