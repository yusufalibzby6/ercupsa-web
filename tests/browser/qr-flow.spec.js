import { test, expect } from "@playwright/test";

const code = "ERC-AAAAAAAAAAAAAAAAAAAAAAAA";
function authSession(metadata = {}) {
  const user = { id: "a873ee44-1ce7-4b30-b0fc-11e90719e9b3", email: "student@example.test", aud: "authenticated", user_metadata: metadata };
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expires_at })).toString("base64url");
  return { access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".dGVzdA", refresh_token: "test-refresh", expires_in: 3600, expires_at, token_type: "bearer", user };
}
async function fixture(page, { signedIn = false, total = 0 } = {}) {
  const state = { claims: [], total, name: "", claimFailures: [], loginFailures: [], authCalls: [], profileWrites: 0, profileHold: null };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked API" } }));
  await page.route("**/api/community*", async route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "config") return route.fulfill({ json: { url: "https://local-test.supabase.co", key: "test-public" } });
    if (action === "me" && route.request().method() === "POST") {
      state.name = route.request().postDataJSON().name;
      state.profileWrites++;
      if (state.profileHold) await state.profileHold;
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "me") return route.fulfill({ json: { profile: { name: state.name || "Test Öğrenci", public_name: false }, total: state.total,
      attendance: state.total ? [{ event_id: "workshop", event_title: "Bilim atölyesi", created_at: "2026-10-08T11:00:00Z" }] : [] } });
    if (action === "claim") {
      state.claims.push(route.request().postDataJSON());
      if (state.claimFailures.length) return route.fulfill({ status: 409, json: { error: state.claimFailures.shift() } });
      state.total++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { board: [] } });
  });
  await page.route("https://local-test.supabase.co/auth/v1/**", route => {
    const request = route.request(), url = new URL(request.url());
    state.authCalls.push({ path: url.pathname, query: url.search });
    if (url.pathname.endsWith("/signup")) return route.fulfill({ json: authSession(request.postDataJSON().data) });
    if (url.pathname.endsWith("/token")) {
      if (state.loginFailures.length) return route.fulfill({ status: 400, json: state.loginFailures.shift() });
      return route.fulfill({ json: authSession() });
    }
    if (url.pathname.endsWith("/user")) return route.fulfill({ json: authSession().user });
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ json: {} });
  });
  if (signedIn) await page.addInitScript(session => localStorage.setItem("sb-local-test-auth-token", JSON.stringify(session)), authSession());
  return state;
}
async function login(page) {
  await page.locator("#loginEmail").fill("student@example.test");
  await page.locator("#loginPassword").fill("Strong-test-123");
  await page.locator("#loginForm").getByRole("button", { name: "Giriş yap", exact: true }).click();
}
async function expectActionAboveGuide(page) {
  const geometry = await page.evaluate(() => ({ action: document.getElementById("ticketCompletionPanel").getBoundingClientRect().top,
    hero: document.querySelector(".participation-hero").getBoundingClientRect().top, width: document.documentElement.scrollWidth }));
  expect(geometry.action).toBeLessThan(geometry.hero);
  expect(geometry.width).toBeLessThanOrEqual(390);
}

