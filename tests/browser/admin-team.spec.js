import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { teamPhotoFormat } from "../../netlify/lib/team.mjs";
import { ownerFixtureSession } from "./admin-session-fixture.js";

const initial = [
  { id: "advisor", name: "Danışman", role: "Danışman Hoca", photo: "danisman-hoca.jpg", featured: true },
  { id: "member", name: "Dileknaz Ergül", role: "Sponsorluk", photo: "ekip13.jpg", featured: false },
];
async function fixture(page, { session = ownerFixtureSession, holdLoad = false } = {}) {
  const state = { members: structuredClone(initial), revision: "team-1", teamReads: 0, uploads: [], saves: [], stale: false };
  let release; const held = holdLoad ? new Promise(resolve => { release = resolve; }) : null;
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), action = url.searchParams.get("action");
    if (url.pathname === "/api/admin-auth") return route.fulfill({ json: { session: action === "logout" ? null : session } });
    if (url.pathname === "/api/events") return route.fulfill({ json: { events: [] } });
    if (url.pathname === "/api/community") return route.fulfill({ json: { batches: [] } });
    if (url.pathname === "/api/team") {
      if (request.method() === "GET") { state.teamReads++; if (held) await held; return route.fulfill({ json: { team: { members: state.members, revision: state.revision } } }); }
      if (request.method() === "POST") {
        const bytes = request.postDataBuffer(), format = teamPhotoFormat(bytes); state.uploads.push({ bytes, format });
        return route.fulfill({ json: { photo: "/api/team?action=photo&id=" + createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, ...format } });
      }
      if (request.method() === "PUT") {
        const input = request.postDataJSON(); state.saves.push(input);
        if (state.stale) return route.fulfill({ status: 409, json: { error: "Liste başka bir pencerede değiştirildi." } });
        expect(input.revision).toBe(state.revision); state.members = input.members; state.revision += "-next";
        return route.fulfill({ json: { ok: true, team: { members: state.members, revision: state.revision } } });
      }
    }
    return route.fulfill({ status: 501, json: { error: "Unused team fixture endpoint" } });
  });
  await page.goto("/admin.html"); await expect(page.locator("#app")).toBeVisible();
  return { state, release };
}
async function openTeam(page) {
  await page.locator('[data-tab="team"]').click();
  await expect(page.locator("#teamMembers .team-admin-card")).toHaveCount(2);
}

test("owner edits names, roles and order, adds/removes cards and publishes the exact roster", async ({ page }) => {
  const { state } = await fixture(page);
  expect(state.teamReads).toBe(0); await openTeam(page);
  await page.locator('[data-team-id="member"] [data-field="name"]').fill("Belinay Daş");
  await page.locator('[data-team-id="member"] [data-field="role"]').fill("Sponsorluk ekibi");
  await page.locator('[data-team-id="member"] [data-action="up"]').click();
  await page.locator("#teamAdd").click();
  const added = page.locator("#teamMembers .team-admin-card").last();
  await added.locator('[data-field="name"]').fill("Yeni Üye"); await added.locator('[data-field="role"]').fill("Tasarım");
  await page.locator("#teamSave").click();
  await expect(page.locator("#teamMessage")).toContainText("Ekip kaydedildi");
  expect(state.saves[0].members.map(value => value.name)).toEqual(["Belinay Daş", "Danışman", "Yeni Üye"]);
  expect(state.saves[0].members[0].role).toBe("Sponsorluk ekibi");
  page.on("dialog", dialog => dialog.accept());
  await page.locator('[data-team-id="advisor"] [data-action="remove"]').click(); await page.locator("#teamSave").click();
  await expect(page.locator("#teamMessage")).toContainText("Ekip kaydedildi");
  expect(state.saves.at(-1).revision).toBe("team-1-next");
  expect(state.members.map(value => value.name)).toEqual(["Belinay Daş", "Yeni Üye"]);
});

