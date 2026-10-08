import { test, expect } from "@playwright/test";

const draftKey = "ercupsa_event_drafts_v1";
const picture = (name) => ({ url: `https://res.cloudinary.com/w2trki15/image/upload/${name}.jpg`, publicId: name, width: 900, height: 600 });
const catalog = [
  { id: "draft-first", title: "Bilim atölyesi", category: "Atölye", date: "2026-10-20", time: "18:00", location: "Eczacılık Fakültesi", registrationUrl: "", description: "Kaydedilmiş açıklama.", published: true, poster: picture("poster-first").url, images: [picture("first"), picture("second")] },
  { id: "draft-second", title: "Araştırma buluşması", category: "Buluşma", date: "2026-10-22", time: "19:00", location: "Kayseri", registrationUrl: "", description: "İkinci etkinlik.", published: false, poster: "", images: [] },
];

async function fixture(page, { holdInitialCatalog = false, initialCatalogStatus = 200 } = {}) {
  const state = { events: structuredClone(catalog), writes: [], reads: 0, saveError: 0, authenticated: true, dialogs: [] };
  const initialCatalog = new Promise(resolve => { state.releaseInitialCatalog = resolve; });
  page.on("dialog", dialog => { state.dialogs.push(dialog.type()); dialog.accept(); });
  await page.addInitScript(() => {
    window.testUploads = [];
    window.testAdminReady = 0;
    document.addEventListener("admin-ready", () => { window.testAdminReady++; });
    window.cloudinary = { createUploadWidget(options, callback) { window.testUploads.push({ options, callback }); return { open() {} }; } };
  });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked API in event draft test" } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { members: [], submissions: [], batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.route("**/api/events*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.searchParams.get("action") === "logout") { state.authenticated = false; return route.fulfill({ json: { ok: true } }); }
    if (url.searchParams.get("action") === "auth") { state.authHadPassword = !!request.headers()["x-admin-password"]; state.authenticated = true; return route.fulfill({ json: { ok: true } }); }
    if (!state.authenticated) return route.fulfill({ status: 401, json: { error: "Yönetici oturumu sona erdi." } });
    if (request.method() === "GET") {
      state.reads++;
      const firstCatalog = state.reads === 1;
      if (holdInitialCatalog && firstCatalog) { state.initialCatalogPending = true; await initialCatalog; }
      if (firstCatalog && initialCatalogStatus !== 200) return route.fulfill({ status: initialCatalogStatus, json: { error: "Yönetici girişi gerekli." } });
      return route.fulfill({ json: { events: state.events } });
    }
    if (request.method() === "POST") {
      const event = request.postDataJSON().event;
      state.writes.push(structuredClone(event));
      if (state.saveError) return route.fulfill({ status: state.saveError, json: { error: "Etkinlik kaydedilemedi. Tekrar deneyin." } });
      event.id ||= "new-event";
      const index = state.events.findIndex(value => value.id === event.id);
      if (index >= 0) state.events[index] = event; else state.events.push(event);
      return route.fulfill({ json: { ok: true, event, events: state.events } });
    }
    return route.fulfill({ status: 405, json: { error: "Unsupported event fixture request" } });
  });
  await page.goto("/admin.html");
  if (!holdInitialCatalog) await expect(page.locator("#app")).toBeVisible();
  return state;
}
async function edit(page, id = "draft-first") {
  await page.locator(`[data-action="edit"][data-id="${id}"]`).click();
  await expect(page.locator("#formWrap")).toBeVisible();
}
async function savedDrafts(page) {
  return page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || "null"), draftKey);
}
async function uploadEvent(page, index, event, info) {
  await page.evaluate(({ index, event, info }) => window.testUploads[index].callback(null, { event, info }), { index, event, info });
}

