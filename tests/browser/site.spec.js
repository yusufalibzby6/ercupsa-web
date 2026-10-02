import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
});
test("navigation and quiz work without external CDN; back navigation and retake", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/test.html");
  await expect(
    page.getByRole("link", { name: "Aktif Üyelerimiz" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Teste Başla" }).click();
  await expect(page.locator("#questionCounter")).toHaveText("Soru 1 / 10");
  await page.locator(".option-btn").first().click();
  await page.getByRole("button", { name: "Önceki soru" }).click();
  await expect(page.locator("#questionCounter")).toHaveText("Soru 1 / 10");
  for (let i = 0; i < 10; i++)
    await page.locator(".option-btn").first().click();
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result progress")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Sonuç kartını indir" }).click();
  await download;
  await page.getByRole("button", { name: "Tekrar Çöz" }).click();
  await expect(page.locator("#questionCounter")).toHaveText("Soru 1 / 10");
  expect(errors).toEqual([]);
});
test("new public pages are accessible and gracefully explain missing setup", async ({
  page,
}) => {
  for (const path of ["/topluluk.html", "/uyeler.html", "/biletler.html"]) {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#status")).not.toBeEmpty();
    expect(errors).toEqual([]);
  }
});
test("mobile navigation opens and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Siteye devam et →" }).click();
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Biletlerim", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Biletlerim", exact: true }),
  ).not.toBeVisible();
});
test("admin keeps cookie session and supports safe event preview", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin.html");
  // Local password comes only from the test launcher environment.
  await page.locator("#password").fill(process.env.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#newBtn").click();
  await page.locator("#title").fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Önizle", exact: true }).click();
  await expect(page.locator("#preview")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#preview img")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  expect(errors).toEqual([]);
});
test("community renders hostile text safely and accepts moderated submissions", async ({
  page,
}) => {
  await page.route("**/api/community*", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ json: { ok: true } });
    return route.fulfill({
      json: {
        members: [{ name: "<img src=x onerror=alert(1)>", class: "2" }],
        experiences: [
          {
            title: "<script>alert(1)</script>",
            content: "Anonim staj deneyimi",
          },
        ],
        board: [],
      },
    });
  });
  await page.goto("/uyeler.html");
  await expect(page.locator("#members")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#members img")).toHaveCount(0);
  await page.goto("/topluluk.html");
  await expect(page.locator("#experiences")).toContainText(
    "<script>alert(1)</script>",
  );
  await expect(page.locator("#experiences script")).toHaveCount(0);
  await page.locator("#submissionTitle").fill("Atölye önerisi");
  await page.locator("#content").fill("Bir formülasyon atölyesi yapalım.");
  await page.getByRole("button", { name: "Gönder", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Gönderin alındı");
});
function authSession(metadata = {}) {
  const user = {
    id: "a873ee44-1ce7-4b30-b0fc-11e90719e9b3",
    email: "student@example.test",
    aud: "authenticated",
    user_metadata: metadata,
  };
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return {
    access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".dGVzdA",
    refresh_token: "test-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
}
async function mockAccount(page) {
  const state = { total: 2, name: "", public_name: false, calls: [] };
  await page.route("**/api/community*", (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "config")
      return route.fulfill({
        json: { url: "https://local-test.supabase.co", key: "test-public" },
      });
    if (action === "me" && route.request().method() === "POST") {
      Object.assign(state, route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "me")
      return route.fulfill({
        json: {
          profile: state.name
            ? { name: state.name, public_name: state.public_name }
            : null,
          total: state.total,
          badge:
            state.total >= 5
              ? "Altın"
              : state.total === 4
                ? "Gümüş"
                : state.total === 3
                  ? "Bronz"
                  : null,
          attendance: Array.from({ length: state.total }, (_, i) => ({
            event_title: "Etkinlik " + i,
          })),
        },
      });
    if (action === "claim") {
      state.total++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { board: [], members: [], experiences: [] } });
  });
  await page.route("https://local-test.supabase.co/auth/v1/**", (route) => {
    const req = route.request(),
      u = new URL(req.url());
    state.calls.push({
      path: u.pathname,
      query: u.search,
      body: req.postDataJSON(),
    });
    if (u.pathname.endsWith("/signup"))
      return route.fulfill({ json: authSession(req.postDataJSON().data) });
    if (u.pathname.endsWith("/token"))
      return route.fulfill({ json: authSession() });
    if (u.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
    if (u.pathname.endsWith("/user"))
      return route.fulfill({ json: authSession().user });
    return route.fulfill({ json: {} });
  });
  return state;
}
test("logo is restored and public footers contain no admin entry", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/etkinlikler.html",
    "/galeri.html",
    "/test.html",
    "/topluluk.html",
    "/uyeler.html",
    "/biletler.html",
    "/hakkimizda.html",
    "/ekip.html",
    "/sss.html",
    "/iletisim.html",
    "/form.html",
  ]) {
    await page.goto(path);
    await expect(page.locator("#logoLink img")).toBeVisible();
    await expect(page.locator("#logoLink img")).toHaveAttribute(
      "src",
      "ercupsa.PNG",
    );
    await expect(page.locator("footer a[href='admin.html']")).toHaveCount(0);
    await expect(page.locator("footer")).toContainText(
      "Erciyes Üniversitesi Eczacılık Fakültesi Öğrenci Topluluğu",
    );
  }
});
test("password signup saves names and login persists without confirmation email", async ({
  page,
}) => {
  const state = await mockAccount(page),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/biletler.html");
  await page.getByRole("tab", { name: "Kayıt ol" }).click();
  await page.locator("#firstName").fill("Test");
  await page.locator("#lastName").fill("Öğrenci");
  await page.locator("#signupEmail").fill("student@example.test");
  await page.locator("#signupPassword").fill("Strong-test-123");
  await page.locator("#signupPasswordAgain").fill("Strong-test-123");
  await page.getByRole("button", { name: "Hesap oluştur" }).click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Hesabın oluşturuldu");
  expect(state.name).toBe("Test Öğrenci");
  expect(state.public_name).toBe(false);
  await page.reload();
  await expect(page.locator("#accountPanel")).toBeVisible();
  await expect(page.locator("#name")).toHaveValue("Test Öğrenci");
  await page.locator("#publicName").check();
  await page.getByRole("button", { name: "Bilgilerimi kaydet" }).click();
  for (const badge of ["Bronz", "Gümüş", "Altın"]) {
    await page.locator("#ticketCode").fill("ERC-AAAAAAAAAAAAAAAAAAAAAAAA");
    await page.getByRole("button", { name: "Biletimi ekle" }).click();
    await expect(page.locator("#badge")).toContainText(badge);
  }
  await page.getByRole("button", { name: "Çıkış yap" }).click();
  await expect(page.locator("#authPanel")).toBeVisible();
  await page.locator("#loginEmail").fill("student@example.test");
  await page.locator("#loginPassword").fill("Strong-test-123");
  await page
    .locator("#loginForm")
    .getByRole("button", { name: "Giriş yap", exact: true })
    .click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  expect(state.calls.some((c) => c.path.endsWith("/signup"))).toBe(true);
  expect(state.calls.some((c) => c.query.includes("grant_type=password"))).toBe(
    true,
  );
  expect(
    state.calls.some(
      (c) => c.path.endsWith("/otp") || c.path.endsWith("/recover"),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
test("password mismatch and translated login error do not sign the user in", async ({
  page,
}) => {
  const state = await mockAccount(page);
  await page.goto("/biletler.html");
  await page.getByRole("tab", { name: "Kayıt ol" }).click();
  await page.locator("#firstName").fill("Test");
  await page.locator("#lastName").fill("Öğrenci");
  await page.locator("#signupEmail").fill("student@example.test");
  await page.locator("#signupPassword").fill("Strong-test-123");
  await page.locator("#signupPasswordAgain").fill("Other-test-456");
  await page.getByRole("button", { name: "Hesap oluştur" }).click();
  await expect(page.locator("#status")).toHaveText("Şifreler eşleşmiyor.");
  expect(state.calls.some((c) => c.path.endsWith("/signup"))).toBe(false);
  await page.route("https://local-test.supabase.co/auth/v1/token**", (r) =>
    r.fulfill({
      status: 400,
      json: { code: "invalid_credentials", msg: "Invalid login credentials" },
    }),
  );
  await page.getByRole("tab", { name: "Giriş yap" }).click();
  await page.locator("#loginEmail").fill("student@example.test");
  await page.locator("#loginPassword").fill("wrong-password");
  await page
    .locator("#loginForm")
    .getByRole("button", { name: "Giriş yap", exact: true })
    .click();
  await expect(page.locator("#status")).toHaveText(
    "E-posta veya şifre yanlış.",
  );
  await expect(page.locator("#accountPanel")).not.toBeVisible();
});
test("password recovery email uses PKCE and callback allows changing password", async ({
  page,
}) => {
  const state = await mockAccount(page),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/biletler.html");
  await page.getByRole("button", { name: "Şifremi unuttum" }).click();
  await page.locator("#forgotEmail").fill("student@example.test");
  await page
    .getByRole("button", { name: "Sıfırlama bağlantısı gönder" })
    .click();
  await expect(page.locator("#status")).toContainText("bir hesap varsa");
  const recover = state.calls.find((c) => c.path.endsWith("/recover"));
  expect(recover.body.code_challenge).toBeTruthy();
  expect(recover.body.code_challenge_method).toBe("s256");
  expect(decodeURIComponent(recover.query)).toContain(
    "biletler.html?recovery=1",
  );
  await page.goto("/biletler.html?recovery=1&code=test-auth-code");
  await expect(page.locator("#resetPanel")).toBeVisible();
  await expect(page.locator("#accountPanel")).not.toBeVisible();
  await page.locator("#newPassword").fill("New-password-123");
  await page.locator("#newPasswordAgain").fill("New-password-123");
  await page.getByRole("button", { name: "Şifremi güncelle" }).click();
  await expect(page.locator("#status")).toContainText("Şifren güncellendi");
  await expect(page.locator("#loginForm")).toBeVisible();
  expect(
    state.calls.some(
      (c) =>
        c.path.endsWith("/user") && c.body?.password === "New-password-123",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("ticket QR code cannot be interpreted as a password recovery callback", async ({
  page,
}) => {
  const state = await mockAccount(page);
  await page.goto("/biletler.html");
  await page.evaluate(() =>
    localStorage.setItem(
      "sb-local-test-auth-token-code-verifier",
      JSON.stringify("test-verifier/PASSWORD_RECOVERY"),
    ),
  );
  await page.goto("/biletler.html?code=ERC-AAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.locator("#authPanel")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("ticket")).toBe(
    "ERC-AAAAAAAAAAAAAAAAAAAAAAAA",
  );
  expect(state.calls.some((c) => c.path.endsWith("/token"))).toBe(false);
});
test("admin membership editing, moderation, 50 QR tickets and print action", async ({
  page,
}) => {
  const { createHash } = await import("node:crypto");
  const db = {
    members: [],
    submissions: [
      {
        id: "s1",
        kind: "experience",
        title: "Deneyim",
        content: "Bir staj hikayesi",
        status: "pending",
      },
    ],
    batches: [],
  };
  let batch;
  await page.route("**/api/community*", (route) => {
    const u = new URL(route.request().url()),
      action = u.searchParams.get("action"),
      method = route.request().method();
    if (action === "admin") return route.fulfill({ json: db });
    if (action === "member") {
      const b = route.request().postDataJSON();
      db.members = [{ id: "m1", ...b }];
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "moderate") {
      db.submissions[0].status = route.request().postDataJSON().status;
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "batch" && method === "POST") {
      const b = route.request().postDataJSON(),
        codes = Array.from(
          { length: b.count },
          (_, i) => "ERC-" + i.toString(16).padStart(24, "0").toUpperCase(),
        );
      batch = {
        id: "b1",
        codes,
        event_title: "Test etkinliği",
        tickets: codes.map((c, i) => ({
          id: "t" + i,
          code_hash: createHash("sha256").update(c).digest("hex"),
          claimed_at: null,
          revoked: false,
        })),
      };
      db.batches = [{ ...batch, created_at: new Date().toISOString() }];
      return route.fulfill({ json: batch });
    }
    if (action === "batch") return route.fulfill({ json: batch });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin.html");
  await page.locator("#password").fill(process.env.ADMIN_PASSWORD);
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="members"]').click();
  await page.locator("#memberName").fill("Yeni Üye");
  await page.locator("#memberClass").selectOption("3");
  await page.getByRole("button", { name: "Üyeyi kaydet" }).click();
  await expect(page.locator("#memberList")).toContainText("Yeni Üye · 3");
  await page.locator("[data-member]").click();
  await expect(page.locator("#memberName")).toHaveValue("Yeni Üye");
  await page.locator('[data-tab="experiences"]').click();
  await page.getByRole("button", { name: "Onayla ve yayımla" }).click();
  await expect(page.locator("#experienceList")).toContainText("Yayımlandı");
  await page.locator('[data-tab="tickets"]').click();
  await page.locator("#ticketCount").fill("50");
  await page.getByRole("button", { name: "Kodları oluştur" }).click();
  await expect(page.locator(".ticket-qr")).toHaveCount(50);
  await expect(page.locator("#status")).toContainText("50 bilet oluşturuldu");
  await page.evaluate(() => {
    window.print = () => {
      window.printCalled = true;
    };
  });
  await page.locator("#printTickets").click();
  await expect.poll(() => page.evaluate(() => window.printCalled)).toBe(true);
  await expect(page.locator("#ticketPrintRoot .ticket-page")).toHaveCount(5);
  await expect(page.locator("#ticketPrintRoot .ticket-logo")).toHaveCount(50);
  await expect(
    page.locator("#ticketPrintRoot .ticket-slogan").first(),
  ).toContainText("hediyeleri kap!");
  await page.pdf({
    path: "/workspace/.onboarding-runtime/tickets-50.pdf",
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("body")).not.toHaveClass(/printing-tickets/);
});
test("A4 ticket layout keeps long titles and the final ticket complete", async ({
  page,
}) => {
  await page.goto("/admin.html");
  await page.evaluate(async () => {
    const { ticketCard, printTickets } =
      await import("/assets/ticket-print.js");
    const sample = document.createElement("canvas");
    sample.width = 10;
    sample.height = 10;
    const cards = Array.from({ length: 11 }, (_, i) =>
      ticketCard({
        code: "ERC-" + i.toString(16).padStart(24, "0"),
        qr: sample.toDataURL(),
        eventTitle: "W".repeat(150),
      }),
    );
    window.print = () => {
      window.printCalled = true;
    };
    await printTickets(cards, "Uzun başlık testi");
  });
  await expect(page.locator("#ticketPrintRoot .ticket-page")).toHaveCount(2);
  expect(
    await page
      .locator("#ticketPrintRoot .ticket-title")
      .evaluateAll((els) =>
        els.every((e) => e.scrollHeight <= e.clientHeight + 1),
      ),
  ).toBe(true);
  await page.pdf({
    path: "/workspace/.onboarding-runtime/tickets-11.pdf",
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
});
