import { mockOwnerSession } from "./admin-session-fixture.js";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const today = new Date("2026-10-04T19:00:00+03:00");
const fullMessage = "İlginiz için teşekkür ederiz. Kontenjanımız dolmuştur. Bir sonraki etkinliklerimize bekleriz.";
const receiptBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64");
const classOptions = ["Hazırlık", "1. Sınıf", "2. Sınıf", "3. Sınıf", "4. Sınıf", "5. Sınıf", "Mezun", "Diğer"];
const coreFields = [
  { id: "full_name", type: "text", label: "Ad soyad", required: true },
  { id: "class_year", type: "select", label: "Sınıf", required: true, options: classOptions },
  { id: "phone", type: "tel", label: "Telefon", required: true },
];
const questions = [
  { id: "session", type: "select", label: "Oturum tercihi", required: true, options: ["Sabah", "Öğleden sonra"] },
  { id: "diet", type: "radio", label: "Yemek tercihi", required: true, options: ["Standart", "Vejetaryen"] },
  { id: "topics", type: "checkboxes", label: "İlgilendiğiniz konular", required: true, options: ["Klinik eczacılık", "Araştırma"] },
  { id: "notes", type: "textarea", label: "Eklemek istedikleriniz", required: false },
];
const events = [
  { id: "native-today", title: "Bugünkü bilim atölyesi", date: "2026-10-04", time: "10:00", location: "Eczacılık Fakültesi", category: "Atölye", description: "Etkinlik tanıtımı", images: [], published: true, registrationMode: "native", registrationEnabled: true },
  { id: "native-next", title: "Araştırma buluşması", date: "2026-10-09", time: "18:00", location: "Kayseri", category: "Buluşma", images: [], published: true, registrationMode: "native", registrationEnabled: true },
  { id: "legacy", title: "Google formuyla gezi", date: "2026-10-12", time: "15:00", category: "Gezi", images: [], published: true, registrationMode: "external", registrationUrl: "https://docs.google.com/forms/d/e/legacy-fixture/viewform" },
  { id: "native-disabled", title: "Kapalı kayıt formu", date: "2026-10-10", time: "12:00", images: [], published: true, registrationMode: "native", registrationEnabled: false, registrationUrl: "https://docs.google.com/forms/d/e/old-fallback/viewform" },
  { id: "native-past", title: "Geçmiş yerel form", date: "2026-10-03", time: "23:59", images: [], published: true, registrationMode: "native", registrationEnabled: true },
];

function formConfig(eventId, custom = false) {
  return {
    eventId, enabled: eventId !== "native-disabled",
    description: eventId === "native-today" ? "Kayıt öncesinde okuyun: etkinlik ayrıntılarını kontrol edin.\nEtkinliğe girişte kaydınızı kontrol edeceğiz." : "İkinci etkinliğin açıklaması.",
    maxRegistrations: null,
    fields: structuredClone([...coreFields, ...(custom ? questions : [])]),
    receipt: { enabled: false, required: false }, payment: { enabled: false }, waitlist: { enabled: false, capacity: 0 }, showRemainingCapacity: false,
  };
}

function entry(id, classYear, hasReceipt = false, eventId = "native-today") {
  return {
    id, eventId, name: `Test katılımcısı ${id}`, classYear, phone: "05551234567",
    createdAt: "2026-10-04T12:00:00Z",
    answers: { full_name: `Test katılımcısı ${id}`, class_year: classYear, phone: "05551234567", notes: "Test yanıtı" },
    fields: [...coreFields, questions[3]],
    receipt: hasReceipt ? { name: "dekont.png", mime: "image/png", size: receiptBytes.length } : null,
  };
}

function summarize(entries) {
  const byClass = new Map();
  for (const value of entries) byClass.set(value.classYear, (byClass.get(value.classYear) || 0) + 1);
  return {
    total: entries.length, main: entries.filter(value => !value.registrationStatus || value.registrationStatus === "main").length, waitlisted: entries.filter(value => value.registrationStatus === "waitlisted").length, cancelled: entries.filter(value => value.registrationStatus === "cancelled").length,
    byClass: [...byClass].map(([classYear, count]) => ({ classYear, count })),
  };
}

