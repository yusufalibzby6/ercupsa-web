import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventShareHandler } from "../netlify/functions/event-share.mjs";

const event = {
  id: "share-one", title: "Bilim & Eczacılık Buluşması", category: "Mesleki gelişim",
  date: "2026-10-12", time: "18:30", location: "Kayseri Eczacılık Fakültesi",
  description: "Etkinlik açıklaması.", poster: "https://res.cloudinary.com/example/image/upload/poster.jpg",
  published: true, registrationMode: "native", registrationEnabled: true,
  registrationFields: [{ id: "private-field", label: "Özel form alanı" }],
  registrationDescription: "Panelden girilmiş özel kayıt yönergesi.",
};

function fixture(data = [event]) {
  const state = { events: structuredClone(data), reads: 0 };
  const handler = createEventShareHandler({ events: async () => { state.reads++; return structuredClone(state.events); } });
  const request = (path = "/etkinlik/share-one", options) => handler(new Request(`https://attacker.test${path}`, options));
  return { state, handler, request };
}

test("published event previews render event metadata on the server and use a fixed canonical domain", async () => {
  const f = fixture(), response = await f.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const html = await response.text();
  assert.match(html, /<meta property="og:title" content="Bilim &amp; Eczacılık Buluşması \| ERCUPSA">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/res\.cloudinary\.com\/example\/image\/upload\/poster\.jpg">/);
  assert.match(html, /<meta property="og:description" content="12 Ekim 2026 · 18:30 · Türkiye saati · Kayseri Eczacılık Fakültesi/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ercupsa\.com\.tr\/etkinlik\/share-one">/);
  assert.match(html, /href="\/form\.html\?event=share-one#registrationSection">Etkinlik detayları ve kayıt formu/);
  assert.ok(!html.includes("attacker.test"));
  assert.ok(!html.includes("private-field"));
  assert.ok(!html.includes("Özel form alanı"));
  assert.ok(!html.includes("özel kayıt yönergesi"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("http-equiv=\"refresh\""));
  assert.equal(f.state.reads, 1);
});

test("Netlify function query routing and original event paths resolve the same canonical event", async () => {
  const f = fixture();
  const original = await (await f.request("/etkinlik/share-one")).text();
  const rewritten = await (await f.request("/.netlify/functions/event-share?eventId=share-one&host=attacker.test")).text();
  assert.equal(rewritten, original);
  assert.equal(await (await f.request("/etkinlik/share-one?eventId=other")).text(), original);
  const head = await f.request("/etkinlik/share-one", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("content-security-policy"), /style-src 'sha256-/);
  const denied = await f.request("/etkinlik/share-one", { method: "POST" });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get("allow"), "GET, HEAD");
});

test("hidden, archived, missing and malformed events return indistinguishable generic HTML without private data", async () => {
  const f = fixture([{ ...event, id: "draft", title: "Hidden event secret", published: false },
    { ...event, id: "archived", title: "Archived event secret", archived: true }]);
  let reference;
  for (const path of ["/etkinlik/draft", "/etkinlik/archived", "/etkinlik/missing", "/etkinlik/%3Cscript%3E",
    "/.netlify/functions/event-share?eventId=../draft", "/.netlify/functions/event-share?eventId=", "/etkinlik/%E0%A4%A"]) {
    const response = await f.request(path);
    assert.equal(response.status, 404, path);
    const html = await response.text();
    reference ??= html;
    assert.equal(html, reference);
    assert.match(html, /noindex,nofollow/);
    assert.ok(!html.includes("secret"));
    assert.ok(!html.includes("poster.jpg"));
    assert.ok(!html.includes("og:url"));
  }
});

test("publishing changes take effect without cached successful metadata", async () => {
  const f = fixture();
  assert.equal((await f.request()).status, 200);
  f.state.events[0].published = false;
  assert.equal((await f.request()).status, 404);
  f.state.events = [];
  assert.equal((await f.request()).status, 404);
  assert.equal(f.state.reads, 3);
});

test("event text is escaped in metadata and visible card; unsafe image locations use the site fallback", async () => {
  const malicious = '\"><script>window.injected=true</script><img src=x onerror="bad()"> & text';
  const f = fixture([{ ...event, title: malicious, location: malicious, category: malicious,
    description: malicious, poster: "javascript:alert(1)" }]);
  const html = await (await f.request()).text();
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;script&gt;window.injected=true&lt;\/script&gt;/);
  assert.match(html, /og:image" content="https:\/\/ercupsa\.com\.tr\/og-image\.jpg"/);
  assert.ok(!html.includes("javascript:"));
  for (const poster of ["http://res.cloudinary.com/poster.jpg", "https://user:password@res.cloudinary.com/poster.jpg",
    "https://res.cloudinary.com.attacker.test/poster.jpg", "https://res.cloudinary.com:444/poster.jpg",
    "data:image/png;base64,AAAA", "https://attacker.test/poster.jpg"]) {
    f.state.events[0].poster = poster;
    assert.match(await (await f.request()).text(), /og:image" content="https:\/\/ercupsa\.com\.tr\/og-image\.jpg"/);
  }
});

test("absent time and location remain explicit and do not invent an event start time", async () => {
  const f = fixture([{ ...event, time: "", location: "", poster: "" }]);
  const html = await (await f.request()).text();
  assert.match(html, /Saat bilgisi paylaşılmadı\./);
  assert.match(html, /Konum bilgisi paylaşılmadı\./);
  assert.ok(!html.includes("00:00"));
  assert.ok(!html.includes('class="poster"'));
});
