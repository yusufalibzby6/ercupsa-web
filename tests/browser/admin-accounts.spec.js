import { mockOwnerSession } from "./admin-session-fixture.js";
import { test, expect } from "@playwright/test";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
function deferred() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function fixture(page, { consent = true, checkinsAvailable = true } = {}) {
  const state = {
    listRequests: [], detailRequests: [], mutations: [], holdList: null, holdDetail: null, holdMutation: null,
    accounts: [
      { id: firstId, name: "Ayşe Öğrenci", email: "ayse@example.test", createdAt: "2026-10-12T12:00:00Z", hasProfile: true, publicName: consent, publicNameBlocked: false },
      { id: secondId, name: "", email: "new@example.test", createdAt: "2026-10-13T09:00:00Z", hasProfile: false, publicName: false, publicNameBlocked: false },
    ],
  };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked accounts fixture" } }));
  await mockOwnerSession(page, { state });
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { batches: [] } }));
  await page.route("**/api/accounts*", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); state.mutations.push(body);
      if (state.holdMutation) await state.holdMutation;
      const current = state.accounts.find(value => value.id === body.userId);
      current.publicNameBlocked = body.hidden;
      return route.fulfill({ json: { ok: true, userId: body.userId, publicNameBlocked: body.hidden } });
    }
    const id = url.searchParams.get("userId");
    if (id) {
      state.detailRequests.push(id);
      if (state.holdDetail) await state.holdDetail;
      const account = state.accounts.find(value => value.id === id);
      return route.fulfill({ json: {
        account, claimTotal: 3, entryTotal: checkinsAvailable ? 1 : null, checkinsAvailable,
        attendance: [
          { eventId: "one", title: "Atölye <img src=x onerror=window.injected=true>", date: "2026-10-10", time: "18:00", location: "Fakülte", claimedAt: "2026-10-10T14:00:00Z", enteredAt: "2026-10-10T15:00:00Z", archived: false },
          { eventId: "two", title: "Konferans", date: "2026-10-11", claimedAt: "2026-10-11T14:00:00Z", enteredAt: null, archived: true },
          { eventId: "three", title: "Gezi", date: "2026-10-12", claimedAt: "2026-10-12T14:00:00Z", enteredAt: null, archived: false },
        ],
      } });
    }
    const pageNumber = Number(url.searchParams.get("page") || 1), search = url.searchParams.get("search") || "";
    state.listRequests.push({ page: pageNumber, search });
    if (state.holdList) await state.holdList;
    const accounts = search ? state.accounts.filter(value => `${value.name} ${value.email}`.includes(search)) : [state.accounts[pageNumber === 2 ? 1 : 0]];
    return route.fulfill({ json: { accounts, page: pageNumber, pageSize: 50, total: search ? accounts.length : 51, pages: search ? 1 : 2 } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#createBatch")).toBeDisabled();
  return state;
}
async function openAccounts(page) {
  await page.locator('[data-tab="accounts"]').click();
  await expect(page.locator("#accountsList .accounts-row")).toHaveCount(1);
}
async function openFirst(page) {
  await openAccounts(page);
  await page.locator(`[data-account-id="${firstId}"]`).click();
  await expect(page.locator("#accountDetail")).toBeVisible();
}
async function releaseResponse(page, hold, predicate) {
  const response = page.waitForResponse(predicate); hold.release(); await response;
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

test("accounts are loaded only on demand, searched and paginated including unfinished profiles", async ({ page }) => {
  const state = await fixture(page);
  expect(state.listRequests).toEqual([]);
  await openAccounts(page);
  await expect(page.locator("#accountsList")).toContainText("Ayşe Öğrenci");
  await expect(page.locator("#accountsList")).toContainText("ayse@example.test");
  await expect(page.locator("#accountsCount")).toHaveText("51 site hesabı");
  await page.locator("#accountsNext").click();
  await expect(page.locator("#accountsList")).toContainText("Ad bilgisi henüz eklenmedi");
  await expect(page.locator("#accountsList")).toContainText("new@example.test");
  await expect(page.locator("#accountsPrevious")).toBeEnabled();
  await expect(page.locator("#accountsNext")).toBeDisabled();
  await page.getByLabel("Ad veya e-posta ara", { exact: true }).fill("ayse@example.test");
  await page.locator("#accountsSearchButton").click();
  await expect(page.locator("#accountsList")).toContainText("Ayşe Öğrenci");
  expect(state.listRequests.at(-1)).toEqual({ page: 1, search: "ayse@example.test" });
});

test("detail distinguishes QR claims from actual entries and safely renders event titles", async ({ page }) => {
  await fixture(page); await openFirst(page);
  await expect(page.locator("#accountDialogTitle")).toHaveText("Ayşe Öğrenci");
  await expect(page.locator("#accountEmail")).toHaveText("ayse@example.test");
  await expect(page.locator("#accountClaimTotal")).toHaveText("3");
  await expect(page.locator("#accountEntryTotal")).toHaveText("1");
  await expect(page.locator("#accountEvents .account-event")).toHaveCount(3);
  await expect(page.locator("#accountEvents")).toContainText("Giriş kaydı yok");
  await expect(page.locator("#accountEvents")).toContainText("Arşiv");
  await expect(page.locator("#accountEvents img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.locator("#accountDialogClose").click();
  await expect(page.locator("#accountDialog")).not.toBeVisible();
  await expect(page.locator("#accountEmail")).toHaveText("");
  await expect(page.locator("#accountEvents")).toHaveText("");
});

test("unavailable gate records show unknown status instead of claiming no entry", async ({ page }) => {
  await fixture(page, { checkinsAvailable: false }); await openFirst(page);
  await expect(page.locator("#accountEntryTotal")).toHaveText("Doğrulanamadı");
  await expect(page.locator("#accountEvents")).toContainText("Giriş durumu doğrulanamadı");
  await expect(page.locator("#accountEvents")).not.toContainText("Giriş kaydı yok");
  await expect(page.locator("#accountCheckinsNote")).toContainText("gelmediği anlamına gelmez");
});

test("hiding and unblocking a public name preserve the user's own consent", async ({ page }) => {
  const state = await fixture(page, { consent: false }); await openFirst(page);
  await expect(page.locator("#accountConsent")).toContainText("izin vermedi");
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#accountVisibilityToggle").click();
  await expect(page.locator("#accountModeration")).toContainText("Yönetici engeli açık");
  await expect(page.locator("#accountConsent")).toContainText("izin vermedi");
  await expect(page.locator("#accountsList")).toContainText("Yönetici tarafından gizlendi");
  await page.locator("#accountVisibilityToggle").click();
  await expect(page.locator("#accountModeration")).toContainText("Yönetici engeli yok");
  await expect(page.locator("#accountConsent")).toContainText("izin vermedi");
  await expect(page.locator("#accountsList")).toContainText("Kullanıcı izni yok");
  expect(state.mutations).toEqual([{ userId: firstId, hidden: true }, { userId: firstId, hidden: false }]);
});

test("dismissing the name moderation confirmation does not change the user", async ({ page }) => {
  const state = await fixture(page); await openFirst(page);
  page.on("dialog", dialog => dialog.dismiss());
  await page.locator("#accountVisibilityToggle").click();
  expect(state.mutations).toEqual([]);
  await expect(page.locator("#accountModeration")).toContainText("Yönetici engeli yok");
});

test("a delayed account list cannot repopulate private names and emails after logout", async ({ page }) => {
  const state = await fixture(page), hold = deferred(); state.holdList = hold.promise;
  await page.locator('[data-tab="accounts"]').click();
  await expect.poll(() => state.listRequests.length).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  await releaseResponse(page, hold, response => response.url().includes("/api/accounts?page="));
  await expect(page.locator("#accountsList")).toHaveText("");
  await expect(page.locator("#accountsCount")).toHaveText("");
  await expect(page.locator("#accountDialog")).not.toBeVisible();
  await expect(page.locator("#accountsSearchButton")).toBeDisabled();
});

test("a detail response arriving after close cannot restore private account details", async ({ page }) => {
  const state = await fixture(page), hold = deferred(); state.holdDetail = hold.promise;
  await openAccounts(page); await page.locator(`[data-account-id="${firstId}"]`).click();
  await expect.poll(() => state.detailRequests.length).toBe(1);
  await page.locator("#accountDialogClose").click();
  await releaseResponse(page, hold, response => response.url().includes("/api/accounts?userId="));
  await expect(page.locator("#accountDialogTitle")).toHaveText("Kullanıcı bilgileri");
  await expect(page.locator("#accountEmail")).toHaveText("");
  await expect(page.locator("#accountEvents")).toHaveText("");
});

test("a delayed account detail cannot survive logout", async ({ page }) => {
  const state = await fixture(page), hold = deferred(); state.holdDetail = hold.promise;
  await openAccounts(page); await page.locator(`[data-account-id="${firstId}"]`).click();
  await expect.poll(() => state.detailRequests.length).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  await releaseResponse(page, hold, response => response.url().includes("/api/accounts?userId="));
  await expect(page.locator("#accountDialog")).not.toBeVisible();
  await expect(page.locator("#accountEmail")).toHaveText("");
  await expect(page.locator("#accountEvents")).toHaveText("");
});

test("a pending moderation request cannot restore private data after logout", async ({ page }) => {
  const state = await fixture(page), hold = deferred(); state.holdMutation = hold.promise;
  await openFirst(page); page.on("dialog", dialog => dialog.accept());
  await page.locator("#accountVisibilityToggle").click();
  await expect.poll(() => state.mutations.length).toBe(1);
  await expect(page.locator("#accountVisibilityToggle")).toBeDisabled();
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  await releaseResponse(page, hold, response => response.url().includes("/api/accounts?action=visibility"));
  await expect(page.locator("#accountDialog")).not.toBeVisible();
  await expect(page.locator("#accountsList")).toHaveText("");
  await expect(page.locator("#accountEmail")).toHaveText("");
  await expect(page.locator("#accountDialogMessage")).toHaveText("");
});

test("reopening the same account during a pending change prevents duplicate requests and refreshes its result", async ({ page }) => {
  const state = await fixture(page), hold = deferred(); state.holdMutation = hold.promise;
  await openFirst(page); page.on("dialog", dialog => dialog.accept());
  await page.locator("#accountVisibilityToggle").click();
  await expect.poll(() => state.mutations.length).toBe(1);
  await page.locator("#accountDialogClose").click();
  await page.locator(`[data-account-id="${firstId}"]`).click();
  await expect(page.locator("#accountDetail")).toBeVisible();
  await expect(page.locator("#accountVisibilityToggle")).toBeDisabled();
  expect(state.mutations).toHaveLength(1);
  await releaseResponse(page, hold, response => response.url().includes("/api/accounts?action=visibility"));
  await expect(page.locator("#accountModeration")).toContainText("Yönetici engeli açık");
  await expect(page.locator("#accountVisibilityToggle")).toBeEnabled();
  expect(state.mutations).toHaveLength(1);
});

test("mobile account list and history fit the screen and switching tabs clears private data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page); await openFirst(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator("#accountDialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.locator("#accountDialogClose").click();
  await page.locator('[data-tab="events"]').click();
  await expect(page.locator("#accountsList")).toHaveText("");
  await expect(page.locator("#accountEmail")).toHaveText("");
});
