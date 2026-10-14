import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRegistrationsHandler } from "../netlify/functions/registrations.mjs";
import { adminLogin, signedAdminCookie } from "../netlify/lib/security.mjs";
import { ADMIN_STORE, ADMIN_ACCOUNTS_KEY, TREASURER_PERMISSIONS } from "../netlify/lib/admin-auth.mjs";
import {
  CLASS_OPTIONS, RECEIPT_MAX_BYTES, REGISTRATION_MAX_BYTES, REGISTRATION_STORE,
  REGISTRATION_RECEIPT_STORE, REGISTRATION_PHOTO_STORE, REGISTRATION_FULL_MESSAGE, defaultRegistrationForm, entryKey, formKey, registrationStateKey,
  hydrateRegistrationFlags, registrationCsv, turkeyToday,
} from "../netlify/lib/registrations.mjs";

const previousPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "registrations-test-only-password";
after(() => {
  if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = previousPassword;
});
const origin = "https://site.test";
const cookie = adminLogin(new Request(origin + "/api/events", {
  headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
})).split(";")[0];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=", "base64");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzuiiiuE+pP//Z", "base64");
const progressiveJpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAVAQEBAAAAAAAAAAAAAAAAAAADBf/aAAwDAQACEAMQAAABnQFT/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=", "base64");
const validAnswers = { full_name: "Deniz Test", class_year: "2. Sınıf", phone: "+90 (555) 123 45 67" };
const photoQuestion = (id = "portrait", required = true) => ({ id, type: "photo", label: "Fotoğraf", required });
const withPhotos = (form) => ({ ...form, fields: [...form.fields, photoQuestion(), photoQuestion("optional", false)] });

function fixture() {
  const stores = new Map();
  const calls = [];
  const hooks = {};
  const batches = new Map();
  const tickets = new Map();
  const databaseCalls = [];
  const db = async (path, options = {}) => {
    databaseCalls.push({ path, options });
    await hooks.beforeDb?.({ path, options, batches, tickets });
    let result;
    if (path === "rpc/create_ticket_batch") {
      const input = options.data;
      if (batches.has(input.p_id)) {
        const error = new Error("duplicate batch"); error.status = 409; throw error;
      }
      batches.set(input.p_id, { id: input.p_id, event_id: input.p_event,
        event_title: input.p_title, codes: input.p_codes });
      const ticketId = randomUUID();
      tickets.set(ticketId, { id: ticketId, batch_id: input.p_id, event_id: input.p_event,
        code_hash: createHash("sha256").update(input.p_codes[0]).digest("hex"),
        claimed_at: null, revoked: false });
      result = input.p_id;
    } else if (path.startsWith("ticket_batches?")) {
      const id = /id=eq\.([^&]+)/.exec(path)[1];
      result = batches.has(id) ? [batches.get(id)] : [];
    } else if (path.startsWith("tickets?batch_id=")) {
      const id = /batch_id=eq\.([^&]+)/.exec(path)[1];
      result = [...tickets.values()].filter((ticket) => ticket.batch_id === id);
    } else if (path.startsWith("tickets?id=") && options.method === "PATCH") {
      const id = /id=eq\.([^&]+)/.exec(path)[1];
      if (tickets.has(id)) tickets.set(id, { ...tickets.get(id), ...options.data });
      result = tickets.has(id) ? [tickets.get(id)] : [];
    } else throw new Error(`Unexpected database request: ${path}`);
    await hooks.afterDb?.({ path, options, batches, tickets });
    return structuredClone(result);
  };
  const events = [
    { id: "event-one", title: "Birinci etkinlik", date: "2026-10-04", time: "00:01", published: true },
    { id: "event-two", title: "İkinci etkinlik", date: "2026-10-10", published: true,
      registrationUrl: "https://docs.google.com/forms/d/test/viewform" },
    { id: "hidden", title: "Gizli etkinlik", date: "2026-10-10", published: false },
    { id: "past", title: "Geçmiş etkinlik", date: "2026-10-03", published: true },
  ];
  let clock = new Date("2026-10-04T09:00:00.000Z");
  let etag = 0;
  const getStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const records = stores.get(name);
    return {
      async get(key, options) {
        calls.push({ name, action: "get", key, options });
        await hooks.get?.({ name, key, records });
        const value = records.get(key)?.data;
        return value == null ? null : structuredClone(value);
      },
      async getWithMetadata(key, options) {
        calls.push({ name, action: "getWithMetadata", key, options });
        await hooks.get?.({ name, key, records });
        const record = records.get(key);
        const cloned = record ? structuredClone(record) : null;
        return hooks.metadata ? hooks.metadata({ name, key, record: cloned }) : cloned;
      },
      async setJSON(key, data, options = {}) {
        calls.push({ name, action: "setJSON", key, options });
        await hooks.beforeSet?.({ name, key, data, records });
        const existing = records.get(key);
        if ((options.onlyIfNew && existing) ||
          (options.onlyIfMatch && existing?.etag !== options.onlyIfMatch)) return { modified: false };
        const tag = String(++etag);
        records.set(key, { data: structuredClone(data), etag: tag });
        await hooks.afterSet?.({ name, key, data, records });
        return { modified: true, etag: tag };
      },
      async set(key, data, options = {}) {
        calls.push({ name, action: "set", key, options });
        await hooks.beforeReceiptSet?.({ name, key, data, records });
        if (options.onlyIfNew && records.has(key)) return { modified: false };
        const tag = String(++etag);
        records.set(key, { data: Uint8Array.from(data), etag: tag });
        await hooks.afterReceiptSet?.({ name, key, data, records });
        return { modified: true, etag: tag };
      },
      async delete(key) {
        calls.push({ name, action: "delete", key });
        await hooks.beforeDelete?.({ name, key, records });
        records.delete(key);
      },
      async list({ prefix = "" } = {}) {
        calls.push({ name, action: "list", prefix });
        return { blobs: [...records].filter(([key]) => key.startsWith(prefix))
          .map(([key, record]) => ({ key, etag: record.etag })), directories: [] };
      },
    };
  };
  const handler = createRegistrationsHandler({ getStore, readEvents: async () => structuredClone(events),
    now: () => new Date(clock), uuid: randomUUID, db });
  const request = async (action = "form", {
    method = "GET", eventId = "event-one", auth = false, input, form,
    rawBody, headers = {}, extra = "",
  } = {}) => {
    const body = method === "GET" ? undefined : input !== undefined ? JSON.stringify(input) : form || rawBody;
    return handler(new Request(`${origin}/api/registrations?action=${action}&event_id=${encodeURIComponent(eventId)}${extra}`, {
      method, headers: { Origin: origin, "x-nf-client-connection-ip": "192.0.2.1",
        ...(auth ? { cookie } : {}), ...(input !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers }, body, ...(rawBody instanceof ReadableStream ? { duplex: "half" } : {}),
    }));
  };
  const open = async (eventId = "event-one", edit = (form) => form) => {
    const input = edit({ ...defaultRegistrationForm(eventId), enabled: true });
    const saved = await request("form", { eventId, method: "POST", auth: true, input });
    assert.equal(saved.status, 200, await saved.clone().text());
    return (await saved.json()).form;
  };
  const submit = (options = {}) => {
    const data = new FormData();
    data.set("answers", JSON.stringify(options.answers ?? validAnswers));
    data.set("requestId", options.requestId ?? randomUUID());
    data.set("website", options.website ?? "");
    if (options.receipt) data.set("receipt", new Blob([options.receipt], { type: options.mime ?? "image/png" }), options.filename ?? "dekont.png");
    for (const [id, photo] of Object.entries(options.photos || {}))
      data.set(`photo:${id}`, new Blob([photo.bytes], { type: photo.mime ?? "image/png" }), photo.name ?? "fotograf.png");
    return request("submit", { method: "POST", eventId: options.eventId, form: data,
      headers: options.headers, extra: options.extra });
  };
  return { stores, calls, hooks, events, getStore, handler, request, open, submit, batches, tickets, databaseCalls,
    setClock: (value) => { clock = new Date(value); } };
}

async function delegateCookie(f, permissions, { treasurer = false } = {}) {
  const account = { id: treasurer ? "sayman" : randomUUID(), username: treasurer ? "sayman" : "yetkili",
    name: treasurer ? "Sayman" : "Yetkili yönetici", role: treasurer ? "treasurer" : "admin", active: true,
    version: randomUUID(), permissions, ...(treasurer ? { fixedPreset: true } : {}),
    salt: "a".repeat(32), passwordHash: "b".repeat(64) };
  await f.getStore(ADMIN_STORE).setJSON(ADMIN_ACCOUNTS_KEY, { revision: randomUUID(), accounts: [account] });
  return signedAdminCookie(new Request(origin + "/admin.html"), account).split(";")[0];
}

