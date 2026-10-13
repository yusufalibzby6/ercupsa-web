import { test, expect } from "@playwright/test";

const ticket = "ERC-AAAAAAAAAAAAAAAAAAAAAAAA";
function authSession() {
  const user = { id: "a873ee44-1ce7-4b30-b0fc-11e90719e9b3", email: "student@example.test", aud: "authenticated", user_metadata: { first_name: "Test", last_name: "Öğrenci" } };
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expires_at })).toString("base64url");
  return { access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".dGVzdA", refresh_token: "test-refresh", expires_in: 3600, expires_at, token_type: "bearer", user };
}
async function fixture(page, { signedIn = false, blocked = false } = {}) {
  const state = { signups: 0, mode: "success", errors: [], profileWrites: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked test API" } }));
  await page.route("**/api/community*", route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "config") return route.fulfill({ json: { url: "https://local-test.supabase.co", key: "test-public" } });
    if (action === "me" && route.request().method() === "POST") {
      state.profileWrites.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "me") return route.fulfill({ json: {
      profile: { name: "Test Öğrenci", public_name: blocked, public_name_blocked: blocked }, total: 3,
      attendance: [{ event_id: "test-event", event_title: "Bilim etkinliği", created_at: "2026-10-10T11:00:00Z" }],
    } });
    return route.fulfill({ json: { board: [] } });
  });
  await page.route("https://local-test.supabase.co/auth/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/signup")) {
      state.signups++;
      if (state.mode === "network") return route.abort("internetdisconnected");
      if (state.mode === "stall") return;
      if (state.errors.length) return route.fulfill({ status: 422, headers: { "x-supabase-api-version": "2024-01-01" }, json: state.errors.shift() });
      return route.fulfill({ json: authSession() });
    }
    if (path.endsWith("/token")) return route.fulfill({ json: authSession() });
    if (path.endsWith("/user")) return route.fulfill({ json: authSession().user });
    if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ json: {} });
  });
  if (signedIn) await page.addInitScript(session => localStorage.setItem("sb-local-test-auth-token", JSON.stringify(session)), authSession());
  return state;
}
async function signup(page, password = "Strong-test-123") {
  await page.locator("#signupTab").click();
  await page.locator("#firstName").fill("Test");
  await page.locator("#lastName").fill("Öğrenci");
  await page.locator("#signupEmail").fill("student@example.test");
  await page.locator("#signupPassword").fill(password);
  await page.locator("#signupPasswordAgain").fill(password);
}

