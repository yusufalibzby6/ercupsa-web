import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createCommunityHandler } from "../netlify/functions/community.mjs";
import { adminLogin } from "../netlify/lib/security.mjs";

const previousPassword = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "community-status-unit-admin-password";
after(() => {
  if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = previousPassword;
});
const origin = "https://site.test";
const cookie = adminLogin(new Request(origin, {
  headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
})).split(";")[0];

function fixture() {
  const state = {
    batch: { id: "batch-one", event_id: "event-one", event_title: "Etkinlik", codes: [] },
    tickets: [
      { id: "claimed-only", code_hash: "a", claimed_at: "2026-10-08T10:00:00Z", revoked: false },
      { id: "unclaimed-entered", code_hash: "b", claimed_at: null, revoked: false },
      { id: "claimed-entered", code_hash: "c", claimed_at: "2026-10-08T10:00:00Z", revoked: false },
      { id: "revoked", code_hash: "d", claimed_at: null, revoked: true },
    ],
    entries: [
      { ticketId: "unclaimed-entered", enteredAt: "2026-10-08T17:00:00Z", name: "Private person", operatorId: "private-operator" },
      { ticketId: "claimed-entered", enteredAt: "2026-10-08T17:01:00Z" },
    ],
    reads: [], storeReads: [], failStore: false,
  };
  const read = async (path, options) => {
    state.reads.push({ path, options });
    if (path.startsWith("ticket_batches?")) return state.batch ? [state.batch] : [];
    if (options?.method === "PATCH") return [];
    if (path.startsWith("tickets?")) return structuredClone(state.tickets);
    throw new Error("Unexpected database request");
  };
  const storage = {
    async get(key) {
      state.storeReads.push(key);
      if (state.failStore) throw new Error("Private storage connection details");
      return { entries: structuredClone(state.entries) };
    },
  };
  const handler = createCommunityHandler({ read, store: () => storage });
  const request = async ({ action = "batch", method = "GET", auth = true, input } = {}) => {
    const result = await handler(new Request(`${origin}/api/community?action=${action}&id=batch-one`, {
      method,
      headers: { Origin: origin, ...(auth ? { cookie } : {}), ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }));
    return { status: result.status, data: await result.json() };
  };
  return { state, request };
}

test("admin batch status separates account claims from authoritative gate entry records", async () => {
  const { state, request } = fixture();
  const { status, data } = await request();
  assert.equal(status, 200);
  assert.equal(data.checkins_available, true);
  assert.deepEqual(state.storeReads, ["checkins/events/event-one.json"]);
  assert.deepEqual(data.tickets.map(({ id, claimed_at, entered_at, revoked }) => ({ id, claimed_at, entered_at, revoked })), [
    { id: "claimed-only", claimed_at: "2026-10-08T10:00:00Z", entered_at: null, revoked: false },
    { id: "unclaimed-entered", claimed_at: null, entered_at: "2026-10-08T17:00:00Z", revoked: false },
    { id: "claimed-entered", claimed_at: "2026-10-08T10:00:00Z", entered_at: "2026-10-08T17:01:00Z", revoked: false },
    { id: "revoked", claimed_at: null, entered_at: null, revoked: true },
  ]);
  assert.ok(!JSON.stringify(data).includes("Private person"));
  assert.ok(!JSON.stringify(data).includes("private-operator"));
});

test("check-in storage failure preserves claim information while making entry status unknown", async () => {
  const { state, request } = fixture();
  state.failStore = true;
  const { status, data } = await request();
  assert.equal(status, 200);
  assert.equal(data.checkins_available, false);
  assert.ok(data.tickets.every(ticket => ticket.entered_at === null));
  assert.equal(data.tickets[0].claimed_at, state.tickets[0].claimed_at);
  assert.ok(!JSON.stringify(data).includes("Private storage"));
});

test("malformed check-in records cannot be presented as a verified entry state", async () => {
  for (const entries of [{ unexpected: true }, [{ ticketId: "claimed-only", enteredAt: "invalid date" }], [null]]) {
    const { state, request } = fixture();
    state.entries = entries;
    const { status, data } = await request();
    assert.equal(status, 200);
    assert.equal(data.checkins_available, false);
    assert.ok(data.tickets.every(ticket => ticket.entered_at === null));
  }
});

test("batch status remains admin-only and unavailable batches never query gate storage", async () => {
  const { state, request } = fixture();
  assert.equal((await request({ auth: false })).status, 401);
  assert.equal(state.reads.length, 0);
  assert.equal(state.storeReads.length, 0);
  state.batch = null;
  assert.equal((await request()).status, 404);
  assert.equal(state.storeReads.length, 0);
});

test("clearer ticket states preserve the restriction that only unclaimed tickets can be revoked", async () => {
  const { state, request } = fixture();
  assert.equal((await request({ action: "revoke", method: "POST", input: { id: "claimed-only" } })).status, 200);
  assert.deepEqual(state.reads, [{
    path: "tickets?id=eq.claimed-only&claimed_at=is.null",
    options: { method: "PATCH", data: { revoked: true } },
  }]);
});
