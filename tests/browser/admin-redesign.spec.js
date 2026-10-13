import { test, expect } from "@playwright/test";

const event = { id: "modern-event", title: "Bilim, dayanışma ve birlikte öğrenme buluşması", category: "Atölye", date: "2026-11-01", time: "18:00", location: "Eczacılık Fakültesi", description: "Etkinlik açıklaması", published: true, images: [] };
const form = {
  eventId: event.id, enabled: true, description: "Etkinliğe katılmak için bilgilerinizi girin.", maxRegistrations: 40,
  fields: [
    { id: "full_name", type: "text", label: "Ad soyad", required: true },
    { id: "class_year", type: "select", label: "Sınıf", required: true, options: ["1. Sınıf", "2. Sınıf"] },
    { id: "phone", type: "tel", label: "Telefon", required: true },
  ], receipt: { enabled: true, required: true },
};
const sections = [
  ["events", "Etkinlikler"], ["registrations", "Kayıt formları"], ["tickets", "Biletler"],
  ["raffles", "Çekilişler"], ["attendance", "Giriş ve görevliler"], ["accounts", "Kullanıcılar"], ["instagram", "Instagram"],
];

async function fixture(page, authenticated = true) {
  const state = { authenticated, logout: 0 };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked API in admin shell test" } }));
  await page.route("**/api/events*", route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "auth") { state.authenticated = true; return route.fulfill({ json: { ok: true } }); }
    if (action === "logout") { state.authenticated = false; state.logout++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill(state.authenticated ? { json: { events: [event] } } : { status: 401, json: { error: "Yönetici girişi gerekli." } });
  });
  await page.route("**/api/community*", route => route.fulfill({ json: { batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.route("**/api/registrations*", route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    return route.fulfill({ json: action === "summary" ? { summaries: [] } : { form, entries: [], pagination: { pages: 1 }, summary: { total: 0, byClass: [] } } });
  });
  await page.route("**/api/raffles*", route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: {
      source: url.searchParams.get("source") || "qr", participants: [], draws: [], poolVersion: "1".repeat(64),
      checkedInOnly: url.searchParams.get("checkedInOnly") === "true", checkinBonus: url.searchParams.get("checkinBonus") === "true",
    } });
  });
  await page.route("**/api/gate*", route => route.fulfill({ json: { participants: [], entries: [], summary: { claimed: 0, entered: 0 } } }));
  await page.route("**/api/staff*", route => route.fulfill({ json: { accounts: [] } }));
  await page.route("**/api/site-content*", route => route.fulfill({ json: { instagram: { revision: "test-revision", posts: [1, 2, 3, 4].map(n => `https://www.instagram.com/p/modern${n}/`) } } }));
  await page.route("**/api/accounts*", route => route.fulfill({ json: { accounts: [], page: 1, pageSize: 50, total: 0, pages: 1 } }));
  await page.goto("/admin.html");
  await expect(page.locator(authenticated ? "#app" : "#login")).toBeVisible();
  return state;
}

async function noPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("modern navigation identifies the selected workspace and keeps event editing available", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  for (const [name, title] of sections) {
    await page.locator(`[data-tab="${name}"]`).click();
    await expect(page.locator('.admin-navigation [aria-current="page"]')).toHaveCount(1);
    await expect(page.locator(`[data-tab="${name}"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`#${name}Tab`)).toBeVisible();
    await expect(page.locator("#adminSectionTitle")).toHaveText(title);
    await expect(page.locator("#adminSectionDescription")).not.toBeEmpty();
    await noPageOverflow(page);
  }
  const eventsButton = page.locator('[data-tab="events"]');
  await eventsButton.focus(); await eventsButton.press("Enter");
  await page.locator('[data-action="edit"]').click();
  await expect(page.locator("#title")).toHaveValue(event.title);
  await expect(page.locator("#saveBtn")).toBeVisible();
  await page.locator("#cancelBtn").click();
  await expect(page.locator("#formWrap")).toBeHidden();
});

test("mobile navigation reaches every retained section without horizontal page overflow and logout closes the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  for (const [name] of sections) {
    await page.locator(`[data-tab="${name}"]`).click();
    await expect(page.locator(`#${name}Tab`)).toBeVisible();
    await noPageOverflow(page);
  }
  await page.locator("#adminLogout").click();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  expect(state.logout).toBe(1);
  await noPageOverflow(page);
});

test("mobile login retains an accessible password label and opens the redesigned workspace", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await fixture(page, false);
  await expect(page.locator("#loginError")).toHaveText("Yönetici girişi gerekli.");
  await page.getByLabel("Yönetici şifresi", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#login")).toBeHidden();
  await expect(page.locator("#adminSectionTitle")).toHaveText("Etkinlikler");
  await noPageOverflow(page);
});