test("Sayman only reads registration lists and receipts; other operations are rejected before private stores", async () => {
  const f = fixture();
  await f.open("event-one", withPhotos);
  const submitted = await (await f.submit({ receipt: png, photos: { portrait: { bytes: png, name: "private-personal-photo.png" } } })).json();
  await f.request("ticket", { method: "POST", auth: true, input: { id: submitted.reference } });
  const signed = await delegateCookie(f, [...TREASURER_PERMISSIONS], { treasurer: true });
  const headers = { cookie: signed };
  const admin = await (await f.request("admin", { headers })).json();
  const record = admin.entries[0];
  assert.equal(record.name, "Deniz Test");
  assert.deepEqual(record.receipt, { name: "dekont.png", mime: "image/png", size: png.length });
  assert.ok(!Object.hasOwn(record, "ticket"));
  assert.ok(!Object.hasOwn(record, "photos"));
  assert.ok(!Object.hasOwn(record.answers, "portrait"));
  assert.ok(!JSON.stringify(admin).includes("private-personal-photo"));
  assert.deepEqual(admin.pendingTicketDeletions, []);
  assert.deepEqual(admin.form.fields, defaultRegistrationForm("event-one").fields);
  assert.equal(admin.form.description, "");
  assert.equal((await f.request("summary", { headers })).status, 200);
  const receipt = await f.request("receipt", { headers, extra: "&id=" + submitted.reference });
  assert.equal(receipt.status, 200);
  assert.deepEqual(Buffer.from(await receipt.arrayBuffer()), png);
  for (const [action, method, input, extra = ""] of [
    ["form", "POST", defaultRegistrationForm("event-one")],
    ["photo", "GET", null, "&id=" + submitted.reference + "&field_id=portrait"],
    ["export", "GET"], ["ticket", "GET", null, "&id=" + submitted.reference],
    ["ticket", "POST", { id: submitted.reference }], ["delete", "POST", { id: submitted.reference }],
  ]) {
    f.calls.length = 0; f.databaseCalls.length = 0;
    assert.equal((await f.request(action, { method, ...(method === "POST" ? { input } : {}), headers, extra })).status, 403, action);
    assert.equal(f.calls.filter(call => call.name !== ADMIN_STORE).length, 0, action + " private storage");
    assert.equal(f.databaseCalls.length, 0, action + " ticket database");
  }
});

test("registration managers cannot delete entries, and ticket access additionally requires registration view", async () => {
  const f = fixture();
  await f.open();
  const reference = (await (await f.submit()).json()).reference;
  const manager = await delegateCookie(f, ["registrations.view", "registrations.manage"]);
  assert.equal((await f.request("form", { method: "POST", input: { ...defaultRegistrationForm("event-one"), enabled: true }, headers: { cookie: manager } })).status, 200);
  f.calls.length = 0;
  assert.equal((await f.request("delete", { method: "POST", input: { id: reference }, headers: { cookie: manager } })).status, 403);
  assert.equal(f.calls.length, 0);
  const onlyTickets = await delegateCookie(f, ["tickets.view", "tickets.manage"]);
  f.calls.length = 0; f.databaseCalls.length = 0;
  for (const method of ["GET", "POST"]) {
    assert.equal((await f.request("ticket", { method, ...(method === "POST" ? { input: { id: reference } } : { extra: "&id=" + reference }), headers: { cookie: onlyTickets } })).status, 403);
  }
  assert.equal(f.calls.filter(call => call.name !== ADMIN_STORE).length, 0);
  assert.equal(f.databaseCalls.length, 0);
  assert.equal((await f.request("delete", { method: "POST", input: { id: reference }, auth: true })).status, 200);
});

test("registration viewers without attachment permissions receive no file metadata or ticket cleanup names", async () => {
  const f = fixture();
  await f.open("event-one", withPhotos);
  await f.submit({ receipt: png, filename: "private-receipt.png", photos: { portrait: { bytes: png, name: "private-photo.png" } } });
  const viewer = await delegateCookie(f, ["registrations.view"]);
  const result = await (await f.request("admin", { headers: { cookie: viewer } })).json();
  assert.equal(result.entries.length, 1);
  const record = result.entries[0];
  assert.ok(!Object.hasOwn(record, "receipt"));
  assert.ok(!Object.hasOwn(record, "photos"));
  assert.ok(!Object.hasOwn(record.answers, "portrait"));
  assert.ok(!JSON.stringify(result).includes("private-receipt"));
  assert.ok(!JSON.stringify(result).includes("private-photo"));
});

test("administrator lists, configuration, deletion, summaries, exports and private receipts require signed cookies", async () => {
  const { request, calls } = fixture();
  for (const action of ["admin", "summary", "receipt", "photo", "export", "delete", "form", "ticket"]) {
    const result = await request(action, {
      method: ["delete", "form"].includes(action) ? "POST" : "GET",
      input: { id: "entry-one", status: "approved" },
      headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
    });
    assert.equal(result.status, 401, action);
  }
  assert.equal((await request("admin", { headers: { cookie: cookie + "tampered" } })).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await request("form", { method: "POST", auth: true,
    input: defaultRegistrationForm("event-one"), headers: { Origin: "https://foreign.test" } })).status, 403);
  assert.equal(calls.length, 0);
});

test("config defaults, core fields, types, lengths and options are enforced without changing registrations", async () => {
  const { request, open, stores } = fixture();
  const empty = await (await request("admin", { auth: true })).json();
  assert.deepEqual(empty.form, defaultRegistrationForm("event-one"));
  assert.deepEqual(empty.form.fields[1].options, CLASS_OPTIONS);
  assert.deepEqual((await (await request()).json()), { form: null, available: false, full: false });
  const saved = await open();
  assert.equal(saved.updatedAt, "2026-10-04T09:00:00.000Z");
  const mutations = [
    (f) => { f.maxRegistrations = 0; },
    (f) => { f.maxRegistrations = -1; },
    (f) => { f.maxRegistrations = 1.5; },
    (f) => { f.maxRegistrations = "40"; },
    (f) => { f.maxRegistrations = 10001; },
    (f) => { f.eventId = "event-two"; },
    (f) => { f.fields[0].required = false; },
    (f) => { f.fields[0].type = "email"; },
    (f) => { f.fields.pop(); },
    (f) => { f.fields[1].options = []; },
    (f) => { f.fields[1].options.push("2. Sınıf"); },
    (f) => { f.fields[1].options = Array.from({ length: 41 }, (_, i) => String(i)); },
    (f) => { f.description = "a".repeat(5001); },
    (f) => { f.receipt = { enabled: false, required: true }; },
    (f) => { f.fields.push({ id: "constructor", type: "text", label: "Soru", required: false }); },
    (f) => { f.fields.push({ id: "full_name", type: "text", label: "Soru", required: false }); },
    (f) => { f.fields[0].label = "x".repeat(161); },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(saved);
    mutate(input);
    assert.equal((await request("form", { auth: true, method: "POST", input })).status, 400);
    assert.deepEqual(stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.form, saved);
  }
  for (const eventId of ["", "../event-one", "x/y"])
    assert.equal((await request("admin", { eventId, auth: true })).status, 400);
  assert.equal((await request("form", { eventId: "unknown", method: "POST", auth: true, input: saved })).status, 404);
});

test("form access is independent of publication, uses Türkiye day, and blocks removed or closed draft events", async () => {
  const { request, open, submit, setClock, events } = fixture();
  for (const eventId of ["event-one", "hidden", "past"]) await open(eventId);
  assert.equal((await (await request()).json()).available, true);
  assert.equal((await submit()).status, 200);
  assert.equal((await (await request("form", { eventId: "past" })).json()).available, false);
  assert.equal((await submit({ eventId: "past" })).status, 409);
  const hidden = await (await request("form", { eventId: "hidden" })).json();
  assert.equal(hidden.available, true);
  assert.equal(hidden.event.id, "hidden");
  assert.equal(hidden.event.published, false);
  assert.equal(hidden.event.registrationMode, "native");
  assert.equal((await submit({ eventId: "hidden" })).status, 200);
  await request("form", { eventId: "hidden", method: "POST", auth: true,
    input: { ...defaultRegistrationForm("hidden"), enabled: false } });
  assert.equal((await request("form", { eventId: "hidden" })).status, 404);
  assert.equal((await submit({ eventId: "hidden" })).status, 404);
  setClock("2026-10-04T21:00:00.000Z");
  assert.equal(turkeyToday(new Date("2026-10-04T20:59:59Z")), "2026-10-04");
  assert.equal((await (await request()).json()).available, false);
  assert.equal((await submit()).status, 409);
  events.splice(0, 1);
  assert.equal((await request()).status, 404);
});