async function fixture(page, { custom = false } = {}) {
  const state = {
    forms: new Map(events.filter(event => event.registrationMode === "native").map(event => [event.id, formConfig(event.id, custom && event.id === "native-today")])),
    entries: new Map([
      ["native-today", [entry("first", "2. Sınıf", true), entry("second", "1. Sınıf"), entry("third", "2. Sınıf")]],
      ["native-next", [entry("fourth", "3. Sınıf", false, "native-next")]],
    ]),
    payments: [], cancellations: [], submissions: [], saves: [], deletions: [], receiptReads: [], requests: [], submitFailures: [], formFailures: [], deleteFailures: [],
  };
  await page.clock.install({ time: today });
  await page.route("https://**/*", route => route.abort());
  // Catch every local API first, so an omitted fixture cannot touch real storage.
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked local API in registration test" } }));
  await mockOwnerSession(page, { state });
  await page.route("**/api/events*", route => route.fulfill({ json: { events } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { members: [], submissions: [], batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.route("**/api/registrations*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get("action");
    const eventId = url.searchParams.get("event_id");
    state.requests.push({ action, eventId, method: request.method() });
    if (action === "form" && request.method() === "GET") {
      if (state.formFailures.length) return route.fulfill({ status: state.formFailures.shift(), json: { error: "Kayıt formuna geçici olarak ulaşılamıyor." } });
      const form = state.forms.get(eventId) || null;
      const event = events.find(value => value.id === eventId);
      const open = !!form?.enabled && event?.published && event.date >= "2026-10-04";
      const counts = summarize(state.entries.get(eventId) || []);
      const mainFull = !!open && form.maxRegistrations !== null && counts.main >= form.maxRegistrations;
      const waitlistAvailable = mainFull && form.waitlist.enabled && counts.waitlisted < form.waitlist.capacity;
      const full = mainFull && !waitlistAvailable;
      const stage = !open || full ? "closed" : waitlistAvailable ? "waitlist" : "main";
      const publicForm = form ? structuredClone(form) : null;
      if (publicForm) { delete publicForm.maxRegistrations; delete publicForm.waitlist.capacity; }
      return route.fulfill({ json: { form: publicForm, available: !!open && !full, stage, full,
        ...(form?.showRemainingCapacity ? { capacity: { limit: form.maxRegistrations, main: counts.main, remaining: form.maxRegistrations == null ? null : Math.max(0, form.maxRegistrations - counts.main) } } : {}),
        ...(full ? { message: form.waitlist.enabled ? "Etkinliğimizin asıl ve yedek kontenjanları dolmuştur. İlginiz için teşekkür ederiz." : fullMessage } : {}) } });
    }
    if (action === "submit") {
      const data = await new Request("http://fixture.test", { method: "POST", headers: { "content-type": request.headers()["content-type"] }, body: request.postDataBuffer() }).formData();
      const file = data.get("receipt");
      state.submissions.push({
        eventId, answers: JSON.parse(data.get("answers")), requestId: data.get("requestId"), website: data.get("website"),
        receipt: file ? { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) } : null,
        paymentDeclared: data.get("paymentDeclared"), mediaConsent: data.get("mediaConsent"),
        contentType: request.headers()["content-type"],
      });
      if (state.submitFailures.length) {
        const failure = state.submitFailures.shift();
        return route.fulfill({ status: typeof failure === "number" ? failure : failure.status, json: { error: typeof failure === "number" ? "Kayıt henüz doğrulanamadı. Lütfen tekrar deneyin." : failure.error, ...(failure.code ? { code: failure.code } : {}) } });
      }
      const currentForm = state.forms.get(eventId), counts = summarize(state.entries.get(eventId) || []);
      const registrationStatus = currentForm.maxRegistrations != null && counts.main >= currentForm.maxRegistrations ? "waitlisted" : "main";
      return route.fulfill({ json: { ok: true, reference: "test-reference", registrationStatus } });
    }
    if (action === "form" && request.method() === "POST") {
      const form = { ...request.postDataJSON(), eventId };
      state.saves.push(structuredClone(form));
      state.forms.set(eventId, form);
      return route.fulfill({ json: { ok: true, form } });
    }
    if (action === "admin") {
      const values = state.entries.get(eventId) || [];
      const pageNumber = Number(url.searchParams.get("page") || 1);
      return route.fulfill({ json: { form: state.forms.get(eventId) || formConfig(eventId), event: events.find(value => value.id === eventId), entries: values.slice((pageNumber - 1) * 50, pageNumber * 50), summary: summarize(values), page: pageNumber, totalPages: Math.max(1, Math.ceil(values.length / 50)) } });
    }
    if (action === "summary") {
      return route.fulfill({ json: { events: events.map(event => ({ eventId: event.id, title: event.title, ...summarize(state.entries.get(event.id) || []) })) } });
    }
    if (action === "payment") {
      const body = request.postDataJSON(); state.payments.push({ eventId, ...body });
      const value = (state.entries.get(eventId) || []).find(value => value.id === body.id);
      value.payment = { ...value.payment, reviewStatus: body.approved ? "approved" : "pending" };
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "cancel") {
      const body = request.postDataJSON(); state.cancellations.push({ eventId, ...body });
      const values = state.entries.get(eventId) || [], value = values.find(value => value.id === body.id);
      value.registrationStatus = "cancelled";
      const next = values.filter(value => value.registrationStatus === "waitlisted").sort((a,b) => a.sequence - b.sequence)[0];
      if (next) { next.registrationStatus = "main"; next.promotedAt = "2026-10-04T16:00:00Z"; }
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "delete") {
      const body = request.postDataJSON();
      state.deletions.push({ eventId, ...body });
      if (state.deleteFailures.length) return route.fulfill({ status: state.deleteFailures.shift(), json: { error: "Kayıt silinemedi. Lütfen tekrar deneyin." } });
      state.entries.set(eventId, (state.entries.get(eventId) || []).filter(value => value.id !== body.id));
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "receipt") {
      state.receiptReads.push({ eventId, id: url.searchParams.get("id") });
      return route.fulfill({ contentType: "image/png", headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, body: receiptBytes });
    }
    if (action === "export") return route.fulfill({ contentType: "text/csv", headers: { "Content-Disposition": 'attachment; filename="registrations.csv"' }, body: "Ad soyad,Sınıf,Telefon\nTest katılımcısı first,2. Sınıf,05551234567\n" });
    return route.fulfill({ status: 400, json: { error: "Unsupported fixture action" } });
  });
  return state;
}

async function fillCore(page) {
  await page.locator("#registration-full_name").fill("Yerel test katılımcısı");
  await page.locator("#registration-class_year").selectOption("2. Sınıf");
  await page.locator("#registration-phone").fill("05551234567");
}

async function openAdmin(page) {
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="registrations"]').click();
  await expect(page.locator("#registrationEvent")).toHaveValue("native-today");
  await expect(page.locator("#registrationDescription")).not.toBeEmpty();
}

test("native registration opens at the description and inputs on mobile without a poster or an embedded Google form ahead of it", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/form.html?event=native-today");
  await expect(page.locator("#registrationDescription")).toContainText("Kayıt öncesinde okuyun");
  await expect(page.locator("#registrationDescription")).toBeInViewport();
  await expect(page.locator("#registration-full_name")).toBeInViewport();
  await expect(page.locator("#nativeRegistrationForm")).toBeVisible();
  await expect(page.locator("#formFrame")).not.toHaveAttribute("src", /docs\.google\.com/);
  const geometry = await page.evaluate(() => ({ registration: document.getElementById("registrationSection").getBoundingClientRect().top, details: document.getElementById("nativeEventDetails").getBoundingClientRect().top, width: document.documentElement.scrollWidth }));
  expect(geometry.registration).toBeLessThan(geometry.details);
  expect(geometry.width).toBeLessThanOrEqual(390);
  await expect(page.locator("body")).not.toContainText(/kontenjan|kayıt sayacı|toplam kayıt/i);
});

