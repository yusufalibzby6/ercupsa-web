import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ticketCard,
  ticketSheets,
  TICKETS_PER_PAGE,
} from "../assets/ticket-print.js";
const code = (i) => "ERC-" + i.toString(16).padStart(24, "0").toUpperCase();
const cards = (n) =>
  Array.from({ length: n }, (_, i) =>
    ticketCard({
      code: code(i),
      qr: "data:image/png;base64,test",
      eventTitle: "Etkinlik <script>test</script>",
    }),
  );
test("ticket pages contain at most ten distinct, complete tickets with logo, title and slogan", () => {
  assert.equal(TICKETS_PER_PAGE, 10);
  for (const [n, pages] of [
    [1, 1],
    [10, 1],
    [11, 2],
    [50, 5],
    [51, 6],
    [200, 20],
  ]) {
    const html = ticketSheets(cards(n));
    const sheets = html.split('<section class="ticket-page"').slice(1);
    assert.equal(sheets.length, pages);
    assert.equal((html.match(/class="ticket"/g) || []).length, n);
    for (const sheet of sheets)
      assert.ok((sheet.match(/class="ticket"/g) || []).length <= 10);
    for (let i = 0; i < n; i++)
      assert.equal(html.split('data-code="' + code(i) + '"').length - 1, 1);
  }
  const html = cards(1)[0];
  assert.match(html, /ercupsa.PNG/);
  assert.match(html, /hediyeleri kap!/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
});
