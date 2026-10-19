import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTeamHandler } from "../netlify/functions/team.mjs";
import { DEFAULT_TEAM, TEAM_KEY, TEAM_STORE, teamPhotoFormat } from "../netlify/lib/team.mjs";
import { ADMIN_PERMISSIONS, adminLogin, signedAdminCookie } from "../netlify/lib/security.mjs";
import { ADMIN_STORE, ADMIN_ACCOUNTS_KEY, initialAccounts, passwordRecord } from "../netlify/lib/admin-auth.mjs";

const previous = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "team-unit-test-only-password";
after(() => { if (previous === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous; });
const origin = "https://site.test";
const owner = adminLogin(new Request(origin, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } })).split(";")[0];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=", "base64");
function fixture() {
  const data = new Map(), versions = new Map(); let storageCalls = 0, writes = 0;
  const store = {
    async get(key) { return structuredClone(data.get(key) ?? null); },
    async getWithMetadata(key) { return data.has(key) ? { data: structuredClone(data.get(key)), etag: String(versions.get(key)) } : null; },
    async setJSON(key, value, options = {}) {
      if ((options.onlyIfNew && data.has(key)) || (options.onlyIfMatch && options.onlyIfMatch !== String(versions.get(key)))) return { modified: false };
      data.set(key, structuredClone(value)); versions.set(key, (versions.get(key) || 0) + 1); writes++; return { modified: true };
    },
  };
  const registry = initialAccounts(), delegate = { id: "delegate", username: "delegate", name: "Delegate", active: true, role: "admin", version: "v1", permissions: [...ADMIN_PERMISSIONS], ...passwordRecord("team-delegate-test-password") };
  registry.accounts.push(delegate);
  const delegateCookie = signedAdminCookie(new Request(origin), delegate).split(";")[0];
  const handler = createTeamHandler({
    getStore(name) { storageCalls++; assert.equal(name, TEAM_STORE); return store; },
    adminStore(name) { assert.equal(name, ADMIN_STORE); return { async get(key) { return key === ADMIN_ACCOUNTS_KEY ? registry : null; } }; },
    now: () => new Date("2026-10-19T12:00:00.000Z"), revision: () => `revision-${writes + 1}`,
  });
  const request = (method = "GET", input, action = "", headers = {}) => handler(new Request(`${origin}/api/team${action ? "?" + action : ""}`, {
    method, headers: { cookie: owner, origin, "Content-Type": "application/json", ...headers },
    ...(input === undefined ? {} : { body: Buffer.isBuffer(input) || typeof input === "string" ? input : JSON.stringify(input) }),
  }));
  return { request, data, versions, delegateCookie, storageCalls: () => storageCalls, writes: () => writes };
}
const member = () => ({ ...DEFAULT_TEAM[0], name: "Yeni danışman", role: "Danışman" });

test("public defaults preserve every current card and Belinay follows Dileknaz without storage writes", async () => {
  const f = fixture(), result = await (await f.request()).json();
  assert.deepEqual(result, { members: DEFAULT_TEAM }); assert.equal(result.members.length, 22);
  assert.equal(result.members[0].name, "Arş. Gör. Dr. Kübra Uzun");
  const dileknaz = result.members.findIndex(value => value.name === "Dileknaz Ergül");
  assert.equal(result.members[dileknaz + 1].name, "Belinay Daş");
  assert.equal(f.writes(), 0); assert.ok(!("revision" in result));
});

test("owner saves ordered safe fields, including an explicitly empty roster", async () => {
  const f = fixture(), members = [member(), { ...DEFAULT_TEAM[15], privateNotes: "do not expose" }];
  const response = await f.request("PUT", { members, revision: "" }); assert.equal(response.status, 200);
  const saved = (await response.json()).team;
  assert.equal(saved.members[1].name, "Belinay Daş"); assert.ok(!("privateNotes" in saved.members[1]));
  assert.deepEqual((await (await f.request()).json()).members, saved.members);
  f.data.get(TEAM_KEY).privateSecret = "never public";
  assert.ok(!("privateSecret" in (await (await f.request("GET", undefined, "action=admin")).json()).team));
  assert.equal((await f.request("PUT", { members: [], revision: saved.revision })).status, 200);
  assert.deepEqual(await (await f.request()).json(), { members: [] });
});