test("anonymous registration validates required core and custom answers without requesting a receipt or optional media consent", async ({ page }) => {
  const state = await fixture(page, { custom: true });
  await page.goto("/form.html?event=native-today#registrationSection");
  await expect(page.locator("#registration-full_name")).toBeVisible();
  await page.locator("#registrationSubmit").click();
  expect(state.submissions).toHaveLength(0);
  await expect(page.locator("#registration-error-full_name")).toBeVisible();
  await fillCore(page);
  await page.locator("#registration-phone").fill("yanlış telefon");
  await page.locator("#registrationSubmit").click();
  expect(state.submissions).toHaveLength(0);
  await expect(page.locator("#registration-error-phone")).toBeVisible();
  await page.locator("#registration-phone").fill("05551234567");
  await page.locator("#registration-session").selectOption("Öğleden sonra");
  await page.locator("#registration-diet-1").check();
  await page.locator("#registration-topics-0").check();
  await page.locator("#registration-topics-1").check();
  await page.locator("#registration-notes").fill("Ulaşım için bilgilendirme rica ederim.");
  await expect(page.locator("#registrationReceipt")).toHaveCount(0);
  await expect(page.locator("#registrationMediaConsent")).not.toBeChecked();
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationSuccess")).toBeVisible();
  expect(state.submissions).toHaveLength(1);
  const submitted = state.submissions[0];
  expect(submitted.eventId).toBe("native-today");
  expect(submitted.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(submitted.answers).toEqual({ full_name: "Yerel test katılımcısı", class_year: "2. Sınıf", phone: "05551234567", session: "Öğleden sonra", diet: "Vejetaryen", topics: ["Klinik eczacılık", "Araştırma"], notes: "Ulaşım için bilgilendirme rica ederim." });
  expect(submitted.requestId).toBeTruthy();
  expect(submitted.website || "").toBe("");
  expect(submitted.receipt).toBeNull();
  expect(submitted.paymentDeclared).toBe("false");
  expect(submitted.mediaConsent).toBe("false");
  expect(state.requests.some(request => ["admin", "summary", "receipt"].includes(request.action))).toBe(false);
  await expect(page.locator("body")).not.toContainText(/toplam kayıt|bekleyen kayıt|kontenjan/i);
});

test("a failed registration keeps answers and optional media choice, and a retry reuses its idempotency key", async ({ page }) => {
  const state = await fixture(page);
  state.submitFailures.push(503);
  await page.goto("/form.html?event=native-today");
  await fillCore(page);
  await page.locator("#registrationMediaConsent").check();
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationFeedback")).toContainText("tekrar deneyin");
  await expect(page.locator("#registrationSuccess")).not.toBeVisible();
  await expect(page.locator("#registration-full_name")).toHaveValue("Yerel test katılımcısı");
  await expect(page.locator("#registration-class_year")).toHaveValue("2. Sınıf");
  await expect(page.locator("#registration-phone")).toHaveValue("05551234567");
  await expect(page.locator("#registrationMediaConsent")).toBeChecked();
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationSuccess")).toBeVisible();
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[1].mediaConsent).toBe("true");
  expect(state.submissions[1].requestId).toBe(state.submissions[0].requestId);
  expect(state.submissions[1].answers).toEqual(state.submissions[0].answers);
  expect(state.submissions[1].receipt).toEqual(state.submissions[0].receipt);
});

