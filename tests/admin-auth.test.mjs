import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createAdminAuthHandler } from "../netlify/functions/admin-auth.mjs";
import { createAdminUsersHandler } from "../netlify/functions/admin-users.mjs";
import { adminLogin, admin, requireAdmin, requirePermission, getAdminSession, signedAdminCookie, ownerUsername } from "../netlify/lib/security.mjs";
import { ADMIN_ACCOUNTS_KEY, ADMIN_STORE, passwordRecord, normalizedPermissions } from "../netlify/lib/admin-auth.mjs";
const previous = { password: process.env.ADMIN_PASSWORD, username: process.env.ADMIN_USERNAME };
process.env.ADMIN_PASSWORD = "synthetic-owner-test-password";
delete process.env.ADMIN_USERNAME;
after(() => { for (const [key, value] of [["ADMIN_PASSWORD", previous.password], ["ADMIN_USERNAME", previous.username]]) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} });
const origin = "https://site.test";
const ownerCookie = () => adminLogin(new Request(origin, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } })).split(";")[0];
function memory() {
  const records = new Map(), calls = [], hooks = {};
  let sequence = 0;
  return { records, calls, hooks,
    async get(key) { calls.push(["get", key]); return structuredClone(records.get(key)?.data || null); },
    async getWithMetadata(key) { calls.push(["getWithMetadata", key]); const value = records.get(key); return value ? structuredClone(value) : null; },
    async setJSON(key, data, options = {}) {
      calls.push(["setJSON", key]); await hooks.beforeSet?.(key, data);
      const value = records.get(key);
      if (options.onlyIfNew && value || options.onlyIfMatch && options.onlyIfMatch !== value?.etag) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: String(++sequence) }); return { modified: true };
    } };
}
function fixture() {
  const storage = memory(), state = { now: new Date() }, getStore = name => { assert.equal(name, ADMIN_STORE); return storage; };
  const auth = createAdminAuthHandler({ getStore, now: () => state.now });
  const users = createAdminUsersHandler({ getStore, now: () => state.now });
  const request = async (endpoint, method = "GET", input, cookie = "", query = "", headers = {}) => {
    const handler = endpoint === "auth" ? auth : users;
    return handler(new Request(origin + (endpoint === "auth" ? "/api/admin-auth" : "/api/admin-users") + query,
      { method, headers: { Origin: origin, "x-nf-client-connection-ip": "192.0.2.10", Cookie: cookie,
        ...(input == null ? {} : { "Content-Type": "application/json" }), ...headers },
        ...(input == null ? {} : { body: JSON.stringify(input) }) }));
  };
  const list = async () => { const result = await request("users", "GET", undefined, ownerCookie()); assert.equal(result.status, 200); return result.json(); };
  const create = async (changes = {}) => {
    const previous = await list();
    const result = await request("users", "POST", { username: "editor-one", name: "Etkinlik editörü", password: "synthetic-editor-password",
      permissions: ["events.manage"], expectedRevision: previous.revision, ...changes }, ownerCookie());
    assert.equal(result.status, 201, await result.clone().text()); return result.json();
  };
  const login = (username = "editor-one", password = "synthetic-editor-password", headers) => request("auth", "POST", { username, password }, "", "?action=login", headers);
  return { storage, state, getStore, auth, users, request, list, create, login };
}

test("versioned owner sessions invalidate legacy signatures and reject role/version/signature tampering", async () => {
  const f = fixture(), expire = String(Date.now() + 100000);
  const legacy = "ercupsa_admin=" + expire + "." + createHmac("sha256", process.env.ADMIN_PASSWORD).update(expire).digest("base64url");
  for (const cookie of [legacy, "ercupsa_gate=staff-token", ownerCookie() + "x", "", "ercupsa_admin=9999999999999.forged"]) {
    assert.equal(admin(new Request(origin, { headers: { Cookie: cookie } })), false);
    assert.equal((await f.request("users", "GET", undefined, cookie)).status, 401);
  }
  assert.equal(f.storage.calls.length, 0);
  const cookie = ownerCookie();
  assert.equal(admin(new Request(origin, { headers: { Cookie: cookie } })), true);
  const owner = await getAdminSession(new Request(origin, { headers: { Cookie: cookie } }), { getStore: () => assert.fail("owner need not read account registry") });
  assert.equal(owner.role, "owner"); assert.equal(owner.username, "basadmin");
  const altered = cookie.split(".");
  const payload = JSON.parse(Buffer.from(altered[2], "base64url").toString()); payload.role = "treasurer";
  altered[2] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.equal(admin(new Request(origin, { headers: { Cookie: altered.join(".") } })), false);
});