test("concurrent owner changes and stale saves preserve the first successful roster", async () => {
  const f = fixture(), results = await Promise.all([
    f.request("PUT", { members: [member()], revision: "" }),
    f.request("PUT", { members: [DEFAULT_TEAM[1]], revision: "" }),
  ]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 409]); assert.equal(f.writes(), 1);
  assert.equal((await f.request("PUT", { members: [], revision: "" })).status, 409); assert.equal(f.writes(), 1);
});

test("all delegated permissions cannot read private team state, upload or modify cards; denied actions do not access business storage", async () => {
  const f = fixture();
  for (const [method, input, action] of [["GET", undefined, "action=admin"], ["PUT", { members: [], revision: "" }, ""], ["POST", png, "action=photo"]]) {
    assert.equal((await f.request(method, input, action, { cookie: f.delegateCookie })).status, 403);
    assert.equal((await f.request(method, input, action, { cookie: "" })).status, 401);
  }
  assert.equal(f.storageCalls(), 0); assert.equal(f.writes(), 0);
});

test("photos use verified bytes, immutable content identifiers and only become publicly available after saving a reference", async () => {
  const f = fixture();
  const uploaded = await f.request("POST", png, "action=photo", { "Content-Type": "image/jpeg" }); // Android MIME hints may be wrong.
  assert.equal(uploaded.status, 200); const photo = await uploaded.json(); assert.equal(photo.mime, "image/png");
  assert.match(photo.photo, /^\/api\/team\?action=photo&id=[a-f0-9]{64}$/);
  const action = photo.photo.split("?")[1];
  assert.equal((await f.request("GET", undefined, action)).status, 404);
  const saved = await f.request("PUT", { members: [{ ...member(), photo: photo.photo }], revision: "" }); assert.equal(saved.status, 200);
  const publicPhoto = await f.request("GET", undefined, action, { cookie: "" }); assert.equal(publicPhoto.status, 200);
  assert.equal(publicPhoto.headers.get("content-type"), "image/png"); assert.equal(publicPhoto.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await publicPhoto.arrayBuffer()), png);
  const again = await (await f.request("POST", png, "action=photo")).json(); assert.equal(again.photo, photo.photo);
  const corrupt = f.data.get("photos/" + photo.photo.split("id=")[1] + ".json"); corrupt.data = Buffer.from("unsafe").toString("base64");
  assert.notEqual((await f.request("GET", undefined, action)).status, 200);
});

test("invalid fields, arbitrary image URLs and missing photo references cannot be published", async () => {
  const f = fixture();
  for (const value of [
    [{ ...member(), name: "" }], [{ ...member(), role: "x".repeat(121) }], [{ ...member(), id: "a\" onclick=\"bad" }],
    [{ ...member(), photo: "https://example.test/image.jpg" }], [{ ...member(), photo: "data:image/png;base64,xxx" }],
    [{ ...member(), photo: "/api/team?action=photo&id=" + "a".repeat(64) }], [member(), member()], [{ ...member(), featured: "yes" }],
  ]) assert.equal((await f.request("PUT", { members: value, revision: "" })).status, 400);
  assert.equal(f.writes(), 0);
});

test("photo uploads reject oversized, non-image, incomplete and over-dimension containers before writing", async () => {
  const f = fixture(), oversizedDimensions = Buffer.from(png); oversizedDimensions.writeUInt32BE(801, 16);
  for (const [bytes, status] of [[Buffer.alloc(180 * 1024 + 1), 413], [Buffer.from("<svg onload=bad>"), 415], [png.subarray(0, 30), 415], [oversizedDimensions, 400], [Buffer.concat([png, Buffer.from("garbage")]), 415]])
    assert.equal((await f.request("POST", bytes, "action=photo")).status, status);
  assert.equal(f.writes(), 0);
  const webp = readFileSync(new URL("../assets/team/belinay-das.webp", import.meta.url));
  assert.deepEqual(teamPhotoFormat(webp), { mime: "image/webp", width: 480, height: 640 });
});

test("same-origin checks and corrupt canonical data fail closed", async () => {
  const f = fixture();
  assert.equal((await f.request("PUT", { members: [], revision: "" }, "", { origin: "https://attacker.test" })).status, 403);
  assert.equal((await f.request("PUT", "not-json")).status, 400);
  assert.equal((await f.request("PUT", { members: [], revision: "" }, "", { "Content-Type": "text/plain" })).status, 415);
  f.data.set(TEAM_KEY, { members: [], revision: "broken" }); f.versions.set(TEAM_KEY, 1);
  assert.equal((await f.request()).status, 503);
  assert.equal((await f.request("PUT", { members: [], revision: "broken" })).status, 503);
  assert.equal(f.writes(), 0);
});