test("event and new-event drafts keep fields, media ordering, preview and publication separately when switching, closing and refreshing", async ({ page }) => {
  const state = await fixture(page);
  await edit(page);
  await page.locator("#title").fill("Kaydedilmemiş bilim atölyesi");
  await page.locator("#description").fill("Henüz tamamlanmamış açıklama.");
  await page.locator("#published").uncheck();
  await page.locator('[data-photo="1"][data-move="-1"]').click();
  await page.locator("#previewBtn").click();
  await expect(page.locator("#preview")).toContainText("Henüz tamamlanmamış açıklama.");
  await edit(page, "draft-second");
  await page.locator("#location").fill("Henüz seçilen salon");
  await page.locator("#newBtn").click();
  await page.locator("#title").fill("Yeni etkinliğin taslağı");
  await page.locator("#registrationUrl").fill("https://henüz-tamamlanmadi");
  await edit(page);
  await expect(page.locator("#title")).toHaveValue("Kaydedilmemiş bilim atölyesi");
  await expect(page.locator("#published")).not.toBeChecked();
  await expect(page.locator("#posterPreview img")).toHaveAttribute("src", catalog[0].poster);
  await expect(page.locator("#photoThumbs img").first()).toHaveAttribute("src", picture("second").url);
  await expect(page.locator("#eventDraftNotice")).toContainText("geri yüklendi");
  await page.reload();
  await expect(page.locator("#title")).toHaveValue("Kaydedilmemiş bilim atölyesi");
  await expect(page.locator("#description")).toHaveValue("Henüz tamamlanmamış açıklama.");
  await expect(page.locator("#photoThumbs img").first()).toHaveAttribute("src", picture("second").url);
  expect(state.dialogs).toContain("beforeunload");
  await page.locator("#cancelBtn").click();
  await expect(page.locator("#formWrap")).toBeHidden();
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#formWrap")).toBeHidden();
  await edit(page, "draft-second");
  await expect(page.locator("#location")).toHaveValue("Henüz seçilen salon");
  await page.locator("#newBtn").click();
  await expect(page.locator("#title")).toHaveValue("Yeni etkinliğin taslağı");
  await expect(page.locator("#registrationUrl")).toHaveValue("https://henüz-tamamlanmadi");
  expect((await savedDrafts(page)).drafts).toHaveLength(3);
  expect(state.writes).toHaveLength(0);
});

test("refreshing the remote event catalog preserves an open dirty draft and explicit discard restores the latest saved data", async ({ page }) => {
  const state = await fixture(page);
  await edit(page);
  await page.locator("#title").fill("Benim yerel taslağım");
  const reads = state.reads;
  state.events[0].title = "Başka yöneticinin kaydettiği başlık";
  state.events[0].description = "Sunucudan güncel açıklama.";
  await page.evaluate(() => document.dispatchEvent(new Event("registration-config-saved")));
  await expect.poll(() => state.reads).toBeGreaterThan(reads);
  await expect(page.locator("#eventsList")).toContainText("Başka yöneticinin kaydettiği başlık");
  await expect(page.locator("#title")).toHaveValue("Benim yerel taslağım");
  await expect(page.locator("#eventDraftNotice")).toContainText("Sunucudaki etkinlik bu sırada değişmiş");
  await page.locator("#eventDiscard").click();
  await expect(page.locator("#title")).toHaveValue("Başka yöneticinin kaydettiği başlık");
  await expect(page.locator("#description")).toHaveValue("Sunucudan güncel açıklama.");
  await expect(page.locator("#eventDraftNotice")).toBeHidden();
  expect((await savedDrafts(page)).drafts).toHaveLength(0);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  state.events[0].title = "Temiz editör güncel başlığı izler";
  await page.evaluate(() => document.dispatchEvent(new Event("registration-config-saved")));
  await expect(page.locator("#title")).toHaveValue("Temiz editör güncel başlığı izler");
  await expect(page.locator("#eventDraftNotice")).toBeHidden();
  expect(state.writes).toHaveLength(0);
});

test("a failed save retains the draft and a successful retry removes only that event's draft", async ({ page }) => {
  const state = await fixture(page);
  await edit(page, "draft-second");
  await page.locator("#description").fill("İkinci etkinlik taslağı korunmalı.");
  await edit(page);
  await page.locator("#title").fill("Kaydedilecek bilim atölyesi");
  state.saveError = 503;
  await page.locator("#saveBtn").click();
  await expect(page.locator("#saveStatus")).toContainText("Etkinlik kaydedilemedi");
  await expect(page.locator("#title")).toHaveValue("Kaydedilecek bilim atölyesi");
  expect((await savedDrafts(page)).drafts).toHaveLength(2);
  state.saveError = 0;
  await page.locator("#saveBtn").click();
  await expect(page.locator("#formWrap")).toBeHidden();
  await expect(page.locator("#eventsList")).toContainText("Kaydedilecek bilim atölyesi");
  expect((await savedDrafts(page)).drafts.map(draft => draft.key)).toEqual(["event:draft-second"]);
  await edit(page, "draft-second");
  await expect(page.locator("#description")).toHaveValue("İkinci etkinlik taslağı korunmalı.");
  expect(state.writes).toHaveLength(2);
});

