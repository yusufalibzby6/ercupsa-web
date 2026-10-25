import { mockOwnerSession } from "./admin-session-fixture.js";
import { test, expect } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64");
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const image = name => `https://res.cloudinary.com/w2trki15/image/upload/${name}.png`;
const events = [
  { id: "media-first", title: "Görsel tercih atölyesi", date: "2030-10-20", time: "18:00", published: true, poster: "", images: [] },
  { id: "media-second", title: "İkinci etkinlik", date: "2030-10-21", time: "19:00", published: true, poster: "", images: [] },
];
const core = [
  { id: "full_name", type: "text", label: "Ad soyad", required: true },
  { id: "class_year", type: "select", label: "Sınıf", required: true, options: ["Hazırlık", "1. Sınıf", "2. Sınıf", "3. Sınıf", "4. Sınıf", "5. Sınıf", "Mezun", "Diğer"] },
  { id: "phone", type: "tel", label: "Telefon", required: true },
];
const choice = { id: "design", type: "radio", label: "Tasarım seçimi", required: true, options: ["Seçenek 1", "Seçenek 2"] };
const photoQuestion = { id: "sample", type: "photo", label: "Güncel fotoğraf başlığı", required: false };
const form = id => ({ eventId: id, enabled: true, description: `${id} açıklaması`, maxRegistrations: null, fields: structuredClone([...core, choice, photoQuestion]), receipt: { enabled: true, required: false } });
const registration = (id, mime = "image/png") => ({
  id, name: `Katılımcı ${id}`, phone: "05551234567", classYear: "2. Sınıf", createdAt: "2026-10-13T12:00:00Z",
  answers: { full_name: `Katılımcı ${id}`, class_year: "2. Sınıf", design: "Eski seçenek" },
  fields: structuredClone([...core, { ...choice, label: "Kaydedilmiş eski tercih" }, { ...photoQuestion, label: "Kayıt anındaki fotoğraf başlığı" }]),
  photos: { sample: { name: `fotograf.${mime === "image/webp" ? "webp" : "png"}`, mime, size: mime === "image/webp" ? webp.length : png.length } }, receipt: null,
});
async function fixture(page) {
  const state = { forms: new Map(events.map(event => [event.id, form(event.id)])), saves: [], photoReads: [], entries: [registration("png"), registration("webp", "image/webp")], photoMime: null, holdPhoto: null, holdSave: null };
  await page.addInitScript(() => {
    window.testUploads = [];
    window.testObjectUrls = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.testObjectUrls.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.testObjectUrls.revoked.push(url); revoke(url); };
    window.cloudinary = { createUploadWidget(options, callback) {
      const item = { options, callback, opened: false, destroyed: false };
      window.testUploads.push(item);
      return { open() { item.opened = true; }, destroy() { item.destroyed = true; } };
    } };
  });
  await page.route("https://**/*", route => route.abort());
  await page.route("https://res.cloudinary.com/**", route => route.fulfill({ contentType: "image/png", body: png }));
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked local media editor fixture" } }));
  await mockOwnerSession(page, { state });
  await page.route("**/api/events*", route => route.fulfill({ json: { events } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { members: [], submissions: [], batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.route("**/api/registrations*", async route => {
    const url = new URL(route.request().url()), eventId = url.searchParams.get("event_id"), action = url.searchParams.get("action");
    if (action === "summary") return route.fulfill({ json: { events: [] } });
    if (action === "admin") return route.fulfill({ json: { form: state.forms.get(eventId), event: events.find(event => event.id === eventId), entries: eventId === events[0].id ? state.entries : [], summary: { total: eventId === events[0].id ? state.entries.length : 0, byClass: [] }, totalPages: 1 } });
    if (action === "form") {
      const saved = route.request().postDataJSON(); state.saves.push(structuredClone(saved)); state.forms.set(eventId, saved);
      if (state.holdSave) await state.holdSave;
      return route.fulfill({ json: { ok: true, form: saved } });
    }
    if (action === "photo") {
      const id = url.searchParams.get("id"), fieldId = url.searchParams.get("field_id");
      state.photoReads.push({ eventId, id, fieldId });
      if (state.holdPhoto) await state.holdPhoto;
      const mime = state.photoMime || state.entries.find(entry => entry.id === id)?.photos?.[fieldId]?.mime;
      return route.fulfill({ contentType: mime || "image/png", headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, body: mime === "image/webp" ? webp : png }).catch(() => {});
    }
    return route.fulfill({ status: 400, json: { error: "Unsupported media editor fixture" } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="registrations"]').click();
  await expect(page.locator("#registrationDescription")).toHaveValue(`${events[0].id} açıklaması`);
  return state;
}
const field = page => page.locator('[data-registration-field="design"]');
const row = (page, index) => field(page).locator("[data-option-id]").nth(index);
async function uploadResult(page, index, event = "success", url = image(`choice-${index}`)) {
  await page.evaluate(({ index, event, url }) => window.testUploads[index].callback(null, { event, info: { secure_url: url } }), { index, event, url });
}
async function save(page) {
  await page.locator("#registrationSave").click();
  await expect(page.locator("#registrationFeedback")).toContainText("Form kaydedildi");
}

test("admin configures a photo question and labeled image choices without changing required core types", async ({ page }) => {
  const state = await fixture(page);
  await page.locator("#registrationAddField").click();
  const question = page.locator("#registrationFields [data-registration-field]").last();
  const id = await question.getAttribute("data-registration-field");
  await question.locator('[data-field-prop="type"]').selectOption("photo");
  await question.locator('[data-field-prop="label"]').fill("Yaptığın tasarımın fotoğrafı");
  await question.locator('[data-field-prop="required"]').check();
  await expect(question).toContainText("Fotoğraflar toplam en fazla 4 MB");
  await row(page, 0).locator("[data-option-label]").fill("Pembe tasarım");
  await row(page, 0).locator("[data-option-upload]").click();
  await expect(page.locator("#registrationSave")).toBeDisabled();
  const widget = await page.evaluate(() => window.testUploads[0].options);
  expect(widget).toMatchObject({ cloudName: "w2trki15", uploadPreset: "ercupsa_gallery", multiple: false, maxImageWidth: 1600, maxImageHeight: 1600, clientAllowedFormats: ["jpg", "jpeg", "png", "webp"] });
  await uploadResult(page, 0);
  await expect(row(page, 0).locator("img")).toHaveAttribute("src", image("choice-0"));
  await field(page).locator('[data-field-prop="type"]').selectOption("select");
  await expect(row(page, 0).locator("img")).toHaveAttribute("src", image("choice-0"));
  await field(page).locator('[data-field-prop="type"]').selectOption("checkboxes");
  await save(page);
  expect(state.saves).toHaveLength(1);
  const saved = state.saves[0];
  expect(saved.fields.find(value => value.id === id)).toEqual({ id, type: "photo", label: "Yaptığın tasarımın fotoğrafı", required: true });
  expect(saved.fields.find(value => value.id === "design")).toMatchObject({ type: "checkboxes", options: ["Pembe tasarım", "Seçenek 2"], optionImages: [image("choice-0"), ""] });
  expect(saved.fields.find(value => value.id === "class_year")).toEqual(core[1]);
  expect(state.entries[0].answers.design).toBe("Eski seçenek");
});

test("a renamed and reordered option keeps its pending image when the admin switches events", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  await row(page, 0).locator("[data-option-label]").fill("İlk satırın yeni adı");
  await row(page, 0).locator('[data-option-move="1"]').click();
  await expect(row(page, 1).locator("[data-option-label]")).toHaveValue("İlk satırın yeni adı");
  await page.locator("#registrationEvent").selectOption("media-second");
  await expect(page.locator("#registrationDescription")).toHaveValue("media-second açıklaması");
  await uploadResult(page, 0);
  await expect(field(page).locator("img")).toHaveCount(0);
  await page.locator("#registrationEvent").selectOption("media-first");
  await expect(row(page, 1).locator("img")).toHaveAttribute("src", image("choice-0"));
  await expect(row(page, 0).locator("img")).toHaveCount(0);
  await save(page);
  expect(state.saves[0].fields.find(value => value.id === "design")).toMatchObject({ options: ["Seçenek 2", "İlk satırın yeni adı"], optionImages: ["", image("choice-0")] });
});

test("removing a pending option does not attach its late image to a new option in the same position", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  await row(page, 0).locator("[data-option-remove]").click();
  await field(page).locator("[data-option-add]").click();
  await uploadResult(page, 0);
  await expect(field(page).locator("img")).toHaveCount(0);
  await expect(page.locator("#registrationSave")).toBeEnabled();
  expect(await page.evaluate(() => window.testUploads[0].destroyed)).toBe(true);
  await save(page);
  expect(state.saves[0].fields.find(value => value.id === "design")).not.toHaveProperty("optionImages");
});

test("returning to a clean form and reloading while an image is pending retains its original option", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 1).locator("[data-option-upload]").click();
  await page.locator("#registrationEvent").selectOption("media-second");
  await expect(page.locator("#registrationDescription")).toHaveValue("media-second açıklaması");
  await page.locator("#registrationEvent").selectOption("media-first");
  await expect(row(page, 1).locator("[data-option-upload]")).toHaveText("Yükleniyor…");
  await page.locator("#registrationReload").click();
  await expect(page.locator("#registrationFeedback")).toContainText("kaydedilmemiş değişiklikleri korunuyor");
  await expect(page.locator("#registrationSave")).toBeDisabled();
  await uploadResult(page, 0);
  await expect(row(page, 1).locator("img")).toHaveAttribute("src", image("choice-0"));
  await expect(row(page, 0).locator("img")).toHaveCount(0);
  await save(page);
  expect(state.saves[0].fields.find(value => value.id === "design").optionImages).toEqual(["", image("choice-0")]);
});

test("closed widgets and discarded drafts ignore late image callbacks", async ({ page }) => {
  await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  await uploadResult(page, 0, "close");
  await uploadResult(page, 0);
  await expect(field(page).locator("img")).toHaveCount(0);
  await row(page, 0).locator("[data-option-upload]").click();
  await uploadResult(page, 0, "success", image("closed-old"));
  await expect(field(page).locator("img")).toHaveCount(0);
  await uploadResult(page, 1);
  await expect(row(page, 0).locator("img")).toHaveAttribute("src", image("choice-1"));
  await row(page, 1).locator("[data-option-upload]").click();
  await page.locator("#registrationDiscard").click();
  await uploadResult(page, 2);
  await expect(field(page).locator("img")).toHaveCount(0);
  await expect(page.locator("#registrationDiscard")).toBeHidden();
});

test("images survive label edits and temporary type changes while pending uploads are canceled", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  await uploadResult(page, 0);
  await row(page, 0).locator("[data-option-label]").fill("Görselin yeni adı");
  await row(page, 1).locator("[data-option-upload]").click();
  await field(page).locator('[data-field-prop="type"]').selectOption("text");
  await uploadResult(page, 1);
  await field(page).locator('[data-field-prop="type"]').selectOption("radio");
  await expect(row(page, 0).locator("[data-option-label]")).toHaveValue("Görselin yeni adı");
  await expect(row(page, 0).locator("img")).toHaveAttribute("src", image("choice-0"));
  await expect(row(page, 1).locator("img")).toHaveCount(0);
  await save(page);
  expect(state.saves[0].fields.find(value => value.id === "design").optionImages).toEqual([image("choice-0"), ""]);
});

test("removing an entire question rejects its pending upload and unsafe uploaded URLs", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  await uploadResult(page, 0, "success", "https://example.test/fake.png");
  await expect(page.locator("#registrationFeedback")).toContainText("bağlantısı doğrulanamadı");
  await expect(field(page).locator("img")).toHaveCount(0);
  await row(page, 0).locator("[data-option-upload]").click();
  await field(page).locator("[data-field-remove]").click();
  await uploadResult(page, 1);
  await expect(field(page)).toHaveCount(0);
  await save(page);
  expect(state.saves[0].fields.some(value => value.id === "design")).toBe(false);
});