test("login requires both username and password, issues HttpOnly 8-hour cookie, and keeps account credentials private", async () => {
  const f = fixture();
  assert.equal((await f.request("auth")).status, 200);
  assert.deepEqual(await (await f.request("auth")).json(), { session: null });
  assert.equal((await f.login("basadmin", "wrong-synthetic-password")).status, 401);
  assert.equal((await f.login("another-owner", process.env.ADMIN_PASSWORD)).status, 401);
  const login = await f.login("BASADMIN", process.env.ADMIN_PASSWORD);
  assert.equal(login.status, 200); assert.equal((await login.json()).session.role, "owner");
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/);
  assert.equal(cookie.includes(process.env.ADMIN_PASSWORD), false);
  f.state.now = new Date(f.state.now.getTime() + 8 * 60 * 60 * 1000 + 1);
  assert.deepEqual(await (await f.request("auth", "GET", undefined, cookie.split(";")[0])).json(), { session: null });
  process.env.ADMIN_USERNAME = "Owner.Custom";
  assert.equal(ownerUsername(), "owner.custom");
  assert.equal(admin(new Request(origin, { headers: { Cookie: cookie.split(";")[0] } })), false);
  delete process.env.ADMIN_USERNAME;
});

test("owner visits bootstrap an inactive Sayman account without any shared default password", async () => {
  const f = fixture(), first = await f.list();
  assert.equal(first.accounts.length, 1);
  assert.deepEqual(first.accounts[0].permissions, ["registrations.view", "registrations.receipts", "payments.view"]);
  assert.equal(first.accounts[0].username, "sayman"); assert.equal(first.accounts[0].role, "treasurer");
  assert.equal(first.accounts[0].active, false); assert.equal(first.accounts[0].hasPassword, false);
  assert.equal(first.accounts[0].fixedPreset, true);
  const firstWrites = f.storage.calls.filter(([method]) => method === "setJSON").length;
  assert.deepEqual(await f.list(), first);
  assert.equal(f.storage.calls.filter(([method]) => method === "setJSON").length, firstWrites);
  assert.equal((await f.login("sayman", process.env.ADMIN_PASSWORD)).status, 401);
  const noPassword = await f.request("users", "PUT", { id: "sayman", active: true, expectedRevision: first.revision }, ownerCookie());
  assert.equal(noPassword.status, 400);
  const enabled = await f.request("users", "PUT", { id: "sayman", active: true, password: "synthetic-treasurer-password", expectedRevision: first.revision }, ownerCookie());
  assert.equal(enabled.status, 200);
  const logged = await f.login("sayman", "synthetic-treasurer-password");
  assert.equal(logged.status, 200); const session = (await logged.json()).session;
  assert.equal(session.role, "treasurer"); assert.deepEqual(session.permissions, first.accounts[0].permissions);
  const cookie = logged.headers.get("set-cookie").split(";")[0], req = new Request(origin, { headers: { Cookie: cookie } });
  assert.equal(admin(req), false); assert.throws(() => requireAdmin(req), error => error.status === 403);
  await requirePermission(req, "registrations.receipts", { getStore: f.getStore });
  await requirePermission(req, "payments.view", { getStore: f.getStore });
  for (const permission of ["payments.manage", "statistics.view", "audit.view", "yearbooks.view", "registrations.manage", "registrations.photos", "registrations.export", "tickets.view", "events.manage", "events.delete"])
    await assert.rejects(requirePermission(req, permission, { getStore: f.getStore }), error => error.status === 403);
});

test("Sayman preset and owner identity cannot be escalated by CRUD payloads", async () => {
  const f = fixture(), list = await f.list();
  for (const input of [{ role: "owner" }, { fixedPreset: false }, { permissions: ["events.manage"] }, { username: "different-name" },
    { version: "chosen-version" }, { salt: "a".repeat(32) }, { passwordHash: "a".repeat(64) }, { permissions: ["registrations.delete"] }]) {
    assert.equal((await f.request("users", "PUT", { id: "sayman", expectedRevision: list.revision, ...input }, ownerCookie())).status, 400);
  }
  assert.equal((await f.request("users", "DELETE", undefined, ownerCookie(), `?id=sayman&expectedRevision=${list.revision}`)).status, 400);
  assert.equal((await f.request("users", "PUT", { id: "owner", name: "Hijacked", expectedRevision: list.revision }, ownerCookie())).status, 400);
  assert.equal((await f.request("users", "POST", { username: "basadmin", name: "Other", password: "synthetic-duplicate-password", permissions: [], expectedRevision: list.revision }, ownerCookie())).status, 400);
  assert.equal((await f.list()).revision, list.revision);
});