test("uploads remain attached to their original event and completed media survives an interrupted multi-upload and refresh", async ({ page }) => {
  const state = await fixture(page);
  await edit(page);
  await page.locator("#photosBtn").click();
  await expect(page.locator("#saveBtn")).toBeDisabled();
  await edit(page, "draft-second");
  await page.locator("#description").fill("Seçilen ikinci etkinlik değişmesin.");
  const photo = picture("late-upload");
  await uploadEvent(page, 0, "success", { secure_url: photo.url, public_id: photo.publicId, width: photo.width, height: photo.height });
  await expect(page.locator("#photoCount")).toHaveText("0 fotoğraf");
  await edit(page);
  await expect(page.locator("#photoCount")).toHaveText("3 fotoğraf");
  await expect(page.locator("#saveBtn")).toBeDisabled();
  await page.evaluate(() => window.testUploads[0].callback(new Error("Interrupted connection")));
  await expect(page.locator("#saveStatus")).toContainText("Tamamlanan görseller taslağınızda korundu");
  await expect(page.locator("#saveBtn")).toBeEnabled();
  await page.locator("#posterBtn").click();
  await uploadEvent(page, 1, "success", { secure_url: picture("new-poster").url, public_id: "new-poster", width: 900, height: 600 });
  await page.reload();
  await expect(page.locator("#posterPreview img")).toHaveAttribute("src", picture("new-poster").url);
  await expect(page.locator("#photoCount")).toHaveText("3 fotoğraf");
  await expect(page.locator("#photoThumbs img").last()).toHaveAttribute("src", photo.url);
  await edit(page, "draft-second");
  await expect(page.locator("#description")).toHaveValue("Seçilen ikinci etkinlik değişmesin.");
  expect(state.writes).toHaveLength(0);
});

test("discarding a draft prevents a late upload callback from recreating it", async ({ page }) => {
  await fixture(page);
  await edit(page);
  await page.locator("#title").fill("Silinecek yerel değişiklik");
  await page.locator("#photosBtn").click();
  await page.locator("#eventDiscard").click();
  await uploadEvent(page, 0, "success", { secure_url: picture("discarded-upload").url, public_id: "discarded-upload", width: 900, height: 600 });
  await expect(page.locator("#title")).toHaveValue(catalog[0].title);
  await expect(page.locator("#photoCount")).toHaveText("2 fotoğraf");
  await expect(page.locator("#eventDraftNotice")).toBeHidden();
  expect((await savedDrafts(page)).drafts).toHaveLength(0);
});

test("expired authentication and logout clear local event drafts without storing the admin password", async ({ page }) => {
  const state = await fixture(page);
  await edit(page);
  await page.locator("#title").fill("Oturum taslağı");
  await page.locator("#password").evaluate(input => { input.value = "This-must-never-be-stored"; });
  expect(JSON.stringify(await savedDrafts(page))).not.toContain("This-must-never-be-stored");
  state.authenticated = false;
  await page.reload();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  expect(await savedDrafts(page)).toBeNull();
  state.authenticated = true;
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await edit(page);
  await page.locator("#title").fill("Çıkışta temizlenecek taslak");
  // Logout first hides the authenticated app, then reloads the page.
  // Wait for that reload instead of observing the outgoing document's login panel.
  await Promise.all([page.waitForEvent("load"), page.locator("#adminLogout").click()]);
  await expect(page.locator("#login")).toBeVisible();
  expect(await savedDrafts(page)).toBeNull();
});