test("all configured answers are validated and invalid submissions leave no entries or receipts", async () => {
  const { open, submit, stores } = fixture();
  await open("event-one", (form) => ({ ...form, receipt: { enabled: true, required: true }, fields: [
    ...form.fields,
    { id: "email", type: "email", label: "E-posta", required: true },
    { id: "choice", type: "radio", label: "Tercih", required: true, options: ["A", "B"] },
    { id: "topics", type: "checkboxes", label: "Konular", required: true, options: ["Bir", "İki"] },
    { id: "note", type: "textarea", label: "Not", required: false },
  ] }));
  const answers = { ...validAnswers, email: "deniz@example.test", choice: "A", topics: ["İki"], note: "" };
  const invalid = [
    { ...answers, full_name: " " }, { ...answers, full_name: ["Deniz"] },
    { ...answers, class_year: "6. Sınıf" }, { ...answers, phone: "123" },
    { ...answers, phone: "555<script>1234567" }, { ...answers, email: "noemail" },
    { ...answers, choice: "C" }, { ...answers, topics: [] },
    { ...answers, topics: ["Bir", "Bir"] }, { ...answers, topics: ["Üç"] },
    { ...answers, note: "x".repeat(2001) }, { ...answers, extra: "unexpected" },
    null, [], { ...answers, note: "x\u0000y" },
  ];
  for (const candidate of invalid) assert.equal((await submit({
    answers: candidate === null ? "invalid" : candidate, receipt: png,
  })).status, 400);
  assert.equal((await submit({ answers })).status, 400);
  assert.equal((await submit({ answers, receipt: png, website: "spam.example" })).status, 400);
  assert.equal((await submit({ answers, receipt: png })).status, 200);
  assert.equal(stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries.length, 1);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
});

test("a native submission is idempotent, private, class-counted and exportable", async () => {
  const { open, submit, request, stores, calls } = fixture();
  await open();
  const requestId = randomUUID();
  const result = await submit({ requestId, receipt: png, filename: '../../dekont".png' });
  assert.equal(result.status, 200);
  const submitted = await result.json();
  assert.match(submitted.reference, /^[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(submitted).sort(), ["event", "ok", "reference"]);
  assert.deepEqual(submitted.event, { id: "event-one", title: "Birinci etkinlik",
    date: "2026-10-04", time: "00:01", location: "" });
  assert.deepEqual(await (await submit({ requestId, receipt: png })).json(), submitted);
  assert.equal((await submit({ requestId, answers: { ...validAnswers, phone: "05559999999" }, receipt: png })).status, 409);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  const admin = await (await request("admin", { auth: true })).json();
  assert.deepEqual(admin.summary, { total: 1, byClass: [{ classYear: "2. Sınıf", count: 1 }],
    duplicateEntries: 0, duplicateGroups: 0 });
  assert.equal(admin.entries[0].name, "Deniz Test");
  assert.deepEqual(admin.entries[0].receipt, { name: "dekont.png", mime: "image/png", size: png.length });
  assert.deepEqual(admin.entries[0].fields, defaultRegistrationForm("event-one").fields);
  assert.ok(!JSON.stringify(admin).includes('"key"'));
  const receipt = await request("receipt", { auth: true, extra: "&id=" + submitted.reference });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.headers.get("content-type"), "image/png");
  assert.equal(receipt.headers.get("cache-control"), "private, no-store");
  assert.equal(receipt.headers.get("x-content-type-options"), "nosniff");
  assert.equal(receipt.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.deepEqual(Buffer.from(await receipt.arrayBuffer()), png);
  assert.equal((await request("receipt", { extra: "&id=" + submitted.reference })).status, 401);
  const summary = await (await request("summary", { auth: true })).json();
  assert.equal(summary.events.find((event) => event.eventId === "event-one").total, 1);
  assert.equal(summary.events.find((event) => event.eventId === "event-two").total, 0);
  assert.equal((await request("status", { auth: true, method: "POST",
    input: { id: submitted.reference, status: "attendance" } })).status, 400);
  const csv = await request("export", { auth: true });
  assert.match(csv.headers.get("content-disposition"), /attachment/);
  const csvText = await csv.text();
  assert.match(csvText, /Deniz Test/);
  assert.ok(!csvText.includes('"Durum"'));
  assert.ok(!Object.hasOwn(admin.entries[0], "status"));
  const publicForm = await (await request()).json();
  assert.deepEqual(Object.keys(publicForm).sort(), ["available", "event", "form", "full"]);
  assert.ok(!JSON.stringify(publicForm).includes("Deniz Test"));
  assert.ok(calls.filter((call) => ["get", "getWithMetadata"].includes(call.action))
    .every((call) => call.options.consistency === "strong"));
});

test("unsupported, incomplete, disabled and oversized receipts are rejected", async () => {
  const { open, submit, request, stores } = fixture();
  await open();
  assert.equal((await submit({ receipt: Buffer.from("<svg>test</svg>"), mime: "image/svg+xml" })).status, 415);
  assert.equal((await submit({ receipt: png.subarray(0, -10) })).status, 415);
  assert.equal((await submit({ receipt: Buffer.from("%PDF-1.4 without eof"), mime: "application/pdf" })).status, 415);
  assert.equal((await submit({ receipt: Buffer.alloc(RECEIPT_MAX_BYTES + 1) })).status, 413);
  const valid = await submit({ receipt: pdf, mime: "application/pdf", filename: "dekont.pdf" });
  assert.equal(valid.status, 200);
  const reference = (await valid.json()).reference;
  const response = await request("receipt", { auth: true, extra: "&id=" + reference });
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  await open("event-one", (form) => ({ ...form, receipt: { enabled: false, required: false } }));
  assert.equal((await submit({ receipt: png })).status, 400);
});

test("Android MIME hints and JPG screenshot names are normalized from the actual receipt contents", async () => {
  const { open, submit, request } = fixture();
  await open();
  const cases = [
    [png, 'image/jpeg', 'Screenshot_VakifBank.jpg', 'image/png', 'Screenshot_VakifBank.png'],
    [png, 'image/x-png', 'dekont.png', 'image/png', 'dekont.png'],
    [png, '', 'dekont.jpg', 'image/png', 'dekont.png'],
    [jpeg, 'application/octet-stream', 'dekont.jpg', 'image/jpeg', 'dekont.jpg'],
    [jpeg, 'image/jpg', 'dekont.jpeg', 'image/jpeg', 'dekont.jpg'],
    [jpeg, 'image/pjpeg', 'dekont.jpg', 'image/jpeg', 'dekont.jpg'],
    [jpeg, 'image/png', 'dekont.png', 'image/jpeg', 'dekont.jpg'],
    [progressiveJpeg, '', 'dekont.jpg', 'image/jpeg', 'dekont.jpg'],
    [pdf, 'application/octet-stream', 'dekont.pdf', 'application/pdf', 'dekont.pdf'],
  ];
  for (const [bytes, mime, filename, actualMime, actualName] of cases) {
    const uploaded = await submit({ receipt: bytes, mime, filename });
    assert.equal(uploaded.status, 200, `${filename}: ${mime}`);
    const reference = (await uploaded.json()).reference;
    const admin = await (await request('admin', { auth: true })).json();
    const entry = admin.entries.find(item => item.id === reference);
    assert.deepEqual(entry.receipt, { name: actualName, mime: actualMime, size: bytes.length });
    const downloaded = await request('receipt', { auth: true, extra: '&id=' + reference });
    assert.equal(downloaded.headers.get('content-type'), actualMime);
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  }
});

test("valid JPEG scans accept trailing phone metadata without confusing metadata markers for an image end", async () => {
  const { open, submit, request } = fixture();
  await open();
  // APP metadata can itself contain FF D9. The parser must skip the segment.
  const app = Buffer.from([0xff, 0xe1, 0, 8, 1, 2, 0xff, 0xd9, 3, 4]);
  const withApp = Buffer.concat([jpeg.subarray(0, 2), app, jpeg.subarray(2)]);
  for (const original of [jpeg, progressiveJpeg, withApp]) {
    const uploaded = await submit({ receipt: Buffer.concat([original, Buffer.from('\0Samsung_SEF_metadata\0')]), mime: 'image/jpeg', filename: 'dekont.jpg' });
    assert.equal(uploaded.status, 200);
    const reference = (await uploaded.json()).reference;
    const downloaded = await request('receipt', { auth: true, extra: '&id=' + reference });
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
  }
  for (const broken of [jpeg.subarray(0, -2), Buffer.from([0xff, 0xd8, ...app, 0xff, 0xd9]),
    Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, 0xff, 0xff]), jpeg.subarray(2)])]) {
    assert.equal((await submit({ receipt: broken, mime: 'image/jpeg' })).status, 415);
  }
});

test("receipt retries bind canonical content even when the phone changes its MIME or filename hint", async () => {
  const { open, submit, request, stores } = fixture();
  await open();
  const requestId = randomUUID();
  const first = await submit({ requestId, receipt: png, mime: 'image/jpeg', filename: 'dekont.jpg' });
  assert.equal(first.status, 200);
  assert.deepEqual(await (await submit({ requestId, receipt: png, mime: 'application/octet-stream', filename: 'dekont.png' })).json(), await first.json());
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  assert.equal((await (await request('admin', { auth: true })).json()).summary.total, 1);
  assert.equal((await submit({ requestId, receipt: jpeg, mime: 'image/jpeg', filename: 'dekont.jpg' })).status, 409);
});