test("mobile QR to signup keeps the last claim step at the top and requires an explicit claim", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/biletler.html?ticket=${code}`);
  await expect(page.locator("#ticketCompletionPanel")).toBeVisible();
  await expect(page.locator("#ticketCompletionContent #authPanel")).toBeVisible();
  await expectActionAboveGuide(page);
  await page.locator("#signupTab").click();
  await page.locator("#firstName").fill("Test");
  await page.locator("#lastName").fill("Öğrenci");
  await page.locator("#signupEmail").fill("student@example.test");
  await page.locator("#signupPassword").fill("Strong-test-123");
  await page.locator("#signupPasswordAgain").fill("Strong-test-123");
  await page.locator("#signupForm").getByRole("button", { name: "Hesap oluştur" }).click();
  await expect(page.locator("#ticketCompletionHeading")).toContainText("Son adım");
  await expect(page.locator("#ticketCompletionContent #claimForm")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  expect(state.claims).toHaveLength(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("#claimForm button")).toBeInViewport();
  await page.locator("#claimForm button").click();
  await expect(page.locator("#ticketCompletionHeading")).toHaveText("Katılımın hesabına eklendi!");
  await expect(page.locator("#attendance")).toContainText("Bilim atölyesi");
  await expect(page.locator("#ticketCode")).toHaveValue("");
  expect(state.claims).toEqual([{ code }]);
  expect(new URL(page.url()).searchParams.has("ticket")).toBe(false);
  await expect(page.locator("#ticketCompletionMessage")).toContainText("duyurulan kuralları");
});

test("a signed-in QR opens the claim above the medal and guide without an auth detour", async ({ page }) => {
  const state = await fixture(page, { signedIn: true });
  await page.goto(`/biletler.html?ticket=${code}`);
  await expect(page.locator("#ticketCompletionContent #claimForm")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  await expect(page.locator("#authPanel")).not.toBeVisible();
  await expectActionAboveGuide(page);
  await expect(page.locator("#claimForm button")).toBeInViewport();
  expect(state.claims).toHaveLength(0);
});

test("a profile refresh preserves a manual code and does not move the active claim form", async ({ page }) => {
  const state = await fixture(page, { signedIn: true, total: 2 });
  await page.goto("/biletler.html");
  await expect(page.locator("#attendanceCount")).toHaveText("2 farklı etkinliğe katıldın.");
  let releaseProfile;
  state.profileHold = new Promise(resolve => { releaseProfile = resolve; });
  await page.locator("#profileForm button").click();
  await expect.poll(() => state.profileWrites).toBe(1);
  await page.locator("#ticketCode").fill(code);
  await page.locator("#ticketCode").focus();
  releaseProfile();
  await expect(page.locator("#status")).toHaveText("Bilgilerin kaydedildi.");
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  await expect(page.locator("#ticketCode")).toBeFocused();
  await expect(page.locator("#ticketCompletionPanel")).not.toBeVisible();
  await expect(page.locator("#accountPanel #claimForm")).toBeVisible();
  await page.locator("#claimForm button").click();
  await expect(page.locator("#badge")).toHaveText("Bronz rozetin");
  await expect(page.locator("#ticketCompletionHeading")).toHaveText("Katılımın hesabına eklendi!");
  expect(state.claims).toEqual([{ code }]);
});

test("manual code preparation and legacy QR cancellation restore the regular forms", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/biletler.html?code=${code}`);
  await expect(page.locator("#ticketCompletionContent #authPanel")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("ticket")).toBe(code);
  expect(state.authCalls.some(call => call.path.endsWith("/token"))).toBe(false);
  await page.evaluate(value => localStorage.setItem("ercupsa.pending-ticket-recovery", JSON.stringify(value)), { code, expiresAt: Date.now() + 3600000 });
  await page.locator("#cancelPendingCode").click();
  await expect(page.locator("#ticketCompletionPanel")).not.toBeVisible();
  await expect(page.locator("#prepareCodeForm")).toBeVisible();
  await expect(page.locator("#entryTicketCode")).toHaveValue("");
  expect(new URL(page.url()).searchParams.has("ticket")).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("ercupsa.pending-ticket-recovery"))).toBeNull();
  await page.locator("#entryTicketCode").fill("erc-aaaaaaaaaaaaaaaaaaaaaaaa");
  await page.locator("#prepareCodeForm button").click();
  await expect(page.locator("#ticketCompletionContent #authPanel")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  expect(state.claims).toHaveLength(0);
});

