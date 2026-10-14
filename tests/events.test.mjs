import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createEventsHandler } from "../netlify/functions/events.mjs";
import { admin, adminLogin } from "../netlify/lib/security.mjs";
import { activeEvents, eventRevision, registrationRecovery } from "../netlify/lib/event-state.mjs";

const oldPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "events-test-only-admin-password";
after(() => { if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = oldPassword; });
const origin = "https://site.test";
const signedCookie = () => adminLogin(new Request(origin, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } })).split(";")[0];
const cookie = signedCookie();
const example = (id = "first") => ({ id, title: `Etkinlik ${id}`, category: "Konferans", date: "2026-10-22",
  time: "15:30", location: "Kırmızı Salon", description: "Kaydedilmiş açıklama", registrationUrl: "",
  poster: "https://res.cloudinary.com/w2trki15/image/upload/poster.jpg", images: [], published: true,
  createdAt: "2026-10-01T12:00:00.000Z" });

function fixture(initial = [example(), example("second")]) {
  const state = { events: structuredClone(initial), etag: initial == null ? 0 : 1, writes: 0, reads: [],
    registrations: new Map(), login: new Map(), failWrites: 0, missingEtag: false, sequence: 0 };
  const content = {
    async get(key, options) { assert.equal(key, "events.json"); state.reads.push(["content", key, options]); return structuredClone(state.events); },
    async getWithMetadata(key, options) {
      assert.equal(key, "events.json"); state.reads.push(["content", key, options]);
      return state.events == null ? null : { data: structuredClone(state.events), etag: state.missingEtag ? undefined : String(state.etag) };
    },
    async setJSON(key, value, options) {
      assert.equal(key, "events.json");
      if (state.failWrites > 0) { state.failWrites--; return { modified: false }; }
      if ((options.onlyIfNew && state.events != null) || (options.onlyIfMatch && options.onlyIfMatch !== String(state.etag))) return { modified: false };
      state.events = structuredClone(value); state.etag++; state.writes++; return { modified: true };
    },
  };
  const registrations = {
    async get(key, options) { state.reads.push(["registrations", key, options]); return state.registrations.get(key) || null; },
    async list(options) { state.reads.push(["registrations-list", options]); return { blobs: [...state.registrations.keys()].filter(key => key.startsWith(options.prefix)).map(key => ({ key })) }; },
    async setJSON() { throw Error("Registration records must not be changed"); },
  };
  const security = {
    async getWithMetadata(key) { const record = state.login.get(key); return record ? { data: structuredClone(record.data), etag: String(record.etag) } : null; },
    async setJSON(key, data, options) {
      const record = state.login.get(key);
      if ((options.onlyIfNew && record) || (options.onlyIfMatch && options.onlyIfMatch !== String(record?.etag))) return { modified: false };
      state.login.set(key, { data: structuredClone(data), etag: (record?.etag || 0) + 1 }); return { modified: true };
    },
  };
  const handler = createEventsHandler({ getStore(name) {
    if (name === "ercupsa-content") return content;
    if (name === "ercupsa-registrations") return registrations;
    if (name === "ercupsa-security") return security;
    throw Error(`Unexpected store ${name}`);
  }, now: () => new Date("2026-10-14T12:00:00.000Z"), uuid: () => `event-revision-${++state.sequence}`, hydrate: async events => events });
  const request = async (method = "GET", path = "/api/events?admin=true", input, headers = {}) => {
    const response = await handler(new Request(origin + path, { method,
      headers: { Cookie: cookie, ...(method === "GET" ? {} : { "Content-Type": "application/json", Origin: origin }), ...headers },
      ...(input === undefined ? {} : { body: typeof input === "string" ? input : JSON.stringify(input) }) }));
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const event = id => activeEvents(state.events || [example()]).find(event => event.id === id);
  const save = (value, revision = event(value.id)?.revision) => request("POST", "/api/events", { event: value, expectedRevision: revision });
  const remove = (id, revision = event(id)?.revision) => request("DELETE", `/api/events?id=${id}&expectedRevision=${encodeURIComponent(revision || "")}`);
  return { state, request, event, save, remove };
}

test("legacy and seed event revisions are stable and GET reads do not migrate storage", async () => {
  const f = fixture(), first = await f.request(), second = await f.request();
  assert.equal(first.status, 200); assert.deepEqual(second.data, first.data);
  assert.match(first.data.events[0].revision, /^[a-f0-9]{64}$/);
  assert.equal(first.data.events[0].revision, eventRevision(example()));
  assert.equal(f.state.writes, 0);
  assert.ok(f.state.reads.every(([, , options]) => options.consistency === "strong"));
  const seeds = fixture(null), seedResult = await seeds.request();
  assert.equal(seedResult.status, 200); assert.equal(seedResult.data.events.length, 3);
  assert.ok(seedResult.data.events.every(event => typeof event.revision === "string"));
  assert.equal(seeds.state.writes, 0);
});

test("anonymous, ordinary staff, password-only and forged sessions cannot access trash or change events", async () => {
  const f = fixture();
  for (const headers of [{ Cookie: "" }, { Cookie: "ercupsa_gate=ordinary-staff-session" },
    { Cookie: "ercupsa_admin=9999999999999.forged" }, { Cookie: "", "x-admin-password": process.env.ADMIN_PASSWORD }]) {
    for (const [method, path, input] of [["GET", "/api/events?admin=true"], ["GET", "/api/events?action=trash"],
      ["POST", "/api/events", { event: example() }], ["POST", "/api/events?action=restore", { id: "first" }],
      ["POST", "/api/events?action=publish", { id: "first", published: false }], ["DELETE", "/api/events?id=first"]])
      assert.equal((await f.request(method, path, input, headers)).status, 401);
  }
  assert.equal(f.state.reads.length, 0); assert.equal(f.state.writes, 0);
});

test("foreign-origin admin mutations fail before storage and 8-hour signed cookies remain required", async () => {
  const f = fixture();
  for (const [method, path, input] of [["POST", "/api/events", { event: example() }],
    ["POST", "/api/events?action=publish", { id: "first", published: false }],
    ["POST", "/api/events?action=restore", { id: "first" }], ["DELETE", "/api/events?id=first"]])
    assert.equal((await f.request(method, path, input, { Origin: "https://attacker.test" })).status, 403);
  assert.equal(f.state.reads.length, 0);
  const before = Date.now(), session = signedCookie(), expires = Number(session.split("=")[1].split(".")[0]);
  assert.ok(expires >= before + 8 * 60 * 60 * 1000 && expires <= Date.now() + 8 * 60 * 60 * 1000);
  assert.equal(admin(new Request(origin, { headers: { Cookie: session } })), true);
  assert.equal(admin(new Request(origin, { headers: { Cookie: session + "x" } })), false);
  const fullCookie = adminLogin(new Request(origin, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } }));
  assert.match(fullCookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/);
  assert.match((await f.request("POST", "/api/events?action=logout")).headers.get("set-cookie"), /Max-Age=0; Secure/);
});