test("native short-password validation gives an inline reason and a corrected signup works", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/biletler.html?ticket=${ticket}`);
  await signup(page, "short-7");
  await page.locator("#signupForm button").click();
  await expect(page.locator("#signupPasswordError")).toHaveText("Şifre 8–128 karakter arasında olmalı.");
  await expect(page.locator("#signupPasswordError")).toBeInViewport();
  await expect(page.locator("#signupPassword")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#signupFormFeedback")).toHaveText("Şifre 8–128 karakter arasında olmalı.");
  expect(state.signups).toBe(0);
  await page.locator("#signupPassword").fill("Strong-test-123");
  await page.locator("#signupPasswordAgain").fill("Strong-test-123");
  await page.locator("#signupForm button").click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  await expect(page.locator("#claimForm #ticketCode")).toHaveValue(ticket);
  expect(state.signups).toBe(1);
});

test("missing name, invalid email and password mismatch identify the relevant field", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/biletler.html");
  await signup(page);
  await page.locator("#firstName").fill("");
  await page.locator("#signupForm button").click();
  await expect(page.locator("#firstNameError")).toHaveText("İsim alanını doldur.");
  await expect(page.locator("#firstName")).toBeFocused();
  await page.locator("#firstName").fill("Test");
  await page.locator("#signupEmail").fill("invalid-email");
  await page.locator("#signupForm button").click();
  await expect(page.locator("#signupEmailError")).toHaveText("Geçerli bir e-posta adresi gir.");
  await page.locator("#signupEmail").fill("student@example.test");
  await page.locator("#signupPasswordAgain").fill("Different-test-123");
  await page.locator("#signupForm button").click();
  await expect(page.locator("#signupPasswordAgainError")).toHaveText("Şifreler eşleşmiyor.");
  await expect(page.locator("#signupPasswordAgain")).toBeFocused();
  await expect(page.locator("#signupFormFeedback")).toBeVisible();
  expect(state.signups).toBe(0);
});

for (const [reason, message, expected] of [
  ["length", "Password should be at least 12 characters", "En az 12 karakter kullan."],
  ["characters", "Password should contain the required characters", "Büyük harf, küçük harf, rakam ve özel karakter içeren bir şifre seç."],
  ["pwned", "Password is known to be weak", "Bu şifre sızdırılmış şifreler arasında bulundu. Başka bir şifre seç."],
]) test(`provider password rule ${reason} appears beside the password and allows retry`, async ({ page }) => {
  const state = await fixture(page);
  state.errors.push({ code: "weak_password", msg: message, weak_password: { reasons: [reason] } });
  await page.goto(`/biletler.html?ticket=${ticket}`);
  await signup(page);
  await page.locator("#signupForm button").click();
  await expect(page.locator("#signupPasswordError")).toHaveText(expected);
  await expect(page.locator("#signupPasswordError")).toBeInViewport();
  await expect(page.locator("#signupFormFeedback")).toHaveText(expected);
  await expect(page.locator("#signupForm button")).toBeEnabled();
  await expect(page.locator("#accountPanel")).not.toBeVisible();
  await page.locator("#signupPassword").fill("Another-strong-123!");
  await page.locator("#signupPasswordAgain").fill("Another-strong-123!");
  await page.locator("#signupForm button").click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  expect(state.signups).toBe(2);
});

test("network failure keeps form data and exposes a usable retry", async ({ page }) => {
  const state = await fixture(page);
  state.mode = "network";
  await page.goto(`/biletler.html?ticket=${ticket}`);
  await signup(page);
  await page.locator("#signupForm button").click();
  await expect(page.locator("#signupFormFeedback")).toContainText("İnternet bağlantını kontrol edip tekrar dene.");
  await expect(page.locator("#signupFormFeedback")).toBeInViewport();
  await expect(page.locator("#signupForm button")).toBeEnabled();
  await expect(page.locator("#signupEmail")).toHaveValue("student@example.test");
  expect(state.signups).toBe(1);
  state.mode = "success";
  await page.locator("#signupForm button").click();
  await expect(page.locator("#ticketCode")).toHaveValue(ticket);
  await expect(page.locator("#accountPanel")).toBeVisible();
});

test("a stalled auth request times out without duplicate signup and the form can retry", async ({ page }) => {
  const state = await fixture(page);
  state.mode = "stall";
  await page.clock.install();
  await page.goto(`/biletler.html?ticket=${ticket}`);
  await signup(page);
  await page.locator("#signupForm button").click();
  await expect.poll(() => state.signups).toBe(1);
  await expect(page.locator("#signupForm")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#signupFormFeedback")).toHaveText("İşlem sürüyor…");
  await page.clock.fastForward(16000);
  await expect(page.locator("#signupFormFeedback")).toContainText("Bağlantı zaman aşımına uğradı.");
  await expect(page.locator("#signupForm button")).toBeEnabled();
  await expect(page.locator("#accountPanel")).not.toBeVisible();
  expect(state.signups).toBe(1);
  state.mode = "success";
  await page.locator("#signupForm button").click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  expect(state.signups).toBe(2);
});

test("administrator-hidden public name preserves the user's consent and badge progress", async ({ page }) => {
  const state = await fixture(page, { signedIn: true, blocked: true });
  await page.goto("/biletler.html");
  await expect(page.locator("#publicNameModeration")).toBeVisible();
  await expect(page.locator("#publicName")).toBeChecked();
  await expect(page.locator("#publicName")).toBeEnabled();
  await expect(page.locator("#badge")).toContainText("Bronz");
  await page.locator("#profileForm button").click();
  await expect(page.locator("#profileFormFeedback")).toHaveText("Bilgilerin kaydedildi.");
  expect(state.profileWrites).toEqual([{ name: "Test Öğrenci", public_name: true }]);
  await expect(page.locator("#publicNameModeration")).toBeVisible();
});