test("multipart parsing rejects duplicate, unknown, invalid id and non-file fields; oversized streams are cancelled", async () => {
  const { open, request, calls } = fixture();
  await open();
  const make = () => {
    const data = new FormData();
    data.set("answers", JSON.stringify(validAnswers));
    data.set("requestId", randomUUID());
    return data;
  };
  for (const mutate of [
    (data) => data.append("answers", "{}"), (data) => data.set("unexpected", "hello"),
    (data) => data.set("requestId", "not-a-uuid"), (data) => data.set("receipt", "not-a-file"),
    (data) => data.set("answers", "not-json"),
  ]) {
    const data = make(); mutate(data);
    assert.equal((await request("submit", { method: "POST", form: data })).status, 400);
  }
  assert.equal((await request("submit", { method: "POST", rawBody: "invalid",
    headers: { "Content-Type": "multipart/form-data; boundary=invalid", "Content-Length": String(REGISTRATION_MAX_BYTES + 1) } })).status, 413);
  let cancelled = false;
  let produced = 0;
  const rawBody = new ReadableStream({
    pull(controller) { produced++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const result = await request("submit", { method: "POST", rawBody,
    headers: { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "1" } });
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
  assert.ok(produced < 8);
  assert.ok(!calls.some((call) => call.action === "set"));
});

test("concurrent entries cannot overwrite each other, and duplicate requests keep exactly one private receipt", async () => {
  const { open, submit, request, stores } = fixture();
  await open();
  const responses = await Promise.all(Array.from({ length: 16 }, (_, index) =>
    submit({ answers: { ...validAnswers, full_name: "Katılımcı " + index },
      headers: { "x-nf-client-connection-ip": "192.0.2." + (index + 10) } })));
  assert.ok(responses.every((result) => result.status === 200));
  const requestId = randomUUID();
  const duplicates = await Promise.all([submit({ requestId, receipt: png }), submit({ requestId, receipt: png })]);
  assert.ok(duplicates.every((result) => result.status === 200));
  assert.deepEqual(await duplicates[0].json(), await duplicates[1].json());
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  const admin = await (await request("admin", { auth: true })).json();
  assert.equal(admin.summary.total, 17);
  assert.equal(new Set(admin.entries.map((entry) => entry.id)).size, 17);
});

test("same UUID cannot report success for changed answers or receipt, including concurrent retries", async () => {
  const { open, submit, request, stores } = fixture();
  await open();
  const requestId = randomUUID();
  const raced = await Promise.all([
    submit({ requestId, receipt: png, answers: { ...validAnswers, full_name: "Deniz" } }),
    submit({ requestId, receipt: png, answers: { ...validAnswers, full_name: "Ece" } }),
  ]);
  assert.deepEqual(raced.map((result) => result.status).sort(), [200, 409]);
  const conflict = raced.find((result) => result.status === 409);
  assert.match((await conflict.json()).error, /Önceki kayıt isteğin alınmış/);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  const admin = await (await request("admin", { auth: true })).json();
  const acceptedAnswers = admin.entries[0].answers;
  assert.equal((await submit({ requestId, answers: acceptedAnswers, receipt: pdf, mime: "application/pdf" })).status, 409);
  assert.equal((await submit({ requestId, answers: acceptedAnswers })).status, 409);
  // Editing the live schema must not reinterpret or block an identical retry.
  await open("event-one", (form) => ({ ...form, enabled: false, fields: [...form.fields,
    { id: "new_question", type: "text", label: "Yeni zorunlu soru", required: true }] }));
  const retried = await submit({ requestId, answers: acceptedAnswers, receipt: png });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).reference, admin.entries[0].id);
});

test("pagination and filters preserve full class breakdowns without public registration counts", async () => {
  const { open, submit, request } = fixture();
  await open();
  for (let index = 0; index < 53; index++) assert.equal((await submit({ answers: {
    ...validAnswers, class_year: index < 28 ? "1. Sınıf" : "2. Sınıf",
  } })).status, 200);
  const first = await (await request("admin", { auth: true })).json();
  const second = await (await request("admin", { auth: true, extra: "&page=2" })).json();
  assert.equal(first.entries.length, 50);
  assert.equal(second.entries.length, 3);
  assert.equal(first.totalPages, 2);
  assert.equal(first.summary.total, 53);
  assert.deepEqual(first.summary.byClass, [{ classYear: "1. Sınıf", count: 28 }, { classYear: "2. Sınıf", count: 25 }]);
  const filtered = await (await request("admin", { auth: true, extra: "&class_year=" + encodeURIComponent("2. Sınıf") })).json();
  assert.equal(filtered.entries.length, 25);
  assert.equal(filtered.summary.total, 53);
  assert.equal((await request("admin", { auth: true, extra: "&page=-1" })).status, 400);
});

test("anonymous rate limits expire, vary by IP and do not penalize idempotent retries", async () => {
  const { open, submit, setClock } = fixture();
  await open();
  const requestId = randomUUID();
  assert.equal((await submit({ requestId })).status, 200);
  for (let i = 1; i < 60; i++) assert.equal((await submit()).status, 200);
  assert.equal((await submit()).status, 429);
  assert.equal((await submit({ requestId })).status, 200);
  assert.equal((await submit({ headers: { "x-nf-client-connection-ip": "192.0.2.5" } })).status, 200);
  setClock("2026-10-04T09:16:00Z");
  assert.equal((await submit()).status, 200);
});

test("legitimate simultaneous registrations behind one campus IP survive counter contention", async () => {
  const { open, submit, request } = fixture();
  await open();
  const results = await Promise.all(Array.from({ length: 32 }, () => submit()));
  assert.deepEqual(results.map((result) => result.status), new Array(32).fill(200));
  assert.equal((await (await request("admin", { auth: true })).json()).summary.total, 32);
});

test("field snapshots and receipts survive form edits and event deletion", async () => {
  const { open, submit, request, events } = fixture();
  await open("event-one", (form) => ({ ...form, fields: [...form.fields,
    { id: "custom", type: "text", label: "Eski soru", required: false }] }));
  const submitted = await submit({ answers: { ...validAnswers, custom: "=HYPERLINK(\"evil\")" }, receipt: png });
  const id = (await submitted.json()).reference;
  await open("event-one", (form) => ({ ...form, enabled: false, fields: [...form.fields,
    { id: "custom", type: "text", label: "Yeni soru", required: false }] }));
  assert.equal((await (await request()).json()).available, false);
  const before = await (await request("admin", { auth: true })).json();
  assert.equal(before.entries[0].fields.at(-1).label, "Eski soru");
  events.splice(0, 1);
  assert.equal((await request()).status, 404);
  const archived = await (await request("admin", { auth: true })).json();
  assert.equal(archived.event.archived, true);
  assert.equal(archived.event.title, "Birinci etkinlik");
  assert.equal(archived.entries.length, 1);
  assert.equal((await request("receipt", { auth: true, extra: "&id=" + id })).status, 200);
  const summary = await (await request("summary", { auth: true })).json();
  assert.equal(summary.events.find((event) => event.eventId === "event-one").total, 1);
  const csv = await (await request("export", { auth: true })).text();
  assert.match(csv, /Eski soru/);
  assert.ok(!csv.includes("Yeni soru"));
  assert.match(csv, /'=HYPERLINK/);
});

test("CSV protects formula prefixes and distinguishes reused question IDs after renaming", () => {
  const rows = [
    { id: "a", name: "  =2+2", phone: "+905551234567", answers: { note: "@SUM(1,2)" },
      fields: [{ id: "note", label: "Eski soru" }], receipt: null },
    { id: "b", name: 'Deniz "Test"', answers: { note: "Yeni cevap" },
      fields: [{ id: "note", label: "Yeni soru" }], receipt: null },
  ];
  const output = registrationCsv(rows);
  assert.match(output, /Eski soru.*Yeni soru/);
  assert.match(output, /'  =2\+2/);
  assert.match(output, /'\+90555/);
  assert.match(output, /'@SUM/);
  assert.match(output, /Deniz ""Test""/);
});

test("event metadata exposes native flags only, including disabled override of Google Forms", async () => {
  const { getStore, events, open } = fixture();
  await open();
  await open("event-two", (form) => ({ ...form, enabled: false }));
  const hydrated = await hydrateRegistrationFlags(events, getStore);
  assert.equal(hydrated[0].registrationMode, "native");
  assert.equal(hydrated[0].registrationEnabled, true);
  assert.equal(hydrated[1].registrationMode, "native");
  assert.equal(hydrated[1].registrationEnabled, false);
  assert.equal(hydrated[2].registrationMode, undefined);
  assert.ok(!JSON.stringify(hydrated).includes("answers"));
});

test("failed entry writes clean uncommitted receipts and preserve receipts if commit succeeded before a network failure", async () => {
  for (const committed of [false, true]) {
    const { open, submit, request, stores, hooks } = fixture();
    await open();
    const hook = async ({ name, key }) => {
      if (name === REGISTRATION_STORE && key.startsWith("state/")) throw new Error("private token failure");
    };
    hooks[committed ? "afterSet" : "beforeSet"] = hook;
    const result = await submit({ receipt: png });
    assert.equal(result.status, committed ? 200 : 503);
    assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, committed ? 1 : 0);
    if (!committed) assert.ok(!(await result.text()).includes("private token"));
    else {
      const id = (await result.json()).reference;
      assert.equal((await request("receipt", { auth: true, extra: "&id=" + id })).status, 200);
    }
  }
});

test("receipt writes that fail after committing are cleaned before creating any entry", async () => {
  const { open, submit, stores, hooks } = fixture();
  await open();
  hooks.afterReceiptSet = () => { throw new Error("receipt connection failed"); };
  assert.equal((await submit({ receipt: png })).status, 503);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 0);
  assert.equal(stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries.length, 0);
});

test("uncertain entry writes preserve a potentially committed receipt rather than deleting participant data", async () => {
  const { open, submit, stores, hooks } = fixture();
  await open();
  let wroteEntry = false;
  hooks.afterSet = ({ name, key }) => {
    if (name === REGISTRATION_STORE && key.startsWith("state/")) {
      wroteEntry = true;
      throw new Error("entry committed but response lost");
    }
  };
  hooks.get = ({ name, key }) => {
    if (wroteEntry && name === REGISTRATION_STORE && key.startsWith("state/"))
      throw new Error("confirmation read temporarily unavailable");
  };
  assert.equal((await submit({ receipt: png })).status, 503);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  const entry = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0];
  assert.ok(entry);
  assert.ok(stores.get(REGISTRATION_RECEIPT_STORE).has(entry.receipt.key));
});

test("a cap of 40 is atomic for 45 simultaneous participants sharing one campus IP", async () => {
  const { open, submit, request, stores } = fixture();
  await open("event-one", (form) => ({ ...form, maxRegistrations: 40 }));
  const responses = await Promise.all(Array.from({ length: 45 }, (_, index) =>
    submit({ answers: { ...validAnswers, full_name: `Katılımcı ${index}` }, receipt: png })));
  assert.equal(responses.filter((result) => result.status === 200).length, 40);
  const refused = responses.filter((result) => result.status !== 200);
  assert.equal(refused.length, 5);
  for (const result of refused) {
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { error: REGISTRATION_FULL_MESSAGE, code: "REGISTRATION_FULL" });
  }
  const admin = await (await request("admin", { auth: true })).json();
  assert.equal(admin.summary.total, 40);
  assert.equal(new Set(admin.entries.map((entry) => entry.id)).size, 40);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 40);
  const publicForm = await (await request()).json();
  assert.equal(publicForm.available, false);
  assert.equal(publicForm.full, true);
  assert.equal(publicForm.message, REGISTRATION_FULL_MESSAGE);
  assert.ok(!Object.hasOwn(publicForm.form, "maxRegistrations"));
  assert.ok(!JSON.stringify(publicForm).includes('"total"'));
  assert.ok(!JSON.stringify(publicForm).includes("Katılımcı"));
});

