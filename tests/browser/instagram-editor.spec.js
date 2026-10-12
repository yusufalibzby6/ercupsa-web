import { test, expect } from "@playwright/test";

const defaults = ["https://www.instagram.com/p/DYNe6W6Cmk4/", "https://www.instagram.com/p/DYU7z9ECgxc/", "https://www.instagram.com/p/DRkMhWUiLtv/", "https://www.instagram.com/p/DP_JtyLCBAy/"];
const edited = ["https://www.instagram.com/reel/New_ONE/", "https://www.instagram.com/p/New_TWO/", "https://www.instagram.com/p/New_THREE/", "https://www.instagram.com/reel/New_FOUR/"];
async function fixture(page, { holdRead = false, holdSave = false } = {}) {
  const state = { posts: [...defaults], revision: "", reads: 0, writes: [], saveError: 0 };
  const readGate = new Promise(resolve => { state.releaseRead = resolve; });
  const saveGate = new Promise(resolve => { state.releaseSave = resolve; });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked Instagram fixture endpoint" } }));
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { batches: [], submissions: [], members: [] } }));
  await page.route("**/api/site-content*", async route => {
    if (route.request().method() === "GET") {
      state.reads++;
      const posts = [...state.posts], revision = state.revision;
      if (holdRead && state.reads === 1) await readGate;
      return route.fulfill({ json: { instagram: { posts, revision, updatedAt: null } } });
    }
    const input = route.request().postDataJSON(); state.writes.push(input);
    if (holdSave) await saveGate;
    if (state.saveError) return route.fulfill({ status: state.saveError, json: { error: "Geçici bağlantı sorunu. Yeniden deneyin." } });
    state.posts = input.posts; state.revision = "revision-1";
    return route.fulfill({ json: { ok: true, instagram: { posts: state.posts, revision: state.revision, updatedAt: "2026-10-12T12:00:00Z" } } });
  });
  await page.goto("/admin.html"); await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="instagram"]').click();
  if (!holdRead) await expect(page.locator("#instagramPost1")).toHaveValue(defaults[0]);
  return state;
}
async function fillPosts(page) { for (let index = 0; index < edited.length; index++) await page.locator(`#instagramPost${index + 1}`).fill(edited[index]); }

test("admin saves four ordered Instagram links and homepage keeps direct links when Instagram embeds are blocked", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const state = await fixture(page); await fillPosts(page);
  await page.locator("#instagramPost1").fill("https://instagram.com/reel/New_ONE/?igsh=tracking");
  await page.locator("#instagramPreview").click();
  await expect(page.locator("#instagramPreviewCards a")).toHaveCount(4);
  await expect(page.locator("#instagramPreviewCards a").first()).toHaveAttribute("href", edited[0]);
  await page.locator("#instagramSave").click();
  await expect(page.locator("#instagramMessage")).toContainText("4 paylaşım kaydedildi");
  expect(state.writes).toEqual([{ posts: edited, revision: "" }]);
  await page.goto("/");
  await expect(page.locator("#homeInstagramCards .home-instagram-open")).toHaveCount(4);
  for (let index = 0; index < edited.length; index++) await expect(page.locator("#homeInstagramCards .home-instagram-open").nth(index)).toHaveAttribute("href", edited[index]);
  await expect(page.locator('a[href="topluluk.html"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("invalid URLs cannot save; failed saves and tab switching preserve the edited four links", async ({ page }) => {
  const state = await fixture(page); await fillPosts(page);
  await page.locator("#instagramPost1").fill("https://example.test/p/invalid/");
  await page.locator("#instagramSave").click();
  await expect(page.locator("#instagramMessage")).toContainText("Instagram gönderi");
  expect(state.writes).toHaveLength(0);
  await page.locator("#instagramPost1").fill(edited[0]); state.saveError = 503;
  await page.locator("#instagramSave").click();
  await expect(page.locator("#instagramMessage")).toContainText("bağlantılar korundu");
  await page.locator('[data-tab="tickets"]').click(); await page.locator('[data-tab="instagram"]').click();
  for (let index = 0; index < edited.length; index++) await expect(page.locator(`#instagramPost${index + 1}`)).toHaveValue(edited[index]);
  expect(state.reads).toBe(1); await expect(page.locator("#instagramSave")).toBeEnabled();
});

test("a delayed initial read from an inactive tab cannot overwrite the next selected configuration", async ({ page }) => {
  const state = await fixture(page, { holdRead: true });
  await expect.poll(() => state.reads).toBe(1);
  await page.locator('[data-tab="tickets"]').click(); state.posts = [...edited]; state.revision = "new-revision";
  state.releaseRead(); await page.locator('[data-tab="instagram"]').click();
  await expect(page.locator("#instagramPost1")).toHaveValue(edited[0]);
  expect(state.reads).toBe(2);
});

test("logout clears editor links and suppresses a delayed save response", async ({ page }) => {
  const state = await fixture(page, { holdSave: true }); await fillPosts(page);
  await page.locator("#instagramSave").click(); await expect.poll(() => state.writes.length).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  const response = page.waitForResponse(value => value.url().includes("/api/site-content") && value.request().method() === "POST");
  state.releaseSave(); await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect(page.locator("#instagramPost1")).toHaveValue("");
  await expect(page.locator("#instagramPreviewCards a")).toHaveCount(0);
  await expect(page.locator("#instagramMessage")).toHaveText("");
  await expect(page.locator("#instagramSave")).toBeDisabled();
});

test("unsafe public configuration leaves the four static fallback posts available", async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/site-content*", route => route.fulfill({ json: { instagram: { posts: ["javascript:alert(1)", ...defaults.slice(1)], revision: "unsafe" } } }));
  await page.goto("/");
  await expect(page.locator("#homeInstagramCards .home-instagram-open")).toHaveCount(4);
  await expect(page.locator("#homeInstagramCards .home-instagram-open").first()).toHaveAttribute("href", defaults[0]);
  await expect(page.locator('#homeInstagramCards a[href^="javascript:"]')).toHaveCount(0);
});
