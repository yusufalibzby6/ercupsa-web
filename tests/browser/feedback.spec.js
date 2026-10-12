import { test, expect } from "@playwright/test";

const event = { id: "past", title: "Etkinlik <img src=x onerror=alert(1)>", date: "2026-10-01", published: true, images: [] };
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
