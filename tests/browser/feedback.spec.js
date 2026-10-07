import { test, expect } from "@playwright/test";

const event = { id: "past", title: "Etkinlik <img src=x onerror=alert(1)>", date: "2026-10-01", published: true, images: [] };
const archived = { id: "archive", title: "Geçmiş buluşma", date: "2026-09-01", published: false, archived: true };
const entries = [
  { userId: "a", name: "Ada <img src=x onerror=alert(1)>", rating: 5, comment: "Çok güzel!\nBir daha olsun.", createdAt: "2026-10-02T09:00:00Z", updatedAt: "2026-10-03T10:00:00Z" },
  { userId: "b", name: "Bora", rating: 2, comment: "<script>alert(1)</script> Süre kısa kaldı.", createdAt: "2026-10-02T09:00:00Z", updatedAt: "2026-10-02T09:00:00Z" },
];
function authSession() {
  const user = { id: "a873ee44-1ce7-4b30-b0fc-11e90719e9b3", email: "student@example.test", aud: "authenticated", user_metadata: {} };
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".dGVzdA", refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer", user };
}
async function publicFixture(page, options = {}) {
  const state = { available: options.available !== false, feedback: options.feedback || null, posts: [], gets: 0, hold: null };
  const session = authSession();
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked API" } }));
  await page.route("**/api/community*", route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "config") return route.fulfill({ json: { url: "https://local-test.supabase.co", key: "test-public" } });
    if (action === "me") return route.fulfill({ json: { profile: { name: "Ada", public_name: false }, total: 1, attendance: [{ event_id: event.id, event_title: event.title, created_at: "2026-10-01T10:00:00Z" }] } });
    return route.fulfill({ json: { board: [] } });
  });
  await page.route("https://local-test.supabase.co/auth/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/token")) return route.fulfill({ json: session });
    if (path.endsWith("/user")) return route.fulfill({ json: session.user });
    if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/feedback*", async route => {
    expect(route.request().headers().authorization).toBe("Bearer " + session.access_token);
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      state.posts.push(input);
      state.feedback = { rating: input.rating, comment: input.comment, createdAt: "2026-10-02T09:00:00Z", updatedAt: "2026-10-03T09:00:00Z" };
      return route.fulfill({ json: { ok: true, feedback: state.feedback } });
    }
    state.gets++;
    if (state.hold) await state.hold;
    return route.fulfill({ json: { event, feedback: state.feedback, available: state.available, message: state.available ? "" : "Değerlendirme, etkinlikten sonraki gün açılır." } });
  });
  await page.goto("/biletler.html");
  await page.locator("#loginEmail").fill("student@example.test");
  await page.locator("#loginPassword").fill("Strong-test-123");
  await page.locator("#loginForm").getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  await expect(page.locator("[data-event-feedback]")).toHaveCount(1);
  return state;
}
async function adminFixture(page, options = {}) {
  const state = { catalog: options.emptyCatalog ? [] : [event], adminGets: [], hold: null };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked API" } }));
  await page.route("**/api/events*", route => route.fulfill({ json: { events: state.catalog } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { submissions: [], batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.route("**/api/registrations*", route => route.fulfill({ json: { form: null, summaries: [] } }));
  await page.route("**/api/feedback*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "summary") return route.fulfill({ json: { events: [
      { event, count: 2, average: 3.5, distribution: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 } },
      { event: archived, count: 1, average: 4, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } },
    ] } });
    const id = url.searchParams.get("eventId"); state.adminGets.push(id);
    if (state.hold) await state.hold;
    return route.fulfill({ json: id === event.id
      ? { event, entries, summary: { count: 2, average: 3.5, distribution: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 } } }
      : { event: archived, entries: [{ ...entries[0], rating: 4, comment: "Geçmiş yorum" }], summary: { count: 1, average: 4, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } } } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("[data-tab=feedback]").click();
  await expect(page.locator("#feedbackEntries article")).toHaveCount(2);
  return state;
}

