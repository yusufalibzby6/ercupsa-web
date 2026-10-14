import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = process.env.SITE_URL || "http://127.0.0.1:8888";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw Error("Bu test etkinlik oluşturup siler; yalnızca yerel geliştirme adresinde çalıştırılabilir.");
if (!process.env.ADMIN_PASSWORD)
  throw Error("ADMIN_PASSWORD test ortamında gerekli.");
let cookie = "";
async function request(
  path,
  { method = "GET", data, rawBody, auth = false, status = 200, headers = {} } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
      ...(auth ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: data ? JSON.stringify(data) : rawBody,
  });
  assert.equal(r.status, status, path);
  const raw = await r.text();
  return { headers: r.headers, json: async () => JSON.parse(raw) };
}
for (const path of [
  "/",
  "/test.html",
  "/ekip.html",
  "/topluluk.html",
  "/biletler.html",
  "/assets/tailwind.css",
  "/assets/vendor/fontawesome.css",
  "/form",
])
  await request(path);
await request("/api/events?admin=true", { status: 401 });
const login = await request("/api/admin-auth?action=login", {
  method: "POST",
  data: { username: process.env.ADMIN_USERNAME || "basadmin", password: process.env.ADMIN_PASSWORD },
});
cookie = login.headers.get("set-cookie").split(";")[0];
assert.match(login.headers.get("set-cookie"), /HttpOnly/);
let id = "", revision = "";
let eventCreated = false, eventRemoved = false;
try {
  const created = await (await request("/api/events", {
    method: "POST",
    auth: true,
    data: {
      event: {
        title: "Smoke test",
        date: "2026-10-02",
        published: false,
        images: [],
      },
    },
  })).json();
  id = created.event.id;
  revision = created.event.revision;
  assert.ok(id && revision);
  eventCreated = true;
  const designPath = "/api/ticket-design?event_id=" + id;
  await request(designPath, { status: 401 });
  assert.equal((await (await request(designPath, { auth: true })).json()).design, null);
  const artwork = readFileSync("assets/ticket-template-blank.png");
  await request(designPath, {
    method: "POST",
    auth: true,
    headers: { "Content-Type": "image/png" },
    rawBody: artwork,
  });
  const stored = (await (await request(designPath, { auth: true })).json()).design;
  assert.equal(stored.width, 1116);
  assert.equal(stored.height, 588);
  assert.ok(Buffer.from(stored.dataUrl.split(",")[1], "base64").equals(artwork));
  const publicEvents = await (await request("/api/events")).json();
  assert.ok(!publicEvents.events.some((e) => e.id === id));
  const adminEvents = await (
    await request("/api/events?admin=true", { auth: true })
  ).json();
  assert.ok(adminEvents.events.some((e) => e.id === id));
  await request("/api/events", {
    method: "POST",
    auth: true,
    status: 400,
    data: { event: { id, title: "invalid", date: "2026-02-30" } },
  });
  await request("/api/events", {
    method: "POST",
    auth: true,
    status: 400,
    data: {
      event: {
        id,
        title: "invalid",
        date: "2026-10-02",
        poster: "javascript:alert(1)",
      },
    },
  });
  await request("/api/events", {
    method: "POST",
    auth: true,
    status: 403,
    headers: { Origin: "https://other.test" },
    data: { event: { id, title: "invalid", date: "2026-10-02" } },
  });
  const updated = await (await request("/api/events", {
    method: "POST",
    auth: true,
    data: {
      expectedRevision: revision,
      event: {
        id,
        title: "Updated smoke",
        date: "2026-10-02",
        published: true,
        images: [],
      },
    },
  })).json();
  revision = updated.event.revision;
  assert.ok(
    (await (await request("/api/events")).json()).events.some(
      (e) => e.id === id && e.title === "Updated smoke",
    ),
  );
  await request("/api/events?id=" + id + "&expectedRevision=" + encodeURIComponent(revision), { method: "DELETE", auth: true });
  eventRemoved = true;
  assert.equal((await (await request(designPath, { auth: true })).json()).design.dataUrl, stored.dataUrl);
  await request("/api/events?action=trash", { status: 401 });
  await request("/api/events?action=restore", { method: "POST", data: { id }, status: 401 });
  const deleted = (await (await request("/api/events?action=trash", { auth: true })).json()).trash.find(event => event.id === id);
  assert.equal(deleted.event.title, "Updated smoke");
  const restored = await (await request("/api/events?action=restore", {
    method: "POST", auth: true, data: { id, expectedRevision: deleted.revision },
  })).json();
  eventRemoved = false;
  assert.equal(restored.event.id, id);
  assert.equal(restored.event.title, "Updated smoke");
  assert.equal(restored.event.published, false);
  revision = restored.event.revision;
  assert.ok(!(await (await request("/api/events")).json()).events.some(event => event.id === id));
  assert.equal((await (await request(designPath, { auth: true })).json()).design.dataUrl, stored.dataUrl);
  await request("/api/events", {
    method: "POST", auth: true, status: 409,
    data: { event: updated.event, expectedRevision: updated.event.revision },
  });
  await request("/api/events?id=" + id + "&expectedRevision=" + encodeURIComponent(revision), { method: "DELETE", auth: true });
  eventRemoved = true;
} finally {
  if (eventCreated) await request("/api/ticket-design?event_id=" + id, { method: "DELETE", auth: true });
  if (eventCreated && !eventRemoved) {
    const latest = (await (await request("/api/events?admin=true", { auth: true })).json()).events.find(event => event.id === id);
    if (latest) await request("/api/events?id=" + id + "&expectedRevision=" + encodeURIComponent(latest.revision), { method: "DELETE", auth: true });
  }
}
console.log(
  "PASS: served pages/assets, admin cookie, revision-protected event CRUD, private same-ID trash/restore, stale-editor protection, draft privacy, URL/date validation, origin protection and persistent archived ticket artwork. Smoke event moved to trash and artwork removed.",
);
