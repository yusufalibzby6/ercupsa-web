import { getStore as blobStore } from "@netlify/blobs";
import { db, user } from "../lib/database.mjs";
import { body, fail, guarded, identifier, requireAdmin, response } from "../lib/security.mjs";
import { FEEDBACK_STORE, feedbackAvailable, feedbackEvent, feedbackInput, feedbackSummary,
  ownFeedback, readFeedback, saveFeedback } from "../lib/feedback.mjs";
import { readEvents } from "./events.mjs";

export function createFeedbackHandler({ read = db, events = readEvents, authenticate = user,
  store = () => blobStore({ name: FEEDBACK_STORE, consistency: "strong" }), now = () => new Date() } = {}) {
  return guarded(async (req) => {
    const url = new URL(req.url), action = url.searchParams.get("action") || "mine";
    if (!["mine", "admin", "summary"].includes(action)) fail(400, "Geçersiz değerlendirme işlemi.");
    if (action !== "mine") requireAdmin(req);
    if (!["GET", "POST"].includes(req.method) || (action !== "mine" && req.method !== "GET"))
      fail(405, "Desteklenmeyen işlem.");
    const person = action === "mine" ? await authenticate(req) : null;
    if (person) identifier(person.id);
    const storage = store();
    if (action === "summary") {
      const [catalog, listed] = await Promise.all([events(), storage.list({ prefix: "events/" })]);
      const records = new Map();
      // Sequential batches bound storage concurrency for larger event archives.
      for (let start = 0; start < listed.blobs.length; start += 10) {
        const batch = await Promise.all(listed.blobs.slice(start, start + 10).map(async ({ key }) => {
          const match = /^events\/([a-zA-Z0-9_-]+)\.json$/.exec(key);
          if (!match) return null;
          return [match[1], (await readFeedback(storage, match[1])).data];
        }));
        for (const item of batch) if (item) records.set(...item);
      }
      const all = new Map(catalog.map((event) => [event.id, event]));
      for (const id of records.keys()) if (!all.has(id)) all.set(id, null);
      return response({ events: [...all].map(([id, event]) => ({
        event: feedbackEvent(event, records.get(id) || {}, id),
        ...feedbackSummary(records.get(id)?.entries || []),
      })) });
    }
    const input = req.method === "POST" ? feedbackInput(await body(req)) : null;
    const eventId = input?.eventId || identifier(url.searchParams.get("eventId"));
    if (person) {
      // Account verification and attendance are authoritative; request bodies
      // cannot supply another person's identity or invent an event attendance.
      const attended = await read(`attendance?user_id=eq.${person.id}&event_id=eq.${eventId}&select=event_id&limit=1`);
      if (!attended.length) fail(403, "Bu etkinliğin biletini önce hesabına eklemelisin.");
    }
    const [catalog, snapshot] = await Promise.all([events(), readFeedback(storage, eventId)]);
    const event = catalog.find((item) => item.id === eventId);
    const entry = snapshot.data.entries.find((item) => item.userId === person?.id);
    if (!event && !snapshot.exists) fail(404, "Etkinlik bulunamadı.");
    if (action === "admin") return response({ event: feedbackEvent(event, snapshot.data, eventId),
      summary: feedbackSummary(snapshot.data.entries),
      entries: [...snapshot.data.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.userId.localeCompare(b.userId)) });
    const available = feedbackAvailable(event, now());
    const message = available ? "" : !event || event.published === false
      ? "Bu etkinlik şu anda değerlendirmeye açık değil."
      : "Değerlendirme, etkinlikten sonraki gün açılır.";
    if (req.method === "GET") return response({ event: feedbackEvent(event, snapshot.data, eventId),
      feedback: ownFeedback(entry), available, message });
    if (!available) fail(409, message);
    const profiles = await read(`profiles?id=eq.${person.id}&select=name&limit=1`);
    const rawName = profiles[0]?.name;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 120) : "Katılımcı";
    const saved = await saveFeedback(storage, event, { id: person.id, name }, input, now());
    return response({ ok: true, feedback: ownFeedback(saved) });
  });
}

export default createFeedbackHandler();