test("identical retries at the last slot succeed, changed payload conflicts, and delete frees the slot", async () => {
  const { open, submit, request, stores } = fixture();
  await open("event-one", (form) => ({ ...form, maxRegistrations: 1 }));
  const requestId = randomUUID();
  const responses = await Promise.all([submit({ requestId, receipt: png }), submit({ requestId, receipt: png })]);
  assert.deepEqual(responses.map((result) => result.status), [200, 200]);
  const accepted = await responses[0].json();
  assert.deepEqual(await responses[1].json(), accepted);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  assert.equal((await submit({ requestId, receipt: png })).status, 200);
  const changed = await submit({ requestId, receipt: png, answers: { ...validAnswers, full_name: "Başka kişi" } });
  assert.equal(changed.status, 409);
  assert.ok(!(await changed.json()).code);
  assert.equal((await submit()).status, 409);
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: accepted.reference } })).status, 200);
  assert.equal((await (await request()).json()).available, true);
  assert.equal((await (await request()).json()).full, false);
  assert.equal((await (await request("admin", { auth: true })).json()).summary.total, 0);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 0);
  assert.equal((await request("receipt", { auth: true, extra: "&id=" + accepted.reference })).status, 404);
  const deletedRetry = await submit({ requestId, receipt: png });
  assert.equal(deletedRetry.status, 409);
  assert.match((await deletedRetry.json()).error, /silinmiş/);
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: accepted.reference } })).status, 200);
  assert.equal((await submit()).status, 200);
});

test("limits can close below existing totals, reopen when raised, and remain optional", async () => {
  const { open, submit, request } = fixture();
  await open();
  for (let i = 0; i < 3; i++) assert.equal((await submit()).status, 200);
  await open("event-one", (form) => ({ ...form, maxRegistrations: 2 }));
  assert.equal((await (await request()).json()).full, true);
  assert.equal((await submit()).status, 409);
  await open("event-one", (form) => ({ ...form, maxRegistrations: 4 }));
  assert.equal((await (await request()).json()).available, true);
  assert.equal((await submit()).status, 200);
  assert.equal((await (await request()).json()).full, true);
  await open("event-one", (form) => ({ ...form, maxRegistrations: null }));
  assert.equal((await submit()).status, 200);
  const publicForm = await (await request()).json();
  assert.equal(publicForm.full, false);
  assert.equal(publicForm.available, true);
  assert.ok(!Object.hasOwn(publicForm.form, "maxRegistrations"));
});

test("cached administrator configuration without a limit cannot remove a newer saved limit", async () => {
  const { open, request } = fixture();
  const saved = await open("event-one", (form) => ({ ...form, maxRegistrations: 40 }));
  const { maxRegistrations, ...oldInput } = saved;
  const result = await request("form", { method: "POST", auth: true, input: { ...oldInput, description: "Eski panel" } });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).form.maxRegistrations, 40);
});

test("a form limit lowered while the last-slot upload is in flight wins the same CAS race", async () => {
  const { open, submit, request, hooks, stores } = fixture();
  await open("event-one", (form) => ({ ...form, maxRegistrations: 2 }));
  assert.equal((await submit()).status, 200);
  let release;
  let signal;
  const blocked = new Promise((resolve) => { signal = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  hooks.beforeSet = async ({ name, key, data }) => {
    if (name === REGISTRATION_STORE && key.startsWith("state/") && data.entries.length === 2) {
      hooks.beforeSet = null;
      signal(); await wait;
    }
  };
  const racingSubmit = submit({ receipt: png });
  await blocked;
  await open("event-one", (form) => ({ ...form, maxRegistrations: 1 }));
  release();
  const result = await racingSubmit;
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "REGISTRATION_FULL");
  assert.equal((await (await request("admin", { auth: true })).json()).summary.total, 1);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 0);
});

test("legacy pending, approved and rejected entries all count and migrate without data or receipt loss", async () => {
  const { getStore, open, submit, request, stores, events } = fixture();
  await open();
  for (let i = 0; i < 3; i++) await submit({ receipt: png, answers: { ...validAnswers, full_name: `Eski kişi ${i}` } });
  const store = getStore(REGISTRATION_STORE);
  const old = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data;
  const { maxRegistrations, ...legacyForm } = old.form;
  await store.setJSON(formKey("event-one"), legacyForm);
  for (const [index, entry] of old.entries.entries()) await store.setJSON(entryKey("event-one", entry.id),
    { ...entry, status: ["pending", "approved", "rejected"][index] });
  await store.delete(registrationStateKey("event-one"));
  const readonly = await (await request("admin", { auth: true })).json();
  assert.equal(readonly.summary.total, 3);
  assert.equal(readonly.form.maxRegistrations, null);
  assert.ok(!stores.get(REGISTRATION_STORE).has(registrationStateKey("event-one")));
  await open("event-one", (form) => ({ ...form, maxRegistrations: 3 }));
  assert.equal((await (await request()).json()).full, true);
  const migrated = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data;
  assert.deepEqual(migrated.entries.map((entry) => entry.status).sort(), ["approved", "pending", "rejected"]);
  const admin = await (await request("admin", { auth: true })).json();
  assert.deepEqual(Object.keys(admin.summary).sort(), ["byClass", "duplicateEntries", "duplicateGroups", "total"]);
  assert.ok(admin.entries.every((entry) => !Object.hasOwn(entry, "status")));
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 3);
  const removed = old.entries[1];
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: removed.id } })).status, 200);
  assert.equal((await (await request()).json()).available, true);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 2);
  assert.ok(!stores.get(REGISTRATION_STORE).has(entryKey("event-one", removed.id)));
  // Stale legacy content must not override native form flags after migration.
  await store.setJSON(formKey("event-one"), { ...legacyForm, enabled: false });
  const hydrated = await hydrateRegistrationFlags(events, getStore);
  assert.equal(hydrated[0].registrationEnabled, true);
  const summary = await (await request("summary", { auth: true })).json();
  assert.equal(summary.events.find((event) => event.eventId === "event-one").total, 2);
});

test("deletion is protected, obsolete status updates are rejected, and unknown IDs do not mutate state", async () => {
  const { open, submit, request } = fixture();
  await open();
  const id = (await (await submit()).json()).reference;
  assert.equal((await request("delete", { method: "POST", input: { id } })).status, 401);
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id }, headers: { Origin: "https://foreign.test" } })).status, 403);
  assert.equal((await request("delete", { auth: true, method: "GET" })).status, 405);
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: "../invalid" } })).status, 400);
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: "unknown" } })).status, 404);
  assert.equal((await request("status", { auth: true, method: "POST", input: { id, status: "approved" } })).status, 400);
  assert.equal((await (await request("admin", { auth: true })).json()).summary.total, 1);
});

