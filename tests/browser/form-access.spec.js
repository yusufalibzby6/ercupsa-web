import { test, expect } from "@playwright/test";

const event = { id: "draft-registration", title: "Duyurusu henüz yapılmayan atölye", date: "2026-10-22", time: "18:00",
  location: "Eczacılık Fakültesi", poster: "", category: "Atölye", description: "Kayıt bağlantısı paylaşıma hazır.",
  published: false, registrationMode: "native", registrationEnabled: true };
const config = { eventId: event.id, enabled: true, description: "Katılım bilgilerini aşağıya yazabilirsin.",
  fields: [
    { id: "full_name", type: "text", label: "Ad soyad", required: true },
    { id: "class_year", type: "select", label: "Sınıf", required: true, options: ["1. Sınıf", "2. Sınıf"] },
    { id: "phone", type: "tel", label: "Telefon", required: true },
  ], receipt: { enabled: false, required: false } };

async function fixture(page, { enabled = true, full = false, failure = false } = {}) {
  const state = { enabled, full, failure, submissions: [], reads: 0 };
  await page.clock.install({ time: new Date("2026-10-14T12:00:00+03:00") });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked form-access test route" } }));
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/registrations*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.searchParams.get("event_id") !== event.id)
      return route.fulfill({ status: 404, json: { error: "Etkinlik bulunamadı." } });
    if (url.searchParams.get("action") === "form") {
      state.reads++;
      if (state.failure) return route.fulfill({ status: 503, json: { error: "Form geçici olarak yüklenemedi." } });
      if (!state.enabled) return route.fulfill({ status: 404, json: { error: "Etkinlik bulunamadı." } });
      return route.fulfill({ json: { event, form: config, available: !state.full, full: state.full } });
    }
    if (url.searchParams.get("action") === "submit") {
      const payload = await new Request("https://fixture.test", { method: "POST", headers: { "content-type": request.headers()["content-type"] }, body: request.postDataBuffer() }).formData();
      state.submissions.push(JSON.parse(payload.get("answers")));
      return route.fulfill({ json: { ok: true, reference: "private-link-reference" } });
    }
    return route.fulfill({ status: 400, json: { error: "Unsupported fixture action" } });
  });
  return state;
}

test("an enabled unpublished native form opens and accepts a registration through its own link", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator("#formTitle")).toHaveText(event.title);
  await expect(page.locator("#nativeFormWrap")).toContainText(config.description);
  await expect(page.locator("#formCatalog")).not.toBeVisible();
  await page.locator("#registration-full_name").fill("Özel bağlantı katılımcısı");
  await page.locator("#registration-class_year").selectOption("2. Sınıf");
  await page.locator("#registration-phone").fill("05551234567");
  await page.getByRole("button", { name: "Kaydımı gönder", exact: true }).click();
  await expect(page.locator("#nativeFormWrap")).toContainText("private-link-reference");
  expect(state.submissions).toEqual([{ full_name: "Özel bağlantı katılımcısı", class_year: "2. Sınıf", phone: "05551234567" }]);
});

test("unpublished forms are absent from the catalog and their enabled link can be closed independently", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/form.html");
  await expect(page.locator("#formEmpty")).toBeVisible();
  await expect(page.locator("#formCatalogList")).not.toContainText(event.title);
  expect(state.reads).toBe(0);
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator("#registration-full_name")).toBeVisible();
  state.enabled = false;
  await page.reload();
  await expect(page.locator("#formEmptyMessage")).toContainText("bulunamadı");
  await expect(page.locator("#eventDetails")).not.toBeVisible();
  await expect(page.locator("#registrationSection")).not.toBeVisible();
  await expect(page.locator("#formTitle")).not.toContainText(event.title);
});

test("sharing an unpublished enabled form retains the working form link instead of an unavailable preview", async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => { window.copiedFormLink = value; } }, configurable: true });
  });
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator("#registration-full_name")).toBeVisible();
  await page.locator("#nativeEventDetails").locator("summary").click();
  await page.locator("#shareEvent").click();
  await expect.poll(() => page.evaluate(() => window.copiedFormLink)).toBe(`https://ercupsa.com.tr/form.html?event=${event.id}`);
});

test("a full unpublished form shows the capacity message and a failed private-link read can be retried", async ({ page }) => {
  const state = await fixture(page, { full: true });
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator("#nativeFormWrap")).toContainText("Kontenjanımız dolmuştur");
  await expect(page.locator("#registration-full_name")).toHaveCount(0);
  state.full = false; state.failure = true;
  await page.reload();
  await expect(page.locator("#formError")).toBeVisible();
  await expect(page.locator("#eventDetails")).not.toBeVisible();
  state.failure = false;
  await page.locator("#formRetry").click();
  await expect(page.locator("#registration-full_name")).toBeVisible();
  await expect(page.locator("#formError")).not.toBeVisible();
});
