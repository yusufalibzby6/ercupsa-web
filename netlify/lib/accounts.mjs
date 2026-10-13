import { getStore } from "@netlify/blobs";
import { fail, text } from "./security.mjs";
import { JSON_READ } from "./blob-state.mjs";
import { paged } from "./raffles.mjs";

export const accountsStore = () => getStore({ name: "ercupsa-accounts", consistency: "strong" });
export const MODERATION_KEY = "public-name-moderation.json";
const emptyModeration = () => ({ version: 1, users: {} });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function accountId(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail(400, "Geçersiz hesap kimliği.");
  return value.toLowerCase();
}
const invalid = () => fail(503, "Hesap bilgileri doğrulanamadı. Lütfen tekrar deneyin.");
export function moderationState(value) {
  if (value == null) return emptyModeration();
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 ||
      !value.users || typeof value.users !== "object" || Array.isArray(value.users)) invalid();
  const users = {};
  for (const [id, entry] of Object.entries(value.users)) {
    if (!UUID.test(id) || id !== id.toLowerCase() || !entry || typeof entry !== "object" ||
        typeof entry.hidden !== "boolean" || typeof entry.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.updatedAt))) invalid();
    users[id] = { hidden: entry.hidden, updatedAt: entry.updatedAt };
  }
  return { version: 1, users };
}
export async function readModeration(store = accountsStore()) {
  const snapshot = await store.getWithMetadata(MODERATION_KEY, JSON_READ);
  if (!snapshot) return emptyModeration();
  if (typeof snapshot.etag !== "string" || !snapshot.etag || snapshot.data == null) invalid();
  return moderationState(snapshot.data);
}
export const isNameBlocked = (state, id) => state.users[accountId(id)]?.hidden === true;
export async function setNameVisibility(store, userId, hidden, now = new Date()) {
  const id = accountId(userId);
  if (typeof hidden !== "boolean") fail(400, "Gizleme tercihi gerekli.");
  for (let attempt = 0; attempt < 24; attempt++) {
    const snapshot = await store.getWithMetadata(MODERATION_KEY, JSON_READ);
    if (snapshot && (typeof snapshot.etag !== "string" || !snapshot.etag || snapshot.data == null)) invalid();
    const state = snapshot ? moderationState(snapshot.data) : emptyModeration();
    state.users[id] = { hidden, updatedAt: now.toISOString() };
    const result = await store.setJSON(MODERATION_KEY, state, snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true });
    if (result.modified) return { ok: true, userId: id, publicNameBlocked: hidden };
  }
  fail(409, "Görünürlük aynı anda değişti. Lütfen yeniden deneyin.");
}
const safeString = (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
export function safeAccount(auth, profile, moderation) {
  if (!auth || typeof auth !== "object" || !UUID.test(auth.id || "") ||
      typeof auth.email !== "string" || !auth.email.includes("@") || auth.email.length > 320) invalid();
  const id = accountId(auth.id);
  if (profile && (accountId(profile.id) !== id || typeof profile.name !== "string" ||
      !profile.name.trim() || profile.name.length > 120 || typeof profile.public_name !== "boolean")) invalid();
  const metadata = auth.user_metadata;
  const firstLast = [safeString(metadata?.first_name, 60), safeString(metadata?.last_name, 60)].filter(Boolean).join(" ");
  return { id, name: profile?.name || firstLast || safeString(metadata?.full_name, 120),
    email: auth.email, createdAt: typeof auth.created_at === "string" && Number.isFinite(Date.parse(auth.created_at)) ? auth.created_at : null,
    hasProfile: !!profile, publicName: profile?.public_name === true, publicNameBlocked: isNameBlocked(moderation, id) };
}

// Do not infer completion from a short Auth page: deployments can impose a
// smaller row cap than requested. A safety limit fails rather than truncating.
export async function readAuthAccounts(auth) {
  const users = [], seen = new Set();
  for (let page = 1; page <= 1001; page++) {
    const result = await auth(`users?page=${page}&per_page=1000`);
    if (!Array.isArray(result?.users) || result.users.length > 1000) invalid();
    if (!result.users.length) return users;
    for (const user of result.users) {
      const id = accountId(user?.id);
      if (seen.has(id) || users.length >= 100000) invalid();
      seen.add(id); users.push(user);
    }
  }
  invalid();
}
export async function readAccountProfiles(ids, read) {
  const profiles = [];
  for (let i = 0; i < ids.length; i += 100) {
    const filter = ids.slice(i, i + 100).map(accountId).join(",");
    profiles.push(...await paged(`profiles?id=in.(${filter})&select=id,name,public_name&order=id.asc`, read, { cursor: ["id"] }));
  }
  return profiles;
}
export function accountQuery(url) {
  const rawPage = url.searchParams.get("page") || "1";
  if (!/^[1-9]\d{0,5}$/.test(rawPage)) fail(400, "Geçersiz sayfa.");
  return { page: Number(rawPage), search: text(url.searchParams.get("search") || "", 120).toLocaleLowerCase("tr") };
}

export async function publicBadgeBoard(read, storage) {
  const before = await readModeration(storage);
  const profiles = await paged("profiles?public_name=eq.true&select=id,name,public_name&order=id.asc", read, { cursor: ["id"] });
  const eligible = profiles.filter(profile => {
    if (!UUID.test(profile?.id || "") || typeof profile.name !== "string" || !profile.name.trim() ||
        profile.name.length > 120 || profile.public_name !== true) invalid();
    return !isNameBlocked(before, profile.id);
  });
  const counts = new Map();
  for (let i = 0; i < eligible.length; i += 100) {
    const ids = eligible.slice(i, i + 100).map(profile => accountId(profile.id));
    const allowed = new Set(ids);
    const rows = await paged(`attendance?user_id=in.(${ids.join(",")})&select=user_id,event_id&order=user_id.asc,event_id.asc`, read, { cursor: ["user_id", "event_id"] });
    for (const row of rows) {
      const id = accountId(row.user_id);
      if (!allowed.has(id) || typeof row.event_id !== "string") invalid();
      if (!counts.has(id)) counts.set(id, new Set());
      counts.get(id).add(row.event_id);
    }
  }
  // Recheck after the slower database reads so a concurrent administrator
  // hide is honored in this response, without changing the user's consent.
  const after = await readModeration(storage);
  return eligible.filter(profile => !isNameBlocked(after, profile.id) && (counts.get(accountId(profile.id))?.size || 0) >= 3)
    .map(profile => ({ name: profile.name, total: counts.get(accountId(profile.id)).size }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "tr"))
    .slice(0, 200);
}
