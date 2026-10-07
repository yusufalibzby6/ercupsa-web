import { fail, identifier, text } from "./security.mjs";

export const FEEDBACK_STORE = "ercupsa-feedback";
export const feedbackKey = (eventId) => `events/${identifier(eventId)}.json`;

export function feedbackInput(input) {
  const eventId = identifier(input.eventId);
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    fail(400, "Etkinliğe 1 ile 5 arasında bir puan seçmelisin.");
  return { eventId, rating: input.rating, comment: text(input.comment, 2000) };
}

// Events currently have a start date/time but no end time. Feedback opens at
// the beginning of the following day in Istanbul, rather than guessing when
// the event finishes. A ticket claimed in advance cannot bypass this rule.
export function feedbackAvailable(event, now = new Date()) {
  if (!event || event.published === false || !/^\d{4}-\d{2}-\d{2}$/.test(event.date || "")) return false;
  const day = new Date(`${event.date}T00:00:00+03:00`);
  if (!Number.isFinite(day.getTime())) return false;
  if (new Date(`${event.date}T12:00:00Z`).toISOString().slice(0, 10) !== event.date) return false;
  return now.getTime() >= day.getTime() + 86400000;
}

export function feedbackSummary(entries) {
  const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((rating) => [rating, 0]));
  let total = 0;
  for (const entry of entries) { distribution[entry.rating]++; total += entry.rating; }
  return { count: entries.length, average: entries.length ? Math.round(total / entries.length * 100) / 100 : null, distribution };
}

const READ = { type: "json", consistency: "strong" };
export async function readFeedback(store, eventId) {
  const snap = await store.getWithMetadata(feedbackKey(eventId), READ);
  if (!snap) return { exists: false, etag: null, data: { version: 1, eventId, entries: [] } };
  const data = snap.data;
  if (data?.version !== 1 || data.eventId !== eventId || !Array.isArray(data.entries) ||
      data.entries.length > 20000 || new Set(data.entries.map((entry) => entry.userId)).size !== data.entries.length ||
      data.entries.some((entry) => !entry || typeof entry.userId !== "string" ||
        !Number.isInteger(entry.rating) || entry.rating < 1 || entry.rating > 5 ||
        typeof entry.comment !== "string" || entry.comment.length > 2000 ||
        typeof entry.name !== "string" || typeof entry.createdAt !== "string" || typeof entry.updatedAt !== "string"))
    fail(503, "Değerlendirmeler şu anda okunamıyor. Lütfen tekrar deneyin.");
  return { exists: true, etag: snap.etag, data };
}

export async function saveFeedback(store, event, person, input, now) {
  const key = feedbackKey(event.id);
  for (let attempt = 0; attempt < 16; attempt++) {
    const snap = await readFeedback(store, event.id);
    const previous = snap.data.entries.find((entry) => entry.userId === person.id);
    if (previous?.rating === input.rating && previous.comment === input.comment) return previous;
    if (!previous && snap.data.entries.length >= 20000) fail(503, "Değerlendirme şu anda kaydedilemiyor.");
    if (snap.exists && (typeof snap.etag !== "string" || !snap.etag))
      fail(503, "Değerlendirmeler şu anda güncellenemiyor. Lütfen tekrar deneyin.");
    const entry = { userId: person.id, name: person.name, rating: input.rating, comment: input.comment,
      createdAt: previous?.createdAt || now.toISOString(), updatedAt: now.toISOString() };
    const data = { ...snap.data, eventTitle: event.title, eventDate: event.date,
      entries: [...snap.data.entries.filter((item) => item.userId !== person.id), entry] };
    const result = await store.setJSON(key, data, snap.exists ? { onlyIfMatch: snap.etag } : { onlyIfNew: true });
    if (result.modified) return entry;
  }
  fail(409, "Değerlendirmeler değişti. Lütfen tekrar deneyin.");
}

export const ownFeedback = (entry) => entry ? { rating: entry.rating, comment: entry.comment,
  createdAt: entry.createdAt, updatedAt: entry.updatedAt } : null;

export function feedbackEvent(event, data, eventId) {
  return event ? { id: event.id, title: event.title, date: event.date, published: event.published !== false }
    : { id: eventId, title: data.eventTitle || "Arşivlenmiş etkinlik", date: data.eventDate || "", archived: true, published: false };
}
