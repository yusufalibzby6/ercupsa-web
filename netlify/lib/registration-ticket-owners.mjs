import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { fail, identifier, HttpError } from './security.mjs';
import { REGISTRATION_STORE, registrationStateKey, entryPrefix, mapConcurrent } from './registrations.mjs';

const READ_JSON = { type: 'json', consistency: 'strong' };
const MAXIMUM_ENTRIES = 100000;
const invalid = () => fail(503, 'Kayıt bileti sahipleri doğrulanamadı. Lütfen tekrar deneyin.');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, max) => typeof value === 'string' && value.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
function validId(value) {
  try { return identifier(value); }
  catch (error) { if (error instanceof HttpError) invalid(); throw error; }
}

function owners(entries, eventId, deleted = []) {
  if (!Array.isArray(entries) || entries.length > MAXIMUM_ENTRIES ||
    !Array.isArray(deleted) || deleted.length > MAXIMUM_ENTRIES) invalid();
  const tombstones = new Set(), ids = new Set(), batches = new Set(), hashes = new Set();
  for (const entry of deleted) {
    if (!record(entry)) invalid();
    const id = validId(entry.id);
    if (tombstones.has(id)) invalid();
    tombstones.add(id);
  }
  const output = [];
  for (const entry of entries) {
    if (!record(entry) || entry.eventId !== eventId || !safeText(entry.name, 2000) || !entry.name.trim() ||
      !safeText(entry.createdAt, 100) || !Number.isFinite(Date.parse(entry.createdAt)) ||
      (entry.classYear !== undefined && !safeText(entry.classYear, 200))) invalid();
    const id = validId(entry.id);
    if (ids.has(id)) invalid();
    ids.add(id);
    // A canonical deletion always wins over any retained legacy copy or an
    // incomplete external ticket cancellation. Deleted people never reappear.
    if (tombstones.has(id) || entry.ticket == null) continue;
    const ticket = entry.ticket;
    if (!record(ticket) || !['pending', 'issued'].includes(ticket.status) ||
      typeof ticket.code !== 'string' || !/^ERC-[A-F0-9]{24}$/.test(ticket.code)) invalid();
    const batchId = validId(ticket.batchId), codeHash = createHash('sha256').update(ticket.code).digest('hex');
    if (batches.has(batchId) || hashes.has(codeHash)) invalid();
    batches.add(batchId); hashes.add(codeHash);
    // A pending reservation can already have a committed database ticket after
    // a lost issuance response. Consumers must verify the actual live ticket's
    // event, batch and code hash; a reservation alone is never ticket proof.
    output.push({ id, name: entry.name, classYear: entry.classYear || '', createdAt: entry.createdAt, batchId, codeHash });
  }
  return output;
}

function stateOwners(state, eventId) {
  if (!record(state) || state.version !== 1 || state.eventId !== eventId || !Array.isArray(state.deleted)) invalid();
  return owners(state.entries, eventId, state.deleted);
}

// Private projection only. Never return receipt data, answers, phone numbers,
// email addresses or raw QR secrets to gate/raffle consumers.
export async function readRegistrationTicketOwners(eventId, { store = getStore({ name: REGISTRATION_STORE, consistency: 'strong' }) } = {}) {
  eventId = identifier(eventId);
  const key = registrationStateKey(eventId), state = await store.get(key, READ_JSON);
  if (state !== null && state !== undefined) return stateOwners(state, eventId);
  const prefix = entryPrefix(eventId), listed = await store.list({ prefix });
  if (!record(listed) || !Array.isArray(listed.blobs) || listed.blobs.length > MAXIMUM_ENTRIES) invalid();
  const keys = new Set();
  for (const item of listed.blobs) {
    if (!record(item) || typeof item.key !== 'string' || !item.key.startsWith(prefix) || !item.key.endsWith('.json') || keys.has(item.key)) invalid();
    const id = item.key.slice(prefix.length, -5);
    if (validId(id) !== id) invalid();
    keys.add(item.key);
  }
  const entries = await mapConcurrent(listed.blobs, async ({ key: entryKey }) => {
    const entry = await store.get(entryKey, READ_JSON);
    if (!record(entry) || `${prefix}${entry.id}.json` !== entryKey) invalid();
    return entry;
  });
  // A concurrent first mutation may establish the canonical ledger while old
  // blobs are being read. Re-read it instead of resurrecting deleted records.
  const migrated = await store.get(key, READ_JSON);
  if (migrated !== null && migrated !== undefined) return stateOwners(migrated, eventId);
  return owners(entries, eventId);
}
