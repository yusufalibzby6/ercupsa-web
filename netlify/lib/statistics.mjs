import { getStore as blobStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { db } from './database.mjs';
import { fail, identifier } from './security.mjs';
import { CONTENT_STORE, EVENTS_KEY, eventArray, isDeletedEvent, isPurgedEvent } from './event-state.mjs';
import { REGISTRATION_STORE } from './registrations.mjs';
import { readRegistrationState, registrationStatus, registrationCounts } from './registration-state.mjs';
import { checkinKey } from './checkins.mjs';
import { paged } from './raffles.mjs';

const READ = { type: 'json', consistency: 'strong' };
export const trackingKey = id => `checkins/tracking/${identifier(id)}.json`;
const finiteDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const total = (rows, key) => rows.some(row => row[key] == null) ? null : rows.reduce((sum, row) => sum + row[key], 0);

export function statisticsSummary(events) {
  return { eventCount: events.length, applications: total(events, 'applications'), main: total(events, 'main'),
    waitlisted: total(events, 'waitlisted'), cancelled: total(events, 'cancelled'), entered: total(events, 'entered'),
    qrEntered: total(events, 'qrEntered'), manualEntered: total(events, 'manualEntered'), noShows: total(events, 'noShows'),
    coverage: { eventsWithEntryData: events.filter(row => row.entered != null).length,
      eventsWithRegistrationData: events.filter(row => row.applications != null).length,
      completeEvents: events.filter(row => row.trackingComplete).length, totalEvents: events.length } };
}

export function statisticsFilters(params) {
  const result = { from: params.get('from') || '', to: params.get('to') || '', eventId: params.get('eventId') || '' };
  for (const key of ['from', 'to']) if (result[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) ||
      !finiteDate(`${result[key]}T12:00:00Z`) || new Date(`${result[key]}T12:00:00Z`).toISOString().slice(0, 10) !== result[key])) fail(400, 'Geçerli bir tarih aralığı seçin.');
  if (result.from && result.to && result.from > result.to) fail(400, 'Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  if (result.eventId) result.eventId = identifier(result.eventId);
  return result;
}

export async function readStatisticsCatalog(getStore = blobStore) {
  // Do not use readEvents()'s display-only starter data as verified activity.
  const raw = await getStore(CONTENT_STORE).get(EVENTS_KEY, READ);
  if (raw == null) return [];
  return eventArray(raw, []).flatMap(record => isPurgedEvent(record) ? [] : [{
    ...(isDeletedEvent(record) ? record.event : record), archived: isDeletedEvent(record),
  }]);
}

async function eventStatistics(event, { getStore, read, instant }) {
  const id = identifier(event.id), registrationStore = getStore(REGISTRATION_STORE), operations = getStore('ercupsa-operations');
  const [snapshot, entryLedger, tracking] = await Promise.all([
    readRegistrationState(registrationStore, id), operations.get(checkinKey(id), READ), operations.get(trackingKey(id), READ),
  ]);
  const state = snapshot.data;
  if (!Array.isArray(state.entries)) fail(503, 'Kayıt istatistikleri doğrulanamadı.');
  const registrationKnown = snapshot.exists || state.form != null || state.entries.length > 0;
  const counts = registrationCounts(state);
  const trackingComplete = tracking?.trackingComplete === true;
  if (tracking && (typeof tracking.trackingComplete !== 'boolean' || typeof tracking.revision !== 'string')) fail(503, 'Katılım takibi bilgileri doğrulanamadı.');
  if (entryLedger && !Array.isArray(entryLedger.entries)) fail(503, 'Giriş istatistikleri doğrulanamadı.');
  const entries = entryLedger?.entries || [], seen = new Set();
  for (const entry of entries) {
    const ticketId = identifier(entry?.ticketId);
    if (seen.has(ticketId) || !finiteDate(entry.enteredAt) || Date.parse(entry.enteredAt) > instant.getTime() || !['qr', 'manual'].includes(entry.method)) fail(503, 'Giriş istatistikleri doğrulanamadı.');
    seen.add(ticketId);
  }
  const entryKnown = entryLedger != null || trackingComplete;
  const mainEntries = state.entries.filter(entry => registrationStatus(entry) === 'main');
  let registeredEntered = null;
  // Historical attendance survives a later ticket revocation. Match ticket
  // identity, but deliberately do not reuse raffle eligibility filters.
  if (registrationKnown && entryKnown) {
    const reservations = new Map();
    for (const entry of mainEntries) if (entry.ticket && typeof entry.ticket.code === 'string' && /^ERC-[A-F0-9]{24}$/.test(entry.ticket.code))
      reservations.set(`${identifier(entry.ticket.batchId)}/${createHash('sha256').update(entry.ticket.code).digest('hex')}`, identifier(entry.id));
    const matched = new Set();
    for (let offset = 0; offset < entries.length; offset += 100) {
      const ids = entries.slice(offset, offset + 100).map(entry => identifier(entry.ticketId)).join(',');
      const tickets = await paged(`tickets?event_id=eq.${id}&id=in.(${ids})&select=id,event_id,batch_id,code_hash&order=id.asc`, read, { cursor: ['id'] });
      for (const ticket of tickets) {
        if (ticket.event_id !== id || !seen.has(ticket.id)) fail(503, 'Katılım eşleştirmesi doğrulanamadı.');
        const owner = reservations.get(`${identifier(ticket.batch_id)}/${ticket.code_hash}`);
        if (owner) matched.add(owner);
      }
    }
    registeredEntered = matched.size;
  }
  const started = finiteDate(`${event.date}T${event.time || '00:00'}:00+03:00`) && Date.parse(`${event.date}T${event.time || '00:00'}:00+03:00`) <= instant.getTime();
  const capacity = Number.isInteger(state.form?.maxRegistrations) && state.form.maxRegistrations > 0 ? state.form.maxRegistrations : null;
  return { id, title: event.title, date: event.date, category: event.category || '', archived: event.archived === true,
    applications: registrationKnown ? counts.total : null, main: registrationKnown ? counts.main : null,
    waitlisted: registrationKnown ? counts.waitlisted : null, cancelled: registrationKnown ? counts.cancelled : null,
    capacity, occupancy: capacity && registrationKnown ? Math.round(counts.main / capacity * 1000) / 10 : null,
    entered: entryKnown ? entries.length : null, qrEntered: entryKnown ? entries.filter(entry => entry.method === 'qr').length : null,
    manualEntered: entryKnown ? entries.filter(entry => entry.method === 'manual').length : null,
    registeredEntered, unmatchedEntries: entryKnown && registeredEntered != null ? entries.length - registeredEntered : null,
    noShows: registrationKnown && trackingComplete && started && registeredEntered != null ? Math.max(0, counts.main - registeredEntered) : null,
    trackingComplete, trackingRevision: tracking?.revision || '', completedAt: tracking?.completedAt || null };
}

export async function readStatistics({ getStore = blobStore, read = db, now = () => new Date(), filters = {}, eventIds } = {}) {
  const instant = now(), catalog = await readStatisticsCatalog(getStore);
  let events = catalog.filter(event => (!filters.eventId || event.id === filters.eventId) &&
    (!filters.from || event.date >= filters.from) && (!filters.to || event.date <= filters.to));
  if (eventIds) {
    const ids = [...new Set(eventIds.map(identifier))];
    if (ids.some(id => !catalog.some(event => event.id === id))) fail(409, 'Yıllık için seçilen bazı etkinlikler doğrulanamadı.');
    events = events.filter(event => ids.includes(event.id));
  }
  const rows = [];
  for (let offset = 0; offset < events.length; offset += 4) rows.push(...await Promise.all(events.slice(offset, offset + 4).map(event => eventStatistics(event, { getStore, read, instant }))));
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { asOf: instant.toISOString(), summary: statisticsSummary(rows), events: rows,
    catalog: catalog.map(({ id, title, date }) => ({ id, title, date })).sort((a, b) => b.date.localeCompare(a.date)), filters };
}

export async function readYearbookStatistics(eventIds, options = {}) {
  const report = await readStatistics({ ...options, eventIds });
  const { noShows, ...safe } = report.summary;
  return { ...safe, asOf: report.asOf };
}
