import { mockOwnerSession } from "./admin-session-fixture.js";
import { test, expect } from "@playwright/test";

const event = (id, extra = {}) => ({ id, title: `Etkinlik ${id}`, category: "Konferans", date: "2026-10-22", time: "15:30", location: "Kırmızı Salon", description: "Orijinal açıklama", registrationUrl: "", published: true, poster: "https://res.cloudinary.com/w2trki15/image/upload/test.jpg", images: [], revision: `revision-${id}`, ...extra });
const draftKey = "ercupsa_event_drafts_v1";
async function fixture(page) {
  const original = event("original"), legacy = event("legacy", { title: "Meme Kanseri Farkındalık Konferansı", poster: "", description: "", published: false, revision: "" });
  const state = { events: [event("active")], trash: [{ id: original.id, event: original, revision: "deleted-original", source: "trash" }], recoverable: [{ id: legacy.id, event: legacy, revision: "legacy-snapshot", source: "registrations" }], writes: [], reads: 0, authenticated: true, dialogs: [], held: null };
  page.on("dialog", dialog => { state.dialogs.push(dialog.message()); dialog.accept(); });
  await page.addInitScript(() => {
    window.testUploads = [];
    window.cloudinary = { createUploadWidget(options, callback) { window.testUploads.push(callback); return { open() {} }; } };
  });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked API" } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { members: [], submissions: [], batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await mockOwnerSession(page, { state });
  await page.route("**/api/events*", async route => {
    const request = route.request(), url = new URL(request.url()), action = url.searchParams.get("action");
    if (action === "auth") { state.authenticated = true; return route.fulfill({ json: { ok: true } }); }
    if (action === "logout") { state.authenticated = false; return route.fulfill({ json: { ok: true } }); }
    if (!state.authenticated) return route.fulfill({ status: 401, json: { error: "Yönetici girişi gerekli." } });
    if (request.method() === "GET") {
      state.reads++;
      return route.fulfill({ json: action === "trash" ? { trash: state.trash, recoverable: state.recoverable } : { events: state.events } });
    }
    const body = request.method() === "POST" ? request.postDataJSON() : {};
    state.writes.push({ method: request.method(), action, body, id: url.searchParams.get("id"), expectedRevision: url.searchParams.get("expectedRevision") });
    if (state.holdNext) { state.holdNext = false; await new Promise(resolve => { state.held = resolve; }); }
    if (state.forceConflict) return route.fulfill({ status: 409, json: { error: "Etkinlik başka bir yönetici tarafından değiştirildi. Güncel kaydı kontrol edin." } });
    if (action === "restore") {
      const item = [...state.trash, ...state.recoverable].find(value => value.id === body.id);
      if (!item || item.revision !== body.expectedRevision) return route.fulfill({ status: 409, json: { error: "Geri alma kaydı değişti." } });
      const restored = { ...item.event, published: false, revision: `restored-${item.id}` };
      state.events.push(restored); state.trash = state.trash.filter(value => value.id !== body.id); state.recoverable = state.recoverable.filter(value => value.id !== body.id);
      return route.fulfill({ json: { ok: true, event: restored, events: state.events } });
    }
    const id = body.id || body.event?.id || url.searchParams.get("id"), existing = state.events.find(value => value.id === id);
    const expected = body.expectedRevision || url.searchParams.get("expectedRevision");
    if (id && (!existing || existing.revision !== expected)) return route.fulfill({ status: 409, json: { error: "Etkinlik değişti veya silinmiş. Güncel kaydı kontrol edin." } });
    if (request.method() === "DELETE") {
      state.events = state.events.filter(value => value.id !== id);
      state.trash.push({ id, event: existing, revision: `deleted-${id}`, source: "trash" });
      return route.fulfill({ json: { ok: true, events: state.events } });
    }
    const saved = action === "publish" ? { ...existing, published: body.published, revision: `published-${id}` } : { ...body.event, id: id || "new-event", revision: `saved-${id || "new"}` };
    state.events = state.events.filter(value => value.id !== saved.id); state.events.push(saved);
    return route.fulfill({ json: { ok: true, event: saved, events: state.events } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  return state;
}
const edit = page => page.locator('[data-action="edit"][data-id="active"]').click();
const drafts = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), draftKey);

test("both full deleted events and legacy metadata restore as drafts with their original IDs and open the editor", async ({ page }) => {
  const state = await fixture(page);
  await page.locator("#eventTrashToggle").click();
  await expect(page.locator("#eventTrashList")).toContainText("Meme Kanseri");
  await expect(page.locator("#eventTrashList")).toContainText("saklanmamış olabilir");
  await expect(page.locator('[data-restore-id="original"]')).toBeVisible();
  await page.locator('[data-restore-id="original"]').click();
  await expect(page.locator("#formWrap")).toBeVisible();
  await expect(page.locator("#eventId")).toHaveValue("original");
  await expect(page.locator("#description")).toHaveValue("Orijinal açıklama");
  await expect(page.locator("#published")).not.toBeChecked();
  await expect(page.locator("#posterPreview img")).toHaveAttribute("src", state.events.find(value => value.id === "original").poster);
  expect(state.writes[0].body).toEqual({ id: "original", expectedRevision: "deleted-original" });
  await page.locator('[data-restore-id="legacy"]').click();
  await expect(page.locator("#eventId")).toHaveValue("legacy");
  await expect(page.locator("#title")).toHaveValue("Meme Kanseri Farkındalık Konferansı");
  await expect(page.locator("#saveStatus")).toContainText("Afiş ve açıklamayı kontrol");
  await expect(page.locator("#eventTrashMessage")).toContainText("bulunamadı");
  expect(state.writes[1].body).toEqual({ id: "legacy", expectedRevision: "legacy-snapshot" });
});

test("delete names the event, retains its ID and revision, and offers same-ID recovery instead of permanent deletion", async ({ page }) => {
  const state = await fixture(page);
  await page.locator('[data-action="delete"][data-id="active"]').click();
  await expect(page.locator("#eventsList")).toContainText("Etkinlik bulunamadı");
  expect(state.dialogs[0]).toContain("Etkinlik active");
  expect(state.dialogs[0]).toContain("geri alabilirsiniz");
  expect(state.dialogs[0]).not.toContain("geri alınamaz");
  expect(state.writes[0]).toMatchObject({ method: "DELETE", id: "active", expectedRevision: "revision-active" });
  await page.locator("#eventTrashToggle").click();
  await page.locator('[data-restore-id="active"]').click();
  await expect(page.locator("#eventId")).toHaveValue("active");
  await expect(page.locator("#published")).not.toBeChecked();
});

test("publish sends only publication state and revision while preserving an unsaved local draft", async ({ page }) => {
  const state = await fixture(page);
  await edit(page); await page.locator("#title").fill("Yerel başlığım");
  await page.locator('[data-action="publish"][data-id="active"]').click();
  await expect(page.locator("#saveStatus")).toContainText("yayından kaldırıldı");
  expect(state.writes[0]).toMatchObject({ action: "publish", body: { id: "active", published: false, expectedRevision: "revision-active" } });
  expect(Object.keys(state.writes[0].body).sort()).toEqual(["expectedRevision", "id", "published"]);
  await expect(page.locator("#title")).toHaveValue("Yerel başlığım");
  await expect(page.locator("#eventDraftNotice")).toContainText("Sunucudaki etkinlik bu sırada değişmiş");
  expect((await drafts(page)).drafts[0].base.revision).toBe("revision-active");
});

test("conflicts retain the original revision through refresh and reload, and explicit discard adopts the current version", async ({ page }) => {
  const state = await fixture(page);
  await edit(page); await page.locator("#description").fill("Yerel değişikliğim");
  state.events[0] = event("active", { title: "Diğer yönetici", revision: "remote-new" });
  await page.locator("#saveBtn").click();
  await expect(page.locator("#saveStatus")).toContainText("Etkinlik değişti");
  await expect(page.locator("#description")).toHaveValue("Yerel değişikliğim");
  expect(state.writes[0].body.expectedRevision).toBe("revision-active");
  await page.reload();
  await expect(page.locator("#description")).toHaveValue("Yerel değişikliğim");
  await page.locator("#saveBtn").click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1].body.expectedRevision).toBe("revision-active");
  await expect(page.locator("#saveBtn")).toBeEnabled();
  await page.locator("#eventDiscard").click();
  await expect(page.locator("#title")).toHaveValue("Diğer yönetici");
  await page.locator("#description").fill("Güncel sürüm üzerine değişiklik");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#formWrap")).toBeHidden();
  expect(state.writes[2].body.expectedRevision).toBe("remote-new");
});

