import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { fail, identifier, HttpError } from './security.mjs';
import { REGISTRATION_STORE, registrationStateKey, entryPrefix, mapConcurrent } from './registrations.mjs';
import { registrationStatus, ticketEligible } from './registration-state.mjs';

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
function reservation(ticket) {
  if (!record(ticket) || !['pending', 'issued'].includes(ticket.status) ||
      typeof ticket.code !== 'string' || !/^ERC-[A-F0-9]{24}$/.test(ticket.code)) invalid();
  return { batchId: validId(ticket.batchId), codeHash: createHash('sha256').update(ticket.code).digest('hex') };
}
function ledger(entries, eventId, deleted = []) {
  if (!Array.isArray(entries) || entries.length > MAXIMUM_ENTRIES ||
      !Array.isArray(deleted) || deleted.length > MAXIMUM_ENTRIES) invalid();
  const tombstones = new Set(), removedIds = new Set(), ids = new Set(), batches = new Set(), hashes = new Set();
  const live = [], removed = [];
  for (const entry of deleted) {
    if (!record(entry)) invalid();
    const id = validId(entry.id);
    if (tombstones.has(id)) invalid();
    tombstones.add(id);
    if (entry.ticket != null) {
      removedIds.add(id);
      removed.push({ id, ...reservation(entry.ticket),
        name: safeText(entry.name, 2000) && entry.name.trim() ? entry.name : null,
        classYear: safeText(entry.classYear, 200) ? entry.classYear : '',
        createdAt: safeText(entry.createdAt, 100) && Number.isFinite(Date.parse(entry.createdAt)) ? entry.createdAt : null });
    }
  }
  for (const entry of entries) {
    if (!record(entry) || entry.eventId !== eventId || !safeText(entry.name, 2000) || !entry.name.trim() ||
        !safeText(entry.createdAt, 100) || !Number.isFinite(Date.parse(entry.createdAt)) ||
        (entry.classYear !== undefined && !safeText(entry.classYear, 200))) invalid();
    const id = validId(entry.id);
    if (ids.has(id)) invalid();
    ids.add(id);
    // Validate the lifecycle independently of the old moderation `status` field.
    const status = registrationStatus(entry);
    if (entry.ticket == null) continue;
    const proof = reservation(entry.ticket);
    if (tombstones.has(id)) {
      // Some older ledgers retained the row beside an ID-only tombstone. Use
      // the retained proof to block it, without resurrecting its identity.
      if (!removedIds.has(id)) {
        removedIds.add(id);
        removed.push({ id, ...proof, name: entry.name, classYear: entry.classYear || '', createdAt: entry.createdAt });
      }
      continue;
    }
    if (batches.has(proof.batchId) || hashes.has(proof.codeHash)) invalid();
    batches.add(proof.batchId); hashes.add(proof.codeHash);
    live.push({ id, name: entry.name, classYear: entry.classYear || '', createdAt: entry.createdAt,
      ...proof, blocked: status !== 'main' || !ticketEligible(entry) });
  }
  return { live, removed };
}
function stateLedger(state, eventId) {
  if (!record(state) || state.version !== 1 || state.eventId !== eventId || !Array.isArray(state.deleted)) invalid();
  return ledger(state.entries, eventId, state.deleted);
}
async function readLedger(eventId, store) {
  eventId = identifier(eventId);
  const key = registrationStateKey(eventId), state = await store.get(key, READ_JSON);
  if (state !== null && state !== undefined) return stateLedger(state, eventId);
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
  // A first concurrent mutation can establish an authoritative ledger. Never
  // resurrect a cancelled or deleted record from retained old entry blobs.
  const migrated = await store.get(key, READ_JSON);
  return migrated !== null && migrated !== undefined ? stateLedger(migrated, eventId) : ledger(entries, eventId);
}

// Private projections only. Raw QR secrets, answers, phones and files never
// enter the gate, raffle or aggregate-report response through these helpers.
export async function readRegistrationTicketOwners(eventId, {
  store = getStore({ name: REGISTRATION_STORE, consistency: 'strong' }), includeInactive = false,
} = {}) {
  const { live, removed } = await readLedger(eventId, store);
  return [...live.filter(person => includeInactive || !person.blocked), ...(includeInactive ? removed : [])]
    .map(({ blocked: _blocked, ...person }) => person);
}

// Consumers must match BOTH persisted batch ID and SHA256 to a real ticket of
// this event. A blocked reservation remains authoritative even if its database
// revocation is retrying. Unmatched ordinary batch tickets retain their flow.
export async function readRegistrationTicketRestrictions(eventId, {
  store = getStore({ name: REGISTRATION_STORE, consistency: 'strong' }),
} = {}) {
  const { live, removed } = await readLedger(eventId, store);
  return [...live.map(person => ({ batchId: person.batchId, codeHash: person.codeHash,
    registrationId: person.id, blocked: person.blocked })), ...removed.map(person => ({
    batchId: person.batchId, codeHash: person.codeHash, registrationId: person.id, blocked: true }))];
}

export function registrationTicketIsBlocked(ticket, restrictions) {
  return restrictions.some(person => person.blocked && person.batchId === ticket.batch_id && person.codeHash === ticket.code_hash);
}