test("new events use server-generated IDs; update, publish and delete require the exact current event revision", async () => {
  const f = fixture(), created = await f.request("POST", "/api/events", { event: { ...example(), id: undefined } });
  assert.equal(created.status, 200); assert.equal(created.data.event.id, "event-revision-1");
  assert.equal(created.data.event.revision, "event-revision-2");
  assert.deepEqual(created.data.event.lastOperation, { type: "create", at: "2026-10-14T12:00:00.000Z" });
  for (const expectedRevision of [undefined, "", "stale"]) {
    assert.equal((await f.request("POST", "/api/events", { event: example(), expectedRevision })).status, 409);
    assert.equal((await f.request("POST", "/api/events?action=publish", { id: "first", published: false, expectedRevision })).status, 409);
    assert.equal((await f.request("DELETE", `/api/events?id=first${expectedRevision == null ? "" : `&expectedRevision=${expectedRevision}`}`)).status, 409);
  }
  assert.equal(f.state.writes, 1);
});

test("publication-only updates preserve the current event content and stale save/publish/delete requests conflict", async () => {
  const f = fixture(), old = f.event("first");
  const saved = await f.save({ ...old, title: "Yeni başlık", description: "Yeni açıklama" }, old.revision);
  assert.equal(saved.status, 200);
  assert.equal((await f.save({ ...old, description: "Eski taslak" }, old.revision)).status, 409);
  assert.equal((await f.request("POST", "/api/events?action=publish", { id: old.id, published: false, expectedRevision: old.revision })).status, 409);
  assert.equal((await f.remove(old.id, old.revision)).status, 409);
  const changed = await f.request("POST", "/api/events?action=publish", { id: old.id, published: false,
    expectedRevision: saved.data.event.revision, event: old });
  assert.equal(changed.status, 200); assert.equal(changed.data.event.title, "Yeni başlık");
  assert.equal(changed.data.event.description, "Yeni açıklama"); assert.equal(changed.data.event.published, false);
  assert.equal(changed.data.event.lastOperation.type, "unpublish");
  assert.equal((await f.request("GET", "/api/events")).data.events.length, 1);
});