test("a dirty missing event cannot be recreated and its draft remains available after refresh and reload", async ({ page }) => {
  const state = await fixture(page);
  await edit(page); await page.locator("#title").fill("Kaybolmayan yerel başlık");
  state.events = [];
  await page.evaluate(() => document.dispatchEvent(new Event("registration-config-saved")));
  await expect(page.locator("#saveBtn")).toBeDisabled();
  await expect(page.locator("#eventDraftNotice")).toContainText("yeniden oluşturulmasını önlemek");
  await page.reload();
  await expect(page.locator("#title")).toHaveValue("Kaybolmayan yerel başlık");
  await expect(page.locator("#saveBtn")).toBeDisabled();
  expect((await drafts(page)).drafts[0].base.revision).toBe("revision-active");
  expect(state.writes).toHaveLength(0);
  await page.locator("#newBtn").click();
  await page.locator("#title").fill("Yeni etkinlik"); await page.locator("#date").fill("2026-11-10");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#formWrap")).toBeHidden();
  expect(state.writes[0].body).not.toHaveProperty("expectedRevision");
  expect(state.writes[0].body.event).not.toHaveProperty("id");
});

test("recovering an event with an older local draft preserves that draft without overwriting the recovered revision", async ({ page }) => {
  const state = await fixture(page);
  await edit(page); await page.locator("#title").fill("Kendi eski yerel taslağım");
  const deleted = state.events[0]; state.events = [];
  state.trash.push({ id: "active", event: deleted, revision: "deleted-active", source: "trash" });
  await page.evaluate(() => document.dispatchEvent(new Event("registration-config-saved")));
  await expect(page.locator("#saveBtn")).toBeDisabled();
  await page.locator("#eventTrashToggle").click();
  await page.locator('[data-restore-id="active"]').click();
  await expect(page.locator("#eventId")).toHaveValue("active");
  await expect(page.locator("#title")).toHaveValue("Kendi eski yerel taslağım");
  await expect(page.locator("#eventDraftNotice")).toContainText("Sunucudaki etkinlik bu sırada değişmiş");
  expect(state.events[0].published).toBe(false);
  expect(state.events[0].revision).toBe("restored-active");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#saveStatus")).toContainText("Etkinlik değişti");
  expect(state.writes[1].body.expectedRevision).toBe("revision-active");
  await page.locator("#eventDiscard").click();
  await expect(page.locator("#title")).toHaveValue("Etkinlik active");
  await expect(page.locator("#published")).not.toBeChecked();
  await page.locator("#title").fill("Geri alınmış etkinliğin güncel adı");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#formWrap")).toBeHidden();
  expect(state.writes[2].body.expectedRevision).toBe("restored-active");
});

