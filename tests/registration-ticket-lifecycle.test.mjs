import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCommunityHandler } from '../netlify/functions/community.mjs';
import { createHandler as createRaffleHandler } from '../netlify/functions/raffles.mjs';
import { adminLogin } from '../netlify/lib/security.mjs';
import { readRegistrationTicketRestrictions } from '../netlify/lib/registration-ticket-owners.mjs';
import { readRegistrationParticipants } from '../netlify/lib/raffle-registrations.mjs';

const origin = 'https://site.test', eventId = 'event-one';
const code = 'ERC-' + '1'.repeat(24), hash = value => createHash('sha256').update(value).digest('hex');
const oldPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = 'registration-lifecycle-unit-password';
after(() => { if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = oldPassword; });
const cookie = adminLogin(new Request(origin, { headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } })).split(';')[0];
const person = (extra = {}) => ({ id: 'entry-one', eventId, name: 'Form Katılımcısı',
  createdAt: '2026-01-01T10:00:00Z', phone: 'PRIVATE_PHONE', answers: { private: 'PRIVATE_ANSWER' },
  ticket: { batchId: 'batch-one', code, status: 'issued' }, ...extra });
function memory(ledger) {
  return { ledger, fail: false,
    async get(key) { if (this.fail) throw Error('PRIVATE_STORAGE_CREDENTIAL'); return key === `state/${eventId}.json` ? structuredClone(this.ledger) : null; },
    async list() { return { blobs: [] }; } };
}
const canonical = entries => ({ version: 1, eventId, entries, deleted: [] });
function claimFixture(ledger = canonical([])) {
  const registrationStore = memory(ledger), calls = [];
  const state = { tickets: [{ id: 'ticket-one', event_id: eventId, batch_id: 'batch-one', code_hash: hash(code), revoked: false }], claims: 0 };
  const handler = createCommunityHandler({ registrationStore, currentUser: async () => ({ id: 'account-one' }),
    read: async (path, options) => {
      calls.push({ path, options });
      if (path === 'rpc/check_rate') return true;
      if (path.startsWith('tickets?')) return structuredClone(state.tickets);
      if (path === 'rpc/claim_ticket') { state.claims++; return { ok: true, event_id: eventId }; }
      assert.fail('Unexpected database access');
    } });
  const request = (input = { code }) => handler(new Request(`${origin}/api/community?action=claim`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
  return { registrationStore, state, calls, request };
}

test('account claims cannot revive cancelled, waiting or deleted reservations while SQL revoke is delayed', async () => {
  for (const ledger of [canonical([person({ registrationStatus: 'cancelled' })]), canonical([person({ registrationStatus: 'waitlisted' })]),
    { ...canonical([]), deleted: [{ id: 'entry-one', ticket: person().ticket }] }]) {
    const { state, request } = claimFixture(ledger);
    assert.equal(state.tickets[0].revoked, false);
    const result = await request();
    assert.equal(result.status, 409);
    assert.equal(state.claims, 0, 'SQL claim RPC must never run for a canonically blocked reservation');
    const text = await result.text();
    assert.equal(text.includes(code), false); assert.equal(text.includes('PRIVATE_'), false);
  }
});

test('account claim preserves ordinary manual batches and accepted legacy main tickets', async () => {
  for (const ledger of [canonical([]), canonical([person()]), canonical([person({
    registrationStatus: 'cancelled', ticket: { ...person().ticket, batchId: 'different-batch' } })])]) {
    const { request, state, calls } = claimFixture(ledger);
    assert.equal((await request({ code: code.toLowerCase() })).status, 200);
    assert.equal(state.claims, 1);
    assert.deepEqual(calls.find(call => call.path === 'rpc/claim_ticket').options.data, { p_user: 'account-one', p_hash: hash(code) });
  }
});

test('claim canonical-storage failures fail closed without leaking details or calling SQL claim', async () => {
  const { request, state, registrationStore } = claimFixture();
  registrationStore.fail = true;
  const result = await request();
  assert.equal(result.status, 503); assert.equal(state.claims, 0);
  assert.equal((await result.text()).includes('PRIVATE_'), false);
});

test('revoked and malformed database ticket proofs never reach the claim RPC', async () => {
  for (const [change, expected] of [[ticket => { ticket.revoked = true; }, 409],
    [ticket => { ticket.batch_id = 'bad,batch'; }, 503], [ticket => { ticket.code_hash = 'bad'; }, 503],
    [ticket => { ticket.revoked = 'false'; }, 503]]) {
    const { request, state } = claimFixture();
    change(state.tickets[0]);
    assert.equal((await request()).status, expected);
    assert.equal(state.claims, 0);
  }
});

function raffleFixture(ledger, { missing = false, malformed = false } = {}) {
  const registrationStore = memory(ledger);
  const claims = [{ user_id: 'blocked-account', event_id: eventId, ticket_id: 'blocked-ticket', created_at: '2026-01-01T11:00:00Z' },
    { user_id: 'manual-account', event_id: eventId, ticket_id: 'manual-ticket', created_at: '2026-01-01T11:00:00Z' }];
  const tickets = [{ id: 'blocked-ticket', event_id: eventId, batch_id: 'batch-one', code_hash: hash(code), revoked: false },
    { id: 'manual-ticket', event_id: eventId, batch_id: 'manual-batch', code_hash: hash('manual-code'), revoked: false }];
  const handler = createRaffleHandler({ events: async () => [{ id: eventId, title: 'Test Etkinliği', date: '2026-01-01' }],
    store: () => ({ get: async () => null }),
    ticketRestrictions: id => readRegistrationTicketRestrictions(id, { store: registrationStore }),
    registrations: id => readRegistrationParticipants(id, registrationStore),
    read: async path => {
      const url = new URL(path, 'https://database.test/');
      if (url.searchParams.has('and') || url.searchParams.has('or')) return [];
      if (url.pathname === '/tickets') return malformed ? [tickets[0], tickets[0]] : missing ? [tickets[1]] : tickets;
      if (url.pathname === '/attendance') {
        const filter = url.searchParams.get('user_id');
        return filter ? claims.filter(claim => filter.slice(4, -1).split(',').includes(claim.user_id)) : claims;
      }
      if (url.pathname === '/profiles') return [{ id: 'manual-account', name: 'Normal bilet' }, { id: 'blocked-account', name: 'İptal edilmiş bilet' }];
      assert.fail('Unexpected raffle read');
    } });
  return source => handler(new Request(`${origin}/api/raffles?eventId=${eventId}${source ? `&source=${source}` : ''}`, { headers: { cookie } }));
}

test('QR account raffle source excludes canonically cancelled/waiting tickets and retains ordinary batches', async () => {
  for (const registrationStatus of ['cancelled', 'waitlisted']) {
    const request = raffleFixture(canonical([person({ registrationStatus })]));
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).participants.map(row => row.id), ['manual-account']);
  }
  const request = raffleFixture({ ...canonical([]), deleted: [{ id: 'entry-one', ticket: person().ticket }] });
  assert.deepEqual((await (await request()).json()).participants.map(row => row.id), ['manual-account']);
});

test('form raffle source excludes cancelled and waitlisted records independently of old moderation statuses', async () => {
  const ledger = canonical([person({ registrationStatus: 'cancelled' }), person({ id: 'waiting', registrationStatus: 'waitlisted' }),
    person({ id: 'legacy-main', status: 'rejected' })]);
  const result = await raffleFixture(ledger)('registrations');
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).participants.map(row => row.id), ['legacy-main']);
});

test('QR source never treats missing ticket proof as an eligible blocked claim and rejects duplicate database proofs', async () => {
  const ledger = canonical([person({ registrationStatus: 'cancelled' })]);
  const result = await raffleFixture(ledger, { missing: true })();
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).participants.map(row => row.id), ['manual-account']);
  assert.equal((await raffleFixture(ledger, { malformed: true })()).status, 503);
});
