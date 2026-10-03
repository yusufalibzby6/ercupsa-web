import { test, after } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, gunzipSync } from "node:zlib";
import { createTicketDesignHandler } from "../netlify/functions/ticket-design.mjs";
import { adminLogin } from "../netlify/lib/security.mjs";
import { TICKET_DESIGN_MAX_BYTES } from "../netlify/lib/ticket-design.mjs";

const previousPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "ticket-design-unit-test-only";
after(() => {
  if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = previousPassword;
});
const origin = "https://site.test";
const cookie = adminLogin(new Request(origin + "/api/events", {
  headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
})).split(";")[0];

// These bytes are a real 1116 x 588 JPEG, generated once from a plain white image.
const jpeg = gunzipSync(Buffer.from(
  "H4sIAPBxwWoC/+3XzQ7BQBDA8Rml29VtWCpBttRHgqQRqgkS4iBpQjyCh/FmHDyEj4s3WeVWXNznN7f/YWavqy/6AcVtvIkBEQCTAX2HNVimycycxRjj3MoL1xG2LWqlcsH16s2GV1fK7w57fjvoKNWfDoLROIqiZm++nIWL4SQKX0uQcy5sUXWcathSrfBv+gTSyuyyewPbkJFoSNRnqLyfmsKS7BY/K7wq/qzyu95AGJhcMSSs4HgAQgghhBBCCCGEpP/O1yfr59ehSBAAAA==",
  "base64",
));

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  let checksum = 0xffffffff;
  for (const byte of chunk.subarray(4, -4))
    checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
function png(width = 1116, height = 588) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  // A PNG scanline starts with filter 0 and contains one RGBA tuple per pixel.
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const artwork = png();

function fixture() {
  const records = new Map();
  const calls = [];
  const events = [{ id: "event-one" }, { id: "event-two", published: false }];
  const store = {
    async get(key, options) {
      calls.push({ action: "get", key, options });
      return structuredClone(records.get(key) || null);
    },
    async setJSON(key, value) {
      calls.push({ action: "set", key });
      records.set(key, structuredClone(value));
    },
    async delete(key) {
      calls.push({ action: "delete", key });
      records.delete(key);
    },
  };
  const handler = createTicketDesignHandler({
    getStore(name) {
      assert.equal(name, "ercupsa-ticket-designs");
      return store;
    },
    readEvents: async () => structuredClone(events),
    now: () => new Date("2026-10-04T09:00:00.000Z"),
  });
  async function request(method = "GET", {
    eventId = "event-one",
    bytes,
    mime = "image/png",
    auth = true,
    headers = {},
  } = {}) {
    const response = await handler(new Request(
      `${origin}/api/ticket-design?event_id=${encodeURIComponent(eventId)}`,
      {
        method,
        headers: {
          Origin: origin,
          "Content-Type": mime,
          ...(auth ? { cookie } : {}),
          ...headers,
        },
        body: bytes,
        ...(bytes instanceof ReadableStream ? { duplex: "half" } : {}),
      },
    ));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    return { status: response.status, data: await response.json() };
  }
  return { handler, request, records, calls, events };
}

test("all design operations require the signed administrator cookie", async () => {
  const { request, calls } = fixture();
  for (const method of ["GET", "POST", "DELETE"]) {
    const result = await request(method, {
      auth: false,
      ...(method === "POST" ? { bytes: artwork } : {}),
      headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
    });
    assert.equal(result.status, 401);
  }
  assert.equal((await request("GET", { headers: { cookie: cookie + "tampered" } })).status, 401);
  assert.deepEqual(calls, []);
});

test("foreign-origin design mutations are rejected before reading or writing storage", async () => {
  const { request, calls } = fixture();
  for (const method of ["POST", "DELETE"]) {
    const result = await request(method, {
      ...(method === "POST" ? { bytes: artwork } : {}),
      headers: { Origin: "https://attacker.test" },
    });
    assert.equal(result.status, 403);
  }
  assert.deepEqual(calls, []);
});

test("design endpoints validate the event identity, upload event existence and allowed method", async () => {
  const { request, calls } = fixture();
  for (const eventId of ["", "../event-one", "x/y"])
    assert.equal((await request("GET", { eventId })).status, 400);
  assert.equal((await request("POST", { eventId: "missing", bytes: artwork })).status, 404);
  assert.equal((await request("PUT", { bytes: artwork })).status, 405);
  assert.deepEqual(calls, []);
});

test("saved designs remain readable and resettable after the event is deleted", async () => {
  const { request, records, events } = fixture();
  const saved = await request("POST", { bytes: artwork });
  assert.equal(saved.status, 200);
  events.splice(events.findIndex((event) => event.id === "event-one"), 1);
  const archived = await request();
  assert.equal(archived.status, 200);
  assert.deepEqual(archived.data.design, saved.data.design);
  assert.equal((await request("POST", { bytes: artwork })).status, 404);
  assert.deepEqual((await request()).data.design, saved.data.design);
  assert.deepEqual((await request("DELETE")).data, { ok: true, design: null });
  assert.equal(records.size, 0);
  // Historical batches without custom art continue using the standard design.
  assert.deepEqual((await request()).data, { design: null });
  assert.equal((await request("GET", { eventId: "deleted-without-art" })).status, 200);
  assert.equal((await request("DELETE", { eventId: "deleted-without-art" })).status, 200);
});

