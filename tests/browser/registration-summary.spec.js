import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const reference = "3c6db343-3a34-4a6d-84e2-c458e835bb24";
const receipt = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64");
const publicEvent = { id: "summary-test", title: "Yayınlanan etkinlik", date: "2026-10-12", time: "18:00", location: "Kayseri", images: [], published: true, registrationMode: "native", registrationEnabled: true };
async function fixture(page, { result = { ok: true, reference }, event = publicEvent, failures = [], clipboardFails = false } = {}) {
  const state = { posts: [], otherRequests: [], failures: [...failures] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(shouldFail => {
    window.copiedRegistrationText = null;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => {
      if (shouldFail) throw new Error("Clipboard unavailable");
      window.copiedRegistrationText = text;
    } } });
  }, clipboardFails);
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => {
    state.otherRequests.push(route.request().url());
    return route.fulfill({ status: 501, json: { error: "Unmocked API" } });
  });
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [event] } }));
  await page.route("**/api/registrations*", async route => {
    const request = route.request(), action = new URL(request.url()).searchParams.get("action");
    if (action === "form") return route.fulfill({ json: { available: true, form: { enabled: true, description: "Etkinlik kayıt açıklaması", fields: [
      { id: "full_name", type: "text", label: "Ad soyad", required: true },
      { id: "class_year", type: "select", label: "Sınıf", required: true, options: ["1. Sınıf", "2. Sınıf"] },
      { id: "phone", type: "tel", label: "Telefon", required: true },
    ], receipt: { enabled: true, required: false } } } });
    if (action === "submit") {
      const data = await new Request("http://fixture.test", { method: "POST", headers: { "content-type": request.headers()["content-type"] }, body: request.postDataBuffer() }).formData();
      const file = data.get("receipt");
      state.posts.push({ requestId: data.get("requestId"), answers: JSON.parse(data.get("answers")), receipt: file ? Buffer.from(await file.arrayBuffer()) : null });
      if (state.failures.length) return route.fulfill({ status: state.failures.shift(), json: { error: "Sunucu yanıtı alınamadı. Tekrar deneyebilirsin." } });
      return route.fulfill({ json: result });
    }
    state.otherRequests.push(request.url());
    return route.fulfill({ status: 501, json: { error: "Unmocked registration action" } });
  });
  await page.goto(`/form.html?event=${event.id}`);
  await expect(page.locator("#nativeRegistrationForm")).toBeVisible();
  return state;
}
async function fillAndSubmit(page) {
  await page.locator("#registration-full_name").fill("Özel katılımcı adı");
  await page.locator("#registration-class_year").selectOption("2. Sınıf");
  await page.locator("#registration-phone").fill("05551234567");
  await page.locator("#registrationSubmit").click();
}

test("successful registration uses the accepted event snapshot and saves only reference and public event details", async ({ page }) => {
  const snapshot = { id: publicEvent.id, title: "Kabul edilen <img src=x onerror=alert(1)> etkinlik", date: "2026-10-11", time: "16:30", location: "Eczacılık Fakültesi" };
  const state = await fixture(page, { result: { ok: true, reference, event: snapshot } });
  await page.locator("#registrationReceipt").setInputFiles({ name: "ozel-dekont.png", mimeType: "image/png", buffer: receipt });
  await fillAndSubmit(page);
  await expect(page.locator("#registrationSummaryTitle")).toHaveText(snapshot.title);
  await expect(page.locator("#registrationSummaryTitle img")).toHaveCount(0);
  await expect(page.locator("#registrationSummaryDate")).toHaveText("11 Ekim 2026");
  await expect(page.locator("#registrationSummaryTime")).toHaveText("16:30 · Türkiye saati");
  await expect(page.locator("#registrationReference")).toHaveText(reference);
  await expect(page.locator("#registrationSuccess")).toContainText("QR bilet kodu değildir");
  await page.locator("#registrationCopyReference").click();
  await expect(page.locator("#registrationSummaryStatus")).toContainText("kopyalandı");
  expect(await page.evaluate(() => window.copiedRegistrationText)).toBe(reference);
  const downloading = page.waitForEvent("download");
  await page.locator("#registrationDownloadSummary").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`ercupsa-kayit-${reference}.txt`);
  const saved = readFileSync(await download.path(), "utf8");
  expect(saved).toContain(`Etkinlik: ${snapshot.title}`);
  expect(saved).toContain("Tarih: 11 Ekim 2026");
  expect(saved).toContain("Saat: 16:30 · Türkiye saati");
  expect(saved).toContain(`Kayıt numarası: ${reference}`);
  expect(saved).not.toContain("Özel katılımcı adı");
  expect(saved).not.toContain("05551234567");
  expect(saved).not.toContain("ozel-dekont");
  expect(saved).not.toContain("data:image");
  expect(state.posts).toHaveLength(1);
  expect(state.otherRequests).toEqual([]);
});

test("legacy success metadata falls back to the selected event and does not invent an unknown time", async ({ page }) => {
  await fixture(page, { event: { ...publicEvent, time: "" } });
  await fillAndSubmit(page);
  await expect(page.locator("#registrationSummaryTitle")).toHaveText(publicEvent.title);
  await expect(page.locator("#registrationSummaryDate")).toHaveText("12 Ekim 2026");
  await expect(page.locator("#registrationSummaryTime")).toHaveText("Saat bilgisi paylaşılmadı.");
  await expect(page.locator("#registrationReference")).toHaveText(reference);
});

test("failed submission preserves fields, selected receipt and retry identity before showing the returned reference", async ({ page }) => {
  const state = await fixture(page, { failures: [503] });
  await page.locator("#registrationReceipt").setInputFiles({ name: "dekont.png", mimeType: "image/png", buffer: receipt });
  await fillAndSubmit(page);
  await expect(page.locator("#registrationFeedback")).toContainText("Tekrar deneyebilirsin");
  await expect(page.locator("#registration-full_name")).toHaveValue("Özel katılımcı adı");
  await expect(page.locator("#registration-class_year")).toHaveValue("2. Sınıf");
  await expect(page.locator("#registration-phone")).toHaveValue("05551234567");
  expect(await page.locator("#registrationReceipt").evaluate(input => input.files[0].name)).toBe("dekont.png");
  await page.locator("#registrationSubmit").click();
  await expect(page.locator("#registrationReference")).toHaveText(reference);
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.otherRequests).toEqual([]);
});

test("clipboard restrictions keep the reference readable and offer the local download fallback", async ({ page }) => {
  await fixture(page, { clipboardFails: true, result: { ok: true, reference, event: { ...publicEvent, time: "" } } });
  await fillAndSubmit(page);
  await page.locator("#registrationCopyReference").click();
  await expect(page.locator("#registrationSummaryStatus")).toContainText("özeti indirebilirsin");
  await expect(page.locator("#registrationReference")).toHaveText(reference);
  await expect(page.locator("#registrationSummaryTime")).toHaveText("Saat bilgisi paylaşılmadı.");
  await expect(page.locator("#registrationDownloadSummary")).toBeEnabled();
});