test("a conflicting retry shows the backend's descriptive reason and keeps edited answers without claiming success", async ({ page }) => {
  const state = await fixture(page);
  const conflict = "Önceki kaydın alınmış olabilir. Organizatörlerle iletişime geç.";
  state.submitFailures.push(503, { status: 409, error: conflict });
  await page.goto("/form.html?event=native-today");
  await fillCore(page);
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationFeedback")).toContainText("tekrar deneyin");
  await page.locator("#registration-full_name").fill("Düzeltilmiş test katılımcısı");
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationFeedback")).toHaveText(conflict);
  await expect(page.locator("#registration-full_name")).toHaveValue("Düzeltilmiş test katılımcısı");
  await expect(page.locator("#registrationSuccess")).not.toBeVisible();
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[1].requestId).toBe(state.submissions[0].requestId);
  expect(state.submissions[1].answers.full_name).toBe("Düzeltilmiş test katılımcısı");
  expect(state.submissions[0].answers.full_name).toBe("Yerel test katılımcısı");
});

test("a full form shows the thank-you message and other events without inputs or public counts", async ({ page }) => {
  const state = await fixture(page);
  state.forms.get("native-today").maxRegistrations = 3;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/form.html?event=native-today#registrationSection");
  await expect(page.locator("#nativeRegistrationFull p")).toHaveText(fullMessage);
  await expect(page.locator("#nativeRegistrationFull")).toBeInViewport();
  await expect(page.locator("#nativeRegistrationForm")).toHaveCount(0);
  await expect(page.locator("#registrationSection input")).toHaveCount(0);
  await expect(page.locator("#registrationSuccess")).toHaveCount(0);
  await expect(page.locator("#nativeRegistrationFull a")).toHaveAttribute("href", "etkinlikler.html");
  await expect(page.locator("#nativeRegistrationFull")).not.toContainText(/\d|toplam kayıt|kalan yer/i);
  expect(state.submissions).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("when the last place fills while a form is open, the closed banner retains answers and never claims success", async ({ page }) => {
  const state = await fixture(page);
  state.forms.get("native-today").maxRegistrations = 4;
  state.submitFailures.push({ status: 409, error: fullMessage, code: "REGISTRATION_FULL" });
  await page.goto("/form.html?event=native-today#registrationSection");
  await fillCore(page);
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationAvailability")).toContainText(fullMessage);
  await expect(page.locator("#registration-full_name")).toHaveValue("Yerel test katılımcısı");
  await expect(page.locator("#registrationSubmit")).toBeDisabled();
  await expect(page.locator("#registrationSuccess")).toHaveCount(0);
  expect(state.submissions).toHaveLength(1);
});

test("Forms offers every enabled native or legacy event, preserves same-day access, and never falls back from a closed native form", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/form.html");
  const cards = page.locator("#formCatalogList article.form-catalog-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".form-catalog-title")).toHaveText(events.slice(0, 3).map(event => event.title));
  await cards.nth(1).getByRole("link", { name: `${events[1].title} kayıt formunu aç`, exact: true }).click();
  await expect(page.locator("#nativeRegistrationForm")).toBeVisible();
  await expect(page.locator("#registrationDescription")).toHaveText("İkinci etkinliğin açıklaması.");
  await page.goto("/form.html?event=legacy");
  await expect(page.locator("#formFrame")).toHaveAttribute("src", /legacy-fixture.*embedded=true/);
  await expect(page.locator("#nativeRegistrationForm")).not.toBeVisible();
  for (const id of ["native-disabled", "native-past"]) {
    await page.goto(`/form.html?event=${id}`);
    await expect(page.locator("#nativeRegistrationUnavailable")).toBeVisible();
    await expect(page.locator("#nativeRegistrationForm")).not.toBeVisible();
    await expect(page.locator("#formFrame")).not.toHaveAttribute("src", /docs\.google\.com/);
  }
  expect(state.submissions).toHaveLength(0);
});

test("a registration form load failure offers a retry without displaying another event's questions", async ({ page }) => {
  const state = await fixture(page);
  state.formFailures.push(503);
  await page.goto("/form.html?event=native-next");
  await expect(page.locator("#registrationFeedback")).toContainText("ulaşılamıyor");
  await expect(page.locator("#nativeRegistrationForm")).not.toBeVisible();
  await page.getByRole("button", { name: /tekrar dene/i }).click();
  await expect(page.locator("#nativeRegistrationForm")).toBeVisible();
  await expect(page.locator("#registrationDescription")).toHaveText("İkinci etkinliğin açıklaması.");
  await expect(page.locator("body")).not.toContainText("Kayıt öncesinde okuyun");
});

test("an admin configures the top description, optional core fields and required custom choices separately for each event", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  await page.locator("#registrationDescription").fill("Önce açıklamayı okuyun. Ücret ve ödeme bilgileri bu alanda.");
  await page.locator('[data-registration-field="class_year"] [data-field-prop="required"]').uncheck();
  await page.locator('[data-registration-field="phone"] [data-field-prop="required"]').uncheck();
  await page.locator("#registrationPaymentEnabled").check();
  await page.locator("#registrationAddField").click();
  const question = page.locator("#registrationFields [data-registration-field]").last();
  const id = await question.getAttribute("data-registration-field");
  await question.locator('[data-field-prop="label"]').fill("Katılım oturumu");
  await question.locator('[data-field-prop="type"]').selectOption("select");
  await question.locator('[data-option-label]').nth(0).fill("Sabah");
  await question.locator('[data-option-label]').nth(1).fill("Akşam");
  await question.locator('[data-field-prop="required"]').check();
  await page.locator("#registrationSave").click();
  await expect(page.locator("#registrationFeedback")).toContainText(/kaydedildi/i);
  expect(state.saves).toHaveLength(1);
  const saved = state.saves[0];
  expect(saved.eventId).toBe("native-today");
  expect(saved.description).toBe("Önce açıklamayı okuyun. Ücret ve ödeme bilgileri bu alanda.");
  expect(saved.fields.find(field => field.id === "full_name").required).toBe(true);
  expect(saved.fields.find(field => field.id === "class_year").required).toBe(false);
  expect(saved.fields.find(field => field.id === "phone").required).toBe(false);
  expect(saved.fields.find(field => field.id === id)).toMatchObject({ label: "Katılım oturumu", type: "select", options: ["Sabah", "Akşam"], required: true });
  expect(saved.receipt).toEqual({ enabled: false, required: false });
  expect(saved.payment).toEqual({ enabled: true });
  expect(saved.maxRegistrations).toBeNull();
  await page.locator("#registrationEvent").selectOption("native-next");
  await expect(page.locator("#registrationDescription")).toHaveValue("İkinci etkinliğin açıklaması.");
  await expect(page.locator('[data-registration-field="phone"] [data-field-prop="required"]')).toBeChecked();
  await expect(page.locator(`#registrationFields [data-registration-field="${id}"]`)).toHaveCount(0);
  await page.locator("#registrationEvent").selectOption("native-today");
  await expect(page.locator("#registrationDescription")).toHaveValue(saved.description);
  await expect(page.locator(`[data-registration-field="${id}"] [data-field-prop="label"]`)).toHaveValue("Katılım oturumu");
});

test("an admin sets a per-event upper limit, retains it while switching events, and can return to unlimited registrations", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  await page.locator("#registrationMaxRegistrations").fill("40");
  await page.locator("#registrationSave").click();
  await expect(page.locator("#registrationFeedback")).toContainText(/kaydedildi/i);
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].maxRegistrations).toBe(40);
  await page.locator("#registrationEvent").selectOption("native-next");
  await expect(page.locator("#registrationMaxRegistrations")).toHaveValue("");
  await page.locator("#registrationEvent").selectOption("native-today");
  await expect(page.locator("#registrationMaxRegistrations")).toHaveValue("40");
  await page.locator("#registrationMaxRegistrations").fill("");
  await page.locator("#registrationSave").click();
  await expect.poll(() => state.saves.length).toBe(2);
  expect(state.saves[1].maxRegistrations).toBeNull();
});