test("a large photo is resized and compressed before upload; new photo stays a local preview until roster save", async ({ page }) => {
  const { state } = await fixture(page); await openTeam(page);
  const image = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 2000; canvas.height = 1200; const context = canvas.getContext("2d"); context.fillStyle = "#a62b2b"; context.fillRect(0, 0, 2000, 1200); return canvas.toDataURL("image/png").split(",")[1]; });
  await page.locator('[data-team-id="member"] input[type="file"]').setInputFiles({ name: "large-photo.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await expect(page.locator("#teamMessage")).toContainText("olarak yüklendi");
  expect(state.uploads).toHaveLength(1); expect(state.uploads[0].bytes.length).toBeLessThanOrEqual(150 * 1024);
  expect(state.uploads[0].format).toEqual({ mime: "image/jpeg", width: 800, height: 480 }); expect(state.saves).toHaveLength(0);
  await expect(page.locator('[data-team-id="member"] img')).toHaveAttribute("src", /^blob:/);
  await page.locator("#teamSave").click(); await expect(page.locator("#teamMessage")).toContainText("Ekip kaydedildi");
  expect(state.saves[0].members[1].photo).toMatch(/^\/api\/team\?action=photo&id=[a-f0-9]{64}$/);
});

test("stale saves retain typed edits and allow an explicit reload", async ({ page }) => {
  const { state } = await fixture(page); await openTeam(page); state.stale = true;
  await page.locator('[data-team-id="member"] [data-field="name"]').fill("Korunacak değişiklik");
  await page.locator("#teamSave").click(); await expect(page.locator("#teamMessage")).toContainText("Değişiklikleriniz bu pencerede korundu");
  await expect(page.locator('[data-team-id="member"] [data-field="name"]')).toHaveValue("Korunacak değişiklik");
  page.on("dialog", dialog => dialog.accept()); await page.locator("#teamReload").click();
  await expect(page.locator('[data-team-id="member"] [data-field="name"]')).toHaveValue("Dileknaz Ergül");
});

test("even a delegated administrator with every capability never gets team controls or private team requests", async ({ page }) => {
  const { state } = await fixture(page, { session: { ...ownerFixtureSession, id: "delegate", username: "delegate", role: "admin" } });
  await expect(page.locator('[data-tab="team"]')).not.toBeVisible();
  await page.evaluate(() => { document.querySelector('[data-tab="team"]').click(); document.dispatchEvent(new CustomEvent("admin-tab", { detail: "team" })); });
  await expect(page.locator("#teamTab")).not.toBeVisible(); await expect(page.locator("#teamAdd")).toBeDisabled(); expect(state.teamReads).toBe(0);
});

test("a late roster response after logout cannot repopulate the editor", async ({ page }) => {
  const { state, release } = await fixture(page, { holdLoad: true });
  await page.locator('[data-tab="team"]').click(); await expect.poll(() => state.teamReads).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("admin-logout"))); release();
  await expect(page.locator("#login")).toBeVisible(); await expect(page.locator("#teamMembers .team-admin-card")).toHaveCount(0);
  await expect(page.locator("#teamSave")).toBeDisabled();
});

test("public roster renders saved safe content, supports an empty roster and retains static fallback on errors", async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  let value = "saved";
  await page.route("**/api/team", route => value === "error" ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fulfill({ json: { members: value === "empty" ? [] : [{ ...initial[1], name: "Belinay <img src=x onerror=bad>", role: "Sponsorluk" }] } }));
  await page.goto("/ekip.html"); await expect(page.locator("#teamCards h3")).toHaveCount(1);
  await expect(page.locator("#teamCards h3")).toHaveText("Belinay <img src=x onerror=bad>"); await expect(page.locator("#teamCards img")).toHaveCount(1);
  value = "empty"; await page.reload(); await expect(page.locator("#teamCards h3")).toHaveCount(0); await expect(page.locator("#teamIntro")).toContainText("yakında");
  value = "error"; await page.reload(); await expect(page.locator("#teamCards h3")).toHaveCount(22); await expect(page.locator("#teamCards")).toContainText("Belinay Daş");
});