test("concurrent saves to the same event have one winner and edits to different events survive CAS retries", async () => {
  const same = fixture(), revision = same.event("first").revision;
  const results = await Promise.all([same.save({ ...example(), title: "Bir" }, revision), same.save({ ...example(), title: "İki" }, revision)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]); assert.equal(same.state.writes, 1);
  const separate = fixture();
  const distinct = await Promise.all([separate.save({ ...example(), title: "Birinci değişti" }),
    separate.save({ ...example("second"), title: "İkinci değişti" })]);
  assert.deepEqual(distinct.map(result => result.status), [200, 200]);
  assert.equal(separate.event("first").title, "Birinci değişti"); assert.equal(separate.event("second").title, "İkinci değişti");
});

test("delete atomically retains the whole original event and public/admin active lists never return tombstones", async () => {
  const f = fixture(), original = f.event("first"), deleted = await f.remove("first");
  assert.equal(deleted.status, 200); assert.equal(deleted.data.events.length, 1);
  assert.equal(f.state.events.length, 2); assert.equal(f.state.events[0].deleted, true);
  assert.deepEqual(f.state.events[0].event, original);
  assert.equal(activeEvents(f.state.events).length, 1);
  const publicResult = await f.request("GET", "/api/events", undefined, { Cookie: "" });
  assert.equal(publicResult.status, 200); assert.equal(publicResult.data.events.length, 1);
  assert.ok(!JSON.stringify(publicResult.data).includes(original.title));
  assert.equal((await f.request()).data.events.length, 1);
  const trash = await f.request("GET", "/api/events?action=trash");
  assert.equal(trash.data.trash[0].id, "first"); assert.deepEqual(trash.data.trash[0].event, original);
  assert.equal(trash.data.trash[0].source, "trash"); assert.equal(trash.data.trash[0].deletedAt, "2026-10-14T12:00:00.000Z");
  assert.equal(trash.data.recoverable.length, 0);
});

test("restore keeps the original ID, metadata and media as a draft without changing forms or tickets", async () => {
  const f = fixture(); f.state.registrations.set("state/first.json", { event: example(), entries: [{ name: "PRIVATE_PERSON" }] });
  await f.remove("first"); const trash = (await f.request("GET", "/api/events?action=trash")).data.trash[0];
  const restored = await f.request("POST", "/api/events?action=restore", { id: trash.id, expectedRevision: trash.revision });
  assert.equal(restored.status, 200); assert.equal(restored.data.event.id, "first");
  assert.equal(restored.data.event.title, example().title); assert.equal(restored.data.event.description, example().description);
  assert.equal(restored.data.event.poster, example().poster); assert.equal(restored.data.event.createdAt, example().createdAt);
  assert.equal(restored.data.event.published, false); assert.equal(restored.data.event.lastOperation.type, "restore");
  assert.equal(f.state.events.find(event => event.id === "first").operations.at(-2).type, "delete");
  assert.equal((await f.request("GET", "/api/events?action=trash")).data.trash.length, 0);
  assert.equal((await f.request("POST", "/api/events?action=restore", { id: trash.id, expectedRevision: trash.revision })).status, 409);
  assert.deepEqual(f.state.registrations.get("state/first.json").entries, [{ name: "PRIVATE_PERSON" }]);
});

test("old open editors cannot recreate missing or deleted IDs or replace their archived originals", async () => {
  const f = fixture(), original = f.event("first"); await f.remove("first");
  assert.equal((await f.save({ ...original, title: "Ancient editor" }, original.revision)).status, 409);
  assert.equal((await f.save({ ...example("never-existed"), title: "Missing event" }, "old")).status, 409);
  assert.equal((await f.request("POST", "/api/events?action=publish", { id: "first", published: true, expectedRevision: original.revision })).status, 409);
  assert.equal(f.state.events[0].event.title, original.title); assert.equal(f.state.writes, 1);
});

