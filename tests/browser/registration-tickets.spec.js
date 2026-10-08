import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

const code = "ERC-1234567890ABCDEF12345678";
const secondCode = "ERC-ABCDEF1234567890ABCDEF12";
const receipt = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64");
const currentEvents = [
  { id: "event-one", title: "Bilim atölyesi", date: "2026-10-20", time: "18:00", location: "Eczacılık Fakültesi", category: "Atölye", published: true, images: [] },
  { id: "event-two", title: "Araştırma buluşması", date: "2026-10-22", time: "19:00", location: "Kayseri", category: "Buluşma", published: true, images: [] },
];
const archivedEvents = [
  { id: "archive", title: "Arşivdeki gezi", date: "2026-09-20", archived: true, published: false },
  { id: "empty-archive", title: "Kaydı olmayan eski form", date: "2026-09-15", archived: true, published: false },
];
const fields = [
  { id: "full_name", type: "text", label: "Ad soyad", required: true },
  { id: "class_year", type: "select", label: "Sınıf", required: true, options: ["1. Sınıf", "2. Sınıf", "3. Sınıf"] },
  { id: "phone", type: "tel", label: "Telefon", required: true },
];
const formFor = (eventId) => ({ eventId, enabled: true, description: `${eventId} form açıklaması`,
  maxRegistrations: null, fields, receipt: { enabled: true, required: false } });
const entry = (id, eventId, options = {}) => ({ id, eventId, name: `Katılımcı ${id}`,
  classYear: "2. Sınıf", phone: "05551234567", createdAt: "2026-10-08T09:00:00Z",
  answers: { full_name: `Katılımcı ${id}`, class_year: "2. Sınıf", phone: "05551234567" },
  fields, receipt: null, possibleDuplicate: false, duplicateCount: 1, ...options });
const ticketFor = (eventId, id) => ({ batchId: `batch-${eventId}-${id}`, id: `ticket-${eventId}-${id}`,
  code: eventId === "event-two" ? secondCode : code, claimedAt: null, revoked: false });
