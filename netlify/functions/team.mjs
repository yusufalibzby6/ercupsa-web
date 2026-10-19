import { createHash, randomUUID } from "node:crypto";
import { getStore as getBlobStore } from "@netlify/blobs";
import { body, fail, guarded, requireOwner, response } from "../lib/security.mjs";
import { JSON_READ, mutateJson } from "../lib/blob-state.mjs";
import { TEAM_KEY, TEAM_STORE, readTeam, readTeamPhoto, teamMembers, teamPhotoFormat, teamPhotoId } from "../lib/team.mjs";

export function createTeamHandler({ getStore = getBlobStore, now = () => new Date(), revision = randomUUID, adminStore } = {}) {
  return guarded(async req => {
    const action = new URL(req.url).searchParams.get("action") || "";
    if (!["GET", "PUT", "POST"].includes(req.method)) fail(405, "Desteklenmeyen işlem.");
    // There is deliberately no delegated team permission. This remains owner-only
    // even if a delegated account holds every other available permission.
    if (req.method !== "GET" || action === "admin") await requireOwner(req, { getStore: adminStore });
    if ((req.method === "GET" && !["", "admin", "photo"].includes(action)) ||
        (req.method === "PUT" && action) || (req.method === "POST" && action !== "photo")) fail(400, "Geçersiz ekip işlemi.");
    const store = getStore(TEAM_STORE);
    if (req.method === "GET") {
      const team = readTeam(await store.get(TEAM_KEY, JSON_READ));
      if (action === "photo") {
        const id = new URL(req.url).searchParams.get("id");
        if (!/^[a-f0-9]{64}$/.test(id || "") || !team.members.some(member => teamPhotoId(member.photo) === id))
          fail(404, "Ekip fotoğrafı bulunamadı.");
        const photo = await store.get(`photos/${id}.json`, JSON_READ);
        if (!photo || typeof photo.data !== "string") fail(404, "Ekip fotoğrafı bulunamadı.");
        const bytes = Buffer.from(photo.data, "base64"), format = teamPhotoFormat(bytes);
        if (createHash("sha256").update(bytes).digest("hex") !== id) fail(503, "Ekip fotoğrafı doğrulanamadı.");
        return new Response(bytes, { headers: { "Content-Type": format.mime, "Content-Length": String(bytes.length),
          "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" } });
      }
      return response(action === "admin" ? { team } : { members: team.members });
    }
    if (req.method === "POST") {
      const bytes = await readTeamPhoto(req), format = teamPhotoFormat(bytes);
      const id = createHash("sha256").update(bytes).digest("hex");
      // Immutable, content-addressed images make an interrupted upload/save safe
      // to retry and never change an already published card under the same URL.
      const photo = { ...format, data: bytes.toString("base64") };
      await store.setJSON(`photos/${id}.json`, photo);
      return response({ photo: `/api/team?action=photo&id=${id}`, bytes: bytes.length, ...format });
    }
    const input = await body(req);
    if (typeof input.revision !== "string" || input.revision.length > 100) fail(400, "Ekip listesini yeniden yükleyip deneyin.");
    const members = teamMembers(input.members);
    for (const id of new Set(members.map(member => teamPhotoId(member.photo)).filter(Boolean))) {
      const photo = await store.get(`photos/${id}.json`, JSON_READ);
      if (!photo || typeof photo.data !== "string") fail(400, "Bir ekip fotoğrafı bulunamadı. Fotoğrafı yeniden yükleyin.");
      const bytes = Buffer.from(photo.data, "base64");
      teamPhotoFormat(bytes);
      if (createHash("sha256").update(bytes).digest("hex") !== id) fail(503, "Ekip fotoğrafı doğrulanamadı.");
    }
    const team = await mutateJson(store, TEAM_KEY, readTeam(null), value => {
      const current = readTeam(value);
      if (current.revision !== input.revision) fail(409, "Ekip listesi başka bir pencerede değiştirildi. Kaydedileni yükleyip yeniden deneyin.");
      const saved = { members, revision: revision(), updatedAt: now().toISOString() };
      Object.assign(value, saved);
      return { result: saved };
    });
    return response({ ok: true, team });
  });
}

export default createTeamHandler();
