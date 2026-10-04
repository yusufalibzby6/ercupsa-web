import { test, expect } from "@playwright/test";

const now = new Date("2026-10-04T19:00:00+03:00");
const events = [
  {
    id: "third",
    title: '<img src=x onerror="window.titleInjected=true"> Bilim buluşması',
    date: "2026-10-12",
    time: "18:00",
    location: '<svg onload="window.locationInjected=true"> Kayseri',
    description: "Üçüncü etkinliğin kayıt formu.",
    category: "Buluşma",
    registrationUrl: "https://docs.google.com/forms/d/e/third-form/viewform?usp=sharing",
    images: [],
    published: true,
  },
  {
    id: "same-day",
    title: "Bugünkü atölye",
    date: "2026-10-04",
    time: "10:00",
    location: "Eczacılık Fakültesi",
    category: "Atölye",
    registrationUrl: "https://docs.google.com/forms/d/e/today-form/viewform",
    images: [],
    published: true,
  },
  {
    id: "second /?&=ç#",
    title: "İkinci etkinlik: eczacılık gezisi",
    date: "2026-10-08",
    time: "14:30",
    location: "Kayseri Şehir Hastanesi",
    description: "İkinci etkinliğin kayıt formu.",
    category: "Gezi",
    registrationUrl: "https://docs.google.com/forms/d/e/second-form/viewform?usp=sf_link",
    images: [],
    published: true,
  },
  {
    id: "past",
    title: "Dünkü etkinlik",
    date: "2026-10-03",
    time: "23:59",
    registrationUrl: "https://docs.google.com/forms/d/e/past-form/viewform",
    published: true,
  },
  { id: "no-form", title: "Formu olmayan etkinlik", date: "2026-10-10", time: "18:00", published: true },
  { id: "unsafe-url", title: "Güvensiz bağlantı", date: "2026-10-11", time: "18:00", registrationUrl: "javascript:window.linkInjected=true", published: true },
  { id: "draft", title: "Yayımlanmamış etkinlik", date: "2026-10-09", time: "18:00", registrationUrl: "https://docs.google.com/forms/d/e/draft-form/viewform", published: false },
];

const registrationPath = event => `form.html?event=${encodeURIComponent(event.id)}#registrationSection`;

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.route("https://**/*", route => route.abort());
});

async function mockEvents(page, data = events) {
  await page.route("**/api/events*", route => route.fulfill({ json: { events: data } }));
}

test("Forms lists every eligible event in date order without automatically choosing the nearest", async ({ page }) => {
  await mockEvents(page);
  await page.goto("/form.html");
  const cards = page.locator("#formCatalogList article.form-catalog-card");
  await expect(cards).toHaveCount(3);
  await expect(page.locator("#formCatalog")).toBeVisible();
  await expect(page.locator("#formLoading")).not.toBeVisible();
  await expect(page.locator("#eventDetails")).not.toBeVisible();
  await expect(page.locator("#registrationSection")).not.toBeVisible();
  await expect(cards.locator(".form-catalog-title")).toHaveText([events[1].title, events[2].title, events[0].title]);
  await expect(cards.nth(0)).toContainText("10:00");
  await expect(cards.nth(1)).toContainText("14:30");
  await expect(cards.nth(1)).toContainText(events[2].location);
  for (const [index, event] of [events[1], events[2], events[0]].entries()) {
    await expect(cards.nth(index).getByRole("link", { name: `${event.title} kayıt formunu aç`, exact: true })).toHaveAttribute("href", registrationPath(event));
  }
  for (const event of events.slice(3)) await expect(page.locator("#formCatalogList")).not.toContainText(event.title);
  await expect(page.locator('nav a[href="form.html"]').first()).toContainText("Formlar");
  await expect(page.locator('nav a[href="form.html"]').first()).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#formCatalogList img[src=x], #formCatalogList svg[onload]")).toHaveCount(0);
  expect(await page.evaluate(() => [window.titleInjected, window.locationInjected, window.linkInjected])).toEqual([undefined, undefined, undefined]);
});