test("failed submit commits cannot consume the only slot, including successful writes with lost responses", async () => {
  for (const committed of [false, true]) {
    const { open, submit, request, hooks } = fixture();
    await open("event-one", (form) => ({ ...form, maxRegistrations: 1 }));
    let failOnce = true;
    hooks[committed ? "afterSet" : "beforeSet"] = ({ name, key }) => {
      if (failOnce && name === REGISTRATION_STORE && key.startsWith("state/")) {
        failOnce = false; throw new Error("write response lost");
      }
    };
    assert.equal((await submit({ receipt: png })).status, committed ? 200 : 503);
    const publicForm = await (await request()).json();
    assert.equal(publicForm.full, committed);
    if (!committed) assert.equal((await submit()).status, 200);
  }
});

test("delete survives a lost commit response and retried cleanup never resurrects a legacy receipt or entry", async () => {
  const { getStore, open, submit, request, stores, hooks } = fixture();
  await open("event-one", (form) => ({ ...form, maxRegistrations: 1 }));
  const id = (await (await submit({ receipt: png })).json()).reference;
  const original = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0];
  await getStore(REGISTRATION_STORE).setJSON(entryKey("event-one", id), { ...original, status: "approved" });
  hooks.afterSet = ({ name, key, data }) => {
    if (name === REGISTRATION_STORE && key.startsWith("state/") && data.deleted.length) {
      hooks.afterSet = null; throw new Error("deleted but response lost");
    }
  };
  hooks.beforeDelete = () => { throw new Error("private cleanup unavailable"); };
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id } })).status, 200);
  assert.equal((await request("receipt", { auth: true, extra: "&id=" + id })).status, 404);
  assert.equal((await (await request("admin", { auth: true })).json()).summary.total, 0);
  assert.equal((await (await request()).json()).available, true);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  assert.ok(stores.get(REGISTRATION_STORE).has(entryKey("event-one", id)));
  const summary = await (await request("summary", { auth: true })).json();
  assert.equal(summary.events.find((event) => event.eventId === "event-one").total, 0);
  hooks.beforeDelete = null;
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id } })).status, 200);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 0);
  assert.ok(!stores.get(REGISTRATION_STORE).has(entryKey("event-one", id)));
});

test("a store missing conditional-write ETags fails closed instead of removing a limit or overwriting records", async () => {
  const { open, submit, request, hooks } = fixture();
  const form = await open("event-one", (value) => ({ ...value, maxRegistrations: 1 }));
  const id = (await (await submit()).json()).reference;
  hooks.metadata = ({ name, key, record }) => {
    if (name === REGISTRATION_STORE && key.startsWith("state/")) delete record.etag;
    return record;
  };
  assert.equal((await request("form", { auth: true, method: "POST", input: { ...form, maxRegistrations: null } })).status, 503);
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id } })).status, 503);
  const current = await (await request("admin", { auth: true })).json();
  assert.equal(current.summary.total, 1);
  assert.equal(current.form.maxRegistrations, 1);
  assert.equal((await (await request()).json()).full, true);
});

test("possible duplicate phones are private same-event warnings calculated before class filtering and pagination", async () => {
  const { open, submit, request } = fixture();
  await open(); await open("event-two");
  for (const phone of ["0555 123 45 67", "+90 (555) 123 45 67", "0090 555 123 45 67"]) {
    assert.equal((await submit({ answers: { ...validAnswers, phone, class_year: phone.startsWith("0") ? "1. Sınıf" : "2. Sınıf" } })).status, 200);
  }
  assert.equal((await submit({ answers: { ...validAnswers, phone: "0555 111 22 33" } })).status, 200);
  assert.equal((await submit({ eventId: "event-two", answers: validAnswers })).status, 200);
  const admin = await (await request("admin", { auth: true, extra: "&duplicate_only=true&class_year=2.%20S%C4%B1n%C4%B1f" })).json();
  assert.equal(admin.entries.length, 1);
  assert.equal(admin.entries[0].possibleDuplicate, true);
  assert.equal(admin.entries[0].duplicateCount, 3);
  assert.equal(admin.summary.total, 4);
  assert.equal(admin.summary.duplicateGroups, 1);
  assert.equal(admin.summary.duplicateEntries, 3);
  const second = await (await request("admin", { auth: true, eventId: "event-two" })).json();
  assert.equal(second.entries[0].possibleDuplicate, false);
  assert.equal((await request("admin", { auth: true, extra: "&duplicate_only=1" })).status, 400);
  const publicResult = await (await request("form")).json();
  assert.ok(!Object.hasOwn(publicResult, "summary"));
  assert.ok(!Object.hasOwn(publicResult, "duplicateEntries"));
});

test("saved forms remain discoverable in the archive even when every registration was removed", async () => {
  const { open, request, events, getStore } = fixture();
  await open();
  events.splice(events.findIndex((event) => event.id === "event-one"), 1);
  await getStore(REGISTRATION_STORE).setJSON(formKey("legacy-archive"), defaultRegistrationForm("legacy-archive"));
  const summary = await (await request("summary", { auth: true })).json();
  const archived = summary.events.find((event) => event.eventId === "event-one");
  assert.equal(archived.archived, true);
  assert.equal(archived.title, "Birinci etkinlik");
  assert.equal(archived.total, 0);
  assert.ok(summary.events.some((event) => event.eventId === "legacy-archive" && event.archived));
  const admin = await (await request("admin", { auth: true })).json();
  assert.equal(admin.event.title, "Birinci etkinlik");
  assert.equal(admin.event.archived, true);
});

test("form submission never issues a ticket; explicit administrator issuance is unique and reusable", async () => {
  const { open, submit, request, batches, tickets, databaseCalls } = fixture();
  await open();
  const id = (await (await submit()).json()).reference;
  assert.equal(databaseCalls.length, 0);
  assert.equal((await request("ticket", { extra: "&id=" + id })).status, 401);
  assert.equal((await request("ticket", { auth: true, extra: "&id=" + id })).status, 404);
  const first = await request("ticket", { method: "POST", auth: true, input: { id } });
  assert.equal(first.status, 200, await first.clone().text());
  const issued = await first.json();
  assert.match(issued.ticket.code, /^ERC-[A-F0-9]{24}$/);
  assert.equal(issued.ticket.revoked, false);
  const retried = await (await request("ticket", { method: "POST", auth: true, input: { id } })).json();
  assert.deepEqual(retried, issued);
  assert.deepEqual(await (await request("ticket", { auth: true, extra: "&id=" + id })).json(), issued);
  assert.equal(batches.size, 1); assert.equal(tickets.size, 1);
  const list = await (await request("admin", { auth: true })).json();
  assert.equal(list.entries[0].ticket.status, "issued");
  assert.ok(!JSON.stringify(list).includes(issued.ticket.code));
  assert.ok(!JSON.stringify(await (await request()).json()).includes(issued.ticket.code));
  tickets.get(issued.ticket.id).claimed_at = "2026-10-04T10:00:00.000Z";
  tickets.get(issued.ticket.id).revoked = true;
  const fresh = await (await request("ticket", { auth: true, extra: "&id=" + id })).json();
  assert.equal(fresh.ticket.claimedAt, "2026-10-04T10:00:00.000Z");
  assert.equal(fresh.ticket.revoked, true);
});

test("concurrent issue requests and lost reservation or SQL responses converge on one ticket", async () => {
  for (const lost of ["none", "reservation", "sql"]) {
    const { open, submit, request, hooks, batches, tickets } = fixture();
    await open();
    const id = (await (await submit()).json()).reference;
    if (lost === "reservation") hooks.afterSet = ({ data }) => {
      if (data.entries?.some((entry) => entry.ticket)) { hooks.afterSet = null; throw new Error("lost reservation response"); }
    };
    if (lost === "sql") hooks.afterDb = ({ path }) => {
      if (path === "rpc/create_ticket_batch") { hooks.afterDb = null; throw new Error("lost SQL response"); }
    };
    const results = await Promise.all(Array.from({ length: 8 }, () => request("ticket", {
      method: "POST", auth: true, input: { id },
    })));
    for (const result of results) assert.equal(result.status, 200, await result.clone().text());
    const bodies = await Promise.all(results.map((result) => result.json()));
    assert.equal(new Set(bodies.map((result) => result.ticket.code)).size, 1);
    assert.equal(new Set(bodies.map((result) => result.ticket.id)).size, 1);
    assert.equal(batches.size, 1); assert.equal(tickets.size, 1);
  }
});