for (const switched of [false, true, "back"]) test(`a pending upload keeps the original edit revision when the remote event refreshes${switched === "back" ? " after switching away and back" : switched ? " after switching editor" : " in the same editor"}`, async ({ page }) => {
  const state = await fixture(page);
  await edit(page); await page.locator("#photosBtn").click();
  if (switched) await page.locator("#newBtn").click();
  state.events[0] = event("active", { title: "Sunucudaki yeni başlık", revision: "remote-new" });
  await page.evaluate(() => document.dispatchEvent(new Event("registration-config-saved")));
  await expect(page.locator("#eventsList")).toContainText("Sunucudaki yeni başlık");
  if (switched === "back") await edit(page);
  await page.evaluate(() => {
    window.testUploads[0](null, { event: "success", info: { secure_url: "https://res.cloudinary.com/w2trki15/image/upload/late.jpg", public_id: "late", width: 900, height: 600 } });
    window.testUploads[0](null, { event: "close" });
  });
  if (switched) await edit(page);
  await expect(page.locator("#title")).toHaveValue("Etkinlik active");
  await expect(page.locator("#photoCount")).toHaveText("1 fotoğraf");
  await expect(page.locator("#eventDraftNotice")).toContainText("Sunucudaki etkinlik bu sırada değişmiş");
  expect((await drafts(page)).drafts.find(value => value.key === "event:active").base.revision).toBe("revision-active");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#saveStatus")).toContainText("Etkinlik değişti");
  expect(state.writes[0].body.expectedRevision).toBe("revision-active");
});

for (const action of ["save", "publish", "delete", "restore"]) test(`a delayed ${action} result cannot clear or reopen a newly logged-in session's draft`, async ({ page }) => {
  const state = await fixture(page);
  if (action === "restore") { await page.locator("#eventTrashToggle").click(); await expect(page.locator('[data-restore-id="original"]')).toBeVisible(); }
  if (action === "save") { await edit(page); await page.locator("#title").fill("Eski oturum değişikliği"); }
  state.holdNext = true;
  const button = action === "save" ? "#saveBtn" : action === "restore" ? '[data-restore-id="original"]' : `[data-action="${action}"][data-id="active"]`;
  await page.locator(button).click();
  await expect.poll(() => !!state.held).toBe(true);
  await expect(page.locator("#newBtn")).toBeDisabled();
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  await expect(page.locator("#login")).toBeVisible();
  await page.locator("#username").fill("basadmin");
  await page.locator("#password").fill("Mocked-local-password"); await page.locator("#loginBtn").click();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#newBtn").click(); await page.locator("#title").fill("Yeni oturum taslağı");
  const response = page.waitForResponse(value => value.request().method() !== "GET" && value.url().includes("/api/events") && !value.url().includes("action=auth"));
  state.held(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#title")).toHaveValue("Yeni oturum taslağı");
  await expect(page.locator("#formWrap")).toBeVisible();
  await expect(page.locator("#saveBtn")).toBeEnabled();
  expect((await drafts(page)).drafts.map(value => value.key)).toEqual(["new"]);
});
