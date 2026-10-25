import { getStore as getBlobStore } from "@netlify/blobs";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { ADMIN_PERMISSIONS, decodeAdminCookie, ownerSession, ownerUsername, fail, text } from "./security.mjs";
import { JSON_READ, mutateJson } from "./blob-state.mjs";

export const ADMIN_STORE = "ercupsa-admin-accounts";
export const ADMIN_ACCOUNTS_KEY = "accounts/state.json";
export const TREASURER_ID = "sayman";
const LEGACY_TREASURER_PERMISSIONS = Object.freeze(["registrations.view", "registrations.receipts"]);
// Retain legacy receipt viewing until an owner explicitly cleans old files.
// The payment replacement grants viewing only, never approval or export.
export const TREASURER_PERMISSIONS = Object.freeze(["registrations.view", "registrations.receipts", "payments.view"]);
const legacyTreasurer = account => account?.role === "treasurer" && account.id === TREASURER_ID &&
  JSON.stringify(account.permissions) === JSON.stringify(LEGACY_TREASURER_PERMISSIONS);
export const adminStore = getStore => getStore ? getStore(ADMIN_STORE) : getBlobStore({ name: ADMIN_STORE, consistency: "strong" });
export const timestamp = value => (typeof value === "function" ? value() : value) || new Date();
export function normalizedUsername(value) {
  const username = text(value, 50, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username))
    fail(400, "Kullanıcı adı 3–50 karakter olmalı; harf, rakam, nokta, tire veya alt çizgi kullanın.");
  return username;
}
export function normalizedPermissions(value) {
  if (!Array.isArray(value) || value.length > ADMIN_PERMISSIONS.length ||
      value.some(permission => typeof permission !== "string" || !ADMIN_PERMISSIONS.includes(permission)))
    fail(400, "Geçersiz yönetici yetkisi.");
  const chosen = new Set(value);
  for (const permission of chosen) if (!permission.endsWith(".view")) chosen.add(permission.split(".")[0] + ".view");
  return ADMIN_PERMISSIONS.filter(permission => chosen.has(permission));
}
export const hasPermission = (session, permission) => session?.role === "owner" || session?.permissions?.includes(permission) === true;
export function passwordRecord(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128 || !password.trim())
    fail(400, "Yönetici şifresi 12–128 karakter olmalı.");
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 32).toString("hex") };
}
export function passwordMatches(password, account) {
  if (typeof password !== "string" || password.length > 128) return false;
  const derived = scryptSync(password, account?.salt || "ercupsa-invalid-admin-login", 32);
  const expected = Buffer.from(account?.passwordHash || "0".repeat(64), "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected) && Boolean(account?.passwordHash);
}
export function ownerPasswordMatches(value) {
  const expected = process.env.ADMIN_PASSWORD || "";
  return typeof value === "string" && Boolean(expected) && Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
export function accountState(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.accounts) || value.accounts.length > 100 ||
      typeof value.revision !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value.revision))
    fail(503, "Yönetici hesapları doğrulanamadı.");
  const ids = new Set(), usernames = new Set();
  for (const account of value.accounts) {
    if (!account || typeof account.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(account.id) ||
        typeof account.username !== "string" || !/^[a-z0-9][a-z0-9._-]{2,49}$/.test(account.username) ||
        typeof account.name !== "string" || !account.name.trim() || account.name.length > 120 ||
        typeof account.active !== "boolean" || !["admin", "treasurer"].includes(account.role) ||
        typeof account.version !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(account.version) ||
        ids.has(account.id) || usernames.has(account.username) || account.id === "owner" ||
        account.username === ownerUsername()) fail(503, "Yönetici hesapları doğrulanamadı.");
    ids.add(account.id); usernames.add(account.username);
    let permissions;
    try { permissions = normalizedPermissions(account.permissions); } catch { fail(503, "Yönetici hesapları doğrulanamadı."); }
    if (JSON.stringify(permissions) !== JSON.stringify(account.permissions)) fail(503, "Yönetici hesapları doğrulanamadı.");
    if (account.role === "treasurer" || account.id === TREASURER_ID || account.username === "sayman") {
      if (account.role !== "treasurer" || account.id !== TREASURER_ID || account.username !== "sayman" ||
          account.fixedPreset !== true || (!legacyTreasurer(account) && JSON.stringify(account.permissions) !== JSON.stringify(TREASURER_PERMISSIONS)))
        fail(503, "Sayman hesabı doğrulanamadı.");
    } else if (account.fixedPreset) fail(503, "Yönetici hesapları doğrulanamadı.");
    if (account.salt != null || account.passwordHash != null) {
      if (typeof account.salt !== "string" || !/^[a-f0-9]{32}$/.test(account.salt) ||
          typeof account.passwordHash !== "string" || !/^[a-f0-9]{64}$/.test(account.passwordHash))
        fail(503, "Yönetici hesapları doğrulanamadı.");
    }
    if (account.active && !account.passwordHash) fail(503, "Yönetici hesapları doğrulanamadı.");
  }
  return value;
}
export function safeAdminAccount(account) {
  return { id: account.id, username: account.username, name: account.name, role: account.role,
    active: account.active, hasPassword: Boolean(account.passwordHash), permissions: [...account.permissions],
    fixedPreset: account.fixedPreset === true,
    ...(account.createdAt ? { createdAt: account.createdAt } : {}), ...(account.updatedAt ? { updatedAt: account.updatedAt } : {}) };
}
export const safePrincipal = account => ({ id: account.id, username: account.username, name: account.name,
  role: account.role, permissions: [...account.permissions] });
