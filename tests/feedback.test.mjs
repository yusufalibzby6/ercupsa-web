import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createFeedbackHandler } from "../netlify/functions/feedback.mjs";
import { adminLogin, fail } from "../netlify/lib/security.mjs";
import {
  feedbackAvailable, feedbackInput, feedbackKey, feedbackSummary,
  ownFeedback, readFeedback, saveFeedback,
} from "../netlify/lib/feedback.mjs";

const previousPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "feedback-test-only-password";
after(() => {
  if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = previousPassword;
});
const origin = "https://site.test";
const cookie = adminLogin(new Request(origin, {
  headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
})).split(";")[0];
const event = { id: "event-one", title: "Etkinlik bir", date: "2026-10-07", time: "23:59", published: true };
const instant = new Date("2026-10-07T21:00:00.000Z");

function memory() {
  const records = new Map(), calls = [], hooks = {};
  let revision = 0;
  const store = {
    async getWithMetadata(key, options) {
      calls.push({ action: "read", key, options });
      await hooks.read?.(key);
      const value = structuredClone(records.get(key) || null);
      return hooks.metadata ? hooks.metadata(value) : value;
    },
    async setJSON(key, data, options = {}) {
      calls.push({ action: "write", key, options });
      await hooks.beforeSet?.(key, data, options);
      const existing = records.get(key);
      if (options.onlyIfNew && existing || options.onlyIfMatch && existing?.etag !== options.onlyIfMatch)
        return { modified: false };
      records.set(key, { data: structuredClone(data), etag: String(++revision) });
      await hooks.afterSet?.(key, data);
      return { modified: true };
    },
    async list({ prefix = "" } = {}) {
      calls.push({ action: "list", prefix });
      return { blobs: [...records.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  return { store, records, calls, hooks };
}

function fixture() {
  const memoryStore = memory();
  const state = {
    events: [structuredClone(event), { id: "event-two", title: "Etkinlik iki", date: "2026-10-20", published: true }],
    attendance: [{ user_id: "ada", event_id: event.id }, { user_id: "bora", event_id: event.id }],
    profiles: [{ id: "ada", name: "Ada Katılımcı" }, { id: "bora", name: "Bora Katılımcı" }],
    reads: [], authentications: [], clock: instant,
  };
  const handler = createFeedbackHandler({
    store: () => memoryStore.store,
    events: async () => structuredClone(state.events),
    now: () => new Date(state.clock),
    authenticate: async (req) => {
      state.authentications.push(req.headers.get("authorization"));
      const token = req.headers.get("authorization");
      if (!token || !["Bearer ada", "Bearer bora", "Bearer outsider"].includes(token)) fail(401, "Oturum gerekli.");
      return { id: token.slice(7), email: "local@example.test" };
    },
    read: async (path) => {
      state.reads.push(path);
      const url = new URL(`https://db.test/${path}`);
      if (url.pathname === "/attendance") return state.attendance.filter((row) =>
        row.user_id === url.searchParams.get("user_id").slice(3) &&
        row.event_id === url.searchParams.get("event_id").slice(3)).map(({ event_id }) => ({ event_id }));
      assert.equal(url.pathname, "/profiles");
      return state.profiles.filter((row) => row.id === url.searchParams.get("id").slice(3));
    },
  });
  const request = (action = "mine", {
    method = "GET", eventId = event.id, person = "ada", admin = false, input, headers = {}, rawBody,
  } = {}) => handler(new Request(`${origin}/api/feedback?action=${action}&eventId=${encodeURIComponent(eventId)}`, {
    method,
    headers: { Origin: origin, ...(person ? { authorization: `Bearer ${person}` } : {}),
      ...(admin ? { cookie } : {}), ...(input !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: method === "GET" ? undefined : input === undefined ? rawBody : JSON.stringify(input),
  }));
  const submit = (rating = 4, options = {}) => request("mine", { method: "POST",
    input: { eventId: options.eventId || event.id, rating, comment: "Güzel etkinlik", ...options.input }, ...options });
  return { ...memoryStore, state, handler, request, submit };
}

test("feedback opens at next Istanbul midnight, including leap days, and rejects invalid or hidden dates", () => {
  assert.equal(feedbackAvailable(event, new Date("2026-10-07T20:59:59.999Z")), false);
  assert.equal(feedbackAvailable(event, instant), true);
  assert.equal(feedbackAvailable({ ...event, time: "00:01" }, instant), true);
  assert.equal(feedbackAvailable({ ...event, date: "2028-02-29" }, new Date("2028-02-29T20:59:59.999Z")), false);
  assert.equal(feedbackAvailable({ ...event, date: "2028-02-29" }, new Date("2028-02-29T21:00:00Z")), true);
  for (const date of ["", "2026-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "2026-10-00", "2026-1-07", "not-a-date"])
    assert.equal(feedbackAvailable({ ...event, date }, new Date("2030-01-01")), false, date);
  assert.equal(feedbackAvailable({ ...event, published: false }, instant), false);
  assert.equal(feedbackAvailable(undefined, instant), false);
  assert.equal(feedbackAvailable(event, new Date(NaN)), false);
});

test("feedback inputs normalize optional comments and reject invalid ratings or identities", () => {
  assert.deepEqual(feedbackInput({ eventId: event.id, rating: 5 }), { eventId: event.id, rating: 5, comment: "" });
  assert.equal(feedbackInput({ eventId: event.id, rating: 1, comment: "  Açıklama  " }).comment, "Açıklama");
  for (const rating of [0, 6, 1.5, "5", null, true, NaN])
    assert.throws(() => feedbackInput({ eventId: event.id, rating }), (error) => error.status === 400);
  for (const input of [{ eventId: "../event-one", rating: 4 }, { eventId: "", rating: 4 },
    { eventId: event.id, rating: 4, comment: [] }, { eventId: event.id, rating: 4, comment: "x".repeat(2001) }])
    assert.throws(() => feedbackInput(input), (error) => error.status === 400);
});

test("administrator feedback and summaries require signed cookies and reject cross-origin mutations before I/O", async () => {
  const f = fixture();
  for (const action of ["admin", "summary"]) {
    assert.equal((await f.request(action, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } })).status, 401);
    assert.equal((await f.request(action, { headers: { cookie: cookie + "tampered" } })).status, 401);
  }
  assert.equal((await f.request("mine", { person: null })).status, 401);
  assert.equal((await f.request("mine", { person: "unknown" })).status, 401);
  assert.equal((await f.submit(4, { headers: { Origin: "https://foreign.test" } })).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.reads.length, 0);
  assert.equal((await f.request("admin", { admin: true, method: "POST", input: {} })).status, 405);
  assert.equal((await f.request("unsupported")).status, 400);
});

test("only verified ticket holders can read or submit, and body identities cannot change ownership", async () => {
  const f = fixture();
  assert.equal((await f.request("mine", { person: "outsider" })).status, 403);
  assert.equal((await f.submit(4, { person: "outsider" })).status, 403);
  assert.equal(f.calls.length, 0);
  const result = await f.submit(5, { input: { eventId: event.id, rating: 5, comment: "  Harika  ", userId: "bora", name: "Spoof" } });
  assert.equal(result.status, 200);
  const saved = f.records.get(feedbackKey(event.id)).data.entries[0];
  assert.equal(saved.userId, "ada");
  assert.equal(saved.name, "Ada Katılımcı");
  assert.equal(saved.comment, "Harika");
  assert.equal((await (await f.request("mine", { person: "bora" })).json()).feedback, null);
  const mine = await (await f.request()).json();
  assert.deepEqual(mine.feedback, ownFeedback(saved));
  assert.deepEqual(Object.keys(mine.feedback).sort(), ["comment", "createdAt", "rating", "updatedAt"]);
  assert.ok(!JSON.stringify(mine).includes("Katılımcı"));
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.ok(f.state.reads.every((path) => !path.includes("bora") || path.startsWith("attendance?")));
});

test("future, same-day, unpublished and removed events cannot be rated even by ticket holders", async () => {
  const f = fixture();
  f.state.clock = new Date("2026-10-07T20:59:59.999Z");
  const closed = await (await f.request()).json();
  assert.equal(closed.available, false);
  assert.match(closed.message, /sonraki gün/);
  assert.equal((await f.submit()).status, 409);
  f.state.clock = new Date("2026-09-01");
  assert.equal((await f.submit()).status, 409);
  f.state.clock = instant;
  f.state.events[0].published = false;
  assert.equal((await f.submit()).status, 409);
  f.state.events.shift();
  assert.equal((await f.submit()).status, 404);
  assert.equal(f.calls.filter((call) => call.action === "write").length, 0);
});

test("HTTP validation and nonattendance errors leave feedback untouched", async () => {
  const f = fixture();
  for (const rating of [0, 6, "4", 2.5, null]) assert.equal((await f.submit(rating)).status, 400);
  assert.equal((await f.submit(4, { input: { eventId: "../event-one", rating: 4 } })).status, 400);
  assert.equal((await f.submit(4, { input: { eventId: event.id, rating: 4, comment: "a".repeat(2001) } })).status, 400);
  assert.equal((await f.request("mine", { method: "POST", rawBody: "{}" })).status, 415);
  assert.equal((await f.request("mine", { method: "POST", rawBody: "[1]", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await f.request("mine", { method: "POST", rawBody: "bad", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await f.submit(4, { eventId: "event-two" })).status, 403);
  assert.equal(f.records.size, 0);
});

test("simultaneous submissions produce one entry per user and never lose other participants", async () => {
  const f = fixture();
  const responses = await Promise.all([f.submit(2), f.submit(5), f.submit(3, { person: "bora" })]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const data = f.records.get(feedbackKey(event.id)).data;
  assert.equal(data.entries.length, 2);
  assert.equal(new Set(data.entries.map((entry) => entry.userId)).size, 2);
  assert.equal(data.entries.find((entry) => entry.userId === "bora").rating, 3);
  assert.ok([2, 5].includes(data.entries.find((entry) => entry.userId === "ada").rating));
  assert.ok(f.calls.some((call) => call.action === "write" && call.options.onlyIfNew));
  assert.ok(f.calls.some((call) => call.action === "write" && call.options.onlyIfMatch));
  assert.ok(f.calls.filter((call) => call.action === "read").every((call) => call.options.consistency === "strong"));
});

test("updates replace one person's rating, preserve creation time and idempotent retries do not write", async () => {
  const f = fixture();
  const first = await (await f.submit(2)).json();
  await f.submit(3, { person: "bora" });
  f.state.clock = new Date("2026-10-08T18:00:00Z");
  f.state.profiles[0].name = "Yeni Ada";
  const changed = await (await f.submit(5)).json();
  assert.equal(changed.feedback.createdAt, first.feedback.createdAt);
  assert.equal(changed.feedback.updatedAt, f.state.clock.toISOString());
  const writes = f.calls.filter((call) => call.action === "write").length;
  f.state.clock = new Date("2026-10-09T18:00:00Z");
  assert.deepEqual(await (await f.submit(5)).json(), changed);
  assert.equal(f.calls.filter((call) => call.action === "write").length, writes);
  const entries = f.records.get(feedbackKey(event.id)).data.entries;
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.userId === "ada").name, "Yeni Ada");
  assert.equal(entries.find((entry) => entry.userId === "bora").rating, 3);
});

test("missing etags fail closed and exhausted compare-and-swap conflicts return retryable status", async () => {
  const m = memory();
  await saveFeedback(m.store, event, { id: "ada", name: "Ada" }, { rating: 2, comment: "" }, instant);
  m.hooks.metadata = (snapshot) => ({ ...snapshot, etag: undefined });
  const writes = m.calls.filter((call) => call.action === "write").length;
  await assert.rejects(saveFeedback(m.store, event, { id: "ada", name: "Ada" }, { rating: 5, comment: "" }, instant),
    (error) => error.status === 503);
  assert.equal(m.calls.filter((call) => call.action === "write").length, writes);
  let attempts = 0;
  await assert.rejects(saveFeedback({ getWithMetadata: async () => null,
    setJSON: async () => { attempts++; return { modified: false }; } }, event, { id: "ada", name: "Ada" },
  { rating: 5, comment: "" }, instant), (error) => error.status === 409);
  assert.equal(attempts, 16);
});

test("saved responses lost in transit can be retried without duplicating a participant", async () => {
  const m = memory();
  let loseResponse = true;
  m.hooks.afterSet = () => { if (loseResponse) { loseResponse = false; throw Error("response lost"); } };
  const person = { id: "ada", name: "Ada" }, input = { rating: 4, comment: "İyi" };
  await assert.rejects(saveFeedback(m.store, event, person, input, instant), /response lost/);
  const saved = await saveFeedback(m.store, event, person, input, new Date("2026-10-10"));
  assert.equal(saved.createdAt, instant.toISOString());
  assert.equal(saved.updatedAt, instant.toISOString());
  assert.equal(m.records.get(feedbackKey(event.id)).data.entries.length, 1);
  assert.equal(m.calls.filter((call) => call.action === "write").length, 1);
});

test("admin summaries count archived feedback and expose no participant identities or comments", async () => {
  const f = fixture();
  await f.submit(5);
  f.state.clock = new Date("2026-10-08T18:00:00Z");
  await f.submit(2, { person: "bora" });
  f.state.events.shift();
  const archived = await (await f.request("admin", { admin: true })).json();
  assert.equal(archived.event.archived, true);
  assert.equal(archived.event.title, event.title);
  assert.equal(archived.event.date, event.date);
  assert.deepEqual(archived.summary, { count: 2, average: 3.5, distribution: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 } });
  assert.deepEqual(archived.entries.map((entry) => entry.userId), ["bora", "ada"]);
  const summary = await (await f.request("summary", { admin: true })).json();
  assert.equal(summary.events.length, 2);
  assert.equal(summary.events.find((item) => item.event.id === event.id).count, 2);
  assert.equal(summary.events.find((item) => item.event.id === "event-two").average, null);
  assert.ok(!JSON.stringify(summary).includes("Katılımcı"));
  assert.ok(!JSON.stringify(summary).includes("Güzel etkinlik"));
  assert.ok(!JSON.stringify(summary).includes("userId"));
  const mine = await (await f.request()).json();
  assert.equal(mine.available, false);
  assert.equal(mine.feedback.rating, 5);
  assert.equal((await f.submit()).status, 409);
  assert.equal((await f.request("admin", { admin: true, eventId: "missing" })).status, 404);
  assert.deepEqual(feedbackSummary([]), { count: 0, average: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  assert.equal(feedbackSummary([{ rating: 1 }, { rating: 2 }, { rating: 2 }]).average, 1.67);
});

test("malformed stored data fails closed instead of exposing or rewriting inconsistent feedback", async () => {
  const m = memory();
  const entry = { userId: "ada", name: "Ada", rating: 4, comment: "", createdAt: instant.toISOString(), updatedAt: instant.toISOString() };
  const base = { version: 1, eventId: event.id, entries: [entry] };
  const invalid = [
    { ...base, version: 2 }, { ...base, eventId: "another-event" }, { ...base, entries: null },
    { ...base, entries: [entry, { ...entry }] }, { ...base, entries: [{ ...entry, rating: "4" }] },
    { ...base, entries: [{ ...entry, rating: 6 }] }, { ...base, entries: [{ ...entry, comment: "a".repeat(2001) }] },
    { ...base, entries: [{ ...entry, name: null }] }, { ...base, entries: [{ ...entry, createdAt: null }] },
    { ...base, entries: [{ ...entry, updatedAt: null }] },
  ];
  for (const data of invalid) {
    m.records.set(feedbackKey(event.id), { data, etag: "1" });
    await assert.rejects(readFeedback(m.store, event.id), (error) => error.status === 503);
  }
  assert.equal(m.calls.filter((call) => call.action === "write").length, 0);
});
