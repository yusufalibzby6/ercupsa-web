import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = process.env.SITE_URL || "http://127.0.0.1:8888";
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
const login = await request("/api/events?action=auth", {
  method: "POST",
  headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
});
cookie = login.headers.get("set-cookie").split(";")[0];
assert.match(login.headers.get("set-cookie"), /HttpOnly/);
const id = "smoke-" + crypto.randomUUID();
let eventCreated = false, eventRemoved = false;
try {
  await request("/api/events", {
    method: "POST",
    auth: true,
    data: {
      event: {
        id,
        title: "Smoke test",
        date: "2026-10-02",
        published: false,
        images: [],
      },
    },
  });
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
  await request("/api/events", {
    method: "POST",
    auth: true,
    data: {
      event: {
        id,
        title: "Updated smoke",
        date: "2026-10-02",
        published: true,
        images: [],
      },
    },
  });
  assert.ok(
    (await (await request("/api/events")).json()).events.some(
      (e) => e.id === id && e.title === "Updated smoke",
    ),
  );
  await request("/api/events?id=" + id, { method: "DELETE", auth: true });
  eventRemoved = true;
  assert.equal((await (await request(designPath, { auth: true })).json()).design.dataUrl, stored.dataUrl);
} finally {
  await request("/api/ticket-design?event_id=" + id, { method: "DELETE", auth: true });
  if (eventCreated && !eventRemoved)
    await request("/api/events?id=" + id, { method: "DELETE", auth: true });
}
console.log(
  "PASS: served pages/assets, admin cookie, event CRUD, draft privacy, URL/date validation, origin protection and persistent archived ticket artwork. Smoke event and artwork removed.",
);
