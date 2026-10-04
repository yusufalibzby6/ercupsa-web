import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
});

const events = [
  { id: "later", title: "Daha sonraki etkinlik", date: "2026-10-12", time: "18:00", category: "Atölye", description: "Atölye açıklaması", location: "Fakülte", images: [] },
  { id: "near", title: "Bugünkü buluşma", date: "2026-10-04", time: "18:00", category: "Buluşma", description: "Bilim ve paylaşım için buluşuyoruz.", location: '<img src=x onerror="window.locationInjected=true">', registrationUrl: "https://docs.google.com/forms/d/e/test-form/viewform", images: [] },
  { id: "past", title: "Geçmiş etkinlik", date: "2026-09-01", time: "18:00", category: "Gezi", description: "Gezi açıklaması", location: "Kayseri", registrationUrl: "https://docs.google.com/forms/d/e/old-form/viewform", images: [] },
];

test("social welcome stays, 187 stays fixed, public member links disappear, and the new sponsor follows Dileknaz", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#welcomeModal")).toBeVisible();
  await expect(page.locator('#welcomeModal a[href*="instagram.com"]')).toBeVisible();
  await expect(page.locator('#welcomeModal a[href*="chat.whatsapp.com"]')).toBeVisible();
  await page.getByRole("button", { name: "Siteye devam et →" }).click();
  await expect(page.locator('nav a[href="uyeler.html"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Topluluğa üye ol/i })).toHaveCount(0);
  const memberCount = page.locator('.counter-glow').filter({ hasText: /^187$/ });
  await expect(memberCount).toHaveCount(1);
  await memberCount.scrollIntoViewIfNeeded();
  await expect(memberCount).toHaveText("187");
  await expect(page.locator("#countdownWrap")).toHaveCount(0);
  await page.goto("/ekip.html");
  const names = await page.locator("main h3").allTextContents();
  expect(names[names.indexOf("Dileknaz Ergül") + 1]).toBe("Belinay Daş");
  const card = page.locator("main .group").filter({ has: page.getByRole("heading", { name: "Belinay Daş", exact: true }) });
  await expect(card).toContainText("Sponsorluk");
  await expect(card.locator("img")).toBeVisible();
});

test("nearby events come first, location is safe, and Google Forms keeps its own registration flow", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-04T15:00:00+03:00") });
  await page.route("**/api/events*", route => route.fulfill({ json: { events } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Siteye devam et →" }).click();
  await expect(page.locator("#home-events")).toContainText(events[1].location);
  await expect(page.locator('#home-events img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.locationInjected)).toBeUndefined();
  await page.goto("/etkinlikler.html");
  await expect(page.locator("#events article h2").first()).toHaveText("Bugünkü buluşma");
  await expect(page.locator("#events")).toContainText(events[1].location);
  await expect(page.locator('#events img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.locationInjected)).toBeUndefined();
  const nearCard = page.locator('#events article').filter({ has: page.getByRole('heading', { name: 'Bugünkü buluşma', exact: true }) });
  await expect(nearCard).toContainText('18:00');
  await expect(nearCard).toContainText('4 Ekim 2026');
  await expect(nearCard.getByRole('link', { name: 'Etkinliğe kaydol', exact: true })).toHaveAttribute('href', 'form.html?event=near#registrationSection');
  const directions = new URL(await nearCard.getByRole('link', { name: 'Yol tarifi al', exact: true }).getAttribute('href'));
  expect(directions.searchParams.get('destination')).toBe(events[1].location);
  const listDownload = page.waitForEvent('download');
  await nearCard.getByRole('link', { name: 'Takvime ekle', exact: true }).click();
  const listCalendar = readFileSync(await (await listDownload).path(), 'utf8');
  expect(listCalendar).toContain('DTSTART:20261004T150000Z');
  expect(listCalendar).toContain('SUMMARY:Bugünkü buluşma');
  await nearCard.getByRole('link', { name: 'Etkinliğe kaydol', exact: true }).click();
  await expect(page).toHaveURL(/form\.html\?event=near#registrationSection$/);
  await expect(page.locator('#registrationSection')).toBeInViewport();
  await expect(page.locator("#formTitle")).toHaveText("Bugünkü buluşma");
  await expect(page.locator("#eventTime")).toContainText("18:00");
  await expect(page.locator("#eventDescription")).toContainText(events[1].description);
  await expect(page.locator("#formFrame")).toHaveAttribute("src", /docs\.google\.com\/forms\/.*embedded=true/);
  await expect(page.locator("#mapsLink")).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1/);
  await expect(page.locator('#eventRegisterLink')).toBeVisible();
  await expect(page.locator('#eventRegisterLink')).toHaveAttribute('href', '#registrationSection');
  const download = page.waitForEvent("download");
  await page.locator("#calendarLink").click();
  const calendar = await download;
  const calendarText = readFileSync(await calendar.path(), "utf8");
  expect(calendarText).toContain("DTSTART:20261004T150000Z");
  expect(calendarText).toContain("SUMMARY:Bugünkü buluşma");
  await expect(page.locator("body")).not.toContainText(/kontenjan|kayıt sayacı/i);
  await page.clock.setSystemTime(new Date("2026-10-04T19:00:00+03:00"));
  await page.goto('/etkinlikler.html');
  await expect(page.locator('#events article h2').first()).toHaveText('Daha sonraki etkinlik');
  await page.locator('[data-filter="past"]').click();
  await expect(page.locator('#events article h2').first()).toHaveText('Bugünkü buluşma');
  await expect(nearCard.getByRole('link', { name: 'Etkinliğe kaydol', exact: true })).toBeVisible();
  const pastCard = page.locator('#events article').filter({ has: page.getByRole('heading', { name: 'Geçmiş etkinlik', exact: true }) });
  await expect(pastCard.getByRole('link', { name: 'Etkinliğe kaydol', exact: true })).toHaveCount(0);
  await page.goto("/form.html?event=near");
  await expect(page.locator("#registrationSection")).toBeVisible();
  await expect(page.locator('#eventRegisterLink')).toBeVisible();
  await page.goto("/form.html?event=past");
  await expect(page.locator("#formTitle")).toHaveText("Geçmiş etkinlik");
  await expect(page.locator("#registrationSection")).not.toBeVisible();
  await expect(page.locator('#eventRegisterLink')).not.toBeVisible();
});

test("failed contact submission preserves the message and only a successful retry shows success", async ({ page }) => {
  let attempts = 0;
  await page.route("http://127.0.0.1:8888/", route => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ status: ++attempts === 1 ? 500 : 200, body: "test response" });
  });
  await page.goto("/iletisim.html");
  await page.locator("#name").fill("Yerel test");
  await page.locator("#email").fill("test@example.test");
  await page.locator("#message").fill("Kaybolmaması gereken mesaj.");
  await page.locator("#submitBtn").click();
  await expect(page.locator("#errorMsg")).toBeVisible();
  await expect(page.locator("#successMsg")).not.toBeVisible();
  await expect(page.locator("#message")).toHaveValue("Kaybolmaması gereken mesaj.");
  await page.locator("#submitBtn").click();
  await expect(page.locator("#successMsg")).toBeVisible();
  expect(attempts).toBe(2);
});

test("gallery retries failures and supports original images, keyboard navigation and focus restoration", async ({ page }) => {
  let attempts = 0;
  await page.route("https://res.cloudinary.com/**", route => route.fulfill({ contentType: "image/png", body: readFileSync("assets/ticket-template-blank.png") }));
  await page.route("**/api/events*", route => {
    if (++attempts === 1) return route.fulfill({ status: 503, json: { error: "Temporary outage" } });
    return route.fulfill({ json: { events: [{ id: "gallery-event", title: "Buluşma", date: "2026-10-01", category: "Etkinlik", images: [
      { url: "https://res.cloudinary.com/test/image/upload/photo-one.jpg" },
      { url: "https://res.cloudinary.com/test/image/upload/photo-two.jpg" },
    ] }] } });
  });
  await page.goto("/galeri.html");
  await expect(page.locator("#gallery-status")).toHaveAttribute("role", "alert");
  await page.locator("[data-gallery-retry]").click();
  const first = page.locator("button[data-gallery-event]").first();
  await expect(first.locator("img")).toHaveAttribute("src", /c_limit,w_500,f_auto,q_auto/);
  await first.click();
  await expect(page.locator("#gallery-counter")).toHaveText("1 / 2");
  await expect(page.locator("#lightimg")).toHaveAttribute("src", "https://res.cloudinary.com/test/image/upload/photo-one.jpg");
  await expect(page.locator("#close")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#gallery-counter")).toHaveText("2 / 2");
  await page.keyboard.press("Escape");
  await expect(page.locator("#lightbox")).not.toBeVisible();
  await expect(first).toBeFocused();
});
