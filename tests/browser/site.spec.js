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
test("email OTP account flow, profile consent and ticket badge UI", async ({
  page,
}) => {
  let total = 2,
    name = "",
    public_name = false;
  await page.route("https://local-test.supabase.co/auth/v1/**", (route) => {
    if (route.request().url().includes("/verify"))
      return route.fulfill({
        json: {
          access_token: "test.token.value",
          refresh_token: "test-refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "a873ee44-1ce7-4b30-b0fc-11e90719e9b3",
            email: "student@example.test",
            aud: "authenticated",
          },
        },
      });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/community*", (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "config")
      return route.fulfill({
        json: { url: "https://local-test.supabase.co", key: "test-public" },
      });
    if (action === "me" && route.request().method() === "POST") {
      ({ name, public_name } = route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "me")
      return route.fulfill({
        json: {
          profile: name ? { name, public_name } : null,
          total,
          badge:
            total >= 5
              ? "Altın"
              : total === 4
                ? "Gümüş"
                : total === 3
                  ? "Bronz"
                  : null,
          attendance: Array.from({ length: total }, (_, i) => ({
            event_title: "Etkinlik " + i,
          })),
        },
      });
    if (action === "claim") {
      total++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { board: [], members: [], experiences: [] } });
  });
  await page.goto("/biletler.html");
  await expect(page.locator("#otpForm")).not.toBeVisible();
  await page.locator("#email").fill("student@example.test");
  await page.getByRole("button", { name: "Doğrulama kodu gönder" }).click();
  await expect(page.locator("#otpForm")).toBeVisible();
  await page.locator("#otp").fill("123456");
  await page.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
  await expect(page.locator("#accountPanel")).toBeVisible();
  await page.locator("#name").fill("Test Öğrenci");
  await page.locator("#publicName").check();
  await page.getByRole("button", { name: "Bilgilerimi kaydet" }).click();
  for (const expected of ["Bronz", "Gümüş", "Altın"]) {
    await page.locator("#ticketCode").fill("ERC-AAAAAAAAAAAAAAAAAAAAAAAA");
    await page.getByRole("button", { name: "Biletimi ekle" }).click();
    await expect(page.locator("#badge")).toContainText(expected);
  }
  expect(name).toBe("Test Öğrenci");
  expect(public_name).toBe(true);
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
  await expect(page.locator(".ticket img")).toHaveCount(50);
  await expect(page.locator("#status")).toContainText("50 bilet oluşturuldu");
  await page.evaluate(() => {
    window.print = () => {
      window.printCalled = true;
    };
  });
  await page.locator("#printTickets").click();
  expect(await page.evaluate(() => window.printCalled)).toBe(true);
});
