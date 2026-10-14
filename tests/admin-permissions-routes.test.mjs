import { after, test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_PERMISSIONS, signedAdminCookie } from "../netlify/lib/security.mjs";
import { ADMIN_STORE, ADMIN_ACCOUNTS_KEY, initialAccounts, normalizedPermissions, passwordRecord } from "../netlify/lib/admin-auth.mjs";
import { createAccountsHandler } from "../netlify/functions/accounts.mjs";
import { createHandler as createRafflesHandler } from "../netlify/functions/raffles.mjs";
import { createCommunityHandler } from "../netlify/functions/community.mjs";
import { createTicketDesignHandler } from "../netlify/functions/ticket-design.mjs";
import { createSiteContentHandler } from "../netlify/functions/site-content.mjs";

const previous = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PASSWORD = "route-permissions-test-only-password";
after(() => { if (previous === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous; });
const origin = "https://site.test";
const testPassword = passwordRecord("delegated-test-only-password");

function fixture(permissions, treasurer = false) {
  const state = initialAccounts(), account = treasurer ? state.accounts[0] : {
    id: "delegate", username: "delegate", name: "Delegated administrator", role: "admin", fixedPreset: false,
    version: "delegate-version", active: true, permissions: normalizedPermissions(permissions), ...testPassword,
  };
  if (treasurer) Object.assign(account, { active: true, ...testPassword });
  else state.accounts.push(account);
  const cookie = signedAdminCookie(new Request(origin), account).split(";")[0];
  const adminStore = name => {
    assert.equal(name, ADMIN_STORE);
    return { async get(key) { return key === ADMIN_ACCOUNTS_KEY ? structuredClone(state) : null; } };
  };
  let businessCalls = 0;
  const forbiddenRead = () => { businessCalls++; throw Error("Business storage must not be accessed before authorization"); };
  const routes = {
    accounts: createAccountsHandler({ read: forbiddenRead, auth: forbiddenRead, events: forbiddenRead, moderation: forbiddenRead, store: forbiddenRead, adminStore }),
    raffles: createRafflesHandler({ read: forbiddenRead, events: forbiddenRead, checkins: forbiddenRead, registrations: forbiddenRead, store: forbiddenRead, adminStore }),
    community: createCommunityHandler({ read: forbiddenRead, events: forbiddenRead, store: forbiddenRead, moderation: forbiddenRead, adminStore }),
    design: createTicketDesignHandler({ getStore: forbiddenRead, readEvents: forbiddenRead, adminStore }),
    instagram: createSiteContentHandler({ getStore: forbiddenRead, adminStore }),
  };
  async function request(route, path, method = "GET", data = {}) {
    return routes[route](new Request(origin + path, {
      method, headers: { cookie, origin, "Content-Type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(data) }),
    }));
  }
  return { request, businessCalls: () => businessCalls };
}

test("Sayman cannot access other private sections or invoke their mutations by calling their API directly", async () => {
  const f = fixture([], true);
  const attempts = [
    ["accounts", "/api/accounts"], ["accounts", "/api/accounts?action=detail&id=someone"],
    ["accounts", "/api/accounts?action=visibility", "POST"],
    ["raffles", "/api/raffles?eventId=event"], ["raffles", "/api/raffles", "POST"], ["raffles", "/api/raffles", "DELETE"],
    ["community", "/api/community?action=batches"], ["community", "/api/community?action=batch&id=batch"],
    ["community", "/api/community?action=batch", "POST"], ["community", "/api/community?action=revoke", "POST"],
    ["community", "/api/community?action=admin"], ["community", "/api/community?action=member&id=member", "DELETE"],
    ["design", "/api/ticket-design?event_id=event"], ["design", "/api/ticket-design?event_id=event", "POST"],
    ["design", "/api/ticket-design?event_id=event", "DELETE"], ["instagram", "/api/site-content", "POST"],
  ];
  for (const [route, path, method] of attempts) assert.equal((await f.request(route, path, method)).status, 403, path);
  assert.equal(f.businessCalls(), 0);
});

test("read-only administrators cannot mutate accounts, raffles, ticket batches or Instagram, even with crafted requests", async () => {
  const f = fixture(["accounts.view", "raffles.view", "tickets.view", "instagram.view"]);
  for (const [route, path, method] of [
    ["accounts", "/api/accounts?action=visibility", "POST"], ["raffles", "/api/raffles", "POST"],
    ["raffles", "/api/raffles?action=prize", "POST"], ["raffles", "/api/raffles", "DELETE"],
    ["community", "/api/community?action=batch", "POST"], ["community", "/api/community?action=revoke", "POST"],
    ["design", "/api/ticket-design?event_id=event", "POST"], ["design", "/api/ticket-design?event_id=event", "DELETE"],
    ["instagram", "/api/site-content", "POST"],
  ]) assert.equal((await f.request(route, path, method)).status, 403, path);
  assert.equal(f.businessCalls(), 0);
});

test("all delegated capabilities still do not grant legacy owner-only account/member deletion or moderation access", async () => {
  const f = fixture([...ADMIN_PERMISSIONS]);
  for (const [path, method] of [
    ["/api/community?action=admin", "GET"], ["/api/community?action=member&id=member", "DELETE"],
    ["/api/community?action=member", "POST"], ["/api/community?action=moderate", "POST"],
  ]) assert.equal((await f.request("community", path, method)).status, 403, path);
  assert.equal(f.businessCalls(), 0);
});
