import { getStore } from '@netlify/blobs';
import { fail, identifier, HttpError } from './security.mjs';
import { REGISTRATION_STORE, registrationStateKey, entryPrefix, mapConcurrent } from './registrations.mjs';

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
    if (!tombstones.has(person.id)) output.push(person);
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