test("an admin reloads clean form settings from the server while unsaved edits survive switching events", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  const externalDescription = "Başka bir yönetici açıklamayı güncelledi.";
  state.forms.set("native-today", { ...state.forms.get("native-today"), description: externalDescription });
  await page.locator("#registrationReload").click();
  await expect(page.locator("#registrationDescription")).toHaveValue(externalDescription);
  const draftDescription = "Henüz kaydetmediğim kendi açıklamam.";
  await page.locator("#registrationDescription").fill(draftDescription);
  state.forms.set("native-today", { ...state.forms.get("native-today"), description: "Sunucuda daha yeni bir açıklama." });
  await page.locator("#registrationEvent").selectOption("native-next");
  await expect(page.locator("#registrationDescription")).toHaveValue("İkinci etkinliğin açıklaması.");
  await page.locator("#registrationEvent").selectOption("native-today");
  await expect(page.locator("#registrationDescription")).toHaveValue(draftDescription);
  expect(state.saves).toHaveLength(0);
});

test("an admin filters registrations by class, reviews a private receipt and compares class distributions without review statuses", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  const entries = page.locator("#registrationEntries [data-registration-entry]");
  await expect(entries).toHaveCount(3);
  await expect(page.locator("#registrationClassBreakdown")).toContainText("2. Sınıf");
  await expect(page.locator("#registrationClassBreakdown")).toContainText("1. Sınıf");
  await page.locator("#registrationClassFilter").selectOption("2. Sınıf");
  await expect(entries).toHaveCount(2);
  await expect(page.locator("#registrationStatusFilter")).toHaveCount(0);
  await expect(page.locator("#registrationEntries")).not.toContainText(/reddet|beklemede/i);
  await expect(page.locator("[data-registration-approve], [data-registration-reject]")).toHaveCount(0);
  await expect(entries.first()).toContainText("Test katılımcısı first");
  await entries.first().locator('[data-registration-receipt="first"]').click();
  await expect(page.locator("#registrationReceiptDialog")).toBeVisible();
  await expect(page.locator("#registrationReceiptImage")).toHaveAttribute("src", /^blob:http:\/\/127\.0\.0\.1:8888\//);
  await page.locator("#registrationReceiptImage").evaluate(image => image.decode());
  expect(state.receiptReads).toEqual([{ eventId: "native-today", id: "first" }]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#registrationReceiptDialog")).not.toBeVisible();
  const nextComparison = page.locator('input[name="registrationCompareEvent"][value="native-next"]');
  await nextComparison.check();
  await expect(page.locator("#registrationComparison")).toContainText("Araştırma buluşması");
  await expect(page.locator("#registrationComparison")).toContainText("Bugünkü bilim atölyesi");
  await expect(page.locator("#registrationComparison")).toContainText("3. Sınıf");
  await expect(page.locator("#registrationComparison")).toContainText("2. Sınıf");
  const csv = page.waitForEvent("download");
  await page.locator("#registrationExport").click();
  const downloaded = await csv;
  expect(downloaded.suggestedFilename()).toMatch(/\.csv$/);
  expect(readFileSync(await downloaded.path(), "utf8")).toContain("Test katılımcısı first,2. Sınıf,05551234567");
});

test("an admin can cancel deletion, a failed deletion keeps the receipt and counts, and successful deletion frees a place", async ({ page }) => {
  const state = await fixture(page);
  state.forms.get("native-today").maxRegistrations = 3;
  state.deleteFailures.push(503);
  await openAdmin(page);
  const entries = page.locator("#registrationEntries [data-registration-entry]");
  const first = page.locator('[data-registration-entry="first"]');
  await expect(entries).toHaveCount(3);
  await expect(page.locator("#registrationCapacityInfo")).toHaveAttribute("data-full", "true");
  await page.locator('input[name="registrationCompareEvent"][value="native-next"]').check();
  await page.locator('input[name="registrationCompareEvent"][value="legacy"]').uncheck();
  await expect(page.locator("#registrationComparison")).toContainText("Araştırma buluşması");
  const comparisonTotals = page.locator("#registrationComparison tr").filter({ has: page.getByRole("rowheader", { name: "Toplam kayıt", exact: true }) }).locator("td");
  const comparisonSecondClass = page.locator("#registrationComparison tr").filter({ has: page.getByRole("rowheader", { name: "2. Sınıf", exact: true }) }).locator("td");
  await expect(comparisonTotals).toHaveText(["3", "1"]);
  await expect(comparisonSecondClass).toHaveText(["2", "0"]);
  const descriptionDraft = "Silme işlemi sırasında korunan açıklama taslağı.";
  await page.locator("#registrationDescription").fill(descriptionDraft);
  await first.locator('[data-registration-delete="first"]').click();
  await first.locator('[data-registration-delete-cancel="first"]').click();
  expect(state.deletions).toHaveLength(0);
  await expect(entries).toHaveCount(3);
  await first.locator('[data-registration-delete="first"]').click();
  await first.locator('[data-registration-delete-confirm="first"]').click();
  await expect(first).toContainText("Kayıt silinemedi");
  await expect(entries).toHaveCount(3);
  await expect(first.locator('[data-registration-receipt="first"]')).toBeVisible();
  expect(state.entries.get("native-today")).toHaveLength(3);
  await expect(page.locator("#registrationClassBreakdown")).toContainText("2. Sınıf: 2");
  await first.locator('[data-registration-delete-confirm="first"]').click();
  await expect(entries).toHaveCount(2);
  expect(state.deletions).toEqual([
    { eventId: "native-today", id: "first" },
    { eventId: "native-today", id: "first" },
  ]);
  await expect(page.locator("#registrationSummary")).toContainText("2");
  await expect(page.locator("#registrationClassBreakdown")).toContainText("2. Sınıf: 1");
  await expect(page.locator("#registrationCapacityInfo")).toHaveAttribute("data-full", "false");
  await expect(page.locator("#registrationDescription")).toHaveValue(descriptionDraft);
  await expect(comparisonTotals).toHaveText(["2", "1"]);
  await expect(comparisonSecondClass).toHaveText(["1", "0"]);
  expect(state.entries.get("native-today")).toHaveLength(2);
  await page.goto("/form.html?event=native-today#registrationSection");
  await expect(page.locator("#nativeRegistrationForm")).toBeVisible();
  await expect(page.locator("#nativeRegistrationFull")).toHaveCount(0);
});

test("class filters and totals include registrations beyond the API's first page", async ({ page }) => {
  const state = await fixture(page);
  state.entries.set("native-today", [
    ...Array.from({ length: 50 }, (_, index) => entry(`page-one-${index}`, "2. Sınıf")),
    entry("page-two", "5. Sınıf"),
  ]);
  await openAdmin(page);
  await expect(page.locator("#registrationEntries [data-registration-entry]")).toHaveCount(51);
  await expect(page.locator("#registrationSummary")).toContainText("51");
  await page.locator("#registrationClassFilter").selectOption("5. Sınıf");
  await expect(page.locator("#registrationEntries [data-registration-entry]")).toHaveCount(1);
  await expect(page.locator("#registrationEntries")).toContainText("Test katılımcısı page-two");
  await expect(page.locator("#registrationClassBreakdown")).toContainText("5. Sınıf: 1");
  // Filtering the entries must preserve the event-wide totals for comparison.
  await expect(page.locator("#registrationSummary")).toContainText("51");
});

test("paid main registration allows reversing the declaration before submit and keeps media consent optional", async ({ page }) => {
  const state = await fixture(page);
  state.forms.get("native-today").payment.enabled = true;
  await page.goto("/form.html?event=native-today");
  await fillCore(page);
  const declaration = page.locator("#registrationPaymentDeclared");
  await expect(declaration).toBeVisible();
  await expect(declaration).not.toBeChecked();
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registration-error-payment")).toContainText("işaretlemelisiniz");
  expect(state.submissions).toHaveLength(0);
  await declaration.check();
  await declaration.uncheck();
  await page.locator("#registrationSubmit").click();
  expect(state.submissions).toHaveLength(0);
  await declaration.check();
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationSuccess")).toContainText("Asıl katılımcı listesi");
  expect(state.submissions[0]).toMatchObject({ paymentDeclared: "true", mediaConsent: "false", receipt: null });
});

test("waitlisted applicants see a clear distinction from admission and never have to declare payment", async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.forms.get("native-today"), { maxRegistrations: 3, waitlist: { enabled: true, capacity: 2 }, payment: { enabled: true } });
  await page.goto("/form.html?event=native-today");
  await expect(page.locator("#registrationAvailability")).toContainText("Başvurunuz yedek listeye alınacaktır");
  await expect(page.locator("#registrationPaymentDeclared")).toBeHidden();
  await expect(page.locator("#registrationAvailability progress")).toHaveCount(0);
  await fillCore(page);
  await page.locator("#registrationMediaConsent").check();
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationSuccess")).toContainText("Yedek kaydınız başarıyla oluşturuldu");
  await expect(page.locator("#registrationSuccess")).toContainText("kesin katılım değildir");
  expect(state.submissions[0]).toMatchObject({ paymentDeclared: "false", mediaConsent: "true" });
});