test("legacy Sayman registry upgrades without losing credentials and never gains payment approval", async () => {
  const f = fixture(), first = await f.list();
  const enabled = await f.request("users", "PUT", { id: "sayman", active: true, password: "synthetic-old-treasurer-password", expectedRevision: first.revision }, ownerCookie());
  assert.equal(enabled.status, 200);
  const record = f.storage.records.get(ADMIN_ACCOUNTS_KEY);
  const old = record.data.accounts[0];
  old.permissions = ["registrations.view", "registrations.receipts"];
  const credentials = { salt: old.salt, passwordHash: old.passwordHash, version: old.version };
  const oldCookie = signedAdminCookie(new Request(origin), old).split(";")[0];
  // Old persisted state stays readable until an authorized migration occurs.
  assert.equal((await getAdminSession(new Request(origin, { headers: { Cookie: oldCookie } }), { getStore: f.getStore })).role, "treasurer");
  const current = await f.list();
  assert.deepEqual(current.accounts[0].permissions, ["registrations.view", "registrations.receipts", "payments.view"]);
  assert.equal(current.accounts[0].active, true);
  const migrated = f.storage.records.get(ADMIN_ACCOUNTS_KEY).data.accounts[0];
  assert.equal(migrated.salt, credentials.salt); assert.equal(migrated.passwordHash, credentials.passwordHash);
  assert.notEqual(migrated.version, credentials.version);
  assert.equal(await getAdminSession(new Request(origin, { headers: { Cookie: oldCookie } }), { getStore: f.getStore }), null);
  const login = await f.login("sayman", "synthetic-old-treasurer-password");
  assert.equal(login.status, 200);
  const principal = await login.clone().json();
  assert.ok(principal.session.permissions.includes("payments.view"));
  assert.ok(!principal.session.permissions.includes("payments.manage"));
  const req = new Request(origin, { headers: { Cookie: login.headers.get("set-cookie").split(";")[0] } });
  await assert.rejects(requirePermission(req, "payments.manage", { getStore: f.getStore }), error => error.status === 403);
});

test("new administrator modules require an explicit permission grant", async () => {
  const f = fixture();
  await f.create(); const login = await f.login();
  const req = new Request(origin, { headers: { Cookie: login.headers.get("set-cookie").split(";")[0] } });
  for (const permission of ["payments.manage", "statistics.view", "audit.view", "yearbooks.view", "yearbooks.publish"])
    await assert.rejects(requirePermission(req, permission, { getStore: f.getStore }), error => error.status === 403);
  assert.deepEqual(normalizedPermissions(["yearbooks.publish", "payments.manage"]), ["payments.view", "payments.manage", "yearbooks.view", "yearbooks.publish"]);
});

test("delegated sessions revalidate every request; permission/password/active changes immediately revoke old sessions", async () => {
  const f = fixture(), created = await f.create();
  assert.deepEqual(created.account.permissions, ["events.view", "events.manage"]);
  const record = f.storage.records.get(ADMIN_ACCOUNTS_KEY).data.accounts.find(account => account.id === created.account.id);
  assert.notEqual(record.passwordHash, "synthetic-editor-password"); assert.equal(record.passwordHash.length, 64);
  for (const secret of [record.salt, record.passwordHash, "synthetic-editor-password"]) assert.equal(JSON.stringify(created).includes(secret), false);
  let cookie = (await f.login()).headers.get("set-cookie").split(";")[0];
  assert.equal((await getAdminSession(new Request(origin, { headers: { Cookie: cookie } }), { getStore: f.getStore })).role, "admin");
  for (const changes of [{ permissions: ["instagram.manage"] }, { password: "new-synthetic-editor-password" }, { active: false }]) {
    const list = await f.list(), update = await f.request("users", "PUT", { id: created.account.id, expectedRevision: list.revision, ...changes }, ownerCookie());
    assert.equal(update.status, 200);
    assert.deepEqual(await (await f.request("auth", "GET", undefined, cookie)).json(), { session: null });
    if (!Object.hasOwn(changes, "active")) cookie = (await f.login("editor-one", changes.password || "synthetic-editor-password")).headers.get("set-cookie").split(";")[0];
  }
  assert.equal((await f.login("editor-one", "new-synthetic-editor-password")).status, 401);
});

