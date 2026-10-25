import { test, expect } from "@playwright/test";

const owner = { id: "owner", username: "basadmin", name: "Baş admin", role: "owner", permissions: [] };
const principal = permissions => ({ id: "assistant-one", username: "duzenleyici", name: "Etkinlik sorumlusu", role: "admin", permissions });
const event = { id: "role-event", title: "Yetki etkinliği", category: "Konferans", date: "2099-10-20", time: "15:30", location: "Fakülte", published: true, revision: "event-rev-1", images: [], registrationMode: "native", registrationEnabled: true };
const preset = { id: "sayman", username: "sayman", name: "Sayman", role: "treasurer", fixedPreset: true, active: false, hasPassword: false, permissions: ["registrations.view", "registrations.receipts"] };
async function fixture(page, { session = owner, holdProbe = false, holdUsers = false } = {}) {
  const state = { requests: [], writes: [], accounts: [preset], revision: "users-rev-1", session, probeRequested: false, usersRequested: false, logoutFails: false };
  let releaseProbe, releaseUsers;
  const probe = holdProbe ? new Promise(resolve => { releaseProbe = resolve; }) : null;
  const users = holdUsers ? new Promise(resolve => { releaseUsers = resolve; }) : null;
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), action = url.searchParams.get("action"), method = request.method();
    state.requests.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/admin-auth") {
      if (action === "session") { const oldSession = state.session; state.probeRequested = true; if (probe) await probe; return route.fulfill({ json: { session: oldSession } }); }
      if (action === "login") { state.writes.push(request.postDataJSON()); state.session = session || owner; return route.fulfill({ json: { session: state.session } }); }
      if (action === "logout") { if (state.logoutFails) return route.fulfill({ status: 503, json: { error: "Bağlantı kesildi" } }); state.session = null; return route.fulfill({ json: { session: null } }); }
    }
    if (url.pathname === "/api/admin-users") {
      if (method === "GET") { state.usersRequested = true; if (users) await users; return route.fulfill({ json: { accounts: state.accounts, revision: state.revision, availablePermissions: [] } }); }
      const body = method === "DELETE" ? { id: url.searchParams.get("id"), expectedRevision: url.searchParams.get("expectedRevision") } : request.postDataJSON();
      state.writes.push(body);
      expect(body.expectedRevision).toBe(state.revision);
      let account;
      if (method === "POST") { account = { ...body, id: "new-admin", role: "admin", fixedPreset: false, hasPassword: true }; delete account.password; state.accounts.push(account); }
      if (method === "PUT") { account = { ...state.accounts.find(item => item.id === body.id), ...body, hasPassword: true }; delete account.password; state.accounts = state.accounts.map(item => item.id === account.id ? account : item); }
      if (method === "DELETE") state.accounts = state.accounts.filter(item => item.id !== body.id);
      state.revision += "-next";
      return route.fulfill({ json: { ...(account ? { account } : {}), accounts: state.accounts, revision: state.revision, availablePermissions: [] } });
    }
    if (url.pathname === "/api/events") {
      if (action === "trash") return route.fulfill({ json: { trash: [{ id: "old-event", event: { title: "Eski etkinlik", date: "2026-10-01" }, revision: "trash-rev-1", source: "trash" }], recoverable: [] } });
      if (method !== "GET") { state.writes.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { events: [event] } });
    }
    if (url.pathname === "/api/community" && action === "batches") return route.fulfill({ json: { batches: [] } });
    if (url.pathname === "/api/ticket-design") return route.fulfill({ json: { design: null } });
    if (url.pathname === "/api/site-content") return route.fulfill({ json: { slots: Array.from({ length: 4 }, (_, index) => ({ id: index + 1, url: "" })) } });
    if (url.pathname === "/api/registrations" && action === "catalog") return route.fulfill({ json: { events: [event], registrations: [], classes: [] } });
    if (url.pathname === "/api/registrations" && action === "config") return route.fulfill({ json: { event, config: { enabled: true, description: "", fields: [], receipt: { enabled: true, required: false } } } });
    if (url.pathname === "/api/registrations" && action === "list") return route.fulfill({ json: { entries: [], stats: { total: 0 }, event } });
    return route.fulfill({ status: 501, json: { error: "Unexpected role fixture endpoint" } });
  });
  await page.goto("/admin.html");
  return { state, releaseProbe, releaseUsers };
}

