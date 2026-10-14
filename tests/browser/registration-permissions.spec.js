import { test, expect } from "@playwright/test";

const event = { id: "permissions-event", title: "Yetkili kayıt incelemesi", date: "2099-10-22", published: false, images: [] };
const fields = [
  { id: "full_name", type: "text", label: "Ad soyad", required: true },
  { id: "class_year", type: "select", label: "Sınıf", required: true, options: ["1. Sınıf", "2. Sınıf"] },
  { id: "phone", type: "tel", label: "Telefon", required: true },
];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=", "base64");
const treasurer = { id: "sayman", username: "sayman", name: "Sayman", role: "treasurer", permissions: ["registrations.view", "registrations.receipts"] };
const account = permissions => ({ id: "custom-admin", username: "yetkili", name: "Yetkili", role: "admin", permissions });

async function fixture(page, session) {
  const state = { requests: [], saves: [], receipts: [], session };
  const form = { eventId: event.id, enabled: true, maxRegistrations: 40, description: "Özel form açıklaması", fields: structuredClone(fields), receipt: { enabled: true, required: false } };
  const entry = { id: "record-one", eventId: event.id, name: "Deniz Katılımcı", classYear: "2. Sınıf", phone: "05551234567", createdAt: "2026-10-14T12:00:00Z",
    fields: [...fields, { id: "portrait", type: "photo", label: "Fotoğraf", required: false }],
    answers: { full_name: "Deniz Katılımcı", class_year: "2. Sınıf", phone: "05551234567", portrait: "private-photo.png" },
    receipt: { name: "dekont.png", mime: "image/png", size: png.length },
    // The UI must still respect current permissions if it sees an old response.
    photos: { portrait: { name: "private-photo.png", mime: "image/png", size: png.length } },
    ticket: { batchId: "private-batch", status: "issued" } };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => {
    state.requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 501, json: { error: "Unmocked local permission fixture" } });
  });
  await page.route("**/api/admin-auth*", route => route.fulfill({ json: { session: state.session } }));
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [event] } }));
  await page.route("**/api/instagram*", route => route.fulfill({ json: { links: [] } }));
  await page.route("**/api/registrations*", route => {
    const req = route.request(), url = new URL(req.url()), action = url.searchParams.get("action");
    state.requests.push(`registrations:${action}:${req.method()}`);
    if (action === "summary") return route.fulfill({ json: { events: [{ eventId: event.id, title: event.title, date: event.date, total: 1, byClass: [{ classYear: "2. Sınıf", count: 1 }] }] } });
    if (action === "admin") return route.fulfill({ json: { event, form, entries: [entry], summary: { total: 1, byClass: [{ classYear: "2. Sınıf", count: 1 }] }, totalPages: 1, pendingTicketDeletions: [{ id: "deleted-entry", name: "Silinen katılımcı" }] } });
    if (action === "receipt") { state.receipts.push(url.searchParams.get("id")); return route.fulfill({ contentType: "image/png", body: png }); }
    if (action === "form" && req.method() === "POST") { const saved = req.postDataJSON(); state.saves.push(saved); return route.fulfill({ json: { ok: true, form: saved } }); }
    return route.fulfill({ status: 403, json: { error: "Bu işlem için yetkiniz yok." } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  return state;
}

test("Sayman sees records and receipts with no form, photo, ticket, export or deletion controls", async ({ page }) => {
  const state = await fixture(page, treasurer);
  await page.locator('[data-tab="registrations"]').click();
  const record = page.locator('[data-registration-entry="record-one"]');
  await expect(record).toContainText("Deniz Katılımcı");
  await expect(page.locator("#registrationSummary")).toContainText("Toplam kayıt");
  await expect(page.locator("#registrationReadOnlyNotice")).toBeVisible();
  await expect(page.locator("#registrationConfigForm")).toBeHidden();
  await expect(page.locator("#registrationExport")).toBeHidden();
  await expect(page.locator("#registrationDeleteHelp")).toBeHidden();
  await expect(record.locator("[data-registration-ticket], [data-registration-delete], [data-registration-photo]")).toHaveCount(0);
  await expect(page.locator("[data-registration-cleanup]")).toHaveCount(0);
  await record.locator("summary").click();
  await expect(record).not.toContainText("private-photo.png");
  await record.locator("[data-registration-receipt]").click();
  await expect(page.locator("#registrationReceiptDialog")).toBeVisible();
  await expect(page.locator("#registrationReceiptImage")).toBeVisible();
  expect(state.receipts).toEqual(["record-one"]);
  expect(state.requests.filter(value => /^registrations:(photo|ticket|export|delete|form):/.test(value))).toEqual([]);
  // Injected DOM events cannot bypass the handler's independent permission guard.
  await page.locator("#registrationConfigForm").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await page.locator("#registrationExport").evaluate(button => button.dispatchEvent(new Event("click", { bubbles: true })));
  expect(state.saves).toEqual([]);
  expect(state.requests.filter(value => /^registrations:(export|form):/.test(value))).toEqual([]);
});

test("form managers can change form access on an unpublished event but cannot delete records", async ({ page }) => {
  const state = await fixture(page, account(["registrations.view", "registrations.manage"]));
  await page.locator('[data-tab="registrations"]').click();
  await expect(page.locator("#registrationDescription")).toHaveValue("Özel form açıklaması");
  await expect(page.locator("#registrationEventNote")).toContainText("etkinliği yayımlamanız gerekmez");
  await page.locator("#registrationDescription").fill("Doğrudan bağlantıyla kayıt olun");
  await page.locator("#registrationSave").click();
  await expect(page.locator("#registrationFeedback")).toContainText("etkinliğin sitede yayımlanması gerekmez");
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0]).toMatchObject({ enabled: true, description: "Doğrudan bağlantıyla kayıt olun" });
  await expect(page.locator("[data-registration-delete], [data-registration-delete-confirm], [data-registration-cleanup]")).toHaveCount(0);
  await expect(page.locator("#registrationExport")).toBeHidden();
});

test("admins without registration view do not eagerly request records even when an event selection is dispatched", async ({ page }) => {
  const state = await fixture(page, account(["instagram.view"]));
  await expect(page.locator('[data-tab="registrations"]')).toBeHidden();
  await page.evaluate(id => document.dispatchEvent(new CustomEvent("registration-event", { detail: { id } })), event.id);
  await page.locator("#registrationReload").evaluate(button => button.dispatchEvent(new Event("click", { bubbles: true })));
  expect(state.requests.filter(value => value.startsWith("registrations:"))).toEqual([]);
  await expect(page.locator("#registrationEntries")).not.toContainText("Deniz Katılımcı");
});
