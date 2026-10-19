import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const event = { id: "digital-batch-event", title: "Dijital bilet etkinliği", date: "2099-10-20", time: "18:30", location: "Fakülte", published: true, images: [] };
const codeAt = index => `ERC-${index.toString(16).padStart(24, "0").toUpperCase()}`;

async function fixture(page, { count = 12, permission = "tickets.view" } = {}) {
  const codes = Array.from({ length: count }, (_, index) => codeAt(index + 1));
  const batch = {
    id: "digital-batch", event_id: event.id, event_title: event.title, codes, checkins_available: true,
    tickets: codes.slice(0, -1).map((code, index) => ({ id: `ticket-${index}`, code_hash: createHash("sha256").update(code).digest("hex"), revoked: index === 1, claimed_at: index === 2 ? "2026-10-01T00:00:00Z" : null })),
  };
  const state = { session: { id: "ticket-reader", username: "biletci", name: "Bilet sorumlusu", role: "admin", permissions: [permission] } };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    if (url.pathname === "/api/admin-auth") {
      if (action === "logout") state.session = null;
      return route.fulfill({ json: { session: state.session } });
    }
    if (url.pathname === "/api/events") return route.fulfill({ json: { events: [event] } });
    if (url.pathname === "/api/ticket-design") return route.fulfill({ json: { design: null } });
    if (url.pathname === "/api/community" && action === "batches") return route.fulfill({ json: { batches: [{ ...batch, created_at: "2026-10-19T10:00:00Z" }] } });
    if (url.pathname === "/api/community" && action === "batch") return route.fulfill({ json: batch });
    return route.fulfill({ status: 501, json: { error: "Unexpected batch fixture endpoint" } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  if (permission === "tickets.view") {
    await page.locator('[data-tab="tickets"]').click();
    await page.locator('[data-batch="digital-batch"]').click();
    await expect(page.locator("#ticketOutput .ticket")).toHaveCount(count);
  }
  return { batch, state };
}

test("confirmed batch tickets offer private links and file downloads while the original ten-up output remains intact", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { batch } = await fixture(page);
  const controls = page.locator("#ticketOutput .ticket-controls");
  await expect(controls.getByRole("link", { name: "Bileti aç", exact: true })).toHaveCount(10);
  const first = controls.first();
  const publicUrl = `http://127.0.0.1:8888/bilet.html#${batch.codes[0]}`;
  await expect(first.getByRole("link", { name: "Bileti aç", exact: true })).toHaveAttribute("href", publicUrl);
  await expect(first.getByRole("link", { name: "Bileti aç", exact: true })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(controls.nth(1).getByRole("link", { name: "Bileti aç", exact: true })).toHaveCount(0);
  await expect(controls.last().getByRole("link", { name: "Bileti aç", exact: true })).toHaveCount(0);
  await first.getByRole("button", { name: "Bağlantıyı kopyala", exact: true }).click();
  await expect(first.locator("[data-digital-status]")).toContainText("kopyalandı");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(publicUrl);

  const [image] = await Promise.all([page.waitForEvent("download"), first.getByRole("button", { name: "Fotoğraf indir", exact: true }).click()]);
  expect(image.suggestedFilename()).toMatch(/\.png$/);
  const png = await readFile(await image.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const [pdf] = await Promise.all([page.waitForEvent("download"), first.getByRole("button", { name: "PDF indir (A4)", exact: true }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfBytes = await readFile(await pdf.path());
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841(?:\.\d+)?\s+595(?:\.\d+)?\s*\]/);

  await page.evaluate(() => { window.print = () => { window.digitalBatchPrintCalled = true; }; });
  await page.locator("#printTickets").click();
  await expect.poll(() => page.evaluate(() => window.digitalBatchPrintCalled)).toBe(true);
  await expect(page.locator("#ticketPrintRoot .ticket-page")).toHaveCount(2);
  await expect(page.locator("#ticketPrintRoot .ticket-page").first().locator(".ticket")).toHaveCount(10);
  await expect(page.locator("#ticketPrintRoot .ticket-page").last().locator(".ticket")).toHaveCount(2);
  await expect(page.locator("#ticketPrintRoot [data-digital-code], #ticketPrintRoot [data-digital-status]")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
});

test("an export finishing after logout cannot download or restore ticket codes", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (!window.digitalBatchBlobHeld) {
        window.digitalBatchBlobHeld = true;
        window.releaseDigitalBatchBlob = () => original.call(this, callback, ...args);
      } else original.call(this, callback, ...args);
    };
    window.digitalBatchDownloads = 0;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) {
      if (this.download) window.digitalBatchDownloads++;
      return click.apply(this, args);
    };
  });
  await page.locator('#ticketOutput [data-digital-action="image"]').first().click();
  await expect.poll(() => page.evaluate(() => window.digitalBatchBlobHeld)).toBe(true);
  await page.locator("#adminLogout").click();
  await expect(page.locator("#login")).toBeVisible();
  await page.evaluate(() => window.releaseDigitalBatchBlob());
  await expect(page.locator("#ticketOutput")).toHaveText("");
  await expect(page.locator("[data-digital-code]")).toHaveCount(0);
  // Two animation frames let any promise continuations complete after encoding.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.digitalBatchDownloads)).toBe(0);
});
