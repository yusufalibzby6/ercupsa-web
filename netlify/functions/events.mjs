import { getStore } from "@netlify/blobs";
import { randomUUID, createHash } from "node:crypto";
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

export async function readEvents() {
  const events =
    (await getStore("ercupsa-content").get("events.json", {
      type: "json",
      consistency: "strong",
    })) || seedEvents;
  return events.map((e) => ({
    ...eventInput(e),
    id: identifier(e.id),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
}
async function loginLimit(req) {
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
    const now = Date.now(),
      record =
        snap?.data?.expires > now
          ? snap.data
          : { hits: 0, expires: now + 15 * 60 * 1000 };
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
export default guarded(async (req) => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.searchParams.get("action") === "auth") {
    await loginLimit(req);
    return response({ ok: true }, 200, { "Set-Cookie": adminLogin(req) });
  }
  if (req.method === "POST" && url.searchParams.get("action") === "logout")
    return response({ ok: true }, 200, {
      "Set-Cookie":
        "ercupsa_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
  if (req.method === "GET") {
    if (url.searchParams.get("admin") === "true") requireAdmin(req);
    const events = await readEvents();
    return response({
      events:
        url.searchParams.get("admin") === "true"
          ? events
          : events.filter((e) => e.published !== false),
    });
  }
  requireAdmin(req);
  if (!["POST", "DELETE"].includes(req.method))
    fail(405, "Desteklenmeyen işlem.");
  const input = req.method === "POST" ? (await body(req)).event : null;
  const normalized = input ? eventInput(input) : null;
  const id = input?.id
    ? identifier(input.id)
    : req.method === "DELETE"
      ? identifier(url.searchParams.get("id"))
      : randomUUID();
  const store = getStore("ercupsa-content");
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await store.getWithMetadata("events.json", {
      type: "json",
      consistency: "strong",
    });
    const events = snapshot?.data || structuredClone(seedEvents);
    const index = events.findIndex((e) => e.id === id);
    let event;
    if (req.method === "DELETE") {
      if (index < 0) fail(404, "Etkinlik bulunamadı.");
      events.splice(index, 1);
    } else {
      event = {
        ...normalized,
        id,
        createdAt:
          index >= 0 ? events[index].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (index >= 0) events[index] = event;
      else events.unshift(event);
    }
    const result = await store.setJSON(
      "events.json",
      events,
      snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true },
    );
    if (result.modified) return response({ ok: true, event, events });
  }
  fail(409, "Başka bir düzenleme yapıldı. Lütfen yeniden deneyin.");
});
