import { test, expect } from "@playwright/test";
import { createEventShareHandler } from "../../netlify/functions/event-share.mjs";

const event = { id: "share-one", title: "Bilim & Eczacılık Buluşması", date: "2026-10-12", time: "18:30",
  category: "Buluşma", location: "Kayseri Eczacılık Fakültesi", description: "Birlikte keşfediyoruz.",
  poster: "https://res.cloudinary.com/example/image/upload/poster.jpg", images: [], published: true,
  registrationUrl: "https://docs.google.com/forms/d/e/share-form/viewform" };
const shareUrl = "https://ercupsa.com.tr/etkinlik/share-one";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-08T12:00:00+03:00") });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [event] } }));
});

test("sharing an event uses its canonical preview link for the native share sheet", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async data => { window.sharedEvent = data; } });
  });
  await page.goto("/form.html?event=share-one");
  await expect(page.locator("#formTitle")).toHaveText(event.title);
  await page.locator("#shareEvent").click();
  await expect.poll(() => page.evaluate(() => window.sharedEvent)).toEqual({ title: event.title, url: shareUrl });
});

test("clipboard and manual fallback retain the public event preview URL", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async value => { window.copiedEvent = value; } } });
  });
  await page.goto("/form.html?event=share-one");
  await page.locator("#shareEvent").click();
  await expect.poll(() => page.evaluate(() => window.copiedEvent)).toBe(shareUrl);
  await expect(page.locator("#eventShareStatus")).toHaveText("Etkinlik bağlantısı kopyalandı.");
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Clipboard unavailable"); }; });
  await page.locator("#shareEvent").click();
  await expect(page.locator("#eventShareStatus")).toHaveText(`Etkinlik bağlantısı: ${shareUrl}`);
});

test("the server preview is readable without JavaScript, fits mobile and links directly to the correct form", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.route("https://**/*", route => route.abort());
  const handler = createEventShareHandler({ events: async () => [{ ...event, title: '<script>alert(1)</script> Bilim' }] });
  await page.route("**/etkinlik/share-one", async route => {
    const response = await handler(new Request(route.request().url()));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto("http://127.0.0.1:8888/etkinlik/share-one");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText('<script>alert(1)</script> Bilim');
  await expect(page.getByRole("main")).toContainText("12 Ekim 2026");
  await expect(page.getByRole("main")).toContainText("18:30 · Türkiye saati");
  await expect(page.getByRole("link", { name: "Etkinlik detayları ve kayıt formu" })).toHaveAttribute("href", "/form.html?event=share-one#registrationSection");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", shareUrl);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", event.poster);
  await expect(page.locator("script")).toHaveCount(0);
  expect(await page.locator(".card").evaluate(element => getComputedStyle(element).borderRadius)).toBe("24px");
  const overflow = await page.locator("html").evaluate(element => element.scrollWidth);
  expect(overflow).toBeLessThanOrEqual(360);
  await context.close();
});

test("Netlify rewrites a public preview link to a generic not-found page without leaking content", async ({ request }) => {
  const response = await request.get("/etkinlik/nonexistent-share-preview-browser-test");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("Etkinlik bulunamadı");
  expect(html).not.toContain("og:url");
  expect(html).not.toContain("Etkinlik detayları ve kayıt formu");
});
