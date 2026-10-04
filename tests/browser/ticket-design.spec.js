import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

const events = [
  { id: "e1", title: "Tasarım atölyesi", date: "2026-10-20", time: "18:00", published: true, images: [] },
  { id: "e2", title: "İkinci etkinlik", date: "2026-10-22", time: "19:00", published: true, images: [] },
];

async function fixture(page) {
  const state = { designs: new Map(), batches: new Map(), requests: [], fail: false, slow: false };
  const old = { id: "old", event_id: "e1", event_title: events[0].title, codes: ["ERC-AAAAAAAAAAAAAAAAAAAAAAAA"], tickets: [] };
  state.batches.set(old.id, old);
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/events*", route => route.fulfill({ json: { events } }));
  await page.route("**/api/community*", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "admin") {
      return route.fulfill({ json: { members: [], submissions: [], batches: [...state.batches.values()].map(b => ({ ...b, created_at: "2026-10-03T00:00:00Z" })) } });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      const batch = {
        id: `b${state.batches.size}`,
        event_id: body.event_id,
        event_title: events.find(e => e.id === body.event_id).title,
        codes: Array.from({ length: body.count }, (_, i) => "ERC-" + i.toString(16).padStart(24, "0").toUpperCase()),
        tickets: [],
      };
      state.batches.set(batch.id, batch);
      return route.fulfill({ json: batch });
    }
    return route.fulfill({ json: state.batches.get(url.searchParams.get("id")) });
  });
  await page.route("**/api/ticket-design*", async route => {
    const request = route.request();
    const eventId = new URL(request.url()).searchParams.get("event_id");
    const method = request.method();
    state.requests.push({ eventId, method, mime: request.headers()["content-type"] });
    if (method === "POST") {
      const mime = request.headers()["content-type"];
      state.designs.set(eventId, {
        dataUrl: `data:${mime};base64,${request.postDataBuffer().toString("base64")}`,
        mime, width: 1116, height: 588, updatedAt: "2026-10-03T00:00:00Z",
      });
    }
    if (method === "DELETE") state.designs.delete(eventId);
    if (state.fail && eventId === "e2") return route.fulfill({ status: 503, json: { error: "Tasarım bağlantısı kesildi." } });
    if (state.slow && eventId === "e2") await new Promise(resolve => setTimeout(resolve, 100));
    return route.fulfill({ json: { design: state.designs.get(eventId) || null } });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="tickets"]').click();
  await expect(page.locator("#createBatch")).toBeEnabled();
  return state;
}

async function raster(page, width = 1116, height = 588, noisy = false) {
  const url = await page.evaluate(({ width, height, noisy }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (noisy) {
      const pixels = ctx.createImageData(width, height);
      let random = 123456789;
      for (let i = 0; i < pixels.data.length; i++) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        pixels.data[i] = random & 255;
      }
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    }
    ctx.fillStyle = "#8b2323";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 50px Arial";
    ctx.fillText("ERCUPSA TEST TASARIMI", 45, 100);
    return canvas.toDataURL("image/png");
  }, { width, height, noisy });
  return Buffer.from(url.split(",")[1], "base64");
}

async function expectFullArtworkWithFixedQr(ticket) {
  await expect(ticket.locator(".ticket-code, .ticket-state")).toHaveCount(0);
  await ticket.locator(".ticket-artwork").evaluate(image => image.decode());
  await ticket.locator(".ticket-qr, .ticket-preview-qr").evaluate(image => image.decode());
  const geometry = await ticket.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const qr = element.querySelector(".ticket-qr, .ticket-preview-qr").getBoundingClientRect();
    const artwork = element.querySelector(".ticket-artwork").getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      qrX: qr.x - rect.x,
      qrY: qr.y - rect.y,
      qrWidth: qr.width,
      qrHeight: qr.height,
      artworkX: artwork.x - rect.x,
      artworkY: artwork.y - rect.y,
      artworkWidth: artwork.width,
      artworkHeight: artwork.height,
    };
  });
  const mm = 96 / 25.4;
  for (const [actual, expected] of [
    [geometry.width, 93], [geometry.height, 49],
    [geometry.qrX, 66], [geometry.qrY, 5],
    [geometry.qrWidth, 24], [geometry.qrHeight, 24],
    [geometry.artworkX, 0], [geometry.artworkY, 0],
    [geometry.artworkWidth, 93], [geometry.artworkHeight, 49],
  ]) expect(actual).toBeCloseTo(expected * mm, 1);

  // Check the rendered result, including the former seam and automatic-text area.
  // A white stub or a divider would obscure the uploaded red artwork here.
  const png = PNG.sync.read(await ticket.screenshot());
  const pixelAt = (xMm, yMm) => {
    const x = Math.floor(xMm * png.width / 93);
    const y = Math.floor(yMm * png.height / 49);
    const offset = (y * png.width + x) * 4;
    return [...png.data.subarray(offset, offset + 4)];
  };
  const red = [139, 35, 35, 255];
  for (const y of [2, 4, 8, 12, 16, 22, 28, 34, 40, 46]) {
    expect(pixelAt(62, y), `old divider at y=${y}mm`).toEqual(red);
  }
  for (const x of [63, 65, 70, 78, 85, 92]) {
    for (const y of [2, 34, 40, 46]) {
      expect(pixelAt(x, y), `artwork at x=${x}mm, y=${y}mm`).toEqual(red);
    }
  }
  // The preview has a decorative dashed edge; real QR codes have a white quiet zone.
  const inset = await ticket.locator(".ticket-preview-qr").count() ? 2 : 0.5;
  for (const [x, y] of [[66 + inset, 5 + inset], [90 - inset, 5 + inset], [66 + inset, 29 - inset], [90 - inset, 29 - inset]]) {
    expect(pixelAt(x, y), `QR quiet zone at x=${x}mm, y=${y}mm`).toEqual([255, 255, 255, 255]);
  }
}