test("deleted event drafts and invalid browser-stored media are not restored", async ({ page }) => {
  const state = await fixture(page);
  await edit(page);
  await page.locator("#title").fill("Artık olmayan etkinliğin taslağı");
  state.events = state.events.filter(event => event.id !== "draft-first");
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#formWrap")).toBeHidden();
  expect(await savedDrafts(page)).toBeNull();
  await edit(page, "draft-second");
  await page.locator("#title").fill("Güvensiz görseli olan taslak");
  await page.evaluate(key => {
    const stored = JSON.parse(sessionStorage.getItem(key));
    stored.drafts[0].value.poster = "javascript:alert('not-an-image')";
    sessionStorage.setItem(key, JSON.stringify(stored));
  }, draftKey);
  // Close navigation without running beforeunload's final capture, which would replace the tampered fixture.
  await page.evaluate(() => { document.dispatchEvent(new Event("admin-logout")); });
  await page.evaluate(({ key, base }) => {
    const value = { ...base, title: "Güvensiz görseli olan taslak", poster: "javascript:alert('not-an-image')" };
    sessionStorage.setItem(key, JSON.stringify({ version: 1, active: "event:draft-second", drafts: [{ key: "event:draft-second", base, value }] }));
  }, { key: draftKey, base: { ...catalog[1], id: "draft-second" } });
  await page.reload();
  await expect(page.locator("#title")).toHaveValue(catalog[1].title);
  await expect(page.locator("#posterPreview img")).toHaveCount(0);
  await expect(page.locator("#eventDraftNotice")).toBeHidden();
  expect((await savedDrafts(page)).drafts).toHaveLength(0);
});

test("published events copy their canonical preview URL while drafts offer no public share button", async ({ page }) => {
  const state = await fixture(page);
  await page.evaluate(() => {
    window.testCopied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(value) { window.testCopied.push(value); } } });
  });
  await expect(page.locator('[data-action="share"][data-id="draft-second"]')).toHaveCount(0);
  await page.locator('[data-action="share"][data-id="draft-first"]').click();
  await expect(page.locator("#status")).toHaveText("Etkinlik paylaşım bağlantısı kopyalandı.");
  expect(await page.evaluate(() => window.testCopied)).toEqual(["https://ercupsa.com.tr/etkinlik/draft-first"]);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText() { throw new Error("Clipboard blocked"); } } }));
  await page.locator('[data-action="share"][data-id="draft-first"]').click();
  await expect(page.locator("#status")).toContainText("https://ercupsa.com.tr/etkinlik/draft-first");
  expect(state.writes).toHaveLength(0);
});

test("a delayed initial catalog response cannot reopen the admin app after logout", async ({ page }) => {
  const state = await fixture(page, { holdInitialCatalog: true });
  await expect.poll(() => state.initialCatalogPending).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/events" && value.request().method() === "GET");
  state.releaseInitialCatalog();
  await (await response).finished();
  // Allow the fetched JSON, load(), and show() promise chain to settle before checking state.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#app")).toBeHidden();
  await expect(page.locator("#login")).toBeVisible();
  expect(await page.evaluate(() => window.testAdminReady)).toBe(0);
  expect(await savedDrafts(page)).toBeNull();
  await page.locator("#password").fill("Local-mocked-admin-password");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#login")).toBeHidden();
  expect(await page.evaluate(() => window.testAdminReady)).toBe(1);
  await edit(page);
  await expect(page.locator("#title")).toHaveValue(catalog[0].title);
});

test("an initial unauthorized cookie probe preserves a password already being typed and allows login", async ({ page }) => {
  const state = await fixture(page, { holdInitialCatalog: true, initialCatalogStatus: 401 });
  await expect.poll(() => state.initialCatalogPending).toBe(true);
  await page.locator("#password").fill("Local-mocked-admin-password");
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/events" && value.request().method() === "GET");
  state.releaseInitialCatalog();
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#password")).toHaveValue("Local-mocked-admin-password");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app")).toBeVisible();
  expect(state.authHadPassword).toBe(true);
  await expect(page.locator("#password")).toBeEmpty();
  await expect(page.locator("#loginError")).toBeEmpty();
});

test("a late initial 401 cannot log out a newly authenticated admin session", async ({ page }) => {
  const state = await fixture(page, { holdInitialCatalog: true, initialCatalogStatus: 401 });
  await expect.poll(() => state.initialCatalogPending).toBe(true);
  await page.locator("#password").fill("Local-mocked-admin-password");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app")).toBeVisible();
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/events" && value.request().method() === "GET");
  state.releaseInitialCatalog();
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#login")).toBeHidden();
  expect(await page.evaluate(() => window.testAdminReady)).toBe(1);
});
