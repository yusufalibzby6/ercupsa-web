import test from "node:test";
import assert from "node:assert/strict";
import { whatsAppTicketUrl } from "../assets/ticket-delivery.js";

test("WhatsApp delivery normalizes Turkish/international numbers without attaching files", () => {
  const link = "https://ercupsa.com.tr/bilet.html#ERC-1234567890ABCDEF12345678";
  for (const phone of ["0555 123 45 67", "5551234567", "+90 (555) 123-45-67", "00905551234567"]) {
    const url = new URL(whatsAppTicketUrl(phone, { link, eventTitle: "Bilim & sanat" }));
    assert.equal(url.origin + url.pathname, "https://wa.me/905551234567");
    assert.ok(url.searchParams.get("text").endsWith(link));
    assert.ok(url.searchParams.get("text").includes("Bilim & sanat"));
    assert.ok(url.searchParams.get("text").includes("*Çekilişlere katılmak ve farklı ayrıcalıklardan yararlanmak için biletini hesabına ekle.*"));
    assert.ok(url.searchParams.get("text").includes("“Biletimi hesabıma ekle”"));
    assert.deepEqual([...url.searchParams.keys()], ["text"]);
  }
  assert.equal(new URL(whatsAppTicketUrl("+49 151 23456789", { link })).pathname, "/4915123456789");
});

test("missing or invalid recipient offers WhatsApp's contact choice", () => {
  for (const phone of [undefined, "", "123", "0555<script>", "00000000", "9".repeat(16)]) {
    assert.equal(new URL(whatsAppTicketUrl(phone, { link: "https://ercupsa.com.tr/bilet.html#ticket" })).pathname, "/");
  }
});
