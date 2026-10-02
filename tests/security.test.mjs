import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventInput,
  safeUrl,
  text,
  adminLogin,
  admin,
  guarded,
  response,
} from "../netlify/lib/security.mjs";
import { badge } from "../netlify/functions/community.mjs";
const event = { title: "Etkinlik", date: "2026-10-02", images: [] };
test("reject unsafe URLs, malformed fields and dates", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
  ])
    assert.throws(() => safeUrl(url));
  assert.throws(() => safeUrl("https://example.com/image.png", true));
  assert.throws(() => text({}, 20));
  for (const date of ["2026-02-30", "not-date", "2026-99-99"])
    assert.throws(
      () => eventInput({ ...event, date }),
      (e) => e.status === 400,
    );
  assert.throws(() => eventInput({ ...event, title: " " }));
  assert.throws(() => eventInput({ ...event, images: Array(101).fill({}) }));
  assert.throws(() => eventInput({ ...event, published: "true" }));
  assert.equal(eventInput(event).title, "Etkinlik");
});
test("signed admin cookie rejects tampering; password header alone does not authorize", () => {
  process.env.ADMIN_PASSWORD = "local-unit-test-password";
  const login = new Request("https://example.com/api/events", {
    headers: { "x-admin-password": process.env.ADMIN_PASSWORD },
  });
  const cookie = adminLogin(login).split(";")[0];
  assert.match(adminLogin(login), /HttpOnly.*SameSite=Strict.*Secure/);
  assert.equal(admin(new Request(login.url, { headers: { cookie } })), true);
  assert.equal(
    admin(new Request(login.url, { headers: { cookie: cookie + "x" } })),
    false,
  );
  assert.equal(admin(login), false);
});
test("cross origin mutation is rejected and unexpected error details stay private", async () => {
  const handler = guarded(() => response({ ok: true }));
  assert.equal(
    (
      await handler(
        new Request("https://site.test/api", {
          method: "POST",
          headers: { Origin: "https://attacker.test" },
        }),
      )
    ).status,
    403,
  );
  const result = await guarded(() => {
    throw Error("secret database details");
  })(new Request("https://site.test/api"));
  assert.equal(result.status, 503);
  assert.ok(!(await result.text()).includes("secret"));
});
test("badges follow 3/4/5 thresholds", () => {
  assert.equal(badge(2), null);
  assert.equal(badge(3), "Bronz");
  assert.equal(badge(4), "Gümüş");
  assert.equal(badge(5), "Altın");
  assert.equal(badge(10), "Altın");
});