test("private PNG and WebP photos use their historical field label and authenticated photo endpoint", async ({ page }) => {
  const state = await fixture(page);
  await page.locator('[data-registration-entry="png"] details').evaluate(element => { element.open = true; });
  await page.locator('[data-registration-photo="png"]').click();
  await expect(page.locator("#registrationReceiptTitle")).toHaveText("Katılımcı png — Kayıt anındaki fotoğraf başlığı");
  await expect(page.locator("#registrationReceiptImage")).toBeVisible();
  await expect(page.locator("#registrationReceiptImage")).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator("#registrationReceiptDownload")).toHaveText("Fotoğrafı indir");
  await expect(page.locator("#registrationReceiptDownload")).toHaveAttribute("download", "fotograf.png");
  const pngUrl = await page.locator("#registrationReceiptImage").getAttribute("src");
  await page.locator("#registrationReceiptClose").click();
  await expect.poll(() => page.evaluate(url => window.testObjectUrls.revoked.includes(url), pngUrl)).toBe(true);
  await page.locator('[data-registration-entry="webp"] details').evaluate(element => { element.open = true; });
  await page.locator('[data-registration-photo="webp"]').click();
  await expect(page.locator("#registrationReceiptImage")).toBeVisible();
  await expect(page.locator("#registrationReceiptImage")).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator("#registrationReceiptDownload")).toHaveAttribute("download", "fotograf.webp");
  await expect(page.locator("#registrationReceiptMessage")).toHaveText("Bu fotoğraf yalnızca yöneticilere gösterilir.");
  expect(state.photoReads).toEqual([{ eventId: "media-first", id: "png", fieldId: "sample" }, { eventId: "media-first", id: "webp", fieldId: "sample" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("a non-image response cannot become a photo preview or download", async ({ page }) => {
  const state = await fixture(page); state.photoMime = "application/pdf";
  await page.locator('[data-registration-entry="png"] details').evaluate(element => { element.open = true; });
  await page.locator('[data-registration-photo="png"]').click();
  await expect(page.locator("#registrationReceiptMessage")).toContainText("dosya biçimi doğrulanamadı");
  await expect(page.locator("#registrationReceiptImage")).toBeHidden();
  await expect(page.locator("#registrationReceiptDownload")).toBeHidden();
  await expect(page.locator("#registrationReceiptDownload")).not.toHaveAttribute("href", /blob:/);
  expect(await page.evaluate(() => window.testObjectUrls.created.length)).toBe(0);
});

test("logout cancels pending option uploads and prevents a late private photo from reappearing", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  let release; state.holdPhoto = new Promise(resolve => { release = resolve; });
  await page.locator('[data-registration-entry="png"] details').evaluate(element => { element.open = true; });
  await page.locator('[data-registration-photo="png"]').click();
  await expect(page.locator("#registrationReceiptMessage")).toHaveText("Fotoğraf yükleniyor…");
  await expect.poll(() => state.photoReads.length).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  release();
  await uploadResult(page, 0);
  await expect(page.locator("#registrationFields")).toBeEmpty();
  await expect(page.locator("#registrationEntries")).toBeEmpty();
  await expect(page.locator("#registrationReceiptDialog")).not.toBeVisible();
  await expect(page.locator("#registrationReceiptImage")).not.toHaveAttribute("src", /blob:/);
  await expect(page.locator("#registrationReceiptDownload")).not.toHaveAttribute("href", /blob:/);
  expect(await page.evaluate(() => window.testObjectUrls.created.length)).toBe(0);
  expect(await page.evaluate(() => window.testUploads[0].destroyed)).toBe(true);
  expect(state.saves).toHaveLength(0);
});

test("a form save completing after logout cannot restore its image choices or private draft", async ({ page }) => {
  const state = await fixture(page);
  await row(page, 0).locator("[data-option-upload]").click();
  await uploadResult(page, 0);
  let release; state.holdSave = new Promise(resolve => { release = resolve; });
  await page.locator("#registrationSave").click();
  await expect.poll(() => state.saves.length).toBe(1);
  await expect(page.locator("#registrationFeedback")).toHaveText("Kayıt formu kaydediliyor…");
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  release();
  await expect(page.locator("#registrationFields")).toBeEmpty();
  await expect(page.locator("#registrationSave")).toBeDisabled();
  await expect(page.locator("#registrationDiscard")).toBeHidden();
});
