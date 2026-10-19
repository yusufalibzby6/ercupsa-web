import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const code = "ERC-1234567890ABCDEF12345678";
const otherCode = "ERC-AAAAAAAAAAAAAAAAAAAAAAAA";
const event = { id: "e1", title: "Meme Kanseri Farkındalık Konferansı", date: "2026-10-22", time: "15:30", location: "Eczacılık Fakültesi Kırmızı Salon" };

function design() {
  const png = new PNG({ width: 1116, height: 588 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([139, 35, 35, 255], i);
  return { mime: "image/png", width: 1116, height: 588, dataUrl: "data:image/png;base64," + PNG.sync.write(png).toString("base64") };
}

async function fixture(page, { custom = true } = {}) {
  const state = { status: 200, requests: [], custom, responseCode: null };
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/public-ticket", route => {
    const request = route.request();
    state.requests.push({ method: request.method(), body: request.postDataJSON(), cookie: request.headers().cookie });
    if (state.status !== 200) return route.fulfill({ status: state.status, json: { error: "Simulated service failure" } });
    return route.fulfill({ json: { ticket: { code: state.responseCode || request.postDataJSON().code, eventId: event.id, eventTitle: event.title }, event, design: state.custom ? design() : null } });
  });
  return state;
}

function decodedQr(bytes) {
  const png = PNG.sync.read(bytes);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: "dontInvert" });
  expect(result, "ticket QR can be scanned").toBeTruthy();
  return { png, result };
}

test("guest ticket shows full artwork, downloads actual PNG and one-page A4 PDF, both with the original scannable QR", async ({ page }, testInfo) => {
  const state = await fixture(page);
  const downloads = [];
  page.on("download", download => downloads.push(download));
  await page.goto(`/bilet.html#${code}`);
  await expect(page.locator("#ticketContent")).toBeVisible();
  await expect(page.locator("h1")).toHaveText(event.title);
  await expect(page.locator("#ticketDetails")).toContainText("22 Ekim 2026 · 15:30");
  await expect(page.locator("#claimTicket")).toHaveAttribute("href", `http://127.0.0.1:8888/biletler.html?ticket=${code}`);
  expect(state.requests).toEqual([{ method: "POST", body: { code }, cookie: undefined }]);
  expect(downloads).toHaveLength(0);
  expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive");

  const imageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Fotoğraf olarak indir" }).click();
  const image = await imageDownload;
  expect(image.suggestedFilename()).toMatch(/\.png$/);
  const imagePath = testInfo.outputPath("ticket.png");
  await image.saveAs(imagePath);
  const { png, result } = decodedQr(readFileSync(imagePath));
  expect([png.width, png.height]).toEqual([2232, 1176]);
  expect(result.data).toBe(`http://127.0.0.1:8888/biletler.html?ticket=${code}`);
  // Uploaded artwork remains continuous across the old seam and the right stub.
  for (const [x, y] of [[744, 100], [1000, 500], [790, 58], [1082, 350]]) {
    const offset = (y * 2 * png.width + x * 2) * 4;
    expect([...png.data.subarray(offset, offset + 4)]).toEqual([139, 35, 35, 255]);
  }
  // QR placement is the same 66mm/5mm/24mm region as the ten-per-page artwork.
  const whiteOffset = ((60 * 2 + 1) * png.width + 792 * 2 + 1) * 4;
  expect([...png.data.subarray(whiteOffset, whiteOffset + 4)]).toEqual([255, 255, 255, 255]);

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF indir" }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfPath = testInfo.outputPath("ticket.pdf");
  await pdf.saveAs(pdfPath);
  const pdfBytes = readFileSync(pdfPath);
  expect(pdfBytes.subarray(0, 8).toString()).toBe("%PDF-1.4");
  expect(pdfBytes.toString("latin1")).toContain("/Count 1");
  expect(pdfBytes.toString("latin1")).toContain("/MediaBox [0 0 841.89 595.28]");
  const rasterPath = testInfo.outputPath("pdf-ticket");
  execFileSync("pdftoppm", ["-scale-to", "2400", "-singlefile", "-png", pdfPath, rasterPath]);
  expect(decodedQr(readFileSync(rasterPath + ".png")).result.data).toBe(result.data);
  expect(state.requests).toHaveLength(1);
});

test("standard ticket works on a narrow phone without login, auto-download, or horizontal overflow", async ({ page }) => {
  const state = await fixture(page, { custom: false });
  await page.setViewportSize({ width: 390, height: 844 });
  const downloads = [];
  page.on("download", download => downloads.push(download));
  await page.goto(`/bilet.html?code=${code}`);
  await expect(page.locator("#ticketContent")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/bilet\\.html#${code}$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(downloads).toHaveLength(0);
  expect(state.requests).toHaveLength(1);
  const image = await page.locator("#ticketImage").evaluate(async element => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer())));
  expect(decodedQr(Buffer.from(image)).result.data).toContain(`/biletler.html?ticket=${code}`);
  await page.evaluate(next => { location.hash = next; }, otherCode);
  await expect.poll(() => state.requests.length).toBe(2);
  await expect(page.locator("#ticketContent")).toBeVisible();
  await expect(page.locator("#claimTicket")).toHaveAttribute("href", `http://127.0.0.1:8888/biletler.html?ticket=${otherCode}`);
});

test("invalid and revoked links fail closed, while temporary errors can be retried", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/bilet.html#invalid");
  await expect(page.locator("#ticketError")).toBeVisible();
  await expect(page.locator("#retryTicket")).toBeHidden();
  expect(state.requests).toHaveLength(0);
  state.status = 410;
  await page.goto(`/bilet.html#${code}`);
  await expect(page.locator("#ticketErrorMessage")).toContainText("artık kullanılamıyor");
  await expect(page.locator("#ticketContent")).toBeHidden();
  await expect(page.locator("#retryTicket")).toBeHidden();
  state.status = 503;
  await page.reload();
  await expect(page.locator("#retryTicket")).toBeVisible();
  state.status = 200;
  await page.getByRole("button", { name: "Yeniden dene" }).click();
  await expect(page.locator("#ticketContent")).toBeVisible();
  state.responseCode = otherCode;
  await page.reload();
  await expect(page.locator("#ticketContent")).toBeHidden();
  await expect(page.locator("#ticketErrorMessage")).toContainText("bilgileri alınamadı");
});