test("delegated and staff cookies cannot read or mutate administrator accounts; authenticated lack of permission is 403", async () => {
  const f = fixture(); await f.create();
  const cookie = (await f.login()).headers.get("set-cookie").split(";")[0], req = new Request(origin, { headers: { Cookie: cookie } });
  for (const method of ["GET", "POST", "PUT", "DELETE"]) assert.equal((await f.request("users", method, method === "GET" || method === "DELETE" ? undefined : {}, cookie)).status, 403);
  await assert.rejects(requirePermission(req, "accounts.view", { getStore: f.getStore }), error => error.status === 403);
  await assert.rejects(requirePermission(new Request(origin), "events.view", { getStore: f.getStore }), error => error.status === 401);
  const forged = signedAdminCookie(new Request(origin), { id: "unknown", username: "unknown", role: "admin", version: randomUUID() }).split(";")[0];
  assert.equal(await getAdminSession(new Request(origin, { headers: { Cookie: forged } }), { getStore: f.getStore }), null);
});

test("delegated logout revokes only the logged-out token, including replayed cookies", async () => {
  const f = fixture(); await f.create();
  const one = (await f.login()).headers.get("set-cookie").split(";")[0], two = (await f.login()).headers.get("set-cookie").split(";")[0];
  assert.notEqual(one, two);
  const loggedOut = await f.request("auth", "POST", undefined, one, "?action=logout");
  assert.equal(loggedOut.status, 200); assert.match(loggedOut.headers.get("set-cookie"), /Max-Age=0; Secure/);
  assert.deepEqual(await (await f.request("auth", "GET", undefined, one)).json(), { session: null });
  assert.equal((await (await f.request("auth", "GET", undefined, two)).json()).session.role, "admin");
  assert.equal((await f.request("auth", "POST", undefined, "", "?action=logout")).status, 200);
});

test("mutations reject stale revisions and concurrent account saves cannot overwrite each other", async () => {
  const f = fixture(), created = await f.create();
  const inputs = [{ name: "First update" }, { name: "Second update" }];
  const results = await Promise.all(inputs.map(change => f.request("users", "PUT", { id: created.account.id, expectedRevision: created.revision, ...change }, ownerCookie())));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const latest = await f.list();
  assert.equal((await f.request("users", "PUT", { id: created.account.id, name: "No revision" }, ownerCookie())).status, 409);
  assert.equal((await f.request("users", "DELETE", undefined, ownerCookie(), `?id=${created.account.id}&expectedRevision=${created.revision}`)).status, 409);
  assert.equal((await f.request("users", "DELETE", undefined, ownerCookie(), `?id=${created.account.id}&expectedRevision=${latest.revision}`)).status, 200);
  assert.equal((await f.login()).status, 401);
});

test("password lengths, normalized usernames and allowed permission masks are validated", async () => {
  const f = fixture(), initial = await f.list();
  for (const input of [{ username: "../admin" }, { username: "sayman" }, { password: "short" }, { password: "x".repeat(129) },
    { password: " ".repeat(12) }, { permissions: ["owner"] }, { permissions: ["events.delete"] }, { permissions: "events.manage" },
    { active: "true" }, { name: "" }, { role: "owner" }]) {
    const result = await f.request("users", "POST", { username: "valid-editor", name: "Editor", password: "synthetic-long-password",
      permissions: ["events.view"], expectedRevision: initial.revision, ...input }, ownerCookie());
    assert.equal(result.status, 400, JSON.stringify(input));
  }
  assert.deepEqual(normalizedPermissions(["registrations.receipts", "instagram.manage", "registrations.receipts"]),
    ["registrations.view", "registrations.receipts", "instagram.view", "instagram.manage"]);
  const first = await f.create({ username: "Mixed.Editor" });
  assert.equal(first.account.username, "mixed.editor");
  const duplicate = await f.request("users", "POST", { username: "MIXED.EDITOR", name: "Duplicate", password: "synthetic-long-password",
    permissions: [], expectedRevision: first.revision }, ownerCookie());
  assert.equal(duplicate.status, 409);
});

