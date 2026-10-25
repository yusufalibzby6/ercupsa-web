import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createPublicTicketHandler } from "../netlify/functions/public-ticket.mjs";

const origin = "https://site.test";
const code = "ERC-1234567890ABCDEF12345678";
const anotherCode = "ERC-AAAAAAAAAAAAAAAAAAAAAAAA";
const hash = value => createHash("sha256").update(value).digest("hex");
// A real 1116 × 588 raster JPEG, also used by the upload validation tests.
const jpeg = gunzipSync(Buffer.from(
  "H4sIAPBxwWoC/+3XzQ7BQBDA8Rml29VtWCpBttRHgqQRqgkS4iBpQjyCh/FmHDyEj4s3WeVWXNznN7f/YWavqy/6AcVtvIkBEQCTAX2HNVimycycxRjj3MoL1xG2LWqlcsH16s2GV1fK7w57fjvoKNWfDoLROIqiZm++nIWL4SQKX0uQcy5sUXWcathSrfBv+gTSyuyyewPbkJFoSNRnqLyfmsKS7BY/K7wq/qzyu95AGJhcMSSs4HgAQgghhBBCCCGEpP/O1yfr59ehSBAAAA==",
  "base64",
));

function fixture() {
  const state = {
    reads: [], storeReads: [], eventReads: 0, failDatabase: false, failEvents: false, failDesign: false,
    tickets: [{ id: "ticket-one", batch_id: "batch-one", event_id: "event-one", code_hash: hash(code),
      revoked: false, claimed_by: "private-account", claimed_at: "2026-10-01T09:00:00.000Z",
      name: "Private person", email: "private@example.test", phone: "private-phone" }],
    batches: [{ id: "batch-one", event_id: "event-one", event_title: "Original event name",
      codes: [code, anotherCode], operator: "private-operator" }],
    events: [{ id: "event-one", title: "Current event name", date: "2026-11-22", time: "15:30",
      location: "Fakülte Salonu", published: false, description: "Private draft description",
      registrationUrl: "https://private-form.test", lastOperation: { actor: "private-owner" } }],
    design: null, registration: null, registrationReads: 0,
  };
  const handler = createPublicTicketHandler({
    registrationStore: {
      async get() { state.registrationReads++; return structuredClone(state.registration); },
      async list() { return { blobs: [] }; },
    },
    async read(path, options) {
      state.reads.push({ path, options });
      if (state.failDatabase) throw Error("Private database address and credential");
      const url = new URL(path, "https://database.test/");
      let rows;
      if (url.pathname === "/tickets") {
        assert.equal(url.searchParams.get("code_hash"), `eq.${hash(code)}`);
        assert.equal(url.searchParams.get("select"), "id,batch_id,event_id,code_hash,revoked");
        rows = state.tickets;
      } else if (url.pathname === "/ticket_batches") {
        assert.equal(url.searchParams.get("id"), "eq.batch-one");
        assert.equal(url.searchParams.get("select"), "id,event_id,event_title,codes");
        rows = state.batches;
      } else throw Error("Unexpected database request");
      assert.equal(url.searchParams.get("limit"), "2");
      assert.equal(options, undefined, "guest access cannot perform database mutations");
      return structuredClone(rows);
    },
    async readEvents() {
      state.eventReads++;
      if (state.failEvents) throw Error("Private event storage credentials");
      return structuredClone(state.events);
    },
    getStore(name) {
      assert.equal(name, "ercupsa-ticket-designs");
      return {
        async get(key, options) {
          state.storeReads.push({ key, options });
          if (state.failDesign) throw Error("Private design storage token");
          return structuredClone(state.design);
        },
      };
    },
  });
  const request = async ({ method = "POST", input = { code }, rawBody, headers = {}, query = "" } = {}) => {
    const result = await handler(new Request(`${origin}/api/public-ticket${query}`, {
      method, headers: { Origin: origin, "Content-Type": "application/json", ...headers },
      ...(method !== "GET" && method !== "HEAD" ? {
        body: rawBody !== undefined ? rawBody : JSON.stringify(input),
      } : {}),
    }));
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    assert.equal(result.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(result.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
    assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(result.headers.get("Set-Cookie"), null);
    return { status: result.status, data: await result.json() };
  };
  return { state, request };
}

test("a previously issued batch ticket opens without any login or account claim", async () => {
  const { state, request } = fixture();
  const before = structuredClone(state.tickets);
  const { status, data } = await request();
  assert.equal(status, 200);
  assert.deepEqual(data, {
    ticket: { code, eventId: "event-one", eventTitle: "Current event name" },
    event: { id: "event-one", title: "Current event name", date: "2026-11-22", time: "15:30", location: "Fakülte Salonu" },
    design: null,
  });
  assert.equal(state.reads.length, 2);
  assert.equal(state.eventReads, 1);
  assert.deepEqual(state.storeReads, [{ key: "event-one", options: { type: "json", consistency: "strong" } }]);
  assert.deepEqual(state.tickets, before);
  for (const privateValue of [anotherCode, "private-", "Private", "claimed", "revoked", "batch-one"])
    assert.ok(!JSON.stringify(data).includes(privateValue), privateValue);
});

test("unclaimed registration tickets open using the same QR on every access", async () => {
  const { state, request } = fixture();
  state.tickets[0].claimed_at = null;
  state.tickets[0].claimed_by = null;
  assert.deepEqual(await request(), await request());
  assert.equal(state.tickets[0].claimed_at, null);
  assert.equal(state.tickets[0].claimed_by, null);
  assert.ok(state.reads.every(call => call.options === undefined));
});

test("code normalization matches the existing account and gate code acceptance", async () => {
  const { request } = fixture();
  const result = await request({ input: { code: `  ${code.toLowerCase().replace("1234", "12 34")}  ` } });
  assert.equal(result.status, 200);
  assert.equal(result.data.ticket.code, code);
});

test("missing and malformed codes have the same unavailable response without storage reads", async () => {
  const { state, request } = fixture();
  for (const value of [undefined, null, 123, {}, "", "ERC-A", "ERC-" + "A".repeat(16),
    "ERC-" + "A".repeat(32), "ERC-" + "G".repeat(24), code + "&select=*", "x".repeat(41),
    `https://site.test/biletler.html?ticket=${code}`]) {
    const result = await request({ input: { code: value } });
    assert.equal(result.status, 404);
    assert.deepEqual(result.data, { error: "Bilet bulunamadı. Bağlantıyı kontrol edin." });
  }
  assert.deepEqual(state.reads, []);
  assert.equal(state.eventReads, 0);
  assert.deepEqual(state.storeReads, []);
});

test("a nonexistent code cannot disclose event metadata, artwork or the batch catalogue", async () => {
  const { state, request } = fixture();
  state.tickets = [];
  const result = await request();
  assert.equal(result.status, 404);
  assert.deepEqual(result.data, { error: "Bilet bulunamadı. Bağlantıyı kontrol edin." });
  assert.equal(state.reads.length, 1);
  assert.equal(state.eventReads, 0);
  assert.deepEqual(state.storeReads, []);
});

test("revocation immediately prevents guest viewing before batch, event or artwork access", async () => {
  const { state, request } = fixture();
  state.tickets[0].revoked = true;
  const result = await request();
  assert.equal(result.status, 410);
  assert.ok(!JSON.stringify(result.data).includes(code));
  assert.equal(state.reads.length, 1);
  assert.equal(state.eventReads, 0);
  assert.deepEqual(state.storeReads, []);
});

test("canonical cancellation and waitlist states block guest tickets while SQL revocation is still pending", async () => {
  for (const registrationStatus of ["cancelled", "waitlisted"]) {
    const { state, request } = fixture();
    state.registration = { version: 1, eventId: "event-one", deleted: [], entries: [{ id: "entry-one",
      eventId: "event-one", name: "Private registrant", createdAt: "2026-10-01T09:00:00Z", registrationStatus,
      ticket: { batchId: "batch-one", code, status: "issued" } }] };
    assert.equal(state.tickets[0].revoked, false);
    const result = await request();
    assert.equal(result.status, 410);
    assert.equal(state.eventReads, 0);
    assert.deepEqual(state.storeReads, []);
    assert.ok(!JSON.stringify(result.data).includes("Private registrant"));
  }
});

test("a deleted reservation blocks the exact ticket only, preserving unrelated manual batches", async () => {
  const { state, request } = fixture();
  state.registration = { version: 1, eventId: "event-one", entries: [], deleted: [{ id: "entry-one",
    ticket: { batchId: "batch-one", code, status: "issued" } }] };
  assert.equal((await request()).status, 410);
  state.registration.deleted[0].ticket.batchId = "unrelated-batch";
  assert.equal((await request()).status, 200);
  state.registration.deleted[0].ticket.batchId = "batch-one";
  state.registration.deleted[0].ticket.code = anotherCode;
  assert.equal((await request()).status, 200);
});

test("the hash record must match one canonical persisted ticket before any other data is read", async () => {
  for (const mutate of [
    state => { state.tickets[0].event_id = "bad/event"; },
    state => { state.tickets[0].batch_id = "batch-one&select=*"; },
    state => { state.tickets[0].id = null; },
    state => { state.tickets[0].code_hash = hash(anotherCode); },
    state => { state.tickets[0].revoked = "false"; },
    state => { state.tickets.push(structuredClone(state.tickets[0])); },
    state => { state.tickets = null; },
  ]) {
    const { state, request } = fixture();
    mutate(state);
    assert.equal((await request()).status, 503);
    assert.equal(state.reads.length, 1);
    assert.equal(state.eventReads, 0);
    assert.deepEqual(state.storeReads, []);
  }
});

test("a detached, mismatched or absent batch cannot be used to retrieve artwork", async () => {
  for (const mutate of [
    state => { state.batches = []; },
    state => { state.batches[0].id = "different-batch"; },
    state => { state.batches[0].event_id = "different-event"; },
    state => { state.batches[0].codes = [anotherCode]; },
    state => { state.batches[0].codes = code; },
    state => { state.batches.push(structuredClone(state.batches[0])); },
  ]) {
    const { state, request } = fixture();
    mutate(state);
    assert.equal((await request()).status, 404);
    assert.equal(state.reads.length, 2);
    assert.equal(state.eventReads, 0);
    assert.deepEqual(state.storeReads, []);
  }
});

test("removed events retain their issued ticket using safe batch metadata", async () => {
  const { state, request } = fixture();
  state.events = [];
  const { status, data } = await request();
  assert.equal(status, 200);
  assert.deepEqual(data.event, { id: "event-one", title: "Original event name", date: "", time: "", location: "" });
  assert.equal(data.ticket.eventTitle, "Original event name");
  state.batches[0].event_title = null;
  assert.equal((await request()).data.event.title, "ERCUPSA etkinliği");
});

test("valid custom artwork is projected without additional stored private properties", async () => {
  const { state, request } = fixture();
  state.design = { mime: "image/jpeg", width: 1116, height: 588,
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`, updatedAt: "2026-10-01T00:00:00.000Z",
    password: "private-password", uploadedBy: { email: "private@example.test" } };
  const { status, data } = await request();
  assert.equal(status, 200);
  const { password, uploadedBy, ...expected } = state.design;
  assert.deepEqual(data.design, expected);
});

test("corrupt, executable or remote stored artwork fails without returning its contents", async () => {
  const base = { mime: "image/jpeg", width: 1116, height: 588, dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
  for (const design of ["invalid", [], { ...base, width: 100 },
    { ...base, mime: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
    { ...base, dataUrl: "https://private.test/design.jpg" },
    { ...base, dataUrl: "data:image/jpeg;base64,YmFkLWltYWdl" },
    { ...base, dataUrl: "data:image/png;base64,YmFkLWltYWdl" }]) {
    const { state, request } = fixture();
    state.design = design;
    const result = await request();
    assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(result.data).includes("base64"));
    assert.ok(!JSON.stringify(result.data).includes("private.test"));
  }
});

test("invalid request methods, origins and JSON schemas fail before any ticket lookup", async () => {
  const { state, request } = fixture();
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    assert.equal((await request({ method, query: `?code=${code}` })).status, 405);
  }
  assert.equal((await request({ headers: { Origin: "https://other.test" } })).status, 403);
  assert.equal((await request({ headers: { "Content-Type": "text/plain" } })).status, 415);
  for (const rawBody of ["{", "[]", "null", "\"value\""]) {
    assert.equal((await request({ rawBody })).status, 400);
  }
  for (const input of [{ code, eventId: "event-two" }, { code, action: "claim" }, { code, userId: "private-account" }]) {
    assert.equal((await request({ input })).status, 400);
  }
  assert.equal((await request({ rawBody: "x".repeat(100001) })).status, 413);
  assert.deepEqual(state.reads, []);
  assert.equal(state.eventReads, 0);
  assert.deepEqual(state.storeReads, []);
});

test("dependency failures never expose private database or storage details", async () => {
  for (const flag of ["failDatabase", "failEvents", "failDesign"]) {
    const { state, request } = fixture();
    state[flag] = true;
    const result = await request();
    assert.equal(result.status, 503);
    assert.deepEqual(result.data, { error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." });
  }
});
