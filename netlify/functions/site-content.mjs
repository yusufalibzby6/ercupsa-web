import { randomUUID } from "node:crypto";
import { getStore as getBlobStore } from "@netlify/blobs";
import { body, fail, guarded, requirePermission, response, text } from "../lib/security.mjs";
import { mutateJson } from "../lib/blob-state.mjs";
import { instagramPosts, readInstagramContent } from "../lib/site-content.mjs";

export function createSiteContentHandler({ getStore = getBlobStore, now = () => new Date(), revision = randomUUID, adminStore } = {}) {
  return guarded(async req => {
    if (!["GET", "POST"].includes(req.method)) fail(405, "Desteklenmeyen işlem.");
    if (req.method === "POST") await requirePermission(req, "instagram.manage", { getStore: adminStore });
    const store = getStore("ercupsa-site-content");
    if (req.method === "GET") {
      const saved = await store.get("instagram", { type: "json", consistency: "strong" });
      return response({ instagram: readInstagramContent(saved) });
    }
    const input = await body(req);
    const posts = instagramPosts(input.posts);
    if (typeof input.revision !== "string") fail(400, "Paylaşımları yeniden yükleyip kaydetmeyi deneyin.");
    const expected = text(input.revision, 100);
    const instagram = await mutateJson(store, "instagram", readInstagramContent(null), state => {
      const current = readInstagramContent(state);
      if (current.revision !== expected)
        fail(409, "Paylaşımlar başka bir yönetici tarafından değiştirildi. Bağlantılarınızı kopyalayın, kaydedileni yükleyip yeniden deneyin.");
      const saved = { posts, revision: revision(), updatedAt: now().toISOString() };
      Object.assign(state, saved);
      return { result: saved };
    });
    return response({ ok: true, instagram });
  });
}

export default createSiteContentHandler();
