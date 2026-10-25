import { fail } from './security.mjs';
import { formKey, entryPrefix, registrationStateKey, mapConcurrent } from './registrations.mjs';

const READ = { type: 'json', consistency: 'strong' };
export function registrationStatus(entry) {
  if (entry.registrationStatus == null) return 'main';
  if (!['main', 'waitlisted', 'cancelled'].includes(entry.registrationStatus)) fail(503, 'Kayıt durumu doğrulanamadı.');
  return entry.registrationStatus;
}
export function registrationCounts(state) {
  const counts = { total: state.entries.length, main: 0, waitlisted: 0, cancelled: 0 };
  for (const entry of state.entries) counts[registrationStatus(entry)]++;
  return counts;
}
export function paymentStatus(entry) {
  if (!entry.payment) return 'not_required';
  if (!['not_required', 'pending', 'approved'].includes(entry.payment.reviewStatus)) fail(503, 'Ödeme durumu doğrulanamadı.');
  return entry.payment.reviewStatus;
}
export function ticketEligible(entry) {
  return registrationStatus(entry) === 'main' && (entry.ticket?.status === 'issued' || paymentStatus(entry) !== 'pending');
}
export function registrationStage(state) {
  const counts = registrationCounts(state), limit = state.form?.maxRegistrations ?? null;
  if (limit === null || counts.main < limit) return 'main';
  if (state.form?.waitlist?.enabled === true && counts.waitlisted < state.form.waitlist.capacity) return 'waitlist';
  return 'closed';
}
export function registrationFormDefaults(form) {
  return form ? { ...form, maxRegistrations: form.maxRegistrations ?? null,
    waitlist: form.waitlist || { enabled: false, capacity: 0 },
    showRemainingCapacity: form.showRemainingCapacity === true,
    payment: form.payment || { enabled: false } } : null;
}
export async function readRegistrationState(store, eventId) {
  const snap = await store.getWithMetadata(registrationStateKey(eventId), READ);
  if (snap) return { exists: true, etag: snap.etag, data: { ...snap.data, form: registrationFormDefaults(snap.data.form) } };
  const [form, listed] = await Promise.all([store.get(formKey(eventId), READ), store.list({ prefix: entryPrefix(eventId) })]);
  const entries = (await mapConcurrent(listed.blobs, ({ key }) => store.get(key, READ))).filter(Boolean);
  // A concurrent first write establishes the canonical ledger. Never merge its
  // deleted rows back from retained old blobs.
  const current = await store.getWithMetadata(registrationStateKey(eventId), READ);
  if (current) return { exists: true, etag: current.etag, data: { ...current.data, form: registrationFormDefaults(current.data.form) } };
  return { exists: false, etag: null, data: { version: 1, eventId, form: registrationFormDefaults(form), entries, deleted: [] } };
}

export function promoteRegistrationQueue(state, at, actor) {
  const counts = registrationCounts(state), limit = state.form?.maxRegistrations ?? null;
  let places = limit === null ? Infinity : Math.max(0, limit - counts.main);
  const queue = state.entries.filter(entry => registrationStatus(entry) === 'waitlisted')
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  if (queue.some(entry => !Number.isSafeInteger(entry.sequence) || entry.sequence < 1)) fail(503, 'Yedek kayıt sırası doğrulanamadı.');
  const ids = new Set(queue.slice(0, places).map(entry => entry.id));
  if (!ids.size) return { state, promoted: [] };
  const entries = state.entries.map(entry => ids.has(entry.id) ? { ...entry, registrationStatus: 'main', promotedAt: at,
    ...(actor ? { promotedBy: actor } : {}),
    payment: state.form?.payment?.enabled ? { declared: entry.payment?.declared === true, reviewStatus: 'pending' }
      : { declared: false, reviewStatus: 'not_required' } } : entry);
  return { state: { ...state, entries }, promoted: [...ids] };
}
