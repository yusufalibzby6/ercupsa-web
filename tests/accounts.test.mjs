import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createAccountsHandler } from "../netlify/functions/accounts.mjs";
import { createCommunityHandler } from "../netlify/functions/community.mjs";
import { MODERATION_KEY, readAuthAccounts, publicBadgeBoard } from "../netlify/lib/accounts.mjs";
import { adminLogin } from "../netlify/lib/security.mjs";

const previousPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "account-admin-test-password";
after(() => { if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previousPassword; });
const origin = "https://site.test";
const cookie = adminLogin(new Request(origin, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } })).split(";")[0];
const id = number => `10000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
const authUser = (number, data = {}) => ({ id: id(number), email: `user${number}@example.test`, created_at: "2026-10-01T10:00:00Z", ...data });
const profile = (number, consent = true) => ({ id: id(number), name: `Öğrenci ${number}`, public_name: consent });
const claim = (number, event = "event-one", data = {}) => ({ user_id: id(number), event_id: event, event_title: event,
  ticket_id: id(number + 10000), created_at: "2026-10-02T10:00:00Z", ...data });

function fixture() {
  const state = { users: [authUser(1), authUser(2)], profiles: [profile(1)], attendance: [],
    events: [{ id: "event-one", title: "Birinci etkinlik", date: "2026-10-02", time: "19:00", location: "Fakülte" }],
    records: new Map(), checkins: new Map(), etag: 0, calls: [], authCap: 1000, dbCap: 1000,
    failModeration: false, failCheckins: false, readHook: null };
  const moderation = {
    async get(key, options) {
      state.calls.push({ kind: "moderation", key, options });
      if (state.failModeration) throw Error("private storage credentials");
      return structuredClone(state.records.get(key)?.data ?? null);
    },
    async getWithMetadata(key, options) {
      state.calls.push({ kind: "moderation-snapshot", key, options });
      if (state.failModeration) throw Error("private storage credentials");
      return structuredClone(state.records.get(key) ?? null);
    },
    async setJSON(key, data, options) {
      state.calls.push({ kind: "moderation-write", key, options });
      const existing = state.records.get(key);
      if (options.onlyIfNew && existing || options.onlyIfMatch && options.onlyIfMatch !== existing?.etag) return { modified: false };
      state.records.set(key, { data: structuredClone(data), etag: String(++state.etag) });
      return { modified: true };
    },
  };
  const operations = {
    async *list() {
      state.calls.push({ kind: "checkin-list" });
      if (state.failCheckins) throw Error("private check-in storage");
      yield { blobs: [...state.checkins.keys()].map(key => ({ key })), directories: [] };
    },
    async get(key, options) {
      state.calls.push({ kind: "checkin", key, options });
      if (state.failCheckins) throw Error("private check-in storage");
      return structuredClone(state.checkins.get(key) ?? null);
    },
    async getWithMetadata(key, options) {
      state.calls.push({ kind: "checkin", key, options });
      if (state.failCheckins) throw Error("private check-in storage");
      return state.checkins.has(key) ? { data: structuredClone(state.checkins.get(key)), etag: "test-etag" } : null;
    },
  };
  const auth = async path => {
    state.calls.push({ kind: "auth", path });
    if (path.startsWith("users/")) {
      const user = state.users.find(user => user.id === path.slice(6));
      if (!user) { const error = Error("Hesap bulunamadı."); error.status = 404; throw error; }
      return { user: structuredClone(user) };
    }
    const params = new URL(path, origin).searchParams, page = Number(params.get("page"));
    return { users: structuredClone(state.users.slice((page - 1) * state.authCap, page * state.authCap)) };
  };
  const read = async (path, options = {}) => {
    state.calls.push({ kind: "db", path, options });
    await state.readHook?.(path);
    const url = new URL(path, origin), table = url.pathname.slice(1), params = url.searchParams;
    if (table === "submissions") return [];
    if (!["profiles", "attendance"].includes(table)) throw Error(`Unmocked table ${table}`);
    if (options.method === "POST") {
      const index = state.profiles.findIndex(profile => profile.id === options.data.id);
      if (index >= 0) state.profiles[index] = structuredClone(options.data);
      else state.profiles.push(structuredClone(options.data));
      return [];
    }
    let rows = structuredClone(state[table]);
    for (const [key, value] of params) {
      if (value.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith("in.(")) {
        const ids = value.slice(4, -1).split(","); rows = rows.filter(row => ids.includes(row[key]));
      }
    }
    const cursor = params.get("and") || params.get("or");
    if (cursor) {
      const columns = [...cursor.matchAll(/([a-z_]+)\.gt\.([A-Za-z0-9_-]+)/g)].map(match => [match[1], match[2]]);
      rows = rows.filter(row => {
        for (const [key, value] of columns) {
          if (row[key] > value) return true;
          if (row[key] < value) return false;
        }
        return false;
      });
    }
    const order = (params.get("order") || "id.asc").split(",").map(value => value.split("."));
    rows.sort((a, b) => {
      for (const [key, direction] of order) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return direction === "desc" ? -comparison : comparison; }
      return 0;
    });
    rows = rows.slice(Number(params.get("offset") || 0), Number(params.get("offset") || 0) + Math.min(Number(params.get("limit") || state.dbCap), state.dbCap));
    const select = params.get("select");
    return select ? rows.map(row => Object.fromEntries(select.split(",").map(key => [key, row[key]]))) : rows;
  };
  const handler = createAccountsHandler({ read, auth, events: async () => structuredClone(state.events),
    moderation: () => moderation, store: () => operations, now: () => new Date("2026-10-13T12:00:00Z") });
  const community = createCommunityHandler({ read, moderation: () => moderation, currentUser: async () => ({ id: id(1), email: "not-returned@example.test" }) });
  const request = async (query = "", { method = "GET", input, authenticated = true, foreignOrigin = false, endpoint = "accounts" } = {}) => {
    const response = await (endpoint === "accounts" ? handler : community)(new Request(`${origin}/api/${endpoint}?${query}`, {
      method, headers: { ...(authenticated ? { cookie } : {}), Origin: foreignOrigin ? "https://foreign.test" : origin,
        ...(input ? { "Content-Type": "application/json" } : {}) }, body: input ? JSON.stringify(input) : undefined,
    }));
    return { status: response.status, data: await response.json(), cache: response.headers.get("cache-control") };
  };
  return { state, moderation, read, request };
}

test("account API authenticates before private storage/Auth reads and refuses foreign mutations", async () => {
  const { state, request } = fixture();
  assert.equal((await request("", { authenticated: false })).status, 401);
  assert.equal((await request(`userId=${id(1)}`, { authenticated: false })).status, 401);
  assert.equal((await request("action=visibility", { method: "POST", input: { userId: id(1), hidden: true }, foreignOrigin: true })).status, 403);
  assert.equal(state.calls.length, 0);
});

test("account directory includes Auth-only registrations, globally searches names/email, and returns only explicit private fields", async () => {
  const { state, request } = fixture();
  state.users[1] = authUser(2, { user_metadata: { first_name: "Belinay", last_name: "Daş", private_secret: "secret-payload" },
    identities: [{ token: "identity-token" }], recovery_token: "recovery-token" });
  const result = await request();
  assert.equal(result.status, 200); assert.equal(result.cache, "no-store");
  assert.equal(result.data.total, 2);
  const account = result.data.accounts.find(account => account.id === id(2));
  assert.deepEqual(Object.keys(account).sort(), ["id", "name", "email", "createdAt", "hasProfile", "publicName", "publicNameBlocked"].sort());
  assert.equal(account.name, "Belinay Daş"); assert.equal(account.hasProfile, false);
  assert.equal(account.publicName, false); assert.equal(account.publicNameBlocked, false);
  assert.equal((await request("search=belinay")).data.total, 1);
  assert.equal((await request("search=user1%40example.test")).data.total, 1);
  assert.ok(!JSON.stringify(result.data).includes("token")); assert.ok(!JSON.stringify(result.data).includes("secret-payload"));
});

test("directory pagination reads past 1000 Auth users and database short pages instead of silently truncating", async () => {
  const { state, request } = fixture();
  state.users = Array.from({ length: 1001 }, (_, index) => authUser(index + 1));
  state.profiles = [profile(1), profile(2), profile(1001)]; state.dbCap = 1;
  const result = await request("page=21");
  assert.equal(result.status, 200); assert.equal(result.data.total, 1001); assert.equal(result.data.accounts.length, 1);
  assert.equal(state.calls.filter(call => call.kind === "auth").length, 3);
  const searched = await request("search=user1001%40example.test");
  assert.equal(searched.data.accounts[0].hasProfile, true);
  state.users = [authUser(1), authUser(2), authUser(3)]; state.authCap = 1;
  assert.equal((await request()).data.total, 3);
});

test("Auth paging fails on repeated pages or invalid data without exposing payloads", async () => {
  await assert.rejects(readAuthAccounts(async () => ({ users: [authUser(1)] })), error => error.status === 503);
  await assert.rejects(readAuthAccounts(async () => ({ users: { access_token: "private" } })), error => error.status === 503);
});

test("invalid account IDs, pages, search lengths and visibility values never mutate moderation", async () => {
  const { state, request } = fixture();
  for (const query of ["page=0", "page=-1", "page=1.5", "userId=not-a-uuid", `search=${"x".repeat(121)}`]) assert.equal((await request(query)).status, 400);
  assert.equal((await request("action=visibility", { method: "POST", input: { userId: id(1), hidden: "true" } })).status, 400);
  assert.equal((await request("action=visibility", { method: "POST", input: { userId: id(99), hidden: true } })).status, 404);
  assert.equal(state.calls.filter(call => call.kind === "moderation-write").length, 0);
});

test("moderation follows user ID across renaming and consent updates without erasing attendance or forcing consent on unblock", async () => {
  const { state, request } = fixture();
  state.attendance = [claim(1, "a"), claim(1, "b"), claim(1, "c")];
  assert.equal((await request("action=public", { endpoint: "community" })).data.board.length, 1);
  assert.equal((await request("action=visibility", { method: "POST", input: { userId: id(1), hidden: true } })).data.publicNameBlocked, true);
  assert.equal(state.profiles[0].public_name, true);
  await request("action=me", { endpoint: "community", method: "POST", input: { name: "Yeni ad", public_name: true } });
  const me = await request("action=me", { endpoint: "community" });
  assert.equal(me.data.profile.public_name_blocked, true); assert.equal(me.data.profile.public_name, true);
  assert.equal(me.data.total, 3);
  assert.deepEqual((await request("action=public", { endpoint: "community" })).data.board, []);
  assert.equal((await request("action=me", { endpoint: "community", method: "POST", input: { name: "Bypass", public_name: true, public_name_blocked: false } })).status, 400);
  assert.equal((await request(`userId=${id(1)}`)).data.account.publicNameBlocked, true);
  await request("action=me", { endpoint: "community", method: "POST", input: { name: "Yeni ad", public_name: false } });
  await request("action=visibility", { method: "POST", input: { userId: id(1), hidden: false } });
  assert.equal(state.profiles[0].public_name, false);
  assert.deepEqual((await request("action=public", { endpoint: "community" })).data.board, []);
  assert.equal(state.attendance.length, 3);
});

test("concurrent visibility changes preserve independent users via strong CAS and public board rechecks a concurrent hide", async () => {
  const { state, request } = fixture();
  await Promise.all([1, 2].map(number => request("action=visibility", { method: "POST", input: { userId: id(number), hidden: true } })));
  const users = state.records.get(MODERATION_KEY).data.users;
  assert.equal(users[id(1)].hidden, true); assert.equal(users[id(2)].hidden, true);
  assert.ok(state.calls.filter(call => call.kind === "moderation-snapshot").every(call => call.options.consistency === "strong"));
  await request("action=visibility", { method: "POST", input: { userId: id(1), hidden: false } });
  state.attendance = [claim(1, "a"), claim(1, "b"), claim(1, "c")];
  state.readHook = async path => {
    if (path.startsWith("attendance?")) state.records.get(MODERATION_KEY).data.users[id(1)].hidden = true;
  };
  assert.deepEqual((await request("action=public", { endpoint: "community" })).data.board, []);
});

test("public board applies blocks before top-200, survives row caps, and exposes no IDs, email or private metadata", async () => {
  const { state, moderation, read } = fixture();
  state.profiles = Array.from({ length: 202 }, (_, index) => profile(index + 1));
  state.profiles[201].public_name = false;
  state.attendance = state.profiles.flatMap(profile => ["a", "b", "c"].map(event => claim(Number(profile.id.slice(-12)), event)));
  state.records.set(MODERATION_KEY, { etag: "1", data: { version: 1, users: { [id(1)]: { hidden: true, updatedAt: "2026-10-13T00:00:00Z" } } } });
  state.dbCap = 1;
  const board = await publicBadgeBoard(read, moderation);
  assert.equal(board.length, 200); assert.ok(board.every(item => Object.keys(item).join(",") === "name,total"));
  assert.ok(board.some(item => item.name === "Öğrenci 201"));
  assert.ok(!board.some(item => ["Öğrenci 1", "Öğrenci 202"].includes(item.name)));
  const result = await createCommunityHandler({ read, moderation: () => moderation })(new Request(`${origin}/api/community`));
  const data = await result.json();
  assert.ok(data.board.every(item => Object.keys(item).sort().join(",") === "badge,name,total"));
  assert.ok(!JSON.stringify(data.board).includes("10000000-"));
});

test("private account list and public board fail closed when moderation storage is unavailable or corrupted", async () => {
  const { state, request } = fixture();
  state.attendance = [claim(1, "a"), claim(1, "b"), claim(1, "c")];
  for (const corrupted of [null, { users: {} }, { version: 1, users: { [id(1)]: { hidden: "true", updatedAt: "invalid" } } }]) {
    state.records.set(MODERATION_KEY, { data: corrupted, etag: "1" });
    assert.equal((await request("action=public", { endpoint: "community" })).status, 503);
    assert.equal((await request()).status, 503);
  }
  state.records.clear(); state.failModeration = true;
  const result = await request("action=public", { endpoint: "community" });
  assert.equal(result.status, 503); assert.equal(result.data.board, undefined);
  assert.ok(!JSON.stringify(result.data).includes("credentials"));
});

test("account detail separates QR claims and verified gate entries, matching user or ticket and keeping archived titles", async () => {
  const { state, request } = fixture();
  state.attendance = [claim(1, "event-one"), claim(1, "deleted-event", { event_title: "Silinen etkinlik", ticket_id: id(10002) }),
    claim(1, "claim-only", { event_title: "Hesaba eklenen", ticket_id: id(10003) })];
  state.checkins.set("checkins/events/event-one.json", { entries: [{ ticketId: id(10001), userId: null, enteredAt: "2026-10-02T16:00:00Z", operatorId: "private", name: "Private" }] });
  state.checkins.set("checkins/events/deleted-event.json", { entries: [{ ticketId: id(10002), userId: id(1), enteredAt: "2026-10-03T16:00:00Z" }] });
  state.checkins.set("checkins/events/gate-only.json", { entries: [{ ticketId: id(10009), userId: id(1), enteredAt: "2026-10-04T16:00:00Z" },
    { ticketId: id(10010), userId: id(2), enteredAt: "2026-10-04T16:00:00Z" }] });
  const result = await request(`userId=${id(1)}`);
  assert.equal(result.status, 200); assert.equal(result.data.claimTotal, 3); assert.equal(result.data.entryTotal, 3);
  assert.equal(result.data.checkinsAvailable, true); assert.equal(result.data.attendance.length, 4);
  const archived = result.data.attendance.find(item => item.eventId === "deleted-event");
  assert.equal(archived.title, "Silinen etkinlik"); assert.equal(archived.archived, true);
  assert.equal(result.data.attendance.find(item => item.eventId === "claim-only").enteredAt, null);
  assert.equal(result.data.attendance.find(item => item.eventId === "gate-only").claimedAt, null);
  assert.ok(!JSON.stringify(result.data).includes("operatorId")); assert.ok(!JSON.stringify(result.data).includes("Private"));
});

test("gate storage outages or corrupt entries report unknown statuses instead of confirmed absences, including Auth-only accounts", async () => {
  const { state, request } = fixture();
  state.attendance = [claim(1)]; state.failCheckins = true;
  let result = await request(`userId=${id(1)}`);
  assert.equal(result.status, 200); assert.equal(result.data.claimTotal, 1); assert.equal(result.data.entryTotal, null);
  assert.equal(result.data.checkinsAvailable, false); assert.equal(result.data.attendance[0].enteredAt, null);
  state.failCheckins = false;
  state.checkins.set("checkins/events/event-one.json", { entries: [{ ticketId: id(10001), enteredAt: "bad" }] });
  result = await request(`userId=${id(1)}`);
  assert.equal(result.data.checkinsAvailable, false);
  for (const bad of [null, { malformed: true }]) {
    state.checkins.set("checkins/events/event-one.json", bad);
    assert.equal((await request(`userId=${id(1)}`)).data.checkinsAvailable, false);
  }
  state.checkins.clear();
  result = await request(`userId=${id(2)}`);
  assert.equal(result.data.account.hasProfile, false); assert.deepEqual(result.data.attendance, []);
});