test("CAS rate limits hold across concurrent attempts, rotating usernames and handler instances", async () => {
  const f = fixture();
  const attempts = await Promise.all(Array.from({ length: 12 }, () => f.login("basadmin", "wrong-synthetic-password")));
  assert.equal(attempts.filter(result => result.status === 401).length, 10);
  assert.equal(attempts.filter(result => result.status === 429).length, 2);
  const anotherHandler = createAdminAuthHandler({ getStore: f.getStore, now: () => f.state.now });
  const limited = await anotherHandler(new Request(origin + "/api/admin-auth?action=login", { method: "POST", headers: {
    "Content-Type": "application/json", "x-nf-client-connection-ip": "192.0.2.10" }, body: JSON.stringify({ username: "BASADMIN", password: process.env.ADMIN_PASSWORD }) }));
  assert.equal(limited.status, 429);
  for (let index = 0; index < 37; index++) assert.equal((await f.login("unknown-" + index, "synthetic-wrong-password")).status, 401);
  assert.equal((await f.login("rotated-last", "synthetic-wrong-password")).status, 429);
  f.state.now = new Date(f.state.now.getTime() + 15 * 60 * 1000 + 1);
  assert.equal((await f.login("basadmin", process.env.ADMIN_PASSWORD)).status, 200);
});

test("foreign-origin mutations fail before storage and private state failures do not leak details", async () => {
  const f = fixture();
  for (const [endpoint, action] of [["auth", "?action=login"], ["auth", "?action=logout"], ["users", ""]]) {
    assert.equal((await f.request(endpoint, "POST", { username: "basadmin", password: process.env.ADMIN_PASSWORD }, ownerCookie(), action,
      { Origin: "https://foreign.test" })).status, 403);
  }
  assert.equal(f.storage.calls.length, 0);
  f.storage.records.set(ADMIN_ACCOUNTS_KEY, { etag: "bad-state", data: { revision: "valid", accounts: [{ role: "owner", passwordHash: "private-secret" }] } });
  const broken = await f.request("users", "GET", undefined, ownerCookie());
  assert.equal(broken.status, 503); assert.equal((await broken.text()).includes("private-secret"), false);
  assert.throws(() => passwordRecord("short"), error => error.status === 400);
});

test("new payment grants require explicit registration viewing without implicitly expanding participant access", async () => {
  const f = fixture();
  const first = await f.list(), initialRecord = structuredClone(f.storage.records.get(ADMIN_ACCOUNTS_KEY));
  for (const permissions of [["payments.view"], ["payments.manage"], ["registrations.receipts", "payments.view"]]) {
    const result = await f.request("users", "POST", { username: "payment-editor", name: "Ödeme sorumlusu", password: "synthetic-payment-password",
      permissions, expectedRevision: first.revision }, ownerCookie());
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /registrations.view/);
    assert.deepEqual(f.storage.records.get(ADMIN_ACCOUNTS_KEY), initialRecord);
  }
  const created = await f.create({ permissions: ["registrations.view", "payments.manage"] });
  assert.deepEqual(created.account.permissions, ["registrations.view", "payments.view", "payments.manage"]);
  const beforeUpdate = structuredClone(f.storage.records.get(ADMIN_ACCOUNTS_KEY));
  const rejected = await f.request("users", "PUT", { id: created.account.id, permissions: ["payments.view"], expectedRevision: created.revision }, ownerCookie());
  assert.equal(rejected.status, 400);
  assert.deepEqual(f.storage.records.get(ADMIN_ACCOUNTS_KEY), beforeUpdate);
  const accepted = await f.request("users", "PUT", { id: created.account.id, permissions: ["registrations.view", "payments.view"], expectedRevision: created.revision }, ownerCookie());
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json()).account.permissions, ["registrations.view", "payments.view"]);
});

test("a legacy payment-only account remains readable and accepts unrelated account changes", async () => {
  const f = fixture(), created = await f.create({ permissions: ["registrations.view", "payments.view"] });
  const persisted = f.storage.records.get(ADMIN_ACCOUNTS_KEY).data.accounts.find(account => account.id === created.account.id);
  persisted.permissions = ["payments.view"];
  const current = await f.list();
  const existing = current.accounts.find(account => account.id === created.account.id);
  assert.deepEqual(existing.permissions, ["payments.view"]);
  const changed = await f.request("users", "PUT", { id: created.account.id, name: "Eski hesabın yeni adı", expectedRevision: current.revision }, ownerCookie());
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).account.permissions, ["payments.view"]);
});