test("a missing verified session keeps the panel closed and never probes private catalogs", async ({ page }) => {
  const { state } = await fixture(page, { session: null });
  await expect(page.locator("#login")).toBeVisible();
  await expect.poll(() => state.probeRequested).toBe(true);
  await expect(page.locator("#app")).not.toBeVisible();
  expect(state.requests).toEqual(["GET /api/admin-auth?action=session"]);
});

test("username and password login wins over a delayed initial session probe", async ({ page }) => {
  const { state, releaseProbe } = await fixture(page, { session: null, holdProbe: true });
  await expect.poll(() => state.probeRequested).toBe(true);
  await page.locator("#username").fill("basadmin"); await page.locator("#password").fill("correct-test-password");
  await page.locator("#loginBtn").click(); await expect(page.locator("#app")).toBeVisible();
  expect(state.writes[0]).toEqual({ username: "basadmin", password: "correct-test-password" });
  releaseProbe();
  await expect(page.locator("#password")).toHaveValue("");
  await expect(page.locator("#adminSessionRole")).toHaveText("Baş admin");
  await expect(page.locator("#app")).toBeVisible();
});

test("Instagram-only account gets one tab and no event, ticket or users requests", async ({ page }) => {
  const { state } = await fixture(page, { session: principal(["instagram.view"]) });
  await expect(page.locator("#app")).toBeVisible(); await expect(page.locator("#instagramTab")).toBeVisible();
  await expect(page.locator(".admin-navigation [data-tab]:visible")).toHaveCount(1);
  await expect(page.locator('[data-tab="adminUsers"]')).not.toBeVisible();
  await page.evaluate(() => document.querySelector('[data-tab="tickets"]').click());
  await expect(page.locator("#ticketsTab")).not.toBeVisible();
  expect(state.requests.some(value => /\/api\/(events|community|ticket-design|admin-users)/.test(value))).toBe(false);
});

test("event publication permission allows unpublishing while delete, trash and editing remain unavailable", async ({ page }) => {
  const { state } = await fixture(page, { session: principal(["events.view", "events.publish"]) });
  await expect(page.locator('#eventsList [data-action="publish"]')).toBeVisible();
  await expect(page.locator('#eventsList [data-action="edit"], #eventsList [data-action="delete"]')).toHaveCount(0);
  await expect(page.locator("#newBtn")).not.toBeVisible(); await expect(page.locator("#eventTrashToggle")).not.toBeVisible();
  await page.locator('#eventsList [data-action="publish"]').click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toEqual({ id: event.id, published: false, expectedRevision: event.revision });
});

test("owner can activate the fixed readonly Sayman preset without changing its permissions", async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="adminUsers"]').click();
  await page.locator('[data-admin-user="sayman"]').click();
  await expect(page.locator("#adminUserUsername")).toBeDisabled();
  await expect(page.locator('#adminUserPermissions [data-permission="registrations.receipts"]')).toBeDisabled();
  await expect(page.locator("#adminUserDelete")).not.toBeVisible();
  await page.locator("#adminUserPassword").fill("sayman-secure-test-password");
  await page.locator("#adminUserActive").check(); await page.locator("#adminUserSave").click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ id: "sayman", active: true, password: "sayman-secure-test-password", expectedRevision: "users-rev-1" });
  expect(state.writes[0]).not.toHaveProperty("permissions"); expect(state.writes[0]).not.toHaveProperty("username");
  await expect(page.locator("#adminUserPassword")).toHaveValue("");
});