test("remaining capacity is opt-in and refreshes without clearing answers or choices", async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.forms.get("native-today"), { maxRegistrations: 15, showRemainingCapacity: true, waitlist: { enabled: true, capacity: 2 } });
  await page.goto("/form.html?event=native-today");
  await expect(page.locator("#registrationAvailability")).toContainText("12 kişilik yer kaldı");
  await expect(page.locator("#registrationAvailability progress")).toHaveAttribute("max", "15");
  await fillCore(page);
  await page.locator("#registrationMediaConsent").check();
  state.forms.get("native-today").maxRegistrations = 6;
  await page.clock.runFor(30000);
  await expect(page.locator("#registrationAvailability")).toContainText("Son 3 kişilik yer kaldı");
  await expect(page.locator("#registration-full_name")).toHaveValue("Yerel test katılımcısı");
  await expect(page.locator("#registrationMediaConsent")).toBeChecked();
  state.forms.get("native-today").maxRegistrations = 3;
  await page.clock.runFor(30000);
  await expect(page.locator("#registrationAvailability")).toContainText("Yedek başvuru kesin katılım değildir");
  await expect(page.locator("#registrationAvailability")).toContainText("Asıl kontenjan doldu");
  await expect(page.locator("#registration-full_name")).toHaveValue("Yerel test katılımcısı");
  state.forms.get("native-today").showRemainingCapacity = false;
  await page.clock.runFor(30000);
  await expect(page.locator("#registrationAvailability progress")).toHaveCount(0);
  await expect(page.locator("#registrationAvailability")).not.toContainText(/kişilik|kalan/);
});

