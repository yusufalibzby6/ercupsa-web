import { getStore as getBlobStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { hydrateRegistrationFlags, mapConcurrent, REGISTRATION_STORE, registrationStateKey } from "../lib/registrations.mjs";
import { activeEvents, assertEventRevision, CONTENT_STORE, eventArray, eventRevision, EVENTS_KEY,
  isDeletedEvent, isPurgedEvent, eventOperation, operationHistory, projectEvent, registrationRecovery } from "../lib/event-state.mjs";
import { createAdminAuthHandler } from "./admin-auth.mjs";
import {
  guarded,
  response,
  getAdminSession,
  requireOwner,
  requirePermission,
  body,
  identifier,
  eventInput,
  fail,
} from "../lib/security.mjs";
const seedEvents = [
  {
    id: "cigkofte-2026",
    title: "3. Çiğköfte Partisi",
    category: "Tanışma / Eğlence",
    date: "2026-09-01",
    time: "",
    location: "",
    description: "ERCUPSA ailesiyle yeni döneme keyifli bir başlangıç.",
    registrationUrl: "",
    poster: "",
    images: [],
    published: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "konya-unides-2026",
    title: "Konya ÜNİDES Teknik Alan Gezisi",
    category: "Teknik Gezi",
    date: "2026-02-01",
    time: "",
    location: "Konya",
    description:
      "ÜNİDES destekli, mesleki gelişim ve kültürel kaynaşma odaklı Konya saha programımız.",
    registrationUrl: "",
    poster: "",
    images: [],
    published: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "fidan-2026",
    title: "Dünya Eczacılık Günü Fidan Dikimi",
    category: "Sosyal Sorumluluk",
    date: "2026-09-25",
    time: "",
    location: "",
    description:
      "Mesleğimizin onur gününde doğaya nefes olmak için düzenlediğimiz fidan dikimi etkinliği.",
    registrationUrl: "",
    poster: "",
    images: [],
    published: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

const READ_JSON = { type: "json", consistency: "strong" };
export async function readEvents() {
  return activeEvents(eventArray(await getBlobStore(CONTENT_STORE).get(EVENTS_KEY, READ_JSON), seedEvents));
}
const has = (session, permission) => session?.role === "owner" || session?.permissions.includes(permission);
const catalogPermissions = ["events.publish", "registrations.view", "registrations.manage", "registrations.receipts",
  "registrations.photos", "registrations.export", "tickets.view", "tickets.manage", "raffles.view", "raffles.manage",
  "attendance.view", "attendance.manage", "accounts.view", "accounts.manage"];
function adminCatalog(events, session) {
  if (has(session, "events.view")) return events;
  if (!catalogPermissions.some(permission => has(session, permission))) return [];
  return events.map(({ id, title, date, time, location, poster, published, registrationMode, registrationEnabled, revision }) =>
    ({ id, title, date, time, location, poster, published, registrationMode, registrationEnabled,
      ...(has(session, "events.publish") ? { revision } : {}) }));
}
export function createEventsHandler({ getStore = getBlobStore, now = () => new Date(), uuid = randomUUID,
  hydrate = hydrateRegistrationFlags } = {}) {
return guarded(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  if (req.method === "POST" && action === "auth") {
    fail(401, "Kullanıcı adınız ve şifrenizle yönetici girişini kullanın.");
  }
  if (req.method === "POST" && action === "logout")
    return createAdminAuthHandler({ getStore })(req);
  if (req.method === "GET") {
    const adminList = url.searchParams.get("admin") === "true";
    let session;
    if (action === "trash") session = await requireOwner(req, { getStore });
    else if (adminList) {
      session = await getAdminSession(req, { getStore });
      if (!session) fail(401, "Yönetici girişi gerekli.");
    }
    if (action && action !== "trash") fail(400, "Geçersiz etkinlik işlemi.");
    const saved = eventArray(await getStore(CONTENT_STORE).get(EVENTS_KEY, READ_JSON), seedEvents);
    if (action === "trash") {
      const trash = saved.filter(record => isDeletedEvent(record) && !isPurgedEvent(record)).map(record => ({ id: record.id, event: projectEvent(record.event, true),
        revision: record.revision, deletedAt: record.deletedAt, source: "trash" }));
      const known = new Set(saved.map(event => event.id));
      const store = getStore(REGISTRATION_STORE), listed = await store.list({ prefix: "state/" });
      const ids = [...new Set(listed.blobs.flatMap(({ key }) => {
        const match = typeof key === "string" && key.match(/^state\/([A-Za-z0-9_-]{1,100})\.json$/);
        return match && !known.has(match[1]) ? [match[1]] : [];
      }))];
      const recoverable = (await mapConcurrent(ids, async id => registrationRecovery(await store.get(registrationStateKey(id), READ_JSON), id))).filter(Boolean);
      return response({ trash, recoverable });
    }
    const events = await hydrate(activeEvents(saved, adminList), getStore);
    return response({
      events:
        adminList
          ? adminCatalog(events, session)
          : events.filter((e) => e.published !== false),
    });
  }
  const session = req.method === "DELETE" || ["restore", "purge"].includes(action)
    ? await requireOwner(req, { getStore })
    : await requirePermission(req, action === "publish" ? "events.publish" : "events.manage", { getStore });
  if (!["POST", "DELETE"].includes(req.method))
    fail(405, "Desteklenmeyen işlem.");
  if ((req.method === "DELETE" && action) || !["", "publish", "restore", "purge"].includes(action))
    fail(400, "Geçersiz etkinlik işlemi.");
  const input = req.method === "POST" ? await body(req) : null;
  const save = req.method === "POST" && !action;
  if (save && (!input.event || typeof input.event !== "object" || Array.isArray(input.event)))
    fail(400, "Etkinlik gerekli.");
  const normalized = save ? eventInput(input.event) : null;
  const providedId = save && input.event.id != null;
  const id = action
    ? identifier(input.id)
    : req.method === "DELETE"
      ? identifier(url.searchParams.get("id"))
      : providedId ? identifier(input.event.id) : identifier(uuid());
  const expectedRevision = req.method === "DELETE" ? url.searchParams.get("expectedRevision") : input.expectedRevision;
  if (action === "publish" && typeof input.published !== "boolean") fail(400, "Geçersiz yayın durumu.");
  if (action === "purge" && typeof input.confirmation !== "string") fail(400, "Etkinlik başlığını yazarak silmeyi onaylayın.");
  const store = getStore(CONTENT_STORE);
  for (let attempt = 0; attempt < 12; attempt++) {
    const snapshot = await store.getWithMetadata(EVENTS_KEY, READ_JSON);
    if (snapshot && (typeof snapshot.etag !== "string" || !snapshot.etag)) fail(503, "Etkinlik listesi doğrulanamadı.");
    const events = eventArray(snapshot?.data, seedEvents);
    const index = events.findIndex((e) => e.id === id);
    const current = index >= 0 ? events[index] : null;
    const at = now().toISOString();
    let event, type;
    if (req.method === "DELETE") {
      if (!current || isDeletedEvent(current)) fail(409, "Etkinlik silinmiş veya artık listede bulunmuyor. Listeyi yenileyin.");
      assertEventRevision(expectedRevision, eventRevision(current));
      events[index] = { id, deleted: true, event: projectEvent(current), deletedAt: at,
        revision: identifier(uuid()), operations: operationHistory(current, "delete", at, session), lastOperation: eventOperation("delete", at, session) };
    } else if (action === "purge") {
      if (current && (!isDeletedEvent(current) || isPurgedEvent(current))) fail(409, "Etkinlik çöp kutusunda bulunmuyor. Listeyi yenileyin.");
      const retained = current || registrationRecovery(await getStore(REGISTRATION_STORE).get(registrationStateKey(id), READ_JSON), id);
      if (!retained) fail(404, "Silinebilecek etkinlik kaydı bulunamadı.");
      assertEventRevision(expectedRevision, retained.revision);
      if (input.confirmation.trim() !== retained.event.title) fail(400, "Onay için etkinlik başlığını tam olarak yazın.");
      // The marker blocks stale edits and recovery from registration snapshots,
      // while permanently discarding the archived event metadata and media.
      const marker = { id, deleted: true, purged: true, deletedAt: current?.deletedAt || at, purgedAt: at,
        revision: identifier(uuid()) };
      if (index >= 0) events[index] = marker; else events.unshift(marker);
    } else if (action === "restore") {
      if (isPurgedEvent(current)) fail(404, "Bu etkinlik kalıcı olarak silinmiş; geri getirilemez.");
      if (current && !isDeletedEvent(current)) fail(409, "Etkinlik zaten listede. Listeyi yenileyin.");
      let retained;
      if (current) {
        assertEventRevision(expectedRevision, current.revision);
        retained = current.event; type = "restore";
      } else {
        const recovery = registrationRecovery(await getStore(REGISTRATION_STORE).get(registrationStateKey(id), READ_JSON), id);
        if (!recovery) fail(404, "Geri getirilebilecek etkinlik kaydı bulunamadı.");
        assertEventRevision(expectedRevision, recovery.revision);
        retained = recovery.event; type = "recover";
      }
      event = { ...projectEvent(retained), published: false, createdAt: retained.createdAt || at,
        updatedAt: at, revision: identifier(uuid()), operations: operationHistory(current || retained, type, at, session), lastOperation: eventOperation(type, at, session) };
      if (index >= 0) events[index] = event; else events.unshift(event);
    } else {
      if (action === "publish" || providedId) {
        if (!current || isDeletedEvent(current)) fail(409, "Etkinlik silinmiş veya artık listede bulunmuyor. Listeyi yenileyin.");
        assertEventRevision(expectedRevision, eventRevision(current));
      } else if (current) fail(409, "Etkinlik kimliği zaten kullanılıyor. Yeniden deneyin.");
      if (save && !has(session, "events.publish")) {
        if (current && input.event.published != null && normalized.published !== (current.published !== false))
          fail(403, "Etkinliğin yayın durumunu değiştirme yetkiniz yok.");
        normalized.published = current?.published !== false && Boolean(current);
      }
      type = action === "publish" ? input.published ? "publish" : "unpublish" : current ? "update" : "create";
      event = { ...(action === "publish" ? projectEvent(current) : normalized), id,
        ...(action === "publish" ? { published: input.published } : {}),
        createdAt: current?.createdAt || at, updatedAt: at, revision: identifier(uuid()),
        operations: operationHistory(current, type, at, session), lastOperation: eventOperation(type, at, session) };
      if (index >= 0) events[index] = event;
      else events.unshift(event);
    }
    const result = await store.setJSON(
      EVENTS_KEY,
      events,
      snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true },
    );
    if (result.modified) return response({ ok: true, ...(event ? { event: adminCatalog([projectEvent(event, true)], session)[0] } : {}),
      events: adminCatalog(activeEvents(events, true), session) });
  }
  fail(409, "Başka bir düzenleme yapıldı. Lütfen yeniden deneyin.");
});
}
export default createEventsHandler();
