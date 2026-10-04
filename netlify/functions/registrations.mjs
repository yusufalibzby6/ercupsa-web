import { getStore as getBlobStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";
import { readEvents as readStoredEvents } from "./events.mjs";
import { fail, guarded, identifier, requireAdmin, response } from "../lib/security.mjs";
import {
  REGISTRATION_STORE, REGISTRATION_RECEIPT_STORE, REGISTRATION_FULL_MESSAGE,
  defaultRegistrationForm, normalizeRegistrationForm, registrationIsAvailable,
  formKey, entryKey, entryPrefix, registrationStateKey,
  validateRegistrationAnswers, validateRegistrationReceipt, readRegistrationJson,
  readRegistrationSubmission, entryForAdmin, registrationSummary, registrationCsv,
  mapConcurrent,
} from "../lib/registrations.mjs";

const READ_JSON = { type: "json", consistency: "strong" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ADMIN_ACTIONS = new Set(["admin", "form", "delete", "summary", "receipt", "export"]);
const RETRY_CONFLICT = "Önceki kayıt isteğin alınmış. Farklı bilgilerle tekrar gönderilemedi. Kaydını düzenlemek için organizatörlerle iletişime geç.";
const DELETED_CONFLICT = "Bu kayıt yönetici tarafından silinmiş. Yeni bir kayıt için sayfayı yenileyin.";
const withLimit = (form) => form ? { ...form, maxRegistrations: form.maxRegistrations ?? null } : null;
const sortedEntries = (entries) => [...entries].sort((a, b) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
const full = (state) => state.form?.maxRegistrations != null &&
  state.entries.length >= state.form.maxRegistrations;
const fullResponse = () => response({ error: REGISTRATION_FULL_MESSAGE, code: "REGISTRATION_FULL" }, 409);
const pause = (attempt) => new Promise((resolve) => setTimeout(resolve,
  3 + Math.floor(Math.random() * Math.min(40, 2 ** Math.min(attempt, 6)))));
const writeOptions = (snap) => {
  if (snap.exists && (typeof snap.etag !== "string" || !snap.etag))
    fail(503, "Kayıtlar şu anda güncellenemiyor. Lütfen tekrar deneyin.");
  return snap.exists ? { onlyIfMatch: snap.etag } : { onlyIfNew: true };
};

async function prepareSubmission(submission, fields, file) {
  const answers = validateRegistrationAnswers(submission.answers, fields);
  const stableAnswers = Object.keys(answers).sort().map((key) => [key,
    Array.isArray(answers[key]) ? [...answers[key]].sort() : answers[key]]);
  const fingerprint = hash(JSON.stringify({ answers: stableAnswers,
    receipt: file ? [file.metadata.mime, hash(file.bytes)] : null }));
  return { answers, fingerprint };
}

async function legacyEntries(store, eventId) {
  const listed = await store.list({ prefix: entryPrefix(eventId) });
  return (await mapConcurrent(listed.blobs, ({ key }) => store.get(key, READ_JSON))).filter(Boolean);
}

async function readState(store, eventId) {
  const snap = await store.getWithMetadata(registrationStateKey(eventId), READ_JSON);
  if (snap) return { exists: true, etag: snap.etag, data: { ...snap.data, form: withLimit(snap.data.form) } };
  const [form, entries] = await Promise.all([
    store.get(formKey(eventId), READ_JSON), legacyEntries(store, eventId),
  ]);
  // Reads do not migrate data. The first successful mutation creates one
  // authoritative event record with CAS; later reads never merge legacy copies.
  return { exists: false, etag: null, data: { version: 1, eventId, form: withLimit(form), entries, deleted: [] } };
}

async function allEntries(store) {
  const [states, legacy] = await Promise.all([
    store.list({ prefix: "state/" }), store.list({ prefix: "entries/" }),
  ]);
  const eventIds = new Set();
  for (const { key } of states.blobs) eventIds.add(key.slice(6, -5));
  for (const { key } of legacy.blobs) eventIds.add(key.split("/")[1]);
  return (await mapConcurrent([...eventIds], async (eventId) =>
    (await readState(store, eventId)).data.entries)).flat();
}

async function rateLimit(req, store, now) {
  const ip = req.headers.get("x-nf-client-connection-ip") || "local";
  const key = "registration/" + hash(ip);
  for (let attempt = 0; attempt < 32; attempt++) {
    const snap = await store.getWithMetadata(key, READ_JSON);
    if (snap && (typeof snap.etag !== "string" || !snap.etag))
      fail(503, "Kayıtlar şu anda güncellenemiyor. Lütfen tekrar deneyin.");
    const record = snap?.data?.expires > now.getTime()
      ? { ...snap.data } : { hits: 0, expires: now.getTime() + 15 * 60 * 1000 };
    if (record.hits >= 60) fail(429, "Çok fazla form gönderildi. 15 dakika sonra tekrar deneyin.");
    record.hits++;
    const write = await store.setJSON(key, record, snap ? { onlyIfMatch: snap.etag } : { onlyIfNew: true });
    if (write.modified) return;
    await pause(attempt);
  }
  fail(429, "Lütfen biraz sonra tekrar deneyin.");
}

function archivedEvent(eventId, entries) {
  return { id: eventId, title: entries[0]?.eventTitle || "Arşivlenmiş etkinlik",
    date: entries[0]?.eventDate || "", published: false, archived: true };
}

async function verifyRetry(submission, entry, file) {
  let prepared;
  try { prepared = await prepareSubmission(submission, entry.fields, file); }
  catch (error) {
    if (error.status) fail(409, RETRY_CONFLICT);
    throw error;
  }
  if (prepared.fingerprint !== entry.fingerprint) fail(409, RETRY_CONFLICT);
  return response({ ok: true, reference: entry.id });
}

export function createRegistrationsHandler({
  getStore = (name) => getBlobStore({ name, consistency: "strong" }),
  readEvents = readStoredEvents, now = () => new Date(), uuid = randomUUID,
} = {}) {
  return guarded(async (req) => {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "form";
    const method = req.method;
    const isPublic = (method === "GET" && action === "form") ||
      (method === "POST" && action === "submit");
    if (!isPublic) {
      requireAdmin(req);
      if (!ADMIN_ACTIONS.has(action)) fail(400, "Geçersiz kayıt işlemi.");
    }
    if ((["submit", "delete"].includes(action) && method !== "POST") ||
      (["admin", "summary", "receipt", "export"].includes(action) && method !== "GET") ||
      (action === "form" && !["GET", "POST"].includes(method)))
      fail(405, "Desteklenmeyen işlem.");
    const store = getStore(REGISTRATION_STORE);
    if (action === "summary") {
      const [events, entries] = await Promise.all([readEvents(), allEntries(store)]);
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
    let snap = await readState(store, eventId);
    if (action === "receipt") {
      const id = identifier(url.searchParams.get("id"));
      const entry = snap.data.entries.find((item) => item.id === id);
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
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      } });
    }
    if (action === "delete") {
      const input = await readRegistrationJson(req);
      const id = identifier(input.id);
      for (let attempt = 0; attempt < 64; attempt++) {
        const entry = snap.data.entries.find((item) => item.id === id);
        let deleted = snap.data.deleted.find((item) => item.id === id);
        if (!entry && !deleted) fail(404, "Kayıt bulunamadı.");
        if (entry) {
          deleted = { id, ...(entry.receipt ? { receiptKey: entry.receipt.key } : {}) };
          const data = { ...snap.data, entries: snap.data.entries.filter((item) => item.id !== id),
            deleted: [...snap.data.deleted, deleted] };
          try {
            const written = await store.setJSON(registrationStateKey(eventId), data, writeOptions(snap));
            if (!written.modified) { await pause(attempt); snap = await readState(store, eventId); continue; }
          } catch (error) {
            // A lost write response must not make a removed record or receipt
            // accessible again. A retry uses the durable tombstone for cleanup.
            const saved = await readState(store, eventId);
            deleted = saved.data.deleted.find((item) => item.id === id);
            if (!deleted) throw error;
          }
        }
        if (deleted.receiptKey) {
          try { await getStore(REGISTRATION_RECEIPT_STORE).delete(deleted.receiptKey); }
          catch { /* Tombstone retains the key for a subsequent cleanup retry. */ }
        }
        try { await store.delete(entryKey(eventId, id)); }
        catch { /* Canonical tombstone prevents any legacy resurrection. */ }
        return response({ ok: true });
      }
      fail(409, "Kayıtlar değişti. Lütfen tekrar deneyin.");
    }
    if (action === "export") {
      const entries = sortedEntries(snap.data.entries);
      if (!entries.length && !(await readEvents()).some((event) => event.id === eventId) &&
        !snap.data.form) fail(404, "Etkinlik bulunamadı.");
      return new Response(registrationCsv(entries), { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kayitlar-${eventId}.csv"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    const events = await readEvents();
    const event = events.find((item) => item.id === eventId);
    if (action === "admin") {
      const entries = sortedEntries(snap.data.entries);
      if (!event && !snap.data.form && !entries.length) fail(404, "Etkinlik bulunamadı.");
      const filtered = entries.filter((entry) => !url.searchParams.has("class_year") ||
        entry.classYear === url.searchParams.get("class_year"));
      const rawPage = url.searchParams.get("page") || "1";
      if (!/^[1-9]\d{0,6}$/.test(rawPage)) fail(400, "Geçersiz sayfa numarası.");
      const totalPages = Math.max(1, Math.ceil(filtered.length / 50));
      const page = Math.min(Number(rawPage), totalPages);
      const eventInfo = event || archivedEvent(eventId, entries);
      return response({ form: snap.data.form || defaultRegistrationForm(eventId),
        event: { id: eventInfo.id, title: eventInfo.title, date: eventInfo.date,
          published: eventInfo.published !== false, ...(eventInfo.archived ? { archived: true } : {}) },
        entries: filtered.slice((page - 1) * 50, page * 50).map(entryForAdmin),
        summary: registrationSummary(entries), page, totalPages });
    }
    if (!event || (isPublic && event.published === false)) fail(404, "Etkinlik bulunamadı.");
    if (action === "form" && method === "GET") {
      const isFull = full(snap.data);
      const { maxRegistrations, ...publicForm } = snap.data.form || {};
      return response({ form: snap.data.form ? publicForm : null,
        available: registrationIsAvailable(event, snap.data.form, now()) && !isFull,
        full: isFull, ...(isFull ? { message: REGISTRATION_FULL_MESSAGE } : {}) });
    }
    if (action === "form") {
      const input = await readRegistrationJson(req);
      const normalized = normalizeRegistrationForm(input, eventId, now().toISOString());
      for (let attempt = 0; attempt < 64; attempt++) {
        const form = Object.hasOwn(input, "maxRegistrations") ? normalized :
          { ...normalized, maxRegistrations: snap.data.form?.maxRegistrations ?? null };
        const result = await store.setJSON(registrationStateKey(eventId),
          { ...snap.data, form }, writeOptions(snap));
        if (result.modified) return response({ ok: true, form });
        await pause(attempt); snap = await readState(store, eventId);
      }
      fail(409, "Form başka bir yönetici tarafından değiştirildi. Tekrar deneyin.");
    }
    const submission = await readRegistrationSubmission(req);
    const id = hash(`${eventId}\u0000${submission.requestId}`).slice(0, 32);
    const existing = snap.data.entries.find((entry) => entry.id === id);
    if (snap.data.deleted.some((entry) => entry.id === id)) fail(409, DELETED_CONFLICT);
    let file;
    try { file = submission.receipt ? await validateRegistrationReceipt(submission.receipt) : null; }
    catch (error) {
      if (existing && error.status) fail(409, RETRY_CONFLICT);
      throw error;
    }
    if (existing) return verifyRetry(submission, existing, file);
    if (!registrationIsAvailable(event, snap.data.form, now()))
      fail(409, "Bu etkinliğin kayıt formu şu anda açık değil.");
    if (full(snap.data)) return fullResponse();
    await prepareSubmission(submission, snap.data.form.fields, file);
    await rateLimit(req, getStore("ercupsa-security"), now());
    const createdAt = now().toISOString();
    const receiptStore = file ? getStore(REGISTRATION_RECEIPT_STORE) : null;
    let receipt = null;
    if (file) {
      receipt = { ...file.metadata, key: `${eventId}/${id}/${identifier(uuid())}` };
      try {
        const uploaded = await receiptStore.set(receipt.key, file.bytes, { onlyIfNew: true });
        if (!uploaded.modified) fail(503, "Dekont kaydedilemedi. Lütfen tekrar deneyin.");
      } catch (error) {
        try { await receiptStore.delete(receipt.key); } catch { /* Retryable private cleanup. */ }
        throw error;
      }
    }
    const cleanup = async () => {
      if (receipt) {
        try { await receiptStore.delete(receipt.key); }
        catch { /* Unreferenced private uploads never affect an accepted record. */ }
      }
    };
    try {
      for (let attempt = 0; attempt < 64; attempt++) {
        const accepted = snap.data.entries.find((entry) => entry.id === id);
        if (accepted) {
          const result = await verifyRetry(submission, accepted, file);
          await cleanup(); return result;
        }
        if (snap.data.deleted.some((entry) => entry.id === id)) fail(409, DELETED_CONFLICT);
        const form = snap.data.form;
        if (!registrationIsAvailable(event, form, now()))
          fail(409, "Bu etkinliğin kayıt formu şu anda açık değil.");
        if (full(snap.data)) { await cleanup(); return fullResponse(); }
        const { answers, fingerprint } = await prepareSubmission(submission, form.fields, file);
        if (receipt && !form.receipt.enabled) fail(400, "Bu formda dekont yüklemesi açık değil.");
        if (!receipt && form.receipt.enabled && form.receipt.required) fail(400, "Dekont dosyanızı yükleyin.");
        const entry = { id, eventId, eventTitle: event.title, eventDate: event.date,
          name: answers.full_name, classYear: answers.class_year, phone: answers.phone,
          answers, fields: structuredClone(form.fields), fingerprint, createdAt, receipt };
        // Form settings, all accepted records and deletion tombstones share a
        // single conditional write. No concurrent submission can oversubscribe
        // the last slot, or race a newly lowered limit or closed form.
        const result = await store.setJSON(registrationStateKey(eventId),
          { ...snap.data, entries: [...snap.data.entries, entry] }, writeOptions(snap));
        if (result.modified) return response({ ok: true, reference: id });
        await pause(attempt); snap = await readState(store, eventId);
      }
      fail(409, "Kayıtlar değişti. Lütfen tekrar deneyin.");
    } catch (error) {
      // CAS may have committed before the connection failed. Strongly confirm
      // ownership before deleting an upload; an uncertain read preserves it.
      let confirmed;
      try { confirmed = await readState(store, eventId); }
      catch { throw error; }
      const accepted = confirmed.data.entries.find((entry) => entry.id === id);
      if (accepted) {
        if (accepted.receipt?.key !== receipt?.key) await cleanup();
        return verifyRetry(submission, accepted, file);
      }
      await cleanup(); throw error;
    }
  });
}

export default createRegistrationsHandler();