test("concurrent restore, deletion and saves cannot lose or accidentally resurrect event data", async () => {
  const f = fixture(), original = f.event("first");
  const actions = await Promise.all([f.remove("first", original.revision), f.save({ ...original, title: "Concurrent edit" }, original.revision)]);
  assert.deepEqual(actions.map(result => result.status).sort(), [200, 409]);
  if (!f.state.events.find(event => event.id === "first").deleted) await f.remove("first");
  const item = (await f.request("GET", "/api/events?action=trash")).data.trash[0];
  const restores = await Promise.all([f.request("POST", "/api/events?action=restore", { id: item.id, expectedRevision: item.revision }),
    f.request("POST", "/api/events?action=restore", { id: item.id, expectedRevision: item.revision })]);
  assert.deepEqual(restores.map(result => result.status).sort(), [200, 409]);
  assert.equal(f.state.events.filter(event => event.id === "first").length, 1);
  assert.equal(f.event("first").published, false);
});

test("previously hard-deleted events are recoverable only from their safe matching registration event snapshot", async () => {
  const f = fixture([example("second")]);
  const snapshot = { id: "first", title: "Meme Kanseri Farkındalık Konferansı", date: "2026-10-22", time: "15:30", location: "Kırmızı Salon",
    poster: "javascript:private", description: "PRIVATE_FORM_DESCRIPTION", name: "PRIVATE_PERSON" };
  f.state.registrations.set("state/first.json", { event: snapshot, form: { description: "PRIVATE_FORM_DESCRIPTION" },
    entries: [{ name: "PRIVATE_PERSON", phone: "PRIVATE_PHONE", receipt: { key: "PRIVATE_RECEIPT" }, ticket: { code: "PRIVATE_TICKET" } }] });
  const listing = await f.request("GET", "/api/events?action=trash"), candidate = listing.data.recoverable[0];
  assert.equal(candidate.id, "first"); assert.equal(candidate.source, "registrations");
  const { createdAt, ...safeExpected } = example("first");
  assert.deepEqual(candidate.event, { ...safeExpected, title: snapshot.title, category: "Etkinlik", description: "", poster: "", published: false });
  assert.ok(!JSON.stringify(listing.data).includes("PRIVATE"));
  const restored = await f.request("POST", "/api/events?action=restore", { id: candidate.id, expectedRevision: candidate.revision });
  assert.equal(restored.status, 200); assert.equal(restored.data.event.id, snapshot.id); assert.equal(restored.data.event.title, snapshot.title);
  assert.equal(restored.data.event.date, snapshot.date); assert.equal(restored.data.event.time, snapshot.time); assert.equal(restored.data.event.location, snapshot.location);
  assert.equal(restored.data.event.category, "Etkinlik"); assert.equal(restored.data.event.poster, ""); assert.equal(restored.data.event.published, false);
  assert.ok(!JSON.stringify(f.state.events).includes("PRIVATE")); assert.equal(f.state.events.length, 2);
  assert.equal((await f.request("GET", "/api/events?action=trash")).data.recoverable.length, 0);
});

test("legacy recovery ignores malformed snapshots and cannot read entries as a fallback", async () => {
  const f = fixture([]);
  for (const [id, event] of [["bad-date", { id: "bad-date", title: "Bad", date: "2026-02-30" }],
    ["bad-title", { id: "bad-title", title: "", date: "2026-10-22" }], ["mismatch", { ...example(), id: "other" }],
    ["missing", null]]) {
    const state = { event }; Object.defineProperty(state, "entries", { get() { throw Error("PII must not be inspected"); } });
    f.state.registrations.set(`state/${id}.json`, state);
  }
  assert.deepEqual((await f.request("GET", "/api/events?action=trash")).data, { trash: [], recoverable: [] });
  for (const id of ["bad-date", "bad-title", "mismatch", "missing", "not-there"])
    assert.equal((await f.request("POST", "/api/events?action=restore", { id, expectedRevision: "bad" })).status, 404);
  assert.equal(f.state.writes, 0);
  assert.equal(registrationRecovery({ eventId: "other", event: example() }, "first"), null);
});

test("delete and restore change revisions so an old editor cannot edit, publish or delete the restored event", async () => {
  const f = fixture(), original = f.event("first"); await f.remove("first");
  const item = (await f.request("GET", "/api/events?action=trash")).data.trash[0];
  const restored = await f.request("POST", "/api/events?action=restore", { id: item.id, expectedRevision: item.revision });
  assert.equal(restored.status, 200); assert.notEqual(restored.data.event.revision, original.revision);
  assert.equal((await f.save({ ...original, title: "Stale draft" }, original.revision)).status, 409);
  assert.equal((await f.remove(original.id, original.revision)).status, 409);
  assert.equal((await f.request("POST", "/api/events?action=publish", { id: original.id, published: true, expectedRevision: original.revision })).status, 409);
  assert.equal(f.state.writes, 2); assert.equal(f.event(original.id).title, original.title); assert.equal(f.event(original.id).published, false);
});