test("login failures keep the QR ready, then login shows the last step rather than silently claiming", async ({ page }) => {
  const state = await fixture(page);
  state.loginFailures.push({ code: "invalid_credentials", msg: "Invalid login credentials" });
  await page.goto(`/biletler.html?ticket=${code}`);
  await login(page);
  await expect(page.locator("#ticketCompletionStatus #status")).toHaveText("E-posta veya şifre yanlış.");
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  await login(page);
  await expect(page.locator("#ticketCompletionContent #claimForm")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  expect(state.claims).toHaveLength(0);
});

test("a claim error stays next to the ready QR and the same code can be retried", async ({ page }) => {
  const state = await fixture(page, { signedIn: true });
  state.claimFailures.push("Katılım şu anda kaydedilemedi. Tekrar dene.");
  await page.goto(`/biletler.html?ticket=${code}`);
  await expect(page.locator("#ticketCompletionContent #claimForm")).toBeVisible();
  await page.locator("#claimForm button").click();
  await expect(page.locator("#ticketCompletionStatus #status")).toContainText("Tekrar dene");
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  await expect(page.locator("#ticketCompletionHeading")).toContainText("Son adım");
  await page.locator("#claimForm button").click();
  await expect(page.locator("#ticketCompletionHeading")).toContainText("hesabına eklendi");
  expect(state.claims).toEqual([{ code }, { code }]);
});

test("password recovery keeps pending QR data and restores the final step after reset", async ({ page }) => {
  const state = await fixture(page, { signedIn: true });
  await page.goto(`/biletler.html?recovery=1&ticket=${code}`);
  await expect(page.locator("#resetPanel")).toBeVisible();
  await expect(page.locator("#ticketCompletionPanel")).not.toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  await page.locator("#newPassword").fill("New-password-123");
  await page.locator("#newPasswordAgain").fill("New-password-123");
  await page.locator("#resetForm button").click();
  await expect(page.locator("#ticketCompletionContent #authPanel")).toBeVisible();
  await expect(page.locator("#ticketCompletionStatus #status")).toContainText("Şifren güncellendi");
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  expect(state.claims).toHaveLength(0);
  expect(new URL(page.url()).searchParams.has("recovery")).toBe(false);
});

test("forgot-password preserves the QR locally through the configured exact PKCE recovery redirect", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/biletler.html?ticket=${code}`);
  await page.locator("#forgotLink").click();
  await page.locator("#forgotEmail").fill("student@example.test");
  await page.locator("#forgotForm").getByRole("button", { name: "Sıfırlama bağlantısı gönder" }).click();
  await expect(page.locator("#status")).toContainText("bir hesap varsa");
  const recover = state.authCalls.find(call => call.path.endsWith("/recover"));
  const redirect = new URL(new URLSearchParams(recover.query).get("redirect_to"));
  expect(redirect.searchParams.has("ticket")).toBe(false);
  expect(redirect.searchParams.get("recovery")).toBe("1");
  expect(redirect.search).toBe("?recovery=1");
  const retained = await page.evaluate(() => JSON.parse(localStorage.getItem("ercupsa.pending-ticket-recovery")));
  expect(retained.code).toBe(code);
  expect(retained.expiresAt).toBeGreaterThan(Date.now());
  redirect.searchParams.set("code", "test-auth-code");
  await page.goto(redirect.pathname + redirect.search);
  await expect(page.locator("#resetPanel")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  await expect(page.locator("#ticketCompletionPanel")).not.toBeVisible();
  expect(state.claims).toHaveLength(0);
  await page.locator("#newPassword").fill("New-password-123");
  await page.locator("#newPasswordAgain").fill("New-password-123");
  await page.locator("#resetForm button").click();
  await expect(page.locator("#ticketCompletionContent #authPanel")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(code);
  expect(new URL(page.url()).searchParams.get("ticket")).toBe(code);
  await login(page);
  await expect(page.locator("#ticketCompletionContent #claimForm")).toBeVisible();
  await page.locator("#claimForm button").click();
  await expect(page.locator("#ticketCompletionHeading")).toContainText("hesabına eklendi");
  expect(await page.evaluate(() => localStorage.getItem("ercupsa.pending-ticket-recovery"))).toBeNull();
});

test("recovery ticket expires, stays out of normal visits, and a newly scanned QR takes precedence", async ({ page }) => {
  await fixture(page, { signedIn: true });
  await page.goto("/biletler.html");
  await page.evaluate(value => localStorage.setItem("ercupsa.pending-ticket-recovery", JSON.stringify(value)), { code, expiresAt: Date.now() + 3600000 });
  await page.goto("/biletler.html");
  await expect(page.locator("#ticketCompletionPanel")).not.toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue("");
  const scanned = "ERC-BBBBBBBBBBBBBBBBBBBBBBBB";
  await page.goto(`/biletler.html?recovery=1&ticket=${scanned}`);
  await expect(page.locator("#resetPanel")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue(scanned);
  await page.evaluate(value => localStorage.setItem("ercupsa.pending-ticket-recovery", JSON.stringify(value)), { code, expiresAt: Date.now() - 1000 });
  await page.goto("/biletler.html?recovery=1");
  await expect(page.locator("#resetPanel")).toBeVisible();
  await expect(page.locator("#ticketCode")).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("ercupsa.pending-ticket-recovery"))).toBeNull();
});
