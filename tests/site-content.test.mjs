import { after, test } from "node:test";
import assert from "node:assert/strict";
import { adminLogin } from "../netlify/lib/security.mjs";
import { createSiteContentHandler } from "../netlify/functions/site-content.mjs";
import { DEFAULT_INSTAGRAM_POSTS, instagramPostUrl } from "../netlify/lib/site-content.mjs";

const previous = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "instagram-unit-test-only";
after(() => { if (previous === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous; });
const origin = "https://site.test";
const cookie = adminLogin(new Request(`${origin}/api/events`, { headers: { "x-admin-password": process.env.ADMIN_PASSWORD } })).split(";")[0];
function fixture() {
  const state = { value: null, etag: 0, writes: 0, reads: [] };
  const store = {
    async get(key, options) { assert.equal(key, "instagram"); state.reads.push(options); return structuredClone(state.value); },
    async getWithMetadata(key, options) {
      assert.equal(key, "instagram"); state.reads.push(options);
      return state.value == null ? null : { data: structuredClone(state.value), etag: String(state.etag) };
    },
    async setJSON(key, value, options) {
      assert.equal(key, "instagram");
      if ((options.onlyIfNew && state.value != null) || (options.onlyIfMatch && options.onlyIfMatch !== String(state.etag))) return { modified: false };
      state.value = structuredClone(value); state.etag++; state.writes++; return { modified: true };
    },
  };
  const handler = createSiteContentHandler({
    getStore(name) { assert.equal(name, "ercupsa-site-content"); return store; },
    now: () => new Date("2026-10-12T12:00:00.000Z"), revision: () => `revision-${state.etag + 1}`,
  });
  const request = (method = "GET", input, headers = {}) => handler(new Request(`${origin}/api/site-content`, {
    method, headers: { ...(method === "GET" ? {} : { "content-type": "application/json", cookie, origin }), ...headers },
    ...(input === undefined ? {} : { body: typeof input === "string" ? input : JSON.stringify(input) }),
  }));
  return { state, request };
}

test("public Instagram defaults preserve the current four posts without writing storage", async () => {
  const f = fixture(), response = await f.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { instagram: { posts: [...DEFAULT_INSTAGRAM_POSTS], revision: "", updatedAt: null } });
  assert.equal(f.state.writes, 0);
  assert.ok(f.state.reads.every(options => options.consistency === "strong"));
});

test("admin saves four ordered links, strips share tracking and public reads persist only safe fields", async () => {
  const f = fixture();
  const posts = ["https://instagram.com/reel/Reel_ONE/?igsh=tracking#fragment", "https://www.instagram.com/p/Post_TWO", DEFAULT_INSTAGRAM_POSTS[2], DEFAULT_INSTAGRAM_POSTS[3]];
  const response = await f.request("POST", { posts, revision: "" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.deepEqual(result.instagram.posts, ["https://www.instagram.com/reel/Reel_ONE/", "https://www.instagram.com/p/Post_TWO/", ...DEFAULT_INSTAGRAM_POSTS.slice(2)]);
  assert.equal(result.instagram.revision, "revision-1");
  assert.equal(f.state.writes, 1);
  f.state.value.privateNotes = "must not be public";
  assert.deepEqual(await (await f.request()).json(), { instagram: result.instagram });
  const second = await f.request("POST", { posts: [...DEFAULT_INSTAGRAM_POSTS].reverse(), revision: result.instagram.revision });
  assert.equal(second.status, 200);
  assert.deepEqual((await (await f.request()).json()).instagram.posts, [...DEFAULT_INSTAGRAM_POSTS].reverse());
});

test("stale and concurrent admin updates cannot silently replace another saved selection", async () => {
  const f = fixture();
  const results = await Promise.all([
    f.request("POST", { posts: [...DEFAULT_INSTAGRAM_POSTS], revision: "" }),
    f.request("POST", { posts: [...DEFAULT_INSTAGRAM_POSTS].reverse(), revision: "" }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(f.state.writes, 1);
  const stale = await f.request("POST", { posts: [...DEFAULT_INSTAGRAM_POSTS].reverse(), revision: "" });
  assert.equal(stale.status, 409); assert.equal(f.state.writes, 1);
});

test("only signed admin same-origin JSON writes are accepted and rejected requests never store data", async () => {
  const f = fixture(), input = { posts: [...DEFAULT_INSTAGRAM_POSTS], revision: "" };
  assert.equal((await f.request("POST", input, { cookie: "" })).status, 401);
  assert.equal((await f.request("POST", input, { origin: "https://attacker.test" })).status, 403);
  assert.equal((await f.request("POST", input, { "content-type": "text/plain" })).status, 415);
  assert.equal((await f.request("POST", "not-json")).status, 400);
  assert.equal((await f.request("POST", " ".repeat(100001))).status, 413);
  assert.equal((await f.request("DELETE")).status, 405);
  assert.equal(f.state.writes, 0);
});

test("invalid Instagram URLs, wrong slot counts and absent revisions are rejected", async () => {
  const f = fixture();
  const invalid = ["javascript:alert(1)", "http://instagram.com/p/abc/", "https://instagram.com.attacker.test/p/abc/",
    "https://user:password@instagram.com/p/abc/", "https://www.instagram.com:444/p/abc/",
    "https://instagram.com/ercupsa/", "https://instagram.com/stories/ercupsa/123/", "https://instagram.com/p/abc/extra/",
    "https://instagram.com/p/%3Cscript%3E/", "https://instagram.com/p/", "https://example.test/p/abc/", 12];
  for (const value of invalid) {
    const posts = [...DEFAULT_INSTAGRAM_POSTS]; posts[0] = value;
    assert.equal((await f.request("POST", { posts, revision: "" })).status, 400, String(value));
  }
  for (const posts of [[], DEFAULT_INSTAGRAM_POSTS.slice(0, 3), [...DEFAULT_INSTAGRAM_POSTS, DEFAULT_INSTAGRAM_POSTS[0]], "bad"])
    assert.equal((await f.request("POST", { posts, revision: "" })).status, 400);
  assert.equal((await f.request("POST", { posts: [...DEFAULT_INSTAGRAM_POSTS] })).status, 400);
  assert.equal(f.state.writes, 0);
  assert.equal(instagramPostUrl("https://INSTAGRAM.com/p/ABC_12-/?utm=test"), "https://www.instagram.com/p/ABC_12-/");
});

test("corrupt stored links fail closed without leaking arbitrary URLs or being overwritten", async () => {
  const f = fixture(); f.state.value = { posts: ["javascript:alert(1)", ...DEFAULT_INSTAGRAM_POSTS.slice(1)], revision: "revision-1", updatedAt: "2026-10-12T12:00:00.000Z" };
  const response = await f.request(); assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(await response.json()).includes("javascript:"));
  assert.equal((await f.request("POST", { posts: [...DEFAULT_INSTAGRAM_POSTS], revision: "revision-1" })).status, 503);
  assert.equal(f.state.writes, 0);
});
