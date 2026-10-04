import { getStore as getBlobStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";
import { readEvents as readStoredEvents } from "./events.mjs";
import { fail, guarded, identifier, requireAdmin, response } from "../lib/security.mjs";
import {
  REGISTRATION_STORE, REGISTRATION_RECEIPT_STORE, defaultRegistrationForm,
  normalizeRegistrationForm, registrationIsAvailable, formKey, entryKey, entryPrefix,
  validateRegistrationAnswers, validateRegistrationReceipt, readRegistrationJson,
  readRegistrationSubmission, entryForAdmin, registrationSummary, registrationCsv,
  mapConcurrent,
} from "../lib/registrations.mjs";

const READ_JSON = { type: "json", consistency: "strong" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ADMIN_ACTIONS = new Set(["admin", "form", "status", "summary", "receipt", "export"]);
const STATUSES = new Set(["pending", "approved", "rejected"]);
const RETRY_CONFLICT = "Önceki kayıt isteğin alınmış. Farklı bilgilerle tekrar gönderilemedi. Kaydını düzenlemek için organizatörlerle iletişime geç.";

async function prepareSubmission(submission, fields) {
  const answers = validateRegistrationAnswers(submission.answers, fields);
  const file = submission.receipt ? await validateRegistrationReceipt(submission.receipt) : null;
  const stableAnswers = Object.keys(answers).sort().map((key) => [key,
    Array.isArray(answers[key]) ? [...answers[key]].sort() : answers[key]]);
  const fingerprint = hash(JSON.stringify({ answers: stableAnswers,
    receipt: file ? [file.metadata.mime, hash(file.bytes)] : null }));
  return { answers, file, fingerprint };
}

async function listEntries(store, eventId) {
  const prefix = eventId ? entryPrefix(eventId) : "entries/";
  // The named store is opened with strong consistency: newly accepted forms are
  // visible immediately in administrator lists and comparison summaries.
  const listed = await store.list({ prefix });
  const entries = await mapConcurrent(listed.blobs, ({ key }) => store.get(key, READ_JSON));
  return entries.filter(Boolean).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

async function rateLimit(req, store, now) {
  const ip = req.headers.get("x-nf-client-connection-ip") || "local";
  const key = "registration/" + hash(ip);
  for (let attempt = 0; attempt < 16; attempt++) {
    const snap = await store.getWithMetadata(key, READ_JSON);
    const record = snap?.data?.expires > now.getTime()
      ? { ...snap.data } : { hits: 0, expires: now.getTime() + 15 * 60 * 1000 };
    if (record.hits >= 60) fail(429, "Çok fazla form gönderildi. 15 dakika sonra tekrar deneyin.");
    record.hits++;
    const write = await store.setJSON(key, record, snap ? { onlyIfMatch: snap.etag } : { onlyIfNew: true });
    if (write.modified) return;
    // Campuses can put many participants behind one IP. Jitter prevents valid
    // simultaneous submissions from repeatedly colliding on the same counter.
    await new Promise((resolve) => setTimeout(resolve,
      3 + Math.floor(Math.random() * Math.min(40, 2 ** attempt))));
  }
  fail(429, "Lütfen biraz sonra tekrar deneyin.");
}

function archivedEvent(eventId, entries) {
  return {
    id: eventId, title: entries[0]?.eventTitle || "Arşivlenmiş etkinlik",
    date: entries[0]?.eventDate || "", published: false, archived: true,
  };
}

export function createRegistrationsHandler({
  getStore = (name) => getBlobStore({ name, consistency: "strong" }),
  readEvents = readStoredEvents,
  now = () => new Date(),
  uuid = randomUUID,
} = {}) {
  return guarded(async (req) => {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "form";
    const isPublic = (req.method === "GET" && action === "form") ||
      (req.method === "POST" && action === "submit");
    if (!isPublic) {
      requireAdmin(req);
      if (!ADMIN_ACTIONS.has(action)) fail(400, "Geçersiz kayıt işlemi.");
    }
    const method = req.method;
    if ((action === "submit" && method !== "POST") ||
      (action === "status" && method !== "POST") ||
      (["admin", "summary", "receipt", "export"].includes(action) && method !== "GET") ||
      (action === "form" && !["GET", "POST"].includes(method)))
      fail(405, "Desteklenmeyen işlem.");
    const store = getStore(REGISTRATION_STORE);
    if (action === "summary") {
      const [events, entries] = await Promise.all([readEvents(), listEntries(store)]);
      const groups = new Map(events.map((event) => [event.id, { event, entries: [] }]));
      for (const entry of entries) {
        if (!groups.has(entry.eventId)) groups.set(entry.eventId, {
          event: archivedEvent(entry.eventId, [entry]), entries: [],
        });
        groups.get(entry.eventId).entries.push(entry);
      }
      return response({ events: [...groups].map(([eventId, group]) => ({
        eventId, title: group.event.title, date: group.event.date,
        ...(group.event.archived ? { archived: true } : {}), ...registrationSummary(group.entries),
      })) });
    }
    const eventId = identifier(url.searchParams.get("event_id"));
    if (action === "receipt") {
      const id = identifier(url.searchParams.get("id"));
      const entry = await store.get(entryKey(eventId, id), READ_JSON);
      if (!entry?.receipt) fail(404, "Dekont bulunamadı.");
      const receipt = entry.receipt;
      const bytes = await getStore(REGISTRATION_RECEIPT_STORE).get(receipt.key, {
        type: "arrayBuffer", consistency: "strong",
      });
      if (!bytes) fail(404, "Dekont bulunamadı.");
      const disposition = receipt.mime === "application/pdf" ? "attachment" : "inline";
      const encodedName = encodeURIComponent(receipt.name).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(bytes, { headers: {
        "Content-Type": receipt.mime,
        "Content-Disposition": `${disposition}; filename="dekont"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
      } });
    }
    if (action === "status") {
      const input = await readRegistrationJson(req);
      const id = identifier(input.id);
      if (!STATUSES.has(input.status)) fail(400, "Geçersiz kayıt durumu.");
      const key = entryKey(eventId, id);
      for (let attempt = 0; attempt < 6; attempt++) {
        const snap = await store.getWithMetadata(key, READ_JSON);
        if (!snap) fail(404, "Kayıt bulunamadı.");
        const result = await store.setJSON(key, {
          ...snap.data, status: input.status, updatedAt: now().toISOString(),
        }, { onlyIfMatch: snap.etag });
        if (result.modified) return response({ ok: true });
      }
      fail(409, "Kayıt başka bir yönetici tarafından değiştirildi. Tekrar deneyin.");
    }
    if (action === "export") {
      const entries = await listEntries(store, eventId);
      // Empty exports remain useful, but must not pretend an unknown event exists.
      if (!entries.length && !(await readEvents()).some((event) => event.id === eventId) &&
        !(await store.get(formKey(eventId), READ_JSON))) fail(404, "Etkinlik bulunamadı.");
      return new Response(registrationCsv(entries), { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kayitlar-${eventId}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      } });
    }
    const [events, form] = await Promise.all([readEvents(), store.get(formKey(eventId), READ_JSON)]);
    const event = events.find((item) => item.id === eventId);
    if (action === "admin") {
      const entries = await listEntries(store, eventId);
      if (!event && !form && !entries.length) fail(404, "Etkinlik bulunamadı.");
      const filtered = entries.filter((entry) =>
        (!url.searchParams.has("class_year") || entry.classYear === url.searchParams.get("class_year")) &&
        (!url.searchParams.has("status") || entry.status === url.searchParams.get("status")));
      const rawPage = url.searchParams.get("page") || "1";
      if (!/^[1-9]\d{0,6}$/.test(rawPage)) fail(400, "Geçersiz sayfa numarası.");
      const totalPages = Math.max(1, Math.ceil(filtered.length / 50));
      const page = Math.min(Number(rawPage), totalPages);
      const eventInfo = event || archivedEvent(eventId, entries);
      return response({
        form: form || defaultRegistrationForm(eventId),
        event: { id: eventInfo.id, title: eventInfo.title, date: eventInfo.date,
          published: eventInfo.published !== false, ...(eventInfo.archived ? { archived: true } : {}) },
        entries: filtered.slice((page - 1) * 50, page * 50).map(entryForAdmin),
        summary: registrationSummary(entries), page, totalPages,
      });
    }
    // Public forms and new submissions never expose unpublished/removed events.
    if (!event || (isPublic && event.published === false)) fail(404, "Etkinlik bulunamadı.");
    if (action === "form" && method === "GET")
      return response({ form: form || null, available: registrationIsAvailable(event, form, now()) });
    if (action === "form") {
      const input = await readRegistrationJson(req);
      const normalized = normalizeRegistrationForm(input, eventId, now().toISOString());
      await store.setJSON(formKey(eventId), normalized);
      return response({ ok: true, form: normalized });
    }
    const submission = await readRegistrationSubmission(req);
    const id = hash(`${eventId}\u0000${submission.requestId}`).slice(0, 32);
    const key = entryKey(eventId, id);
    // Verify retries against the original schema. Administrators may have edited
    // or closed the form since an accepted response was lost on the network.
    const existing = await store.get(key, READ_JSON);
    if (existing) {
      let prepared;
      try { prepared = await prepareSubmission(submission, existing.fields); }
      catch (error) {
        if (error.status) fail(409, RETRY_CONFLICT);
        throw error;
      }
      if (prepared.fingerprint !== existing.fingerprint) fail(409, RETRY_CONFLICT);
      return response({ ok: true, reference: id });
    }
    if (!registrationIsAvailable(event, form, now()))
      fail(409, "Bu etkinliğin kayıt formu şu anda açık değil.");
    const { answers, file, fingerprint } = await prepareSubmission(submission, form.fields);
    if (submission.receipt && !form.receipt.enabled) fail(400, "Bu formda dekont yüklemesi açık değil.");
    if (!submission.receipt && form.receipt.enabled && form.receipt.required)
      fail(400, "Dekont dosyanızı yükleyin.");
    await rateLimit(req, getStore("ercupsa-security"), now());
    const createdAt = now().toISOString();
    const entry = {
      id, eventId, eventTitle: event.title, eventDate: event.date,
      name: answers.full_name, classYear: answers.class_year, phone: answers.phone,
      answers, fields: structuredClone(form.fields), fingerprint, status: "pending", createdAt,
      receipt: null,
    };
    let receiptStore;
    if (file) {
      receiptStore = getStore(REGISTRATION_RECEIPT_STORE);
      // Independent receipt keys ensure a losing concurrent retry cannot erase
      // the winning entry's receipt, even when both have the same requestId.
      entry.receipt = { ...file.metadata, key: `${eventId}/${id}/${identifier(uuid())}` };
      let uploaded;
      try { uploaded = await receiptStore.set(entry.receipt.key, file.bytes, { onlyIfNew: true }); }
      catch (error) {
        // No entry can refer to this attempt's fresh UUID until the next write.
        // Clean up uploads whose receipt write committed before a connection error.
        try { await receiptStore.delete(entry.receipt.key); } catch { /* Best effort on an unavailable store. */ }
        throw error;
      }
      if (!uploaded.modified) fail(503, "Dekont kaydedilemedi. Lütfen tekrar deneyin.");
    }
    let result;
    try { result = await store.setJSON(key, entry, { onlyIfNew: true }); }
    catch (error) {
      if (entry.receipt) {
        // A write may have committed before a network error. Delete an upload
        // only when a strong read confirms it is not used by the saved entry.
        try {
          const saved = await store.get(key, READ_JSON);
          if (saved?.receipt?.key !== entry.receipt.key) await receiptStore.delete(entry.receipt.key);
          else return response({ ok: true, reference: id });
        } catch { /* Preserve a possibly committed receipt on uncertain reads. */ }
      }
      throw error;
    }
    if (!result.modified && entry.receipt) await receiptStore.delete(entry.receipt.key);
    if (!result.modified) {
      const accepted = await store.get(key, READ_JSON);
      if (!accepted) fail(503, "Kayıt tamamlanamadı. Lütfen tekrar deneyin.");
      if (accepted.fingerprint !== fingerprint) fail(409, RETRY_CONFLICT);
    }
    return response({ ok: true, reference: id });
  });
}

export default createRegistrationsHandler();