export function initialAccounts(now = new Date(), uuid = randomUUID) {
  const at = timestamp(now).toISOString();
  return { revision: uuid(), accounts: [{ id: TREASURER_ID, username: "sayman", name: "Sayman", role: "treasurer",
    active: false, fixedPreset: true, version: uuid(), permissions: [...TREASURER_PERMISSIONS], createdAt: at, updatedAt: at }] };
}
export async function ensureAccounts(storage, now = new Date(), uuid = randomUUID) {
  const existing = await storage.get(ADMIN_ACCOUNTS_KEY, JSON_READ);
  if (existing) {
    accountState(existing);
    if (!existing.accounts.some(legacyTreasurer)) return structuredClone(existing);
    return mutateJson(storage, ADMIN_ACCOUNTS_KEY, existing, state => {
      accountState(state);
      if (!state.accounts.some(legacyTreasurer)) return { write: false, result: structuredClone(state) };
      for (const account of state.accounts.filter(legacyTreasurer)) {
        account.permissions = [...TREASURER_PERMISSIONS];
        account.version = uuid(); account.updatedAt = timestamp(now).toISOString();
      }
      state.revision = uuid();
      return { result: structuredClone(accountState(state)) };
    });
  }
  const initial = initialAccounts(now, uuid);
  return mutateJson(storage, ADMIN_ACCOUNTS_KEY, initial, state => {
    accountState(state);
    // Initial state is stored on the first owner visit, never on public reads.
    return { result: structuredClone(state) };
  });
}
export async function getAdminSession(req, { getStore, now = new Date() } = {}) {
  const token = decodeAdminCookie(req, timestamp(now));
  if (!token) return null;
  if (token.role === "owner") return ownerSession();
  const storage = adminStore(getStore);
  const [value, revoked] = await Promise.all([
    storage.get(ADMIN_ACCOUNTS_KEY, JSON_READ), storage.get(`sessions/revoked/${token.sessionId}.json`, JSON_READ),
  ]);
  if (revoked || !value) return null;
  const account = accountState(value).accounts.find(account => account.id === token.id && account.active &&
    account.version === token.version && account.username === token.username && account.role === token.role);
  return account ? safePrincipal(account) : null;
}
export async function loginLimit(req, username, storage, now = new Date()) {
  const instant = timestamp(now).getTime(), ip = req.headers.get("x-nf-client-connection-ip") || "local";
  for (const [scope, limit] of [["ip:" + ip, 50], ["account:" + ip + ":" + username, 10]]) {
    const key = "login/" + createHash("sha256").update(scope).digest("hex") + ".json";
    await mutateJson(storage, key, { hits: 0, expires: 0 }, record => {
      if (!Number.isInteger(record.hits) || !Number.isSafeInteger(record.expires)) fail(503, "Giriş sınırı doğrulanamadı.");
      if (record.expires <= instant) { record.hits = 0; record.expires = instant + 15 * 60 * 1000; }
      if (record.hits >= limit) fail(429, "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.");
      record.hits++;
      return { result: true };
    });
  }
}