test("a full waitlist closes with its specific message and unlimited capacity has no artificial progress", async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.forms.get("native-today"), { maxRegistrations: 3, waitlist: { enabled: true, capacity: 1 } });
  state.entries.get("native-today").push({ ...entry("wait", "1. Sınıf"), registrationStatus: "waitlisted", sequence: 4 });
  await page.goto("/form.html?event=native-today");
  await expect(page.locator("#nativeRegistrationFull")).toContainText("asıl ve yedek kontenjanları dolmuştur");
  await expect(page.locator("#nativeRegistrationForm")).toHaveCount(0);
  state.forms.get("native-next").showRemainingCapacity = true;
  await page.goto("/form.html?event=native-next");
  await expect(page.locator("#registrationAvailability")).toContainText("Kontenjan sınırsız");
  await expect(page.locator("#registrationAvailability progress")).toHaveCount(0);
});

test("an admin independently enables waitlist, visible capacity and payment settings with guarded waitlist limits", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  await expect(page.locator("#registrationWaitlistEnabled")).not.toBeChecked();
  await expect(page.locator("#registrationShowRemaining")).not.toBeChecked();
  await expect(page.locator("#registrationWaitlistCapacity")).toBeDisabled();
  await page.locator("#registrationWaitlistEnabled").check();
  await page.locator("#registrationWaitlistCapacity").fill("5");
  await page.locator("#registrationSave").click();
  await expect(page.locator("#registrationFeedback")).toContainText("asıl kontenjan");
  expect(state.saves).toHaveLength(0);
  await page.locator("#registrationMaxRegistrations").fill("40");
  await page.locator("#registrationShowRemaining").check();
  await page.locator("#registrationPaymentEnabled").check();
  await page.locator("#registrationSave").click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0]).toMatchObject({ maxRegistrations: 40, waitlist: { enabled: true, capacity: 5 }, showRemainingCapacity: true, payment: { enabled: true } });
  await page.locator("#registrationEvent").selectOption("native-next");
  await expect(page.locator("#registrationWaitlistEnabled")).not.toBeChecked();
  await expect(page.locator("#registrationShowRemaining")).not.toBeChecked();
  await page.locator("#registrationEvent").selectOption("native-today");
  await expect(page.locator("#registrationWaitlistEnabled")).toBeChecked();
  await expect(page.locator("#registrationWaitlistCapacity")).toHaveValue("5");
});

