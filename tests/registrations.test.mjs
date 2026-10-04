import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRegistrationsHandler } from "../netlify/functions/registrations.mjs";
import { adminLogin } from "../netlify/lib/security.mjs";
import {
  CLASS_OPTIONS, RECEIPT_MAX_BYTES, REGISTRATION_MAX_BYTES, REGISTRATION_STORE,
  REGISTRATION_RECEIPT_STORE, defaultRegistrationForm, entryKey, formKey,
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
const validAnswers = { full_name: "Deniz Test", class_year: "2. Sınıf", phone: "+90 (555) 123 45 67" };

function fixture() {
  const stores = new Map();
  const calls = [];
  const hooks = {};
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
        const record = records.get(key);
        return record ? structuredClone(record) : null;
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
        if (options.onlyIfNew && records.has(key)) return { modified: false };
        const tag = String(++etag);
        records.set(key, { data: Uint8Array.from(data), etag: tag });
        await hooks.afterReceiptSet?.({ name, key, data, records });
        return { modified: true, etag: tag };
      },
      async delete(key) {
        calls.push({ name, action: "delete", key });
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
    now: () => new Date(clock), uuid: randomUUID });
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
    return request("submit", { method: "POST", eventId: options.eventId, form: data,
      headers: options.headers, extra: options.extra });
  };
  return { stores, calls, hooks, events, getStore, handler, request, open, submit,
    setClock: (value) => { clock = new Date(value); } };
}

test("administrator lists, configuration, statuses, summaries, exports and private receipts require signed cookies", async () => {
  const { request, calls } = fixture();
  for (const action of ["admin", "summary", "receipt", "export", "status", "form"]) {
    const result = await request(action, {
      method: ["status", "form"].includes(action) ? "POST" : "GET",
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
  assert.deepEqual((await (await request()).json()), { form: null, available: false });
  const saved = await open();
  assert.equal(saved.updatedAt, "2026-10-04T09:00:00.000Z");
  const mutations = [
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
    assert.deepEqual(stores.get(REGISTRATION_STORE).get(formKey("event-one")).data, saved);
  }
  for (const eventId of ["", "../event-one", "x/y"])
    assert.equal((await request("admin", { eventId, auth: true })).status, 400);
  assert.equal((await request("form", { eventId: "unknown", method: "POST", auth: true, input: saved })).status, 404);
});

test("availability uses Türkiye calendar day, not start time, and hides unpublished or removed events", async () => {
  const { request, open, submit, setClock, events } = fixture();
  for (const eventId of ["event-one", "hidden", "past"]) await open(eventId);
  assert.equal((await (await request()).json()).available, true);
  assert.equal((await submit()).status, 200);
  assert.equal((await (await request("form", { eventId: "past" })).json()).available, false);
  assert.equal((await submit({ eventId: "past" })).status, 409);
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
  assert.equal([...stores.get(REGISTRATION_STORE).keys()].filter((key) => key.startsWith("entries/")).length, 1);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
});

test("a native submission is idempotent, private, class-counted, approvable and exportable", async () => {
  const { open, submit, request, stores, calls } = fixture();
  await open();
  const requestId = randomUUID();
  const result = await submit({ requestId, receipt: png, filename: '../../dekont".png' });
  assert.equal(result.status, 200);
  const submitted = await result.json();
  assert.match(submitted.reference, /^[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(submitted).sort(), ["ok", "reference"]);
  assert.deepEqual(await (await submit({ requestId, receipt: png })).json(), submitted);
  assert.equal((await submit({ requestId, answers: { ...validAnswers, phone: "05559999999" }, receipt: png })).status, 409);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  const admin = await (await request("admin", { auth: true })).json();
  assert.deepEqual(admin.summary, { total: 1, pending: 1, approved: 0, rejected: 0,
    byClass: [{ classYear: "2. Sınıf", count: 1 }] });
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
  assert.equal((await request("status", { auth: true, method: "POST",
    input: { id: submitted.reference, status: "approved" } })).status, 200);
  const summary = await (await request("summary", { auth: true })).json();
  assert.equal(summary.events.find((event) => event.eventId === "event-one").approved, 1);
  assert.equal(summary.events.find((event) => event.eventId === "event-two").total, 0);
  assert.equal((await request("status", { auth: true, method: "POST",
    input: { id: submitted.reference, status: "attendance" } })).status, 400);
  const csv = await request("export", { auth: true });
  assert.match(csv.headers.get("content-disposition"), /attachment/);
  assert.match(await csv.text(), /Deniz Test/);
  const publicForm = await (await request()).json();
  assert.deepEqual(Object.keys(publicForm).sort(), ["available", "form"]);
  assert.ok(!JSON.stringify(publicForm).includes("Deniz Test"));
  assert.ok(calls.filter((call) => ["get", "getWithMetadata"].includes(call.action))
    .every((call) => call.options.consistency === "strong"));
});

test("receipt MIME signatures, disabled uploads, empty and oversized files are rejected", async () => {
  const { open, submit, request, stores } = fixture();
  await open();
  assert.equal((await submit({ receipt: png, mime: "image/jpeg" })).status, 415);
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

test("field snapshots, approvals and receipts survive form edits and event deletion", async () => {
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
  assert.equal((await request("status", { auth: true, method: "POST", input: { id, status: "approved" } })).status, 200);
  const summary = await (await request("summary", { auth: true })).json();
  assert.equal(summary.events.find((event) => event.eventId === "event-one").approved, 1);
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
      if (name === REGISTRATION_STORE && key.startsWith("entries/")) throw new Error("private token failure");
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
  assert.equal([...stores.get(REGISTRATION_STORE).keys()].filter((key) => key.startsWith("entries/")).length, 0);
});

test("uncertain entry writes preserve a potentially committed receipt rather than deleting participant data", async () => {
  const { open, submit, stores, hooks } = fixture();
  await open();
  let wroteEntry = false;
  hooks.afterSet = ({ name, key }) => {
    if (name === REGISTRATION_STORE && key.startsWith("entries/")) {
      wroteEntry = true;
      throw new Error("entry committed but response lost");
    }
  };
  hooks.get = ({ name, key }) => {
    if (wroteEntry && name === REGISTRATION_STORE && key.startsWith("entries/"))
      throw new Error("confirmation read temporarily unavailable");
  };
  assert.equal((await submit({ receipt: png })).status, 503);
  assert.equal(stores.get(REGISTRATION_RECEIPT_STORE).size, 1);
  const entry = [...stores.get(REGISTRATION_STORE).values()].find((record) => record.data.receipt?.key)?.data;
  assert.ok(entry);
  assert.ok(stores.get(REGISTRATION_RECEIPT_STORE).has(entry.receipt.key));
});
