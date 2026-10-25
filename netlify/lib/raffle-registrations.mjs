import { getStore } from '@netlify/blobs';
import { fail, identifier, HttpError } from './security.mjs';
import { REGISTRATION_STORE, registrationStateKey, entryPrefix, mapConcurrent } from './registrations.mjs';
import { paged } from './raffles.mjs';
import { registrationStatus } from './registration-state.mjs';

const READ_JSON = { type: 'json', consistency: 'strong' };
const MAXIMUM_ENTRIES = 100000;
const invalid = () => fail(503, 'Form kayıtları doğrulanamadı. Çekiliş başlatılmadı.');

function participant(entry, eventId) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.eventId !== eventId ||
    typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 2000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(entry.name) ||
    typeof entry.createdAt !== 'string' || entry.createdAt.length > 100 || !Number.isFinite(Date.parse(entry.createdAt))) invalid();
  let id;
  try { id = identifier(entry.id); }
  catch (error) { if (error instanceof HttpError) invalid(); throw error; }
  // Never expose answers, phone numbers, uploaded receipts or ticket secrets
  // to the raffle surface. A form row has one chance; it is not an account.
  return { id, name: entry.name, previous: 0, weight: 1, createdAt: entry.createdAt };
}

function participants(entries, eventId, deleted = []) {
  if (!Array.isArray(entries) || entries.length > MAXIMUM_ENTRIES || !Array.isArray(deleted)) invalid();
  const tombstones = new Set(), seen = new Set();
  for (const entry of deleted) {
    let id;
    try { id = identifier(entry?.id); }
    catch (error) { if (error instanceof HttpError) invalid(); throw error; }
    if (tombstones.has(id)) invalid();
    tombstones.add(id);
  }
  const output = [];
  for (const entry of entries) {
    const person = participant(entry, eventId);
    if (seen.has(person.id)) invalid();
    seen.add(person.id);
    if (!tombstones.has(person.id) && registrationStatus(entry) === 'main') output.push(person);
  }
  return output.sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id));
}

function stateParticipants(state, eventId) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 || state.eventId !== eventId) invalid();
  return participants(state.entries, eventId, state.deleted);
}

export async function readRegistrationParticipants(eventId, store = getStore({ name: REGISTRATION_STORE, consistency: 'strong' })) {
  const key = registrationStateKey(eventId);
  const state = await store.get(key, READ_JSON);
  if (state !== null && state !== undefined) return stateParticipants(state, eventId);
  // Before the atomic event ledger existed, registrations were separate blobs.
  // Netlify's non-paginated list collects every page. Never merge those old
  // copies into a newer authoritative state, or a deleted row could reappear.
  const prefix = entryPrefix(eventId), listed = await store.list({ prefix });
  if (!listed || !Array.isArray(listed.blobs) || listed.blobs.length > MAXIMUM_ENTRIES) invalid();
  const keys = new Set();
  for (const item of listed.blobs) {
    if (!item || typeof item.key !== 'string' || !item.key.startsWith(prefix) || !item.key.endsWith('.json') || keys.has(item.key)) invalid();
    keys.add(item.key);
  }
  const entries = await mapConcurrent(listed.blobs, ({ key: entryKey }) => store.get(entryKey, READ_JSON));
  const migrated = await store.get(key, READ_JSON);
  if (migrated !== null && migrated !== undefined) return stateParticipants(migrated, eventId);
  return participants(entries, eventId);
}

// Door scans can precede an account claim, so eligibility is proved by the
// actual scanned ticket and its durable form reservation, never by a matching
// name, phone number or profile. Every public raffle row remains a form ID.
export async function checkedInRegistrationParticipants(eventId, owners, entries, read, now = Date.now()) {
  if (!Array.isArray(owners) || owners.length > MAXIMUM_ENTRIES ||
    !Array.isArray(entries) || entries.length > MAXIMUM_ENTRIES) invalid();
  const byReservation = new Map(), ownerIds = new Set();
  const validIdentifier = value => {
    try { return identifier(value); }
    catch (error) { if (error instanceof HttpError) invalid(); throw error; }
  };
  for (const owner of owners) {
    const person = participant({ ...owner, eventId }, eventId);
    const batchId = validIdentifier(owner.batchId);
    if (typeof owner.codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(owner.codeHash)) invalid();
    const key = `${batchId}/${owner.codeHash}`;
    if (ownerIds.has(person.id) || byReservation.has(key)) invalid();
    ownerIds.add(person.id); byReservation.set(key, person);
  }
  const scanned = new Map(), seenScans = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      typeof entry.enteredAt !== 'string' || entry.enteredAt.length > 100 ||
      !Number.isFinite(Date.parse(entry.enteredAt))) invalid();
    const ticketId = validIdentifier(entry.ticketId);
    if (seenScans.has(ticketId)) invalid();
    seenScans.add(ticketId);
    // A future timestamp cannot prove an entrance that has already happened.
    if (Date.parse(entry.enteredAt) <= now) scanned.set(ticketId, entry.enteredAt);
  }
  const tickets = [], ticketIds = [...scanned.keys()];
  for (let i = 0; i < ticketIds.length; i += 100) {
    const ids = ticketIds.slice(i, i + 100).join(',');
    try {
      tickets.push(...await paged(`tickets?event_id=eq.${encodeURIComponent(eventId)}&id=in.(${ids})&select=id,event_id,batch_id,code_hash,revoked&order=id.asc`, read, { cursor: ['id'] }));
    } catch (error) {
      if (error instanceof HttpError && error.status === 400) invalid();
      throw error;
    }
  }
  const included = new Map(), seenTickets = new Set();
  for (const ticket of tickets) {
    if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket) ||
      typeof ticket.revoked !== 'boolean' || typeof ticket.code_hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(ticket.code_hash)) invalid();
    const ticketId = validIdentifier(ticket.id), batchId = validIdentifier(ticket.batch_id);
    if (seenTickets.has(ticketId) || !scanned.has(ticketId)) invalid();
    seenTickets.add(ticketId);
    if (ticket.event_id !== eventId || ticket.revoked) continue;
    const person = byReservation.get(`${batchId}/${ticket.code_hash}`);
    if (!person) continue;
    if (included.has(person.id)) invalid();
    included.set(person.id, { ...person, enteredAt: scanned.get(ticketId) });
  }
  return [...included.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id));
}