test("legacy restore and an unrelated concurrent edit preserve both events under CAS", async () => {
  const f = fixture([example("second")]); f.state.registrations.set("state/first.json", { eventId: "first", event: example() });
  const candidate = (await f.request("GET", "/api/events?action=trash")).data.recoverable[0];
  const result = await Promise.all([f.request("POST", "/api/events?action=restore", { id: candidate.id, expectedRevision: candidate.revision }),
    f.save({ ...example("second"), title: "Unrelated newer title" })]);
  assert.deepEqual(result.map(value => value.status), [200, 200]);
  assert.equal(f.event("first").id, "first"); assert.equal(f.event("first").published, false);
  assert.equal(f.event("second").title, "Unrelated newer title"); assert.equal(f.state.writes, 2);
});

test("a changed registration snapshot or trash revision after listing prevents stale recovery", async () => {
  const f = fixture([example("second")]); f.state.registrations.set("state/first.json", { event: example() });
  const legacy = (await f.request("GET", "/api/events?action=trash")).data.recoverable[0];
  f.state.registrations.get("state/first.json").event.title = "Snapshot changed";
  assert.equal((await f.request("POST", "/api/events?action=restore", { id: legacy.id, expectedRevision: legacy.revision })).status, 409);
  assert.equal(f.state.writes, 0);
  await f.remove("second"); const trash = (await f.request("GET", "/api/events?action=trash")).data.trash[0];
  assert.equal((await f.request("POST", "/api/events?action=restore", { id: trash.id, expectedRevision: "stale" })).status, 409);
  assert.equal(f.state.writes, 1);
});

test("CAS conflicts retry safely; missing etags and corrupted event arrays fail closed", async () => {
  const f = fixture(); f.state.failWrites = 2;
  assert.equal((await f.remove("first")).status, 200); assert.equal(f.state.writes, 1);
  assert.equal(f.state.events.find(event => event.id === "first").deleted, true);
  const fail = fixture(); fail.state.failWrites = 20;
  assert.equal((await fail.remove("first")).status, 409); assert.equal(fail.state.writes, 0);
  const etag = fixture(); etag.state.missingEtag = true;
  assert.equal((await etag.remove("first")).status, 503); assert.equal(etag.state.writes, 0);
  for (const invalid of [{ events: [] }, [example(), example()], [{ id: "first", deleted: true }]]) {
    const corrupt = fixture(invalid);
    assert.equal((await corrupt.request()).status, 503); assert.equal(corrupt.state.writes, 0);
  }
});

test("mutation input validation rejects malformed JSON, invalid publication and IDs", async () => {
  const f = fixture();
  for (const [path, input, expected] of [["/api/events", "not-json", 400], ["/api/events", {}, 400],
    ["/api/events", { event: [] }, 400], ["/api/events", { event: { ...example(), date: "2026-02-30" } }, 400],
    ["/api/events?action=publish", { id: "first", published: "false" }, 400],
    ["/api/events?action=restore", { id: "../escape" }, 400], ["/api/events?action=purge", {}, 400]])
    assert.equal((await f.request("POST", path, input)).status, expected);
  assert.equal((await f.request("POST", "/api/events", { event: example() }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await f.request("POST", "/api/events", " ".repeat(100001))).status, 413);
  assert.equal((await f.request("PATCH", "/api/events")).status, 405);
  assert.equal(f.state.writes, 0);
});

test("admin login retains IP-scoped conditional-write rate limiting", async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 10; attempt++)
    assert.equal((await f.request("POST", "/api/events?action=auth", undefined, { "x-admin-password": "wrong", "x-nf-client-connection-ip": "198.51.100.1" })).status, 401);
  assert.equal((await f.request("POST", "/api/events?action=auth", undefined, { "x-admin-password": process.env.ADMIN_PASSWORD, "x-nf-client-connection-ip": "198.51.100.1" })).status, 429);
  const login = await f.request("POST", "/api/events?action=auth", undefined, { "x-admin-password": process.env.ADMIN_PASSWORD, "x-nf-client-connection-ip": "198.51.100.2" });
  assert.equal(login.status, 200); assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(f.state.writes, 0);
});