test("PNG artwork saves, reads with strong consistency, stays per event and resets", async () => {
  const { request, calls, records } = fixture();
  assert.deepEqual((await request()).data, { design: null });
  const saved = await request("POST", { bytes: artwork });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.design, {
    mime: "image/png",
    width: 1116,
    height: 588,
    dataUrl: "data:image/png;base64," + artwork.toString("base64"),
    updatedAt: "2026-10-04T09:00:00.000Z",
  });
  assert.equal(saved.data.ok, true);
  assert.deepEqual((await request()).data.design, saved.data.design);
  assert.deepEqual((await request("GET", { eventId: "event-two" })).data, { design: null });
  assert.ok(calls.filter((call) => call.action === "get").every((call) =>
    call.options.type === "json" && call.options.consistency === "strong"));
  assert.deepEqual((await request("DELETE")).data, { ok: true, design: null });
  assert.equal(records.size, 0);
  assert.deepEqual((await request()).data, { design: null });
  // Reset is idempotent, including when there is no custom artwork.
  assert.equal((await request("DELETE")).status, 200);
});

test("standard JPEG artwork is accepted with the dimensions read from its frame", async () => {
  const { request } = fixture();
  const saved = await request("POST", { bytes: jpeg, mime: "image/jpeg" });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.design.mime, "image/jpeg");
  assert.equal(saved.data.design.width, 1116);
  assert.equal(saved.data.design.height, 588);
  assert.equal(saved.data.design.dataUrl, "data:image/jpeg;base64," + jpeg.toString("base64"));
  const wrongSize = Buffer.from(jpeg);
  const frame = wrongSize.indexOf(Buffer.from([0xff, 0xc0, 0, 17, 8]));
  assert.ok(frame > 0);
  wrongSize.writeUInt16BE(1000, frame + 7);
  const result = await request("POST", { bytes: wrongSize, mime: "image/jpeg" });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /1116 × 588/);
});

test("mismatched MIME types, SVG and malformed images are rejected without storing", async () => {
  const { request, records } = fixture();
  const brokenPng = Buffer.from(artwork);
  brokenPng[20] ^= 1;
  const unsupported = [
    { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: "image/svg+xml", status: 415 },
    { bytes: Buffer.from("GIF89a"), mime: "image/png", status: 415 },
    { bytes: artwork, mime: "image/jpeg", status: 415 },
    { bytes: jpeg, mime: "image/png", status: 415 },
    { bytes: artwork, mime: "application/octet-stream", status: 415 },
    { bytes: artwork.subarray(0, 28), status: 400 },
    { bytes: brokenPng, status: 400 },
    { bytes: Buffer.concat([artwork, Buffer.from("<svg/>")]), status: 400 },
    { bytes: jpeg.subarray(0, -2), mime: "image/jpeg", status: 400 },
    { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0xff, 0xff]), mime: "image/jpeg", status: 400 },
    { bytes: png(1115, 588), status: 400 },
  ];
  for (const { status, ...upload } of unsupported)
    assert.equal((await request("POST", upload)).status, status);
  assert.equal((await request("POST", { bytes: Buffer.alloc(0) })).status, 400);
  assert.equal(records.size, 0);
});

test("the size limit uses both declared length and streamed bytes, cancelling excess data", async () => {
  const { request, records } = fixture();
  assert.equal((await request("POST", {
    bytes: artwork,
    headers: { "Content-Length": String(TICKET_DESIGN_MAX_BYTES + 1) },
  })).status, 413);
  assert.equal((await request("POST", {
    bytes: artwork,
    headers: { "Content-Length": "invalid" },
  })).status, 400);
  let cancelled = false;
  let produced = 0;
  const stream = new ReadableStream({
    pull(controller) {
      produced++;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (produced === 10) controller.close();
    },
    cancel() { cancelled = true; },
  });
  const result = await request("POST", {
    bytes: stream,
    headers: { "Content-Length": "1" },
  });
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
  assert.ok(produced < 10);
  assert.equal(records.size, 0);
});

test("storage failures return a generic error without backend details", async () => {
  const handler = createTicketDesignHandler({
    readEvents: async () => [{ id: "event-one" }],
    getStore: () => ({ get: async () => { throw new Error("private storage token"); } }),
  });
  const result = await handler(new Request(origin + "/api/ticket-design?event_id=event-one", {
    headers: { cookie },
  }));
  assert.equal(result.status, 503);
  assert.ok(!(await result.text()).includes("private"));
});