test("ticket holders save and edit a private rating; reopening restores the selected rating", async ({ page }) => {
  const state = await publicFixture(page);
  await page.locator("[data-event-feedback]").click();
  const dialog = page.locator("#eventFeedbackDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h2")).toHaveText(event.title);
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(page.locator("#eventFeedbackFields")).toBeEnabled();
  await dialog.locator('input[value="4"]').check();
  await page.locator("#eventFeedbackComment").fill("<script>alert(1)</script> Çok sevdim.");
  await page.locator("#eventFeedbackSubmit").click();
  await expect(page.locator("#eventFeedbackMessage")).toContainText("Teşekkür ederiz");
  expect(state.posts).toEqual([{ eventId: event.id, rating: 4, comment: "<script>alert(1)</script> Çok sevdim." }]);
  await expect(page.locator("#eventFeedbackSubmit")).toHaveText("Değerlendirmeyi güncelle");
  await page.locator("#eventFeedbackClose").click();
  await page.locator("[data-event-feedback]").click();
  await expect(dialog.locator('input[value="4"]')).toBeChecked();
  await expect(page.locator("#eventFeedbackComment")).toHaveValue(state.feedback.comment);
  await dialog.locator('input[value="5"]').check();
  await page.locator("#eventFeedbackComment").fill("Yeni yorum");
  await page.locator("#eventFeedbackSubmit").click();
  await expect(page.locator("#eventFeedbackMessage")).toContainText("Teşekkür ederiz");
  expect(state.posts[1]).toEqual({ eventId: event.id, rating: 5, comment: "Yeni yorum" });
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-event-feedback]")).toBeFocused();
});

test("future feedback stays disabled and a delayed response cannot expose feedback after logout", async ({ page }) => {
  const state = await publicFixture(page, { available: false });
  await page.locator("[data-event-feedback]").click();
  await expect(page.locator("#eventFeedbackMessage")).toContainText("sonraki gün");
  await expect(page.locator('input[name="eventFeedbackRating"]').first()).toBeDisabled();
  await expect(page.locator("#eventFeedbackComment")).toBeDisabled();
  expect(state.posts).toHaveLength(0);
  await page.locator("#eventFeedbackClose").click();
  let release; state.hold = new Promise(resolve => { release = resolve; });
  await page.locator("[data-event-feedback]").click();
  await expect.poll(() => state.gets).toBe(2);
  await page.locator("#eventFeedbackClose").click();
  await page.locator("#logout").click();
  await expect(page.locator("#accountPanel")).not.toBeVisible();
  release(); state.hold = null;
  await expect(page.locator("#eventFeedbackDialog")).not.toBeVisible();
  await expect(page.locator("#eventFeedbackMessage")).toHaveText("");
});

test("admin sees ratings, escaped private comments, filtering and archived comparison", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await adminFixture(page);
  await expect(page.locator("#feedbackSummary")).toContainText("3,5 / 5");
  await expect(page.locator("#feedbackDistribution progress")).toHaveCount(5);
  await expect(page.locator("#feedbackEntries img, #feedbackEntries script")).toHaveCount(0);
  await expect(page.locator("#feedbackEntries")).toContainText(entries[1].comment);
  await page.locator("#feedbackRatingFilter").selectOption("5");
  await expect(page.locator("#feedbackEntries article")).toHaveCount(1);
  await expect(page.locator("#feedbackFilterCount")).toHaveText("1 değerlendirme gösteriliyor / 2 değerlendirme.");
  await page.locator("#feedbackSearch").fill("bulunmayan");
  await expect(page.locator("#feedbackEntries")).toContainText("eşleşen değerlendirme yok");
  await page.locator('[data-feedback-event="archive"]').click();
  await expect(page.locator("#feedbackEvent")).toHaveValue("archive");
  await expect(page.locator("#feedbackSearch")).toHaveValue("");
  await expect(page.locator("#feedbackRatingFilter")).toHaveValue("");
  await expect(page.locator("#feedbackEntries")).toContainText("Geçmiş yorum");
  await expect(page.locator("#feedbackMessage")).toContainText("Arşivlenmiş");
  expect(state.adminGets).toContain("archive");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("archived feedback remains accessible when the current event catalog is empty", async ({ page }) => {
  await adminFixture(page, { emptyCatalog: true });
  await expect(page.locator("#feedbackEvent option")).toHaveCount(2);
  await page.locator("#feedbackEvent").selectOption("archive");
  await expect(page.locator("#feedbackEntries")).toContainText("Geçmiş yorum");
  await expect(page.locator("#feedbackOverview")).toContainText("Geçmiş buluşma (arşiv)");
});

test("logout clears private comments and discards a delayed admin refresh", async ({ page }) => {
  const state = await adminFixture(page);
  let release; state.hold = new Promise(resolve => { release = resolve; });
  await page.locator("#feedbackReload").click();
  await expect.poll(() => state.adminGets.length).toBe(2);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  release(); state.hold = null;
  await expect(page.locator("#feedbackEntries article")).toHaveCount(0);
  await expect(page.locator("#feedbackOverview")).toHaveText("");
  await expect(page.locator("#feedbackSummary")).toHaveText("");
  await expect(page.locator("#feedbackReload")).toBeDisabled();
});