test("the second and third Forms entries open and share their own stable encoded event links", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async value => { window.copiedEventLink = value; } },
      configurable: true,
    });
  });
  await mockEvents(page);
  for (const [index, event] of [[1, events[2]], [2, events[0]]]) {
    await page.goto("/form.html");
    await page.locator("#formCatalogList article.form-catalog-card").nth(index).getByRole("link", { name: `${event.title} kayıt formunu aç`, exact: true }).click();
    expect(new URL(page.url()).searchParams.get("event")).toBe(event.id);
    expect(new URL(page.url()).hash).toBe("#registrationSection");
    await expect(page.locator("#formTitle")).toHaveText(event.title);
    await expect(page.locator("#eventDescription")).toHaveText(event.description);
    await expect(page.locator("#eventLocation")).toHaveText(event.location);
    await expect(page.locator("#formCatalog")).not.toBeVisible();
    await expect(page.locator("#registrationSection")).toBeVisible();
    await expect(page.locator("#registrationLink")).toHaveAttribute("href", event.registrationUrl);
    const embed = new URL(await page.locator("#formFrame").getAttribute("src"));
    expect(embed.pathname).toBe(new URL(event.registrationUrl).pathname);
    expect(embed.searchParams.get("embedded")).toBe("true");
    await expect(page.locator("#formFrame")).toHaveAttribute("title", `${event.title} kayıt formu`);
    await page.locator("#shareEvent").click();
    await expect.poll(() => page.evaluate(() => window.copiedEventLink)).toBe(`http://127.0.0.1:8888/form.html?event=${encodeURIComponent(event.id)}`);
    await expect(page.locator("#formBackLink")).toHaveAttribute("href", "form.html");
    await page.reload();
    await expect(page.locator("#formTitle")).toHaveText(event.title);
    await expect(page.locator("#registrationLink")).toHaveAttribute("href", event.registrationUrl);
    expect(await page.evaluate(() => [window.titleInjected, window.locationInjected])).toEqual([undefined, undefined]);
  }
});

test("unknown and empty event IDs never display another event's form", async ({ page }) => {
  await mockEvents(page);
  for (const path of ["/form.html?event=missing", "/form.html?event="]) {
    await page.goto(path);
    await expect(page.locator("#formEmpty")).toBeVisible();
    await expect(page.locator("#formEmptyMessage")).toContainText("bulunamadı");
    await expect(page.locator("#eventDetails")).not.toBeVisible();
    await expect(page.locator("#registrationSection")).not.toBeVisible();
    await expect(page.locator("#formCatalog")).not.toBeVisible();
    await expect(page.locator("#formFrame")).not.toHaveAttribute("src", /docs\.google\.com/);
    await expect(page.locator("#formBackLink")).toBeVisible();
    await page.locator("#formBackLink").click();
    await expect(page.locator("#formCatalogList article.form-catalog-card")).toHaveCount(3);
  }
});

test("Forms has a useful empty state and retries a failed events request", async ({ page }) => {
  await mockEvents(page, []);
  await page.goto("/form.html");
  await expect(page.locator("#formEmpty")).toBeVisible();
  await expect(page.locator("#formEmptyMessage")).not.toBeEmpty();
  await expect(page.locator("#formCatalogList article.form-catalog-card")).toHaveCount(0);
  await expect(page.locator("#registrationSection")).not.toBeVisible();

  await page.unroute("**/api/events*");
  let attempts = 0;
  await page.route("**/api/events*", route => ++attempts === 1
    ? route.abort("failed")
    : route.fulfill({ json: { events } }));
  await page.goto("/form.html");
  await expect(page.locator("#formError")).toBeVisible();
  await expect(page.locator("#formLoading")).not.toBeVisible();
  await page.locator("#formRetry").click();
  await expect(page.locator("#formCatalogList article.form-catalog-card")).toHaveCount(3);
  await expect(page.locator("#formError")).not.toBeVisible();
  expect(attempts).toBe(2);
});

test("Forms catalog and a selected form fit a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockEvents(page);
  await page.goto("/form.html");
  const cards = page.locator("#formCatalogList article.form-catalog-card");
  await expect(cards).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await cards.nth(2).getByRole("link", { name: `${events[0].title} kayıt formunu aç`, exact: true }).click();
  await expect(page.locator("#formTitle")).toHaveText(events[0].title);
  await expect(page.locator("#registrationSection")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