function summarize(values) {
  const byClass = new Map();
  for (const value of values) byClass.set(value.classYear, (byClass.get(value.classYear) || 0) + 1);
  return { total: values.length, byClass: [...byClass].map(([classYear, count]) => ({ classYear, count })),
    duplicateEntries: values.filter(value => value.possibleDuplicate).length,
    duplicateGroups: values.some(value => value.possibleDuplicate) ? 1 : 0 };
}
function customDesign() {
  const png = new PNG({ width: 1116, height: 588 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([139, 35, 35, 255], i);
  return { width: 1116, height: 588, mime: "image/png",
    dataUrl: `data:image/png;base64,${PNG.sync.write(png).toString("base64")}` };
}

async function fixture(page, { design = null } = {}) {
  const state = {
    entries: new Map([
      ["event-one", [entry("new", "event-one", { possibleDuplicate: true, duplicateCount: 2 }),
        entry("existing", "event-one", { possibleDuplicate: true, duplicateCount: 2,
          ticket: { batchId: "batch-event-one-existing", status: "issued" } }),
        entry("separate", "event-one", { phone: "05551112233", classYear: "3. Sınıf" })]],
      ["event-two", [entry("other", "event-two")]],
      ["archive", [entry("old", "archive", { receipt: { name: "dekont.png", mime: "image/png", size: receipt.length },
        ticket: { batchId: "batch-archive-old", status: "issued" } }), entry("no-ticket", "archive")]],
      ["empty-archive", []],
    ]),
    pending: new Map(), requests: [], ticketFailures: [], deleteFailures: [], design,
    ticketWait: null, ticketStarted: null, exportWait: null, exportStarted: null,
  };
  await page.addInitScript(() => {
    window.__copiedLinks = [];
    window.__printCalls = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async value => { window.__copiedLinks.push(value); },
    } });
    window.print = () => {
      window.__printCalls.push({ title: document.title,
        codes: [...document.querySelectorAll("#ticketPrintRoot .ticket")].map(ticket => ticket.dataset.code),
        custom: document.querySelectorAll("#ticketPrintRoot .ticket-artwork").length });
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.route("https://**/*", route => route.abort());
  // Every API is intercepted, including APIs owned by other administrator tabs.
  await page.route("**/api/**", route => route.fulfill({ status: 501, json: { error: "Unmocked registration ticket fixture API" } }));
  await page.route("**/api/events*", route => route.fulfill({ json: { events: currentEvents } }));
  await page.route("**/api/community*", route => route.fulfill({ json: { members: [], submissions: [], batches: [] } }));
  await page.route("**/api/ticket-design*", route => route.fulfill({ json: { design: state.design } }));
  await page.route("**/api/registrations*", async route => {
    const request = route.request(), url = new URL(request.url());
    const action = url.searchParams.get("action"), eventId = url.searchParams.get("event_id");
    const id = request.method() === "POST" ? request.postDataJSON().id : url.searchParams.get("id");
    state.requests.push({ action, eventId, id, method: request.method() });
    const values = state.entries.get(eventId) || [];
    const event = [...currentEvents, ...archivedEvents].find(value => value.id === eventId);
    if (action === "admin") return route.fulfill({ json: { form: formFor(eventId), event,
      entries: values, summary: summarize(values), page: 1, totalPages: 1,
      pendingTicketDeletions: state.pending.get(eventId) || [] } });
    if (action === "summary") return route.fulfill({ json: { events: [...currentEvents, ...archivedEvents]
      .map(event => ({ eventId: event.id, title: event.title, date: event.date,
        ...(event.archived ? { archived: true } : {}), ...summarize(state.entries.get(event.id) || []) })) } });
    if (action === "ticket") {
      if (state.ticketWait) {
        const wait = state.ticketWait; state.ticketWait = null;
        state.ticketStarted?.(); await wait;
      }
      if (state.ticketFailures.length) return route.fulfill({ status: state.ticketFailures.shift(),
        json: { error: "Bilet henüz kaydedilemedi. Aynı kayıttan tekrar deneyin." } });
      const value = values.find(value => value.id === id);
      if (!value) return route.fulfill({ status: 404, json: { error: "Kayıt bulunamadı." } });
      if (request.method() === "POST") value.ticket = { batchId: `batch-${eventId}-${id}`, status: "issued" };
      return route.fulfill({ json: { ticket: ticketFor(eventId, id), event } });
    }
    if (action === "delete") {
      if (state.deleteFailures.length) return route.fulfill({ status: state.deleteFailures.shift(),
        json: { error: "Bilet iptali henüz doğrulanamadı. Tekrar deneyin." } });
      state.pending.set(eventId, (state.pending.get(eventId) || []).filter(value => value.id !== id));
      state.entries.set(eventId, values.filter(value => value.id !== id));
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "receipt") return route.fulfill({ contentType: "image/png", body: receipt,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    if (action === "export") {
      if (state.exportWait) { state.exportStarted?.(); await state.exportWait; }
      return route.fulfill({ contentType: "text/csv", body: "Ad soyad,Sınıf\nKatılımcı old,2. Sınıf\n",
        headers: { "Content-Disposition": 'attachment; filename="kayitlar.csv"' } });
    }
    return route.fulfill({ status: 400, json: { error: "Unsupported registration ticket fixture action" } });
  });
  return state;
}

async function openAdmin(page) {
  await page.goto("/admin.html");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator('[data-tab="registrations"]').click();
  await expect(page.locator("#registrationEvent")).toHaveValue("event-one");
  await expect(page.locator('[data-registration-entry="new"]')).toBeVisible();
  await expect(page.locator("#registrationComparisonFeedback")).toBeEmpty();
}
const ticketRequests = state => state.requests.filter(request => request.action === "ticket");

test("explicit issuance renders a custom QR ticket, copies and prints it, then reopens the same ticket with GET", async ({ page }) => {
  const state = await fixture(page, { design: customDesign() });
  await openAdmin(page);
  await page.locator('[data-registration-ticket="new"]').click();
  await expect(page.locator("#registrationTicketDialog")).toBeVisible();
  await expect(page.locator("#registrationTicketCode")).toHaveText(code);
  const preview = page.locator("#registrationTicketPreview .ticket-custom");
  await expect(preview).toHaveCount(1);
  await preview.locator(".ticket-artwork").evaluate(image => image.decode());
  await preview.locator(".ticket-qr").evaluate(image => image.decode());
  await expect(preview).toHaveAttribute("data-code", code);
  await expect(page.locator("#registrationTicketLink")).toHaveValue(new RegExp(`/biletler\\.html\\?ticket=${code}$`));
  await page.locator("#registrationTicketCopy").click();
  await expect(page.locator("#registrationTicketMessage")).toContainText("kopyalandı");
  expect(await page.evaluate(() => window.__copiedLinks)).toEqual([await page.locator("#registrationTicketLink").inputValue()]);
  await page.locator("#registrationTicketPrint").click();
  await expect.poll(() => page.evaluate(() => window.__printCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.__printCalls[0])).toEqual({ title: "ERCUPSA - Bilim atölyesi - Biletler", codes: [code], custom: 1 });
  await expect(page.locator("#registrationTicketDialog")).not.toBeVisible();
  await expect(page.locator("#registrationTicketCode")).toBeEmpty();
  await page.locator('[data-registration-ticket="new"]').click();
  await expect(page.locator("#registrationTicketCode")).toHaveText(code);
  expect(ticketRequests(state).map(request => request.method)).toEqual(["POST", "GET"]);
  await page.locator("#registrationTicketClose").click();
  await expect(page.locator("#registrationTicketPreview")).toBeEmpty();
});

test("failed issuance preserves the form draft and retries the same registration without duplicate clicks", async ({ page }) => {
  const state = await fixture(page);
  state.ticketFailures.push(503);
  await openAdmin(page);
  await page.locator("#registrationDescription").fill("Korunacak form açıklaması");
  await page.locator('[data-registration-ticket="new"]').click();
  await expect(page.locator("#registrationTicketMessage")).toContainText("Aynı kayıttan tekrar deneyin");
  await expect(page.locator("#registrationTicketCopy")).toBeDisabled();
  await expect(page.locator("#registrationTicketPrint")).toBeDisabled();
  await page.locator("#registrationTicketClose").click();
  await expect(page.locator("#registrationDescription")).toHaveValue("Korunacak form açıklaması");
  await page.locator('[data-registration-ticket="new"]').click();
  await expect(page.locator("#registrationTicketCode")).toHaveText(code);
  expect(ticketRequests(state).map(request => [request.method, request.id])).toEqual([["POST", "new"], ["POST", "new"]]);
  await page.locator("#registrationTicketClose").click();
  await expect(page.locator('[data-registration-entry="new"]')).toContainText("Bilet verilmiş");
  await expect(page.locator("#registrationDescription")).toHaveValue("Korunacak form açıklaması");
});

test("duplicate warnings and with or without ticket filters preserve full event totals", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  await expect(page.locator(".registration-duplicate")).toHaveCount(2);
  await expect(page.locator('[data-registration-entry="new"]')).toContainText("aynı telefonla 2 kayıt");
  await page.locator("#registrationRecordFilter").selectOption("duplicates");
  await expect(page.locator(".registration-entry")).toHaveCount(2);
  await expect(page.locator('[data-registration-entry="separate"]')).toHaveCount(0);
  await page.locator("#registrationRecordFilter").selectOption("with-ticket");
  await expect(page.locator(".registration-entry")).toHaveCount(1);
  await expect(page.locator('[data-registration-entry="existing"]')).toBeVisible();
  await page.locator("#registrationRecordFilter").selectOption("without-ticket");
  await expect(page.locator(".registration-entry")).toHaveCount(2);
  await expect(page.locator('[data-registration-entry="existing"]')).toHaveCount(0);
  await expect(page.locator("#registrationSummary")).toContainText("Toplam kayıt3");
  await expect(page.locator("#registrationSummary")).toContainText("Olası tekrar kayıt2");
  expect(ticketRequests(state)).toHaveLength(0);
});

test("archive catalog retains zero-entry forms and provides read-only configuration, receipts, CSV and saved tickets", async ({ page }) => {
  const state = await fixture(page);
  await openAdmin(page);
  await page.locator("#registrationEventScope").selectOption("archived");
  await expect(page.locator("#registrationEvent option")).toHaveCount(2);
  await expect(page.locator('#registrationEvent option[value="empty-archive"]')).toContainText("Kaydı olmayan eski form");
  await expect(page.locator("#registrationEvent")).toHaveValue("archive");
  await expect(page.locator("#registrationDescription")).toBeDisabled();
  await expect(page.locator("#registrationSave")).toBeDisabled();
  await expect(page.locator('[data-registration-ticket="no-ticket"]')).toBeDisabled();
  await page.locator('[data-registration-receipt="old"]').click();
  await expect(page.locator("#registrationReceiptImage")).toBeVisible();
  await page.locator("#registrationReceiptImage").evaluate(image => image.decode());
  await page.locator("#registrationReceiptClose").click();
  const download = page.waitForEvent("download");
  await page.locator("#registrationExport").click();
  expect((await download).suggestedFilename()).toContain("kayitlar");
  await page.locator('[data-registration-ticket="old"]').click();
  await expect(page.locator("#registrationTicketCode")).toHaveText(code);
  expect(ticketRequests(state).map(request => [request.method, request.eventId])).toEqual([["GET", "archive"]]);
  await page.locator("#registrationTicketClose").click();
  await page.locator("#registrationEvent").selectOption("empty-archive");
  await expect(page.locator("#registrationEntries")).toContainText("eşleşen kayıt yok");
  await expect(page.locator("#registrationDescription")).toBeDisabled();
  await page.locator("#registrationEventScope").selectOption("current");
  await page.locator('[data-registration-open-event="archive"]').click();
  await expect(page.locator("#registrationEventScope")).toHaveValue("all");
  await expect(page.locator("#registrationEvent")).toHaveValue("archive");
  await expect(page.locator('[data-registration-entry="old"]')).toBeVisible();
  expect(state.requests.some(request => request.action === "receipt" && request.eventId === "archive")).toBe(true);
  expect(state.requests.some(request => request.action === "export" && request.eventId === "archive")).toBe(true);
});

test("a failed deleted-ticket cancellation remains recoverable after refresh and its retry removes the recovery row", async ({ page }) => {
  const state = await fixture(page);
  state.pending.set("event-one", [{ id: "deleted", name: "Silinen katılımcı" }]);
  state.deleteFailures.push(503);
  await openAdmin(page);
  await page.locator('[data-registration-cleanup="deleted"]').click();
  await expect(page.locator(".registration-cleanup")).toContainText("henüz doğrulanamadı");
  await expect(page.locator('[data-registration-cleanup="deleted"]')).toBeEnabled();
  await page.locator("#registrationReload").click();
  await expect(page.locator('[data-registration-cleanup="deleted"]')).toBeVisible();
  await page.locator('[data-registration-cleanup="deleted"]').click();
  await expect(page.locator(".registration-cleanup")).toHaveCount(0);
  await expect(page.locator("#registrationFeedback")).toContainText("QR bileti iptal edildi");
  expect(state.requests.filter(request => request.action === "delete").map(request => request.id)).toEqual(["deleted", "deleted"]);
});

test("logging out during slow private ticket print preparation clears its cards and prevents printing", async ({ page }) => {
  await fixture(page);
  await openAdmin(page);
  await page.locator('[data-registration-ticket="existing"]').click();
  await expect(page.locator("#registrationTicketCode")).toHaveText(code);
  await expect(page.locator("#registrationTicketPrint")).toBeEnabled();
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.__printDecodeStarted = false;
    window.__releasePrintDecode = null;
    const slowDecode = new Promise(resolve => { window.__releasePrintDecode = resolve; });
    HTMLImageElement.prototype.decode = function () {
      if (this.closest("#ticketPrintRoot")) {
        window.__printDecodeStarted = true;
        return slowDecode;
      }
      return decode.call(this);
    };
  });
  await page.locator("#registrationTicketPrint").click();
  await expect(page.locator("#registrationTicketDialog")).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__printDecodeStarted)).toBe(true);
  await expect(page.locator("#ticketPrintRoot .ticket")).toHaveCount(1);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  await expect(page.locator("#ticketPrintRoot")).toBeEmpty();
  await page.evaluate(async () => {
    window.__releasePrintDecode();
    // Flush the resolved decode chain before inspecting the print spy.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => window.__printCalls)).toHaveLength(0);
  await expect(page.locator("#ticketPrintRoot .ticket")).toHaveCount(0);
  await expect(page.locator("#registrationTicketCode")).toBeEmpty();
});

test("a delayed private CSV response cannot start a download after administrator logout", async ({ page }) => {
  const state = await fixture(page);
  let release, signal;
  state.exportWait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signal = resolve; });
  state.exportStarted = signal;
  await openAdmin(page);
  await page.evaluate(() => {
    window.__downloadClicks = [];
    window.__exportBlobRead = false;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloadClicks.push({ href: this.href, filename: this.download }); return; }
      return click.call(this);
    };
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (String(args[0]).includes("action=export")) {
        const blob = response.blob.bind(response);
        response.blob = async () => {
          const value = await blob();
          window.__exportBlobRead = true;
          return value;
        };
      }
      return response;
    };
  });
  await page.locator("#registrationExport").click();
  await started;
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout")));
  release();
  await expect.poll(() => page.evaluate(() => window.__exportBlobRead)).toBe(true);
  // Run after the awaited blob continuation and its logout/version guard.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => window.__downloadClicks)).toHaveLength(0);
  expect(state.requests.filter(request => request.action === "export")).toHaveLength(1);
  await expect(page.locator("#registrationEntries")).toBeEmpty();
});

