import { getStore as getBlobStore } from "@netlify/blobs";
import { randomUUID, createHash } from "node:crypto";
import { hydrateRegistrationFlags, mapConcurrent, REGISTRATION_STORE, registrationStateKey } from "../lib/registrations.mjs";
import { activeEvents, assertEventRevision, CONTENT_STORE, eventArray, eventRevision, EVENTS_KEY,
  isDeletedEvent, operationHistory, projectEvent, registrationRecovery } from "../lib/event-state.mjs";
import {
  guarded,
  response,
  adminLogin,
  requireAdmin,
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
async function loginLimit(req, getStore, now) {
  const key =
    "login/" +
    createHash("sha256")
      .update(req.headers.get("x-nf-client-connection-ip") || "local")
      .digest("hex");
  const store = getStore("ercupsa-security");
  for (let i = 0; i < 4; i++) {
    const snap = await store.getWithMetadata(key, {
      type: "json",
      consistency: "strong",
    });
    const timestamp = now().getTime(),
      record =
        snap?.data?.expires > timestamp
          ? snap.data
          : { hits: 0, expires: timestamp + 15 * 60 * 1000 };
    if (snap && (typeof snap.etag !== "string" || !snap.etag))
      fail(503, "Giriş doğrulanamadı. Lütfen tekrar deneyin.");
    if (record.hits >= 10)
      fail(429, "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.");
    record.hits++;
    const write = await store.setJSON(
      key,
      record,
      snap ? { onlyIfMatch: snap.etag } : { onlyIfNew: true },
    );
    if (write.modified) return;
  }
  fail(429, "Lütfen biraz sonra tekrar deneyin.");
}
export function createEventsHandler({ getStore = getBlobStore, now = () => new Date(), uuid = randomUUID,
  hydrate = hydrateRegistrationFlags } = {}) {
return guarded(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  if (req.method === "POST" && action === "auth") {
    await loginLimit(req, getStore, now);
    return response({ ok: true }, 200, { "Set-Cookie": adminLogin(req) });
  }
  if (req.method === "POST" && action === "logout")
    return response({ ok: true }, 200, {
      "Set-Cookie":
        `ercupsa_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`,
    });
  if (req.method === "GET") {
    const adminList = url.searchParams.get("admin") === "true";
    if (action === "trash" || adminList) requireAdmin(req);
    if (action && action !== "trash") fail(400, "Geçersiz etkinlik işlemi.");
    const saved = eventArray(await getStore(CONTENT_STORE).get(EVENTS_KEY, READ_JSON), seedEvents);
    if (action === "trash") {
      const trash = saved.filter(isDeletedEvent).map(record => ({ id: record.id, event: projectEvent(record.event, true),
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
          ? events
          : events.filter((e) => e.published !== false),
    });
  }
  requireAdmin(req);
  if (!["POST", "DELETE"].includes(req.method))
    fail(405, "Desteklenmeyen işlem.");
  if ((req.method === "DELETE" && action) || !["", "publish", "restore"].includes(action))
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
        revision: identifier(uuid()), operations: operationHistory(current, "delete", at), lastOperation: { type: "delete", at } };
    } else if (action === "restore") {
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
        updatedAt: at, revision: identifier(uuid()), operations: operationHistory(current || retained, type, at), lastOperation: { type, at } };
      if (index >= 0) events[index] = event; else events.unshift(event);
    } else {
      if (action === "publish" || providedId) {
        if (!current || isDeletedEvent(current)) fail(409, "Etkinlik silinmiş veya artık listede bulunmuyor. Listeyi yenileyin.");
        assertEventRevision(expectedRevision, eventRevision(current));
      } else if (current) fail(409, "Etkinlik kimliği zaten kullanılıyor. Yeniden deneyin.");
      type = action === "publish" ? input.published ? "publish" : "unpublish" : current ? "update" : "create";
      event = { ...(action === "publish" ? projectEvent(current) : normalized), id,
        ...(action === "publish" ? { published: input.published } : {}),
        createdAt: current?.createdAt || at, updatedAt: at, revision: identifier(uuid()),
        operations: operationHistory(current, type, at), lastOperation: { type, at } };
      if (index >= 0) events[index] = event;
      else events.unshift(event);
    }
    const result = await store.setJSON(
      EVENTS_KEY,
      events,
      snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true },
    );
    if (result.modified) return response({ ok: true, ...(event ? { event: projectEvent(event, true) } : {}), events: activeEvents(events, true) });
  }
  fail(409, "Başka bir düzenleme yapıldı. Lütfen yeniden deneyin.");
});
}
export default createEventsHandler();