test("admin groups admissions, keeps waitlist order and reviews payment independently before a cancellation promotes the next applicant", async ({ page }) => {
  const state = await fixture(page);
  state.entries.set("native-today", [
    { ...entry("main", "1. Sınıf"), registrationStatus: "main", payment: { declared: true, reviewStatus: "pending" } },
    { ...entry("wait-later", "2. Sınıf"), registrationStatus: "waitlisted", sequence: 5, payment: { declared: false, reviewStatus: "not_required" } },
    { ...entry("wait-first", "2. Sınıf"), registrationStatus: "waitlisted", sequence: 4, payment: { declared: false, reviewStatus: "not_required" } },
    { ...entry("cancelled", "3. Sınıf"), registrationStatus: "cancelled" },
  ]);
  await openAdmin(page);
  const main = page.locator('[data-registration-entry="main"]');
  await expect(main).toContainText("Ödeme onayı bekleniyor");
  await expect(main.locator("[data-registration-ticket]")).toBeDisabled();
  const queue = page.getByRole("region", { name: "Yedek katılımcı listesi" });
  await expect(queue.locator(".registration-entry h4")).toHaveText(["Test katılımcısı wait-first", "Test katılımcısı wait-later"]);
  await main.locator("[data-registration-payment]").click();
  await expect(main).toContainText("Ödeme onaylandı");
  await expect(main.locator("[data-registration-ticket]")).toBeEnabled();
  expect(state.payments).toEqual([{ eventId: "native-today", id: "main", approved: true }]);
  page.once("dialog", dialog => dialog.accept());
  await main.locator("[data-registration-cancel]").click();
  await expect(main).toHaveAttribute("data-registration-status", "cancelled");
  await expect(page.locator('[data-registration-entry="wait-first"]')).toHaveAttribute("data-registration-status", "main");
  await expect(page.locator('[data-registration-entry="wait-first"]')).toContainText("Asıl listeye yükseltildi");
  await page.locator("#registrationRecordFilter").selectOption("waitlisted");
  await expect(page.locator("#registrationEntries [data-registration-entry]")).toHaveCount(1);
  expect(state.cancellations).toEqual([{ eventId: "native-today", id: "main" }]);
});