test("failed ticket creation keeps the same pending reservation for retry and archived records remain readable", async () => {
  const { open, submit, request, hooks, stores, events, batches, tickets } = fixture();
  await open();
  const id = (await (await submit()).json()).reference;
  hooks.beforeDb = ({ path }) => { if (path === "rpc/create_ticket_batch") throw new Error("SQL unavailable"); };
  assert.equal((await request("ticket", { method: "POST", auth: true, input: { id } })).status, 503);
  const reserved = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0].ticket;
  assert.equal(reserved.status, "pending"); assert.equal(tickets.size, 0);
  hooks.beforeDb = null;
  const issued = await (await request("ticket", { method: "POST", auth: true, input: { id } })).json();
  assert.equal(issued.ticket.code, reserved.code); assert.equal(issued.ticket.batchId, reserved.batchId);
  assert.equal(batches.size, 1);
  events.splice(events.findIndex((event) => event.id === "event-one"), 1);
  assert.equal((await request("ticket", { method: "POST", auth: true, input: { id } })).status, 409);
  const saved = await request("ticket", { auth: true, extra: "&id=" + id });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).ticket.code, reserved.code);
});

test("deleting while ticket issuance is delayed materializes and revokes the reservation before success", async () => {
  const { open, submit, request, hooks, tickets, batches } = fixture();
  await open();
  const id = (await (await submit()).json()).reference;
  let release, signal;
  const blocked = new Promise((resolve) => { signal = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  hooks.beforeDb = async ({ path }) => {
    if (path === "rpc/create_ticket_batch") { hooks.beforeDb = null; signal(); await wait; }
  };
  const issue = request("ticket", { method: "POST", auth: true, input: { id } });
  await blocked;
  const removed = await request("delete", { method: "POST", auth: true, input: { id } });
  assert.equal(removed.status, 200, await removed.clone().text());
  release();
  assert.equal((await issue).status, 409);
  assert.equal(batches.size, 1); assert.equal(tickets.size, 1);
  assert.equal([...tickets.values()][0].revoked, true);
  assert.equal((await request("ticket", { auth: true, extra: "&id=" + id })).status, 404);
});

test("failed ticket cancellation keeps a deletion tombstone and retries cannot resurrect its ticket", async () => {
  const { open, submit, request, hooks, tickets, stores } = fixture();
  await open();
  const requestId = randomUUID();
  const id = (await (await submit({ requestId })).json()).reference;
  const issued = await (await request("ticket", { method: "POST", auth: true, input: { id } })).json();
  hooks.beforeDb = ({ options }) => { if (options.method === "PATCH") throw new Error("cancellation unavailable"); };
  assert.equal((await request("delete", { method: "POST", auth: true, input: { id } })).status, 503);
  const data = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data;
  assert.equal(data.entries.length, 0); assert.equal(data.deleted[0].ticket.code, issued.ticket.code);
  const refreshed = await (await request("admin", { auth: true })).json();
  assert.deepEqual(refreshed.pendingTicketDeletions, [{ id, name: validAnswers.full_name }]);
  assert.ok(!JSON.stringify(refreshed).includes(issued.ticket.code));
  assert.equal((await submit({ requestId })).status, 409);
  hooks.beforeDb = null;
  assert.equal((await request("delete", { method: "POST", auth: true, input: { id } })).status, 200);
  assert.equal(tickets.get(issued.ticket.id).revoked, true);
  assert.deepEqual((await (await request("admin", { auth: true })).json()).pendingTicketDeletions, []);
  assert.equal((await request("ticket", { method: "POST", auth: true, input: { id } })).status, 404);
});

test("idempotent submission summary retains its original event details after the event is edited", async () => {
  const { open, submit, events } = fixture();
  events[0].location = "Eczacılık Fakültesi";
  await open();
  const requestId = randomUUID();
  const first = await (await submit({ requestId })).json();
  events[0].title = "Yeni başlık"; events[0].time = "14:00"; events[0].location = "Yeni yer";
  assert.deepEqual(await (await submit({ requestId })).json(), first);
  assert.equal(first.event.location, "Eczacılık Fakültesi");
});

test("photo questions and aligned option images normalize without changing legacy choices", async () => {
  const { open, request } = fixture();
  const image = "https://res.cloudinary.com/w2trki15/image/upload/v1/example.jpg";
  const form = await open("event-one", (current) => ({ ...withPhotos(current), fields: [
    ...current.fields, photoQuestion(),
    { id: "choice", type: "radio", label: "Renk", required: true,
      options: ["Seçenek 1", "Seçenek 2"], optionImages: [image, ""] },
  ] }));
  assert.equal(form.fields[3].type, "photo");
  assert.deepEqual(form.fields[4].options, ["Seçenek 1", "Seçenek 2"]);
  assert.deepEqual(form.fields[4].optionImages, [image, ""]);
  assert.ok(!Object.hasOwn(form.fields[1], "optionImages"));
  const publicForm = (await (await request()).json()).form;
  assert.deepEqual(publicForm.fields, form.fields);
  for (const images of [[image], [image, null], ["http://res.cloudinary.com/w2trki15/image/upload/x.jpg", ""],
    ["https://res.cloudinary.com/other/image/upload/x.jpg", ""],
    [image + "?download=1", ""], [image + "#x", ""],
    ["https://user:password@res.cloudinary.com/w2trki15/image/upload/x.jpg", ""],
    ["https://res.cloudinary.com:444/w2trki15/image/upload/x.jpg", ""],
    ["https://res.cloudinary.com.attacker.test/w2trki15/image/upload/x.jpg", ""]]) {
    const altered = structuredClone(form); altered.fields[4].optionImages = images;
    assert.equal((await request("form", { auth: true, method: "POST", input: altered })).status, 400);
  }
  const empty = structuredClone(form); empty.fields[4].optionImages = ["", ""];
  assert.ok(!Object.hasOwn((await (await request("form", { auth: true, method: "POST", input: empty })).json()).form.fields[4], "optionImages"));
  const invalidPhoto = structuredClone(form); invalidPhoto.fields[3].optionImages = [];
  assert.equal((await request("form", { auth: true, method: "POST", input: invalidPhoto })).status, 400);
});

test("private photo uploads enforce required fields, actual images and the shared file budget", async () => {
  const { open, submit, request, stores } = fixture();
  await open("event-one", withPhotos);
  assert.equal((await submit()).status, 400);
  assert.equal((await submit({ answers: { ...validAnswers, portrait: "fake.png" }, photos: { portrait: { bytes: png } } })).status, 400);
  assert.equal((await submit({ photos: { portrait: { bytes: png }, stale: { bytes: png } } })).status, 400);
  for (const bytes of [pdf, Buffer.from("<svg>fake</svg>"), Buffer.from("not a photo"), png.subarray(0, -1)])
    assert.equal((await submit({ photos: { portrait: { bytes, mime: "image/jpeg" } } })).status, 415);
  assert.equal((await submit({ photos: { portrait: { bytes: Buffer.alloc(0) } } })).status, 415);
  const padded = Buffer.concat([png, Buffer.alloc(RECEIPT_MAX_BYTES / 2 - png.length)]);
  const overflow = await submit({ receipt: padded, photos: { portrait: { bytes: padded }, optional: { bytes: png } } });
  assert.equal(overflow.status, 413); assert.match((await overflow.json()).error, /toplam/);
  assert.equal((await (await request("admin", { auth: true })).json()).entries.length, 0);
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE)?.size || 0, 0);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE)?.size || 0, 0);
});

test("photo metadata and CSV use safe names while originals are available only through the private endpoint", async () => {
  const { open, submit, request, stores, events } = fixture();
  await open("event-one", (form) => ({ ...withPhotos(form), receipt: { enabled: false, required: false } }));
  const result = await submit({ photos: { portrait: { bytes: png, mime: "image/pjpeg", name: '../../resim".jpg' } } });
  assert.equal(result.status, 200);
  const { reference } = await result.json();
  const admin = await (await request("admin", { auth: true })).json();
  const entry = admin.entries[0];
  assert.deepEqual(entry.photos, { portrait: { name: "resim.png", mime: "image/png", size: png.length } });
  assert.equal(entry.answers.portrait, "resim.png"); assert.equal(entry.answers.optional, "");
  assert.ok(!JSON.stringify(entry).includes('"key"'));
  const get = (auth = true, field = "portrait") => request("photo", { auth, extra: `&id=${reference}&field_id=${field}` });
  assert.equal((await get(false)).status, 401);
  assert.equal((await get(true, "optional")).status, 404);
  assert.equal((await get(true, "constructor")).status, 404);
  const photo = await get(); assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.equal(photo.headers.get("cache-control"), "private, no-store");
  assert.equal(photo.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  const csv = await (await request("export", { auth: true })).text();
  assert.ok(csv.includes('"resim.png"'));
  const saved = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0];
  assert.ok(!csv.includes(saved.photos.portrait.key));
  const publicText = await (await request()).text(); assert.ok(!publicText.includes(reference));
  events.splice(0, 1); assert.equal((await get()).status, 200);
});

test("photo retries bind field IDs and canonical bytes but ignore renamed picker hints and edited live questions", async () => {
  const { open, submit, request, stores } = fixture();
  await open("event-one", withPhotos);
  const requestId = randomUUID();
  const accepted = await submit({ requestId, photos: { portrait: { bytes: png, name: "one.jpg", mime: "image/jpeg" } } });
  assert.equal(accepted.status, 200); const expected = await accepted.json();
  assert.deepEqual(await (await submit({ requestId, photos: { portrait: { bytes: png, name: "two.png", mime: "" } } })).json(), expected);
  for (const photos of [{ portrait: { bytes: jpeg } }, { optional: { bytes: png } }, {},
    { portrait: { bytes: png }, optional: { bytes: png } }])
    assert.equal((await submit({ requestId, photos })).status, 409);
  await open("event-one", (form) => ({ ...form, enabled: false, fields: [...form.fields,
    { id: "new", type: "text", label: "Yeni", required: true }] }));
  assert.deepEqual(await (await submit({ requestId, photos: { portrait: { bytes: png } } })).json(), expected);
  const entry = (await (await request("admin", { auth: true })).json()).entries[0];
  assert.equal(entry.answers.portrait, "one.png");
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 1);
});