test("owner assigns separate module permissions and new account never receives deletion permissions", async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.locator("#app")).toBeVisible(); await page.locator('[data-tab="adminUsers"]').click();
  await expect(page.locator("#adminUserSave")).toBeEnabled();
  await page.locator("#adminUserName").fill("Sosyal medya ekibi"); await page.locator("#adminUserUsername").fill("sosyalmedya");
  await page.locator("#adminUserPassword").fill("secure-social-test-password");
  await page.locator('[data-permission="instagram.manage"]').check();
  await expect(page.locator('[data-permission="instagram.view"]')).toBeChecked();
  await page.locator('[data-permission="events.view"]').check(); await page.locator("#adminUserSave").click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].permissions).toEqual(["events.view", "instagram.view", "instagram.manage"]);
  expect(state.writes[0].permissions.some(value => value.includes("delete"))).toBe(false);
});

test("private owner account response arriving after logout cannot repopulate the manager", async ({ page }) => {
  const { state, releaseUsers } = await fixture(page, { holdUsers: true });
  await expect(page.locator("#app")).toBeVisible(); await page.locator('[data-tab="adminUsers"]').click();
  await expect.poll(() => state.usersRequested).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  releaseUsers(); await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#adminUsersList")).toHaveText("");
  await expect(page.locator("#adminUserPassword")).toHaveValue(""); await expect(page.locator("#adminUserSave")).toBeDisabled();
});

test("owner permanent trash deletion requires exact event title and sends archive revision", async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.locator("#app")).toBeVisible(); await page.locator("#eventTrashToggle").click();
  page.once("dialog", dialog => dialog.accept("Yanlış ad")); await page.locator('[data-purge-id="old-event"]').click();
  await expect(page.locator("#eventTrashMessage")).toContainText("adı uyuşmadığı"); expect(state.writes).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept("Eski etkinlik")); await page.locator('[data-purge-id="old-event"]').click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toEqual({ id: "old-event", expectedRevision: "trash-rev-1", confirmation: "Eski etkinlik" });
});

test("logout clears private UI immediately and offers retry when the logout request fails", async ({ page }) => {
  const { state } = await fixture(page); await expect(page.locator("#app")).toBeVisible();
  state.logoutFails = true; await page.locator("#adminLogout").click();
  await expect(page.locator("#login")).toBeVisible(); await expect(page.locator("#eventsList")).toHaveText("");
  await expect(page.locator("#adminLogoutRetry")).toBeVisible(); state.logoutFails = false;
  await page.locator("#adminLogoutRetry").click(); await expect(page.locator("#adminLogoutRetry")).not.toBeVisible();
});

test("payment permissions require a deliberate registration-view grant and preserve the unfinished account", async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="adminUsers"]').click();
  await expect(page.locator("#adminUserSave")).toBeEnabled();
  await expect(page.locator("#adminPaymentPermissionHelp")).toContainText("katılımcı bilgilerine erişim verir");
  await page.locator("#adminUserName").fill("Ödeme sorumlusu");
  await page.locator("#adminUserUsername").fill("odemesorumlusu");
  await page.locator("#adminUserPassword").fill("synthetic-payment-password");
  await page.locator('[data-permission="payments.manage"]').check();
  await expect(page.locator('[data-permission="payments.view"]')).toBeChecked();
  await expect(page.locator('[data-permission="registrations.view"]')).not.toBeChecked();
  await page.locator("#adminUserSave").click();
  await expect(page.locator("#adminUsersMessage")).toContainText("Kayıtları görüntüle");
  expect(state.writes).toHaveLength(0);
  await expect(page.locator("#adminUserName")).toHaveValue("Ödeme sorumlusu");
  await expect(page.locator("#adminUserUsername")).toHaveValue("odemesorumlusu");
  await expect(page.locator("#adminUserPassword")).toHaveValue("synthetic-payment-password");
  await expect(page.locator('[data-permission="payments.manage"]')).toBeChecked();
  await expect(page.locator('[data-permission="registrations.view"]')).toBeFocused();
  await page.locator('[data-permission="registrations.view"]').check();
  await page.locator("#adminUserSave").click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].permissions).toEqual(["registrations.view", "payments.view", "payments.manage"]);
  await expect(page.locator("#adminUsersMessage")).toContainText("Yönetici hesabı oluşturuldu");
});