for (const switchEvent of [false, true]) {
  test(`closing ${switchEvent ? "and switching events" : "the dialog"} during slow issuance prevents a stale ticket from appearing`, async ({ page }) => {
    const state = await fixture(page);
    let release, signal;
    state.ticketWait = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { signal = resolve; });
    state.ticketStarted = signal;
    await openAdmin(page);
    await page.locator('[data-registration-ticket="new"]').click();
    await started;
    await expect(page.locator("#registrationTicketDialog")).toBeVisible();
    await expect(page.locator('[data-registration-ticket="new"]')).toBeDisabled();
    await page.locator("#registrationTicketClose").click();
    if (switchEvent) {
      await page.locator("#registrationEvent").selectOption("event-two");
      await expect(page.locator('[data-registration-entry="other"]')).toBeVisible();
    }
    release();
    await expect.poll(() => state.entries.get("event-one")[0].ticket?.status).toBe("issued");
    await expect(page.locator("#registrationTicketDialog")).not.toBeVisible();
    await expect(page.locator("#registrationTicketCode")).toBeEmpty();
    await expect(page.locator("#registrationTicketLink")).toHaveValue("");
    await expect(page.locator("#registrationTicketPreview")).toBeEmpty();
    if (switchEvent) {
      await page.locator('[data-registration-ticket="other"]').click();
      await expect(page.locator("#registrationTicketCode")).toHaveText(secondCode);
      await expect(page.locator("#registrationTicketTitle")).toContainText("Katılımcı other");
    } else {
      await expect(page.locator('[data-registration-ticket="new"]')).toBeEnabled();
      await page.locator('[data-registration-ticket="new"]').click();
      await expect(page.locator("#registrationTicketCode")).toHaveText(code);
      expect(ticketRequests(state).map(request => request.method)).toEqual(["POST", "GET"]);
    }
  });
}