test("legacy receipt-only fingerprints remain byte-for-byte unchanged when photos are absent", async () => {
  for (const receipt of [null, png]) {
    const { open, submit, stores } = fixture(); await open();
    const accepted = await submit({ receipt }); assert.equal(accepted.status, 200);
    const entry = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0];
    const stableAnswers = Object.keys(validAnswers).sort().map((key) => [key, validAnswers[key]]);
    const hash = (data) => createHash("sha256").update(data).digest("hex");
    const old = hash(JSON.stringify({ answers: stableAnswers, receipt: receipt ? ["image/png", hash(png)] : null }));
    assert.equal(entry.fingerprint, old); assert.ok(!Object.hasOwn(entry, "photos"));
  }
});

test("concurrent photo submissions preserve canonical uploads, changed content conflicts and capacity stays atomic", async () => {
  const { open, submit, request, stores } = fixture();
  await open("event-one", (form) => ({ ...withPhotos(form), maxRegistrations: 1 }));
  const requestId = randomUUID();
  const same = await Promise.all(Array.from({ length: 4 }, () =>
    submit({ requestId, receipt: png, photos: { portrait: { bytes: png }, optional: { bytes: jpeg } } })));
  assert.ok(same.every((result) => result.status === 200));
  assert.equal(new Set(await Promise.all(same.map(async (result) => (await result.json()).reference))).size, 1);
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 2);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  assert.equal((await submit({ requestId, receipt: png, photos: { portrait: { bytes: jpeg }, optional: { bytes: jpeg } } })).status, 409);
  assert.equal((await submit({ photos: { portrait: { bytes: png } } })).status, 409);
  const entry = (await (await request("admin", { auth: true })).json()).entries[0];
  for (const fieldId of ["portrait", "optional"])
    assert.equal((await request("photo", { auth: true, extra: `&id=${entry.id}&field_id=${fieldId}` })).status, 200);
});

test("partial private uploads are cleaned and conditional-create collisions never delete the existing file", async () => {
  const { open, submit, stores, hooks } = fixture(); await open("event-one", withPhotos);
  let count = 0;
  hooks.afterReceiptSet = ({ name }) => {
    if (name === REGISTRATION_PHOTO_STORE && ++count === 2) throw Error("lost upload response");
  };
  assert.equal((await submit({ receipt: png, photos: { portrait: { bytes: png }, optional: { bytes: jpeg } } })).status, 503);
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 0);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 0);
  hooks.afterReceiptSet = null;
  let protectedKey;
  hooks.beforeReceiptSet = ({ name, key, records }) => {
    if (name === REGISTRATION_PHOTO_STORE) {
      protectedKey = key; records.set(key, { etag: "existing", data: Uint8Array.from(jpeg) });
    }
  };
  assert.equal((await submit({ photos: { portrait: { bytes: png } } })).status, 503);
  assert.deepEqual(Buffer.from(stores.get(REGISTRATION_PHOTO_STORE).get(protectedKey).data), jpeg);
});

test("lost CAS responses retain accepted photos and unconfirmed ownership preserves potentially committed uploads", async () => {
  for (const unreadable of [false, true]) {
    const { open, submit, stores, hooks } = fixture(); await open("event-one", withPhotos);
    let wrote = false;
    hooks.afterSet = ({ name, key }) => {
      if (name === REGISTRATION_STORE && key.startsWith("state/")) { wrote = true; throw Error("lost commit"); }
    };
    if (unreadable) hooks.get = ({ name, key }) => {
      if (wrote && name === REGISTRATION_STORE && key.startsWith("state/")) throw Error("confirmation unavailable");
    };
    assert.equal((await submit({ receipt: png, photos: { portrait: { bytes: png }, optional: { bytes: jpeg } } })).status, unreadable ? 503 : 200);
    const entry = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0];
    assert.ok(entry); assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 2);
    for (const photo of Object.values(entry.photos)) assert.ok(stores.get(REGISTRATION_PHOTO_STORE).has(photo.key));
    assert.ok(stores.get(REGISTRATION_RECEIPT_STORE).has(entry.receipt.key));
  }
});

test("photo tombstones deny access immediately and deletion retries remove leftover private files", async () => {
  const { open, submit, request, stores, hooks, getStore } = fixture(); await open("event-one", withPhotos);
  const requestId = randomUUID();
  const { reference } = await (await submit({ requestId, photos: { portrait: { bytes: png }, optional: { bytes: jpeg } } })).json();
  const original = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.entries[0];
  await getStore(REGISTRATION_STORE).setJSON(entryKey("event-one", reference), original);
  hooks.afterSet = ({ name, key, data }) => {
    if (name === REGISTRATION_STORE && key.startsWith("state/") && data.deleted.length) {
      hooks.afterSet = null; throw Error("lost delete response");
    }
  };
  hooks.beforeDelete = () => { throw Error("cleanup unavailable"); };
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: reference } })).status, 200);
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 2);
  for (const fieldId of ["portrait", "optional"])
    assert.equal((await request("photo", { auth: true, extra: `&id=${reference}&field_id=${fieldId}` })).status, 404);
  assert.equal((await submit({ requestId, photos: { portrait: { bytes: png } } })).status, 409);
  const tombstone = stores.get(REGISTRATION_STORE).get(registrationStateKey("event-one")).data.deleted[0];
  assert.deepEqual(tombstone.photoKeys.sort(), Object.values(original.photos).map((photo) => photo.key).sort());
  hooks.beforeDelete = null;
  assert.equal((await request("delete", { auth: true, method: "POST", input: { id: reference } })).status, 200);
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 0);
  assert.ok(!stores.get(REGISTRATION_STORE).has(entryKey("event-one", reference)));
});

test("an administrator changing photo questions during upload wins the same CAS fence without leaving files or filling a slot", async () => {
  const { open, submit, stores, hooks, request } = fixture();
  await open("event-one", (form) => ({ ...withPhotos(form), maxRegistrations: 1 }));
  let edited = false;
  hooks.afterReceiptSet = async ({ name }) => {
    if (name === REGISTRATION_PHOTO_STORE && !edited) {
      edited = true;
      await open("event-one", (form) => ({ ...form, maxRegistrations: 1, fields: [...form.fields, photoQuestion("replacement")] }));
    }
  };
  const result = await submit({ receipt: png, photos: { portrait: { bytes: png } } });
  assert.equal(result.status, 400);
  assert.equal(stores.get(REGISTRATION_PHOTO_STORE).size, 0);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 0);
  const admin = await (await request("admin", { auth: true })).json();
  assert.equal(admin.entries.length, 0); assert.equal(admin.form.fields.at(-1).id, "replacement");
  assert.equal((await (await request()).json()).full, false);
  assert.equal((await submit({ photos: { replacement: { bytes: png } } })).status, 200);
});

test("emoji filenames survive the truncation boundary and malformed legacy names still download with valid UTF-8 headers", async () => {
  const { open, submit, request, getStore } = fixture();
  await open("event-one", withPhotos);
  const filename = "a".repeat(149) + "🌸" + "z.png";
  const expectedName = "a".repeat(149) + "🌸.png";
  const result = await submit({ receipt: png, filename, photos: { portrait: { bytes: png, name: filename } } });
  assert.equal(result.status, 200); const { reference } = await result.json();
  const admin = await (await request("admin", { auth: true })).json();
  assert.equal(admin.entries[0].receipt.name, expectedName);
  assert.equal(admin.entries[0].photos.portrait.name, expectedName);
  const download = (action) => request(action, { auth: true,
    extra: `&id=${reference}${action === "photo" ? "&field_id=portrait" : ""}` });
  for (const action of ["receipt", "photo"]) {
    const file = await download(action); assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
    const encoded = file.headers.get("content-disposition").split("filename*=UTF-8''")[1];
    assert.equal(decodeURIComponent(encoded), expectedName);
  }
  const store = getStore(REGISTRATION_STORE);
  const state = await store.get(registrationStateKey("event-one"), { type: "json" });
  const entry = state.entries[0];
  const legacyName = "a".repeat(149) + "\uD83C.png";
  entry.receipt.name = legacyName; entry.photos.portrait.name = legacyName;
  await store.setJSON(registrationStateKey("event-one"), state);
  for (const action of ["receipt", "photo"]) {
    const file = await download(action); assert.equal(file.status, 200);
    const encoded = file.headers.get("content-disposition").split("filename*=UTF-8''")[1];
    assert.equal(decodeURIComponent(encoded), "a".repeat(149) + "\uFFFD.png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  }
});
