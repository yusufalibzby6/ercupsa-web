import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicketPdf, DIGITAL_TICKET_QR, ticketClaimUrl, ticketDateLabel, ticketFileBase, ticketPublicUrl, validDigitalTicketCode } from "../assets/ticket-export.js";

const code = "ERC-1234567890ABCDEF12345678";

test("digital ticket links preserve the existing claim QR and keep the public code in a fragment", () => {
  assert.equal(ticketClaimUrl(code, { origin: "https://ercupsa.com.tr" }), `https://ercupsa.com.tr/biletler.html?ticket=${code}`);
  const personal = new URL(ticketPublicUrl(code, { origin: "https://ercupsa.com.tr/path?ignored=1" }));
  assert.equal(personal.pathname, "/bilet.html");
  assert.equal(personal.search, "");
  assert.equal(personal.hash, "#" + code);
  assert.deepEqual(DIGITAL_TICKET_QR, { x: 792, y: 60, size: 288 });
  for (const invalid of ["", null, "ERC-123", code.toLowerCase(), `${code}<script>`]) {
    assert.equal(validDigitalTicketCode(invalid), false);
    assert.throws(() => ticketPublicUrl(invalid, { origin: "https://ercupsa.com.tr" }), /geçersiz/);
  }
  for (const origin of ["javascript:alert(1)", "data:text/html,test", "https://password@example.com"]) assert.throws(() => ticketClaimUrl(code, { origin }), /geçersiz/);
});

test("digital ticket filenames remove path/control characters while retaining Turkish names", () => {
  assert.equal(ticketFileBase(code, '  İlaç / bilim:\u0000 "atölyesi"?  '), "ERCUPSA - İlaç bilim atölyesi - 12345678");
  assert.equal(ticketFileBase(code, "..."), "ERCUPSA - Etkinlik - 12345678");
  assert.match(ticketDateLabel({ date: "2026-10-22", time: "15:30" }), /^22 Ekim 2026 · 15:30$/);
  assert.equal(ticketDateLabel({ date: "invalid", time: "wrong" }), "");
});

test("one-ticket PDF has one A4 landscape page, preserves image proportions, and uses exact byte offsets", async () => {
  const jpeg = Uint8Array.from([255, 216, 255, 0, 128, 222, 10, 255, 217]);
  const blob = createTicketPdf(jpeg, { width: 2232, height: 1176 });
  assert.equal(blob.type, "application/pdf");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const text = bytes.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.match(text, /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1/);
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(text, /\/Width 2232 \/Height 1176/);
  assert.ok(bytes.includes(Buffer.from(jpeg)));
  const transform = text.match(/q\n([\d.]+) 0\.000 0\.000 ([\d.]+) ([\d.]+) ([\d.]+) cm/);
  assert.ok(transform);
  assert.ok(Math.abs(Number(transform[1]) / Number(transform[2]) - 2232 / 1176) < 0.0001);
  assert.ok(Number(transform[3]) >= 23.99 && Number(transform[4]) >= 23.99);
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(bytes.subarray(startxref, startxref + 5).toString(), "xref\n");
  const rows = text.slice(startxref).split("\n");
  for (let object = 1; object <= 5; object++) {
    const offset = Number(rows[2 + object].slice(0, 10));
    assert.equal(bytes.subarray(offset, offset + 7).toString(), `${object} 0 obj`);
  }
  const embeddedStart = text.indexOf("stream\n", text.indexOf("4 0 obj")) + 7;
  assert.deepEqual(bytes.subarray(embeddedStart, embeddedStart + jpeg.length), Buffer.from(jpeg));
});

test("PDF export rejects malformed image input and unreasonable dimensions", () => {
  const jpeg = Uint8Array.from([255, 216, 255, 217]);
  for (const options of [{ width: 0, height: 588 }, { width: 1116.5, height: 588 }, { width: 10001, height: 588 }]) assert.throws(() => createTicketPdf(jpeg, options), /geçersiz/);
  assert.throws(() => createTicketPdf(Uint8Array.from([1, 2, 3, 4]), { width: 1116, height: 588 }), /geçersiz/);
});
