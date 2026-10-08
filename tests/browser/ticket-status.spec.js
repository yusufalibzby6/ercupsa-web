import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

async function fixture(page) {
  const codes = [1, 2, 3, 4].map(value => `ERC-${String(value).padStart(24, "0")}`);
  const state = {
    id: "status-batch", event_id: "status-event", event_title: "Durum atölyesi", codes,
    checkins_available: true,
    tickets: codes.map((code, index) => ({
      id: `ticket-${index}`,
      code_hash: createHash("sha256").update(code).digest("hex"),
      claimed_at: index === 0 || index === 2 ? "2026-10-08T10:00:00Z" : null,
      entered_at: index === 1 || index === 2 ? "2026-10-08T17:00:00Z" : null,
      revoked: index === 3,
    })),
  };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/events*", route => route.fulfill({ json: { events: [{
    id: state.event_id, title: state.event_title, date: "2026-10-20", published: true, images: [],
  }] } }));
  await page.route("**/api/community*", route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    return route.fulfill({ json: action === "admin" ? { submissions: [], members: [], batches: [{
      id: state.id, event_id: state.event_id, event_title: state.event_title, created_at: "2026-10-08T10:00:00Z",
    }] } : state });
  });
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: null } }));
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="tickets"]').click();
  await page.locator('#batchList button[data-batch="status-batch"]').click();
  await expect(page.locator("#ticketOutput .ticket-controls")).toHaveCount(4);
  return state;
}

test("admin tickets display claims and gate entries independently, including unclaimed paper-ticket entry", async ({ page }) => {
  await fixture(page);
  const controls = page.locator("#ticketOutput .ticket-controls");
  await expect(controls.nth(0)).toContainText("Hesaba eklendi · Henüz giriş yapmadı");
  await expect(controls.nth(1)).toContainText("Henüz hesaba eklenmedi · Kapıda giriş yaptı");
  await expect(controls.nth(2)).toContainText("Hesaba eklendi · Kapıda giriş yaptı");
  await expect(controls.nth(3)).toContainText("İptal · Henüz giriş yapmadı");
  await expect(controls.nth(0).locator("button")).toHaveCount(0);
  await expect(controls.nth(1).locator("button")).toHaveText("İptal et");
  await expect(controls.nth(2).locator("button")).toHaveCount(0);
  await expect(controls.nth(3).locator("button")).toHaveCount(0);
  await expect(page.locator("#ticketOutput")).toContainText("Hesaba eklenme ve kapıdan giriş ayrı durumlardır.");
  await expect(page.locator("#printTickets")).toBeEnabled();
});

test("a gate storage outage shows an unknown status instead of a false no-entry status", async ({ page }) => {
  const state = await fixture(page);
  state.checkins_available = false;
  state.tickets.forEach(ticket => { ticket.entered_at = null; });
  await page.locator('#batchList button[data-batch="status-batch"]').click();
  await expect(page.locator("#ticketOutput .ticket-controls")).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    await expect(page.locator("#ticketOutput .ticket-controls").nth(index)).toContainText("Giriş durumu doğrulanamadı");
  }
  await expect(page.locator("#ticketOutput .ticket-controls").nth(0)).toContainText("Hesaba eklendi");
  await expect(page.locator("#ticketOutput .ticket-controls").filter({ hasText: "Henüz giriş yapmadı" })).toHaveCount(0);
  await expect(page.locator("#ticketOutput")).toContainText("bilet grubunu yeniden açarak tekrar deneyin");
});