test("full ticket artwork stays continuous behind fifty unique fixed-position QR codes and eleven tickets print on two A4 pages", async ({ page }) => {
  const state = await fixture(page);
  await page.locator("#ticketDesignFile").setInputFiles({ name: "wrong.png", mimeType: "image/png", buffer: await raster(page, 100, 100) });
  await expect(page.locator("#ticketDesignStatus")).toContainText("100 × 100");
  await expect(page.locator("#ticketDesignSave")).toBeDisabled();
  await page.locator("#ticketDesignFile").setInputFiles({ name: "event.png", mimeType: "image/png", buffer: await raster(page) });
  await expect(page.locator("#ticketDesignPreview .ticket-artwork")).toHaveCount(1);
  await expect(page.locator("#createBatch")).toBeDisabled();
  await page.locator("#ticketDesignSave").click();
  await expect(page.locator("#createBatch")).toBeEnabled();
  expect(state.requests.some(r => r.method === "POST" && r.eventId === "e1" && r.mime === "image/png")).toBe(true);
  await expectFullArtworkWithFixedQr(page.locator("#ticketDesignPreview .ticket"));
  await page.locator("#ticketCount").fill("50");
  await page.locator("#createBatch").click();
  await expect(page.locator("#ticketOutput .ticket-custom")).toHaveCount(50);
  await expect(page.locator("#ticketOutput .ticket-title")).toHaveCount(0);
  const qrSources = await page.locator("#ticketOutput .ticket-qr").evaluateAll(images => images.map(i => i.src));
  expect(new Set(qrSources).size).toBe(50);
  await expect(page.locator("#ticketOutput .ticket-code, #ticketOutput .ticket-state")).toHaveCount(0);
  await expectFullArtworkWithFixedQr(page.locator("#ticketOutput .ticket").first());
  await page.locator("#ticketCount").fill("11");
  await page.locator("#createBatch").click();
  await expect(page.locator("#ticketOutput .ticket-custom")).toHaveCount(11);
  await page.evaluate(() => { window.print = () => { window.printCalled = true; }; });
  await page.locator("#printTickets").click();
  await expect.poll(() => page.evaluate(() => window.printCalled)).toBe(true);
  await expect(page.locator("#ticketPrintRoot .ticket-page")).toHaveCount(2);
  await expect(page.locator("#ticketPrintRoot .ticket-artwork")).toHaveCount(11);
  await expect(page.locator("#ticketPrintRoot .ticket-code, #ticketPrintRoot .ticket-state")).toHaveCount(0);
  expect(await page.locator("#ticketPrintRoot img").evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
  await page.pdf({ path: "/workspace/.onboarding-runtime/custom-tickets-11.pdf", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#ticketDesignReset").click();
  await expect(page.locator("#ticketOutput .ticket-custom")).toHaveCount(0);
  await expect(page.locator("#ticketOutput .ticket-logo")).toHaveCount(11);
  await expect(page.locator("#ticketOutput .ticket-title")).toHaveCount(11);
  await expect(page.locator("#ticketOutput .ticket-code")).toHaveCount(11);
  await expect(page.locator("#ticketOutput .ticket-code").first()).toHaveText("ERC-000000000000000000000000");
  await expect(page.locator("#ticketOutput .ticket-state")).toHaveCount(11);
  await expect(page.locator("#ticketOutput .ticket-state").first()).toHaveText("KATILIM BİLETİ");
  await expect(page.locator("#ticketOutput .ticket-stub").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await page.locator("#ticketOutput .ticket-stub").first().evaluate(stub => getComputedStyle(stub, "::before").borderLeftStyle)).toBe("dashed");
  await expect(page.locator("#ticketOutput .ticket-slogan").first()).toHaveText("Sürpriz hediyeler sizi bekliyor.");
  expect(state.requests.some(r => r.method === "DELETE" && r.eventId === "e1")).toBe(true);
});

test("design failures block printing and opening an older batch selects its own event design", async ({ page }) => {
  const state = await fixture(page);
  await page.locator('[data-batch="old"]').click();
  await expect(page.locator("#printTickets")).toBeEnabled();
  state.fail = true;
  await page.locator("#ticketEvent").selectOption("e2");
  await expect(page.locator("#ticketDesignStatus")).toContainText("Tasarım bağlantısı kesildi");
  await expect(page.locator("#createBatch")).toBeDisabled();
  await expect(page.locator("#printTickets")).toHaveCount(0);
  state.fail = false;
  await page.locator("#ticketDesignRetry").click();
  await expect(page.locator("#createBatch")).toBeEnabled();
  await page.locator('[data-batch="old"]').click();
  await expect(page.locator("#ticketEvent")).toHaveValue("e1");
  await expect(page.locator("#printTickets")).toBeEnabled();
  await expect(page.locator("#ticketOutput")).toContainText(events[0].title);
  state.slow = true;
  await page.locator("#ticketEvent").selectOption("e2");
  await page.locator("#ticketEvent").selectOption("e1");
  await expect(page.locator("#createBatch")).toBeEnabled();
  await page.waitForTimeout(150);
  await expect(page.locator("#ticketEvent")).toHaveValue("e1");
  await expect(page.locator("#ticketDesignEvent")).toContainText(events[0].title);
  await expect(page.locator("#ticketDesignPreview .ticket-title")).toHaveText(events[0].title);
});

test("a large custom raster is shared across two hundred tickets and its blob is released after changing events", async ({ page }) => {
  await fixture(page);
  const image = await raster(page, 1116, 588, true);
  expect(image.length).toBeGreaterThan(2 * 1024 * 1024);
  expect(image.length).toBeLessThanOrEqual(3 * 1024 * 1024);
  await page.locator("#ticketDesignFile").setInputFiles({ name: "large.png", mimeType: "image/png", buffer: image });
  await expect(page.locator("#ticketDesignSave")).toBeEnabled();
  await page.locator("#ticketDesignSave").click();
  await expect(page.locator("#createBatch")).toBeEnabled();
  await page.locator("#ticketCount").fill("200");
  await page.locator("#createBatch").click();
  await expect(page.locator("#ticketOutput .ticket-custom")).toHaveCount(200);
  await expect(page.locator("#ticketOutput .ticket-page")).toHaveCount(20);
  const sources = await page.locator("#ticketOutput .ticket-artwork").evaluateAll(images => images.map(i => i.src));
  expect(new Set(sources).size).toBe(1);
  expect(sources[0]).toMatch(/^blob:http:\/\/127\.0\.0\.1:8888\//);
  expect(sources[0].length).toBeLessThan(100);
  const htmlLength = await page.locator("#ticketOutput").evaluate(output => output.innerHTML.length);
  expect(htmlLength).toBeLessThan(20 * 1024 * 1024);
  await page.locator("#ticketEvent").selectOption("e2");
  await expect(page.locator("#createBatch")).toBeEnabled();
  expect(await page.evaluate(url => fetch(url).then(() => true).catch(() => false), sources[0])).toBe(false);
});

test("a corrupt saved design can be explicitly reset while printing stays blocked", async ({ page }) => {
  const state = await fixture(page);
  state.designs.set("e2", { dataUrl: "https://invalid.example/design.png", width: 1116, height: 588, mime: "image/png" });
  await page.locator("#ticketEvent").selectOption("e2");
  await expect(page.locator("#ticketDesignStatus")).toContainText("Kaydedilmiş bilet tasarımı geçersiz");
  await expect(page.locator("#createBatch")).toBeDisabled();
  await expect(page.locator("#ticketDesignReset")).toBeEnabled();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#ticketDesignReset").click();
  await expect(page.locator("#createBatch")).toBeEnabled();
  await expect(page.locator("#ticketDesignPreview .ticket-logo")).toHaveCount(1);
  expect(state.designs.has("e2")).toBe(false);
});
