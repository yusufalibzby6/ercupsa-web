import { randomUUID } from "node:crypto";
import { guarded, response, requireAdmin, body, text, identifier, fail, ADMIN_PERMISSIONS, ownerUsername } from "../lib/security.mjs";
import { adminStore, ADMIN_ACCOUNTS_KEY, ensureAccounts, accountState, normalizedUsername, normalizedPermissions,
  passwordRecord, safeAdminAccount, TREASURER_ID, TREASURER_PERMISSIONS } from "../lib/admin-auth.mjs";
import { mutateJson } from "../lib/blob-state.mjs";
const project = state => ({ accounts: state.accounts.map(safeAdminAccount), revision: state.revision, availablePermissions: [...ADMIN_PERMISSIONS] });
function revision(input, state) {
  if (typeof input !== "string" || input !== state.revision)
    fail(409, "Yönetici hesapları değişmiş. Listeyi yenileyip tekrar deneyin.");
}
function keys(input, allowed) {
  if (Object.keys(input).some(key => !allowed.includes(key))) fail(400, "Geçersiz yönetici hesabı alanı.");
}

export function createAdminUsersHandler({ getStore, now = () => new Date(), uuid = randomUUID } = {}) {
  return guarded(async req => {
    requireAdmin(req);
    const url = new URL(req.url), storage = adminStore(getStore), instant = now();
    if (req.method === "GET") return response(project(await ensureAccounts(storage, instant, uuid)));
    if (!["POST", "PUT", "DELETE"].includes(req.method)) fail(405, "Desteklenmeyen işlem.");
    // Bootstrap only on an authenticated owner request. The preset has no shared default password.
    await ensureAccounts(storage, instant, uuid);
    const input = req.method === "DELETE" ? { id: url.searchParams.get("id"), expectedRevision: url.searchParams.get("expectedRevision") } : await body(req);
    keys(input, req.method === "POST" ? ["username", "name", "password", "permissions", "active", "expectedRevision"] :
      ["id", "username", "name", "password", "permissions", "active", "expectedRevision"]);
    const id = req.method === "POST" ? uuid() : identifier(input.id);
    if (id === "owner") fail(400, "Baş yönetici hesabı bu bölümden değiştirilemez.");
    const changes = {};
    if (Object.hasOwn(input, "username")) {
      changes.username = normalizedUsername(input.username);
      if (changes.username === ownerUsername() || (changes.username === "sayman" && id !== TREASURER_ID))
        fail(400, "Bu kullanıcı adı ayrılmıştır.");
    }
    if (Object.hasOwn(input, "name")) changes.name = text(input.name, 120, true);
    if (Object.hasOwn(input, "permissions")) changes.permissions = normalizedPermissions(input.permissions);
    if (Object.hasOwn(input, "active")) {
      if (typeof input.active !== "boolean") fail(400, "Geçersiz hesap durumu.");
      changes.active = input.active;
    }
    if (Object.hasOwn(input, "password")) Object.assign(changes, passwordRecord(input.password));
    if (req.method === "POST" && (!changes.username || !changes.name || !changes.passwordHash || !changes.permissions))
      fail(400, "Kullanıcı adı, ad, şifre ve yetkiler gerekli.");
    if (id === TREASURER_ID) {
      if (req.method === "DELETE") fail(400, "Sayman hazır hesabı silinemez; hesabı devre dışı bırakabilirsiniz.");
      if ((changes.username && changes.username !== "sayman") ||
          (changes.permissions && JSON.stringify(changes.permissions) !== JSON.stringify(TREASURER_PERMISSIONS)))
        fail(400, "Sayman hesabının kullanıcı adı ve salt okunur yetkileri değiştirilemez.");
    }
    const result = await mutateJson(storage, ADMIN_ACCOUNTS_KEY, null, state => {
      accountState(state); revision(input.expectedRevision, state);
      if (req.method === "DELETE") {
        const index = state.accounts.findIndex(account => account.id === id);
        if (index === -1) fail(404, "Yönetici hesabı bulunamadı.");
        state.accounts.splice(index, 1);
      } else if (req.method === "POST") {
        if (state.accounts.length >= 100) fail(400, "En fazla 100 yönetici hesabı oluşturabilirsiniz.");
        if (state.accounts.some(account => account.username === changes.username)) fail(409, "Bu kullanıcı adı zaten kullanılıyor.");
        state.accounts.push({ id, role: "admin", fixedPreset: false, active: true, ...changes,
          version: uuid(), createdAt: instant.toISOString(), updatedAt: instant.toISOString() });
      } else {
        const account = state.accounts.find(account => account.id === id);
        if (!account) fail(404, "Yönetici hesabı bulunamadı.");
        if (changes.username && state.accounts.some(candidate => candidate.id !== id && candidate.username === changes.username))
          fail(409, "Bu kullanıcı adı zaten kullanılıyor.");
        if (changes.active && !changes.passwordHash && !account.passwordHash) fail(400, "Hesabı etkinleştirmeden önce şifre belirleyin.");
        Object.assign(account, changes, { version: uuid(), updatedAt: instant.toISOString() });
      }
      state.revision = uuid(); accountState(state);
      const account = state.accounts.find(account => account.id === id);
      return { result: { ...project(state), ...(account ? { account: safeAdminAccount(account) } : {}) } };
    });
    return response(result, req.method === "POST" ? 201 : 200);
  });
}
export default createAdminUsersHandler();
