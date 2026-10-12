import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

async function fixture(page, { holdCatalog = false } = {}) {
  const event = { id: "cleanup-event", title: "Panel etkinliği", date: "2026-10-20", published: true, images: [] };
  const code = "ERC-AAAAAAAAAAAAAAAAAAAAAAAA";
  const batch = { id: "private-batch", event_id: event.id, event_title: event.title, created_at: "2026-10-12T12:00:00Z" };
  const state = { actions: [], feedbackRequests: 0, catalogRequested: false, batchRequested: false, holdBatch: null };
  let releaseCatalog;
  const catalog = holdCatalog ? new Promise(resolve => { releaseCatalog = resolve; }) : null;
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked cleanup fixture" } }));
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [event] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.route("**/api/feedback*", route => {
    state.feedbackRequests++;
    return route.fulfill({ status: 501, json: { error: "Retired admin section" } });
  });
  await page.route("**/api/community*", async route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    state.actions.push(action);
    if (action === "batches") {
      state.catalogRequested = true;
      if (catalog) await catalog;
      return route.fulfill({ json: { batches: [batch] } });
    }
    if (action === "batch") {
      state.batchRequested = true;
      if (state.holdBatch) await state.holdBatch;
      return route.fulfill({ json: { ...batch, codes: [code], checkins_available: true, tickets: [{
        id: "private-ticket", code_hash: createHash("sha256").update(code).digest("hex"), claimed_at: null, entered_at: null, revoked: false,
      }] } });
    }
    return route.fulfill({ status: 501, json: { error: "Unexpected community action" } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await expect.poll(() => state.catalogRequested).toBe(true);
  return { state, releaseCatalog };
}

test("retired panels are absent and admin starts with ticket metadata instead of moderation or feedback requests", async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.locator("#batchList button")).toHaveCount(1);
  await expect(page.locator('[data-tab="suggestions"], [data-tab="experiences"], [data-tab="feedback"]')).toHaveCount(0);
  await expect(page.locator("#suggestionsTab, #experiencesTab, #feedbackTab")).toHaveCount(0);
  expect(state.feedbackRequests).toBe(0);
  expect(state.actions).toEqual(["batches"]);
  await page.locator('[data-tab="tickets"]').click();
  await expect(page.locator('[data-tab="tickets"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-tab="events"]')).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-tab].is-active')).toHaveCount(1);
  await expect(page.locator("#ticketsTab")).toBeVisible();
  await expect(page.locator("#eventsTab")).not.toBeVisible();
  await expect(page.locator("#adminSectionTitle")).toHaveText(await page.locator('[data-tab="tickets"]').getAttribute("data-section-title"));
});

test("a delayed private ticket catalog cannot repopulate the panel after logout", async ({ page }) => {
  const { releaseCatalog } = await fixture(page, { holdCatalog: true });
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  const response = page.waitForResponse(url => url.url().includes("community?action=batches"));
  releaseCatalog();
  await response;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator("#app")).not.toBeVisible();
  await expect(page.locator("#batchList")).toHaveText("");
  await expect(page.locator("#ticketOutput")).toHaveText("");
  await expect(page.locator("#ticketEvent option")).toHaveCount(0);
  await expect(page.locator("#createBatch")).toBeDisabled();
});

test("an in-flight private batch cannot restore ticket QR codes after logout", async ({ page }) => {
  const { state } = await fixture(page);
  await expect(page.locator("#batchList button")).toHaveCount(1);
  let release;
  state.holdBatch = new Promise(resolve => { release = resolve; });
  await page.locator('[data-tab="tickets"]').click();
  await expect(page.locator("#createBatch")).toBeEnabled();
  await page.locator('#batchList button[data-batch="private-batch"]').click();
  await expect.poll(() => state.batchRequested).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  const response = page.waitForResponse(url => url.url().includes("community?action=batch&id="));
  release();
  await response;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator("#app")).not.toBeVisible();
  await expect(page.locator("#batchList")).toHaveText("");
  await expect(page.locator("#ticketOutput .ticket-qr")).toHaveCount(0);
  await expect(page.locator("#ticketOutput")).toHaveText("");
});
