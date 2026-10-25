import { getStore as getBlobStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";
import { readEvents as readStoredEvents } from "./events.mjs";
import { db as database } from "../lib/database.mjs";
import { fail, guarded, identifier, requireAdmin, requirePermission, response } from "../lib/security.mjs";
import {
  REGISTRATION_STORE, REGISTRATION_RECEIPT_STORE, REGISTRATION_PHOTO_STORE, REGISTRATION_FULL_MESSAGE,
  defaultRegistrationForm, normalizeRegistrationForm, registrationIsAvailable,
  entryKey, registrationStateKey,
  validateRegistrationAnswers, validateRegistrationReceipt, validateRegistrationPhoto, readRegistrationJson,
  readRegistrationSubmission, entryForAdmin, registrationSummary, registrationCsv,
  mapConcurrent, annotateRegistrationDuplicates,
} from "../lib/registrations.mjs";
import { auditOperation, appendAudit } from "../lib/event-audit.mjs";
import { readRegistrationState as readState, registrationCounts, registrationStatus, registrationStage, ticketEligible, promoteRegistrationQueue } from "../lib/registration-state.mjs";
import { reserveRegistrationTicket, ensureRegistrationTicket, savedRegistrationTicket,
  revokeRegistrationTicket, registrationTicketResponse } from "../lib/registration-tickets.mjs";

const READ_JSON = { type: "json", consistency: "strong" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const ADMIN_ACTIONS = new Set(["admin", "form", "delete", "summary", "receipt", "photo", "export", "ticket", "cancel", "payment"]);
const RETRY_CONFLICT = "Önceki kayıt isteğin alınmış. Farklı bilgilerle tekrar gönderilemedi. Kaydını düzenlemek için organizatörlerle iletişime geç.";
const DELETED_CONFLICT = "Bu kayıt yönetici tarafından silinmiş. Yeni bir kayıt için sayfayı yenileyin.";
const sortedEntries = (entries) => [...entries].sort((a, b) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
const full = (state) => registrationStage(state) === "closed";
const fullResponse = state => response({ error: state?.form?.waitlist?.enabled ? "Etkinliğimizin asıl ve yedek kontenjanları dolmuştur. İlginiz için teşekkür ederiz." : REGISTRATION_FULL_MESSAGE, code: "REGISTRATION_FULL" }, 409);
const pause = (attempt) => new Promise((resolve) => setTimeout(resolve,
  3 + Math.floor(Math.random() * Math.min(40, 2 ** Math.min(attempt, 6)))));
const writeOptions = (snap) => {
  if (snap.exists && (typeof snap.etag !== "string" || !snap.etag))
    fail(503, "Kayıtlar şu anda güncellenemiyor. Lütfen tekrar deneyin.");
  return snap.exists ? { onlyIfMatch: snap.etag } : { onlyIfNew: true };
};

async function prepareSubmission(submission, fields, file, photos = {}, choicesVersion = 0) {
  const answers = validateRegistrationAnswers(submission.answers, fields);
  const photoFields = new Map(fields.filter((field) => field.type === "photo").map((field) => [field.id, field]));
  for (const id of Object.keys(submission.photos || {})) {
    if (!photoFields.has(id)) fail(400, "Form değişmiş olabilir. Sayfayı yenileyip fotoğrafları tekrar seçin.");
  }
  for (const field of photoFields.values()) {
    if (field.required && !photos[field.id]) fail(400, `${field.label}: fotoğraf yükleyin.`);
  }
  const stableAnswers = Object.keys(answers).sort().map((key) => [key,
    Array.isArray(answers[key]) ? [...answers[key]].sort() : answers[key]]);
  const fingerprint = hash(JSON.stringify({ answers: stableAnswers,
    ...(choicesVersion ? { paymentDeclared: submission.paymentDeclared, mediaConsent: submission.mediaConsent } : {}),
    receipt: file ? [file.metadata.mime, hash(file.bytes)] : null,
    ...(Object.keys(photos).length ? { photos: Object.keys(photos).sort().map((id) =>
      [id, photos[id].metadata.mime, hash(photos[id].bytes)]) } : {}) }));
  for (const field of photoFields.values()) answers[field.id] = photos[field.id]?.metadata.name || "";
  return { answers, fingerprint };
}

async function allStates(store) {
  const [states, legacy, forms] = await Promise.all([
    store.list({ prefix: "state/" }), store.list({ prefix: "entries/" }), store.list({ prefix: "forms/" }),
  ]);
  const eventIds = new Set();
  for (const { key } of states.blobs) eventIds.add(key.slice(6, -5));
  for (const { key } of legacy.blobs) eventIds.add(key.split("/")[1]);
  for (const { key } of forms.blobs) eventIds.add(key.slice(6, -5));
  return mapConcurrent([...eventIds], async (eventId) => (await readState(store, eventId)).data);
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

function archivedEvent(eventId, entries, savedEvent) {
  return { id: eventId, title: savedEvent?.title || entries[0]?.eventTitle || "Arşivlenmiş etkinlik",
    date: savedEvent?.date || entries[0]?.eventDate || "", time: savedEvent?.time || entries[0]?.eventTime || "",
    location: savedEvent?.location || entries[0]?.eventLocation || "", published: false, archived: true };
}

const eventSnapshot = (event) => ({ id: event.id, title: event.title, date: event.date,
  time: event.time || "", location: event.location || "" });
const publicFormEvent = (event) => ({ ...eventSnapshot(event), poster: event.poster || "",
  category: event.category || "", description: event.description || "",
  published: event.published !== false, registrationMode: "native", registrationEnabled: true });
const allowed = (session, permission) => session?.role === "owner" || session?.permissions?.includes(permission);
const viewForm = (form, eventId) => ({ ...defaultRegistrationForm(eventId),
  enabled: !!form?.enabled, maxRegistrations: form?.maxRegistrations ?? null,
  receipt: { enabled: !!form?.receipt?.enabled, required: false } });
const submissionResponse = (entry) => response({ ok: true, reference: entry.id, registrationStatus: registrationStatus(entry),
  ...(registrationStatus(entry) === "waitlisted" ? { message: "Yedek kaydınız başarıyla oluşturuldu! Şu anda etkinliğin asıl katılımcı listesinde değil, yedek listesindesiniz. Kontenjanda yer açılması durumunda sizinle iletişime geçilecektir." } : {}),
  event: { id: entry.eventId, title: entry.eventTitle, date: entry.eventDate,
    time: entry.eventTime || "", location: entry.eventLocation || "" } });

async function verifyRetry(submission, entry, file, photos) {
  let prepared;
  try { prepared = await prepareSubmission(submission, entry.fields, file, photos, entry.choicesVersion || 0); }
  catch (error) {
    if (error.status) fail(409, RETRY_CONFLICT);
    throw error;
  }
  if (prepared.fingerprint !== entry.fingerprint) fail(409, RETRY_CONFLICT);
  return submissionResponse(entry);
}

export function createRegistrationsHandler({
  getStore = (name) => getBlobStore({ name, consistency: "strong" }),
  readEvents = readStoredEvents, now = () => new Date(), uuid = randomUUID, db = database,
} = {}) {
  return guarded(async (req) => {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "form";
    const method = req.method;
    const isPublic = (method === "GET" && action === "form") ||
      (method === "POST" && action === "submit");
    let session = null;
    if (!isPublic) {
      // Authenticate and authorize before opening any registration, attachment,
      // event, or ticket store. Deleting participant records is owner-only.
      if (["delete", "cancel"].includes(action)) session = requireAdmin(req);
      else {
        const permission = action === "form" ? "registrations.manage" : action === "payment" ? "payments.manage" : action === "receipt" ? "registrations.receipts"
          : action === "photo" ? "registrations.photos" : action === "export" ? "registrations.export" : "registrations.view";
        session = await requirePermission(req, permission, { getStore });
        if (action === "ticket") await requirePermission(req, method === "POST" ? "tickets.manage" : "tickets.view", { getStore });
      }
      if (!ADMIN_ACTIONS.has(action)) fail(400, "Geçersiz kayıt işlemi.");
    }
    if ((["submit", "delete", "cancel", "payment"].includes(action) && method !== "POST") ||
      (["admin", "summary", "receipt", "photo", "export"].includes(action) && method !== "GET") ||
      (["form", "ticket"].includes(action) && !["GET", "POST"].includes(method)))
      fail(405, "Desteklenmeyen işlem.");
    const store = getStore(REGISTRATION_STORE);
    if (action === "summary") {
      const [events, states] = await Promise.all([readEvents(), allStates(store)]);
      const groups = new Map(events.map((event) => [event.id, { event, entries: [] }]));
      for (const state of states) {
        if (!groups.has(state.eventId)) groups.set(state.eventId, {
          event: archivedEvent(state.eventId, state.entries, state.event), entries: [],
        });
        groups.get(state.eventId).entries.push(...state.entries);
      }
      return response({ events: [...groups].map(([eventId, group]) => ({
        eventId, title: group.event.title, date: group.event.date,
        ...(group.event.archived ? { archived: true } : {}), ...registrationSummary(group.entries),
      })) });
    }
    const eventId = identifier(url.searchParams.get("event_id"));
    let snap = await readState(store, eventId);
    if (["receipt", "photo"].includes(action)) {
      const id = identifier(url.searchParams.get("id"));
      const entry = snap.data.entries.find((item) => item.id === id);
      const fieldId = action === "photo" ? identifier(url.searchParams.get("field_id")) : null;
      const receipt = action === "photo" ? (entry?.photos && Object.hasOwn(entry.photos, fieldId) ? entry.photos[fieldId] : null) : entry?.receipt;
      if (!receipt) fail(404, action === "photo" ? "Fotoğraf bulunamadı." : "Dekont bulunamadı.");
      const bytes = await getStore(action === "photo" ? REGISTRATION_PHOTO_STORE : REGISTRATION_RECEIPT_STORE).get(receipt.key, {
        type: "arrayBuffer", consistency: "strong",
      });
      if (!bytes) fail(404, action === "photo" ? "Fotoğraf bulunamadı." : "Dekont bulunamadı.");
      const disposition = receipt.mime === "application/pdf" ? "attachment" : "inline";
      // Older truncated names can contain an unpaired UTF-16 surrogate. Keep
      // the private file readable while emitting a valid RFC 5987 filename.
      const encodedName = encodeURIComponent(String(receipt.name).replace(/[\uD800-\uDFFF]/gu, "\uFFFD")).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(bytes, { headers: {
        "Content-Type": receipt.mime,
        "Content-Disposition": `${disposition}; filename="${action === "photo" ? "fotograf" : "dekont"}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      } });
    }
    if (["cancel", "payment"].includes(action)) {
      const input = await readRegistrationJson(req), id = identifier(input.id);
      if (action === "payment" && typeof input.approved !== "boolean") fail(400, "Ödeme onayı geçersiz.");
      const operationId = uuid(), at = now().toISOString();
      for (let attempt = 0; attempt < 64; attempt++) {
        const entry = snap.data.entries.find(item => item.id === id);
        if (!entry) fail(404, "Kayıt bulunamadı.");
        const already = registrationStatus(entry) === "cancelled";
        if (action === "payment" && (already || entry.payment?.reviewStatus === "not_required" || !entry.payment))
          fail(409, "Bu kayıt için ödeme kontrolü yapılamaz.");
        const desired = input.approved ? "approved" : "pending";
        const unchanged = action === "cancel" ? already : entry.payment.reviewStatus === desired;
        let promotedIds = [];
        if (!unchanged) {
          const changed = action === "cancel" ? { ...entry, registrationStatus: "cancelled", cancelledAt: at,
            cancelledBy: session?.id, ...(entry.ticket ? { ticketCancellationPending: true } : {}) }
            : { ...entry, payment: { ...entry.payment, reviewStatus: desired, reviewedAt: at, reviewedBy: session?.id } };
          const state = { ...snap.data, entries: snap.data.entries.map(item => item.id === id ? changed : item) };
          const promoted = action === "cancel" ? promoteRegistrationQueue(state, at, session?.id) : { state, promoted: [] };
          promotedIds = promoted.promoted;
          appendAudit(promoted.state, auditOperation({ id: operationId, type: action === "cancel" ? "registration.cancel" : "payment.review",
            at, actor: session, eventId, relatedId: id, before: { status: registrationStatus(entry), reviewStatus: entry.payment?.reviewStatus || "not_required" },
            after: { status: registrationStatus(changed), reviewStatus: changed.payment?.reviewStatus || "not_required" } }));
          for (const promotedId of promotedIds) appendAudit(promoted.state, auditOperation({ id: hash(operationId + promotedId).slice(0, 32),
            type: "registration.promote", at, actor: session, eventId, relatedId: promotedId, before: { status: "waitlisted" }, after: { status: "main" } }));
          try {
            const written = await store.setJSON(registrationStateKey(eventId), promoted.state, writeOptions(snap));
            if (!written.modified) { snap = await readState(store, eventId); await pause(attempt); continue; }
          } catch (error) {
            const current = await readState(store, eventId);
            if (!current.data.audit?.some(item => item.id === operationId)) throw error;
          }
          snap = await readState(store, eventId);
        }
        const saved = snap.data.entries.find(item => item.id === id);
        if (action === "cancel" && saved.ticket && !saved.ticketCancelledAt) {
          await revokeRegistrationTicket(db, eventId, saved.ticket);
          for (let retry = 0; retry < 64; retry++) {
            const current = await readState(store, eventId), value = current.data.entries.find(item => item.id === id);
            if (!value || value.ticketCancelledAt) break;
            const result = await store.setJSON(registrationStateKey(eventId), { ...current.data,
              entries: current.data.entries.map(item => item.id === id ? { ...item, ticketCancellationPending: false, ticketCancelledAt: at } : item) }, writeOptions(current));
            if (result.modified) break;
            if (retry === 63) fail(409, "Bilet iptal kaydı değişti; tekrar deneyin.");
          }
        }
        return response({ ok: true, registrationStatus: action === "cancel" ? "cancelled" : registrationStatus(saved), promoted: promotedIds });
      }
      fail(409, "Kayıtlar değişti. Tekrar deneyin.");
    }
    if (action === "delete") {
      const input = await readRegistrationJson(req);
      const id = identifier(input.id);
      const operationId = uuid(), at = now().toISOString();
      for (let attempt = 0; attempt < 64; attempt++) {
        const entry = snap.data.entries.find((item) => item.id === id);
        let deleted = snap.data.deleted.find((item) => item.id === id);
        if (!entry && !deleted) fail(404, "Kayıt bulunamadı.");
        if (entry) {
          deleted = { id, name: entry.name, ...(entry.receipt ? { receiptKey: entry.receipt.key } : {}),
            ...(entry.photos ? { photoKeys: Object.values(entry.photos).map((photo) => photo.key) } : {}),
            ...(entry.ticket ? { ticket: entry.ticket } : {}) };
          const promoted = promoteRegistrationQueue({ ...snap.data, entries: snap.data.entries.filter((item) => item.id !== id),
            deleted: [...snap.data.deleted, deleted] }, at, session?.id);
          const data = promoted.state;
          appendAudit(data, auditOperation({ id: operationId, type: "registration.delete", at, actor: session, eventId,
            relatedId: id, before: { status: registrationStatus(entry) }, after: { status: "deleted" } }));
          for (const promotedId of promoted.promoted) appendAudit(data, auditOperation({ id: hash(operationId + promotedId).slice(0, 32),
            type: "registration.promote", at, actor: session, eventId, relatedId: promotedId,
            before: { status: "waitlisted" }, after: { status: "main" } }));
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
        for (const key of deleted.photoKeys || []) {
          try { await getStore(REGISTRATION_PHOTO_STORE).delete(key); }
          catch { /* Canonical tombstone denies access until cleanup can be retried. */ }
        }
        try { await store.delete(entryKey(eventId, id)); }
        catch { /* Canonical tombstone prevents any legacy resurrection. */ }
        if (deleted.ticket && !deleted.ticketCancelledAt) {
          await revokeRegistrationTicket(db, eventId, deleted.ticket);
          for (let cleanupAttempt = 0; cleanupAttempt < 64; cleanupAttempt++) {
            const current = await readState(store, eventId);
            const tombstone = current.data.deleted.find((item) => item.id === id);
            if (tombstone?.ticketCancelledAt) break;
            if (!tombstone) fail(503, "Bilet iptal kaydı doğrulanamadı. Silme işlemini tekrar deneyin.");
            const data = { ...current.data, deleted: current.data.deleted.map((item) => item.id === id
              ? { ...item, ticketCancelledAt: now().toISOString() } : item) };
            try {
              const written = await store.setJSON(registrationStateKey(eventId), data, writeOptions(current));
              if (written.modified) break;
            } catch (error) {
              const saved = await readState(store, eventId);
              if (!saved.data.deleted.find((item) => item.id === id)?.ticketCancelledAt) throw error;
              break;
            }
            if (cleanupAttempt === 63) fail(409, "Bilet iptal kaydı değişti. Silme işlemini tekrar deneyin.");
            await pause(cleanupAttempt);
          }
        }
        return response({ ok: true });
      }
      fail(409, "Kayıtlar değişti. Lütfen tekrar deneyin.");
    }
    if (action === "export") {
      const entries = sortedEntries(snap.data.entries);
      if (!entries.length && !(await readEvents()).some((event) => event.id === eventId) &&
        !snap.data.form) fail(404, "Etkinlik bulunamadı.");
      return new Response(registrationCsv(entries, { paymentAccess: allowed(session, "payments.view") || allowed(session, "payments.manage") }), { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kayitlar-${eventId}.csv"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    const events = await readEvents();
    const event = events.find((item) => item.id === eventId);
    if (action === "ticket") {
      const input = method === "POST" ? await readRegistrationJson(req) : null;
      const id = identifier(input ? input.id : url.searchParams.get("id"));
      let entry = snap.data.entries.find((item) => item.id === id);
      if (!entry) fail(404, "Kayıt bulunamadı.");
      if (registrationStatus(entry) !== "main") fail(409, "Yalnızca asıl listedeki kayıtlara bilet verilebilir.");
      if (method === "POST" && !ticketEligible(entry)) fail(409, "Bilet vermeden önce ödeme onaylanmalıdır.");
      if (method === "GET") {
        if (!entry.ticket) fail(404, "Bu kayıt için henüz bilet verilmedi.");
        const ticket = await savedRegistrationTicket(db, eventId, entry.ticket);
        return response({ ticket: registrationTicketResponse(entry.ticket, ticket),
          event: eventSnapshot(event || archivedEvent(eventId, [entry], snap.data.event)) });
      }
      if (!event) fail(409, "Arşivlenmiş etkinlikler için yeni bilet verilemez.");
      for (let attempt = 0; attempt < 64 && !entry.ticket; attempt++) {
        const reservation = reserveRegistrationTicket(uuid, now().toISOString(), event.title);
        const data = { ...snap.data, event: eventSnapshot(event),
          entries: snap.data.entries.map((item) => item.id === id ? { ...item, ticket: reservation } : item) };
        try {
          const written = await store.setJSON(registrationStateKey(eventId), data, writeOptions(snap));
          if (written.modified) { snap = await readState(store, eventId); }
          else { await pause(attempt); snap = await readState(store, eventId); }
        } catch (error) {
          const saved = await readState(store, eventId);
          if (!saved.data.entries.find((item) => item.id === id)?.ticket) throw error;
          snap = saved;
        }
        entry = snap.data.entries.find((item) => item.id === id);
        if (!entry || !ticketEligible(entry)) fail(409, "Kayıt durumu değişti. Bilet verilemedi.");
      }
      if (!entry.ticket) fail(409, "Kayıtlar değişti. Lütfen tekrar deneyin.");
      const reservation = entry.ticket;
      const ticket = reservation.status === "issued" ? await savedRegistrationTicket(db, eventId, reservation)
        : await ensureRegistrationTicket(db, eventId, reservation);
      for (let attempt = 0; attempt < 64; attempt++) {
        snap = await readState(store, eventId);
        entry = snap.data.entries.find((item) => item.id === id);
        if (!entry || registrationStatus(entry) !== "main") {
          await revokeRegistrationTicket(db, eventId, reservation);
          fail(409, "Kayıt silindi. Bilet iptal edildi.");
        }
        // A payment review can be put back on hold while SQL materializes the
        // reserved ticket. Keep the same reservation retryable: canonical
        // eligibility blocks its use until approval, without permanently
        // revoking the ticket merely because payment was reviewed again.
        if (!ticketEligible(entry)) fail(409, "Ödeme onayı değişti. Ödeme onaylandıktan sonra bilet vermeyi tekrar deneyin.");
        if (entry.ticket.status === "issued") return response({
          ticket: registrationTicketResponse(reservation, ticket), event: eventSnapshot(event) });
        const issued = { ...entry.ticket, status: "issued", issuedAt: now().toISOString() };
        try {
          const written = await store.setJSON(registrationStateKey(eventId), { ...snap.data,
            entries: snap.data.entries.map((item) => item.id === id ? { ...item, ticket: issued } : item),
          }, writeOptions(snap));
          if (written.modified) return response({ ticket: registrationTicketResponse(issued, ticket),
            event: eventSnapshot(event) });
        } catch (error) {
          const saved = await readState(store, eventId);
          if (saved.data.entries.find((item) => item.id === id)?.ticket?.status !== "issued") throw error;
          return response({ ticket: registrationTicketResponse(issued, ticket), event: eventSnapshot(event) });
        }
        await pause(attempt);
      }
      fail(409, "Kayıtlar değişti. Bilet ver düğmesiyle tekrar deneyin.");
    }
    if (action === "admin") {
      const entries = sortedEntries(snap.data.entries);
      if (!event && !snap.data.form && !entries.length && !snap.data.deleted.length)
        fail(404, "Etkinlik bulunamadı.");
      if (url.searchParams.has("duplicate_only") && !["true", "false"].includes(url.searchParams.get("duplicate_only")))
        fail(400, "Geçersiz tekrar kayıt filtresi.");
      const filtered = annotateRegistrationDuplicates(entries).filter((entry) =>
        (!url.searchParams.has("class_year") || entry.classYear === url.searchParams.get("class_year")) &&
        (url.searchParams.get("duplicate_only") !== "true" || entry.possibleDuplicate));
      const rawPage = url.searchParams.get("page") || "1";
      if (!/^[1-9]\d{0,6}$/.test(rawPage)) fail(400, "Geçersiz sayfa numarası.");
      const totalPages = Math.max(1, Math.ceil(filtered.length / 50));
      const page = Math.min(Number(rawPage), totalPages);
      const eventInfo = event || archivedEvent(eventId, entries, snap.data.event);
      const form = snap.data.form || defaultRegistrationForm(eventId);
      return response({ form: allowed(session, "registrations.manage") ? form : viewForm(form, eventId),
        event: { id: eventInfo.id, title: eventInfo.title, date: eventInfo.date,
          published: eventInfo.published !== false, ...(eventInfo.archived ? { archived: true } : {}) },
        entries: filtered.slice((page - 1) * 50, page * 50).map((entry) => entryForAdmin(entry, {
          tickets: allowed(session, "tickets.view") || allowed(session, "tickets.manage"),
          photoAccess: allowed(session, "registrations.photos"), receiptAccess: allowed(session, "registrations.receipts"),
          paymentAccess: allowed(session, "payments.view") || allowed(session, "payments.manage"),
        })),
        summary: registrationSummary(entries), page, totalPages,
        pendingTicketDeletions: (session?.role === "owner" ? snap.data.deleted : []).filter((item) => item.ticket && !item.ticketCancelledAt)
          .map((item) => ({ id: item.id, name: item.name || "Silinen kayıt" })) });
    }
    if (!event || (isPublic && event.published === false && !snap.data.form?.enabled)) fail(404, "Etkinlik bulunamadı.");
    if (action === "form" && method === "GET") {
      const stage = registrationStage(snap.data), available = registrationIsAvailable(event, snap.data.form, now()) && stage !== "closed";
      const form = snap.data.form;
      const publicForm = form ? { eventId, enabled: form.enabled, description: form.description, fields: form.fields,
        receipt: { enabled: false, required: false }, payment: form.payment || { enabled: false },
        waitlist: { enabled: form.waitlist?.enabled === true }, showRemainingCapacity: form.showRemainingCapacity === true } : null;
      const limit = form?.maxRegistrations ?? null, counts = registrationCounts(snap.data);
      const message = stage === "waitlist" ? "Etkinliğimizin asıl kontenjanı dolmuştur. Ancak yedek kayıtlarımız devam etmektedir. Başvurunuz yedek listeye alınacaktır."
        : stage === "closed" ? form?.waitlist?.enabled ? "Etkinliğimizin asıl ve yedek kontenjanları dolmuştur. İlginiz için teşekkür ederiz." : REGISTRATION_FULL_MESSAGE : undefined;
      return response({ form: publicForm, ...(form?.enabled ? { event: publicFormEvent(event) } : {}),
        stage: available ? stage : "closed", available, full: stage === "closed", ...(message ? { message } : {}),
        ...(form?.showRemainingCapacity ? { capacity: { limit, main: counts.main, remaining: limit === null ? null : Math.max(0, limit - counts.main) } } : {}) });
    }
    if (action === "form") {
      const input = await readRegistrationJson(req);
      const at = now().toISOString(), operationId = uuid();
      const normalized = normalizeRegistrationForm(input, eventId, at);
      for (let attempt = 0; attempt < 64; attempt++) {
        const form = { ...normalized };
        for (const key of ["maxRegistrations", "waitlist", "showRemainingCapacity", "payment"])
          if (!Object.hasOwn(input, key) && snap.data.form && Object.hasOwn(snap.data.form, key)) form[key] = snap.data.form[key];
        const promoted = promoteRegistrationQueue({ ...snap.data, form }, at, session?.id);
        appendAudit(promoted.state, auditOperation({ id: operationId, type: "form.update", at, actor: session, eventId,
          before: { enabled: !!snap.data.form?.enabled, maxRegistrations: snap.data.form?.maxRegistrations ?? null,
            waitlistEnabled: !!snap.data.form?.waitlist?.enabled, waitlistCapacity: snap.data.form?.waitlist?.capacity || 0,
            showRemainingCapacity: !!snap.data.form?.showRemainingCapacity, paymentEnabled: !!snap.data.form?.payment?.enabled },
          after: { enabled: form.enabled, maxRegistrations: form.maxRegistrations, waitlistEnabled: form.waitlist.enabled,
            waitlistCapacity: form.waitlist.capacity, showRemainingCapacity: form.showRemainingCapacity, paymentEnabled: form.payment.enabled } }));
        const previous = snap.data.form;
        const changes = [
          ["form", !!previous?.enabled !== form.enabled, form.enabled ? "form.open" : "form.close",
            { enabled: !!previous?.enabled }, { enabled: form.enabled }],
          ["capacity", (previous?.maxRegistrations ?? null) !== form.maxRegistrations, "capacity.change",
            { maxRegistrations: previous?.maxRegistrations ?? null }, { maxRegistrations: form.maxRegistrations }],
          ["waitlist", !!previous?.waitlist?.enabled !== form.waitlist.enabled || (previous?.waitlist?.capacity || 0) !== form.waitlist.capacity, "waitlist.change",
            { waitlistEnabled: !!previous?.waitlist?.enabled, waitlistCapacity: previous?.waitlist?.capacity || 0 },
            { waitlistEnabled: form.waitlist.enabled, waitlistCapacity: form.waitlist.capacity }],
          ["counter", !!previous?.showRemainingCapacity !== form.showRemainingCapacity, "counter.change",
            { showRemainingCapacity: !!previous?.showRemainingCapacity }, { showRemainingCapacity: form.showRemainingCapacity }],
        ];
        for (const [suffix, changed, type, before, after] of changes) if (changed)
          appendAudit(promoted.state, auditOperation({ id: `${operationId}-${suffix}`, type, at, actor: session, eventId, before, after }));
        for (const id of promoted.promoted) appendAudit(promoted.state, auditOperation({ id: hash(operationId + id).slice(0, 32),
          type: "registration.promote", at, actor: session, eventId, relatedId: id, before: { status: "waitlisted" }, after: { status: "main" } }));
        const result = await store.setJSON(registrationStateKey(eventId),
          { ...promoted.state, event: eventSnapshot(event) }, writeOptions(snap));
        if (result.modified) return response({ ok: true, form, promoted: promoted.promoted });
        await pause(attempt); snap = await readState(store, eventId);
      }
      fail(409, "Form başka bir yönetici tarafından değiştirildi. Tekrar deneyin.");
    }
    const submission = await readRegistrationSubmission(req);
    const id = hash(`${eventId}\u0000${submission.requestId}`).slice(0, 32);
    const existing = snap.data.entries.find((entry) => entry.id === id);
    if (snap.data.deleted.some((entry) => entry.id === id)) fail(409, DELETED_CONFLICT);
    let file;
    const photoFiles = Object.create(null);
    try {
      file = submission.receipt ? await validateRegistrationReceipt(submission.receipt) : null;
      for (const [fieldId, photo] of Object.entries(submission.photos))
        photoFiles[fieldId] = await validateRegistrationPhoto(photo);
    }
    catch (error) {
      if (existing && error.status) fail(409, RETRY_CONFLICT);
      throw error;
    }
    if (existing) return verifyRetry(submission, existing, file, photoFiles);
    if (file) fail(400, "Dekont yükleme kaldırıldı. Lütfen formu yenileyin.");
    if (!registrationIsAvailable(event, snap.data.form, now()))
      fail(409, "Bu etkinliğin kayıt formu şu anda açık değil.");
    if (full(snap.data)) return fullResponse(snap.data);
    await prepareSubmission(submission, snap.data.form.fields, file, photoFiles);
    await rateLimit(req, getStore("ercupsa-security"), now());
    const createdAt = now().toISOString();
    const staged = [];
    const photos = Object.create(null);
    const receipt = null;
    const cleanup = async (accepted) => {
      const keep = new Set([accepted?.receipt?.key,
        ...Object.values(accepted?.photos || {}).map((photo) => photo.key)].filter(Boolean));
      for (const upload of staged) {
        if (keep.has(upload.key)) continue;
        try { await upload.store.delete(upload.key); }
        catch { /* Unreferenced private uploads never affect an accepted record. */ }
      }
    };
    const upload = async (storeName, source) => {
      const target = getStore(storeName);
      const metadata = { ...source.metadata, key: `${eventId}/${id}/${identifier(uuid())}` };
      let uploaded;
      try {
        uploaded = await target.set(metadata.key, source.bytes, { onlyIfNew: true });
      } catch (error) {
        // A uniquely named upload may have completed before its response was lost.
        try { await target.delete(metadata.key); } catch { /* Retryable private cleanup. */ }
        throw error;
      }
      // A failed conditional create belongs to somebody else; never delete it.
      if (!uploaded.modified) fail(503, "Dosya kaydedilemedi. Lütfen tekrar deneyin.");
      staged.push({ store: target, key: metadata.key });
      return metadata;
    };
    try {
      for (const [fieldId, source] of Object.entries(photoFiles))
        photos[fieldId] = await upload(REGISTRATION_PHOTO_STORE, source);
    } catch (error) { await cleanup(); throw error; }
    try {
      for (let attempt = 0; attempt < 64; attempt++) {
        const accepted = snap.data.entries.find((entry) => entry.id === id);
        if (accepted) {
          const result = await verifyRetry(submission, accepted, file, photoFiles);
          await cleanup(accepted); return result;
        }
        if (snap.data.deleted.some((entry) => entry.id === id)) fail(409, DELETED_CONFLICT);
        const form = snap.data.form;
        if (!registrationIsAvailable(event, form, now()))
          fail(409, "Bu etkinliğin kayıt formu şu anda açık değil.");
        if (full(snap.data)) { await cleanup(); return fullResponse(snap.data); }
        const promoted = promoteRegistrationQueue(snap.data, createdAt, null);
        for (const promotedId of promoted.promoted) appendAudit(promoted.state, auditOperation({
          id: hash(`${eventId}:promote:${promotedId}`).slice(0, 32), type: "registration.promote", at: createdAt,
          eventId, relatedId: promotedId, before: { status: "waitlisted" }, after: { status: "main" } }));
        const stage = registrationStage(promoted.state);
        if (stage === "closed") {
          if (promoted.promoted.length) {
            const reconciled = await store.setJSON(registrationStateKey(eventId), promoted.state, writeOptions(snap));
            if (!reconciled.modified) { snap = await readState(store, eventId); continue; }
          }
          await cleanup(); return fullResponse(promoted.state);
        }
        if (stage === "main" && form.payment?.enabled && !submission.paymentDeclared)
          fail(400, "Ödememi gönderdim kutucuğunu işaretleyin.");
        const { answers, fingerprint } = await prepareSubmission(submission, form.fields, file, photoFiles, 1);

        const entry = { id, eventId, eventTitle: event.title, eventDate: event.date,
          eventTime: event.time || "", eventLocation: event.location || "",
          name: answers.full_name, classYear: answers.class_year, phone: answers.phone,
          answers, fields: structuredClone(form.fields), fingerprint, createdAt, receipt,
          registrationStatus: stage === "waitlist" ? "waitlisted" : "main",
          sequence: promoted.state.nextSequence || (Math.max(0, ...promoted.state.entries.map(item => item.sequence || 0)) + 1), choicesVersion: 1,
          payment: { declared: submission.paymentDeclared, reviewStatus: stage === "main" && form.payment?.enabled ? "pending" : "not_required" },
          mediaConsent: { granted: submission.mediaConsent, textVersion: "media-1", recordedAt: createdAt, channels: ["website", "instagram"] },
          ...(Object.keys(photos).length ? { photos } : {}) };
        // Form settings, all accepted records and deletion tombstones share a
        // single conditional write. No concurrent submission can oversubscribe
        // the last slot, or race a newly lowered limit or closed form.
        const result = await store.setJSON(registrationStateKey(eventId),
          { ...promoted.state, nextSequence: entry.sequence + 1, event: eventSnapshot(event), entries: [...promoted.state.entries, entry] }, writeOptions(snap));
        if (result.modified) return submissionResponse(entry);
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
        await cleanup(accepted);
        return verifyRetry(submission, accepted, file, photoFiles);
      }
      await cleanup(); throw error;
    }
  });
}

export default createRegistrationsHandler();
