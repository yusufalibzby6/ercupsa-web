import { guarded, response, body, fail, decodeAdminCookie, signedAdminCookie, adminLogoutCookie, ownerSession } from "../lib/security.mjs";
import { adminStore, ADMIN_ACCOUNTS_KEY, accountState, ensureAccounts, TREASURER_PERMISSIONS, normalizedUsername, getAdminSession,
  ownerPasswordMatches, passwordMatches, safePrincipal, loginLimit } from "../lib/admin-auth.mjs";
import { JSON_READ } from "../lib/blob-state.mjs";

export function createAdminAuthHandler({ getStore, now = () => new Date() } = {}) {
  return guarded(async req => {
    const action = new URL(req.url).searchParams.get("action") || "session";
    const instant = now();
    if (action === "session" && req.method === "GET")
      return response({ session: await getAdminSession(req, { getStore, now: instant }) });
    if (action === "logout" && req.method === "POST") {
      const token = decodeAdminCookie(req, instant);
      if (token && token.role !== "owner") await adminStore(getStore).setJSON(`sessions/revoked/${token.sessionId}.json`, { expires: token.expires });
      return response({ session: null }, 200, { "Set-Cookie": adminLogoutCookie(req) });
    }
    if (action === "login" && req.method === "POST") {
      if (!process.env.ADMIN_PASSWORD) fail(503, "Yönetici girişi henüz yapılandırılmadı.");
      const input = await body(req), username = normalizedUsername(input.username);
      if (typeof input.password !== "string" || input.password.length > 128)
        fail(401, "Kullanıcı adı veya şifre geçersiz.");
      const storage = adminStore(getStore);
      await loginLimit(req, username, storage, instant);
      const owner = ownerSession();
      if (username === owner.username) {
        if (!ownerPasswordMatches(input.password)) fail(401, "Kullanıcı adı veya şifre geçersiz.");
        return response({ session: owner }, 200, { "Set-Cookie": signedAdminCookie(req, owner, instant) });
      }
      const value = await storage.get(ADMIN_ACCOUNTS_KEY, JSON_READ);
      let account = value ? accountState(value).accounts.find(account => account.username === username && account.active) : null;
      if (!passwordMatches(input.password, account)) fail(401, "Kullanıcı adı veya şifre geçersiz.");
      if (account.role === "treasurer" && JSON.stringify(account.permissions) !== JSON.stringify(TREASURER_PERMISSIONS)) {
        account = (await ensureAccounts(storage, instant)).accounts.find(candidate => candidate.id === account.id);
        if (!account?.active || !passwordMatches(input.password, account)) fail(401, "Kullanıcı adı veya şifre geçersiz.");
      }
      return response({ session: safePrincipal(account) }, 200, { "Set-Cookie": signedAdminCookie(req, account, instant) });
    }
    fail(405, "Desteklenmeyen işlem.");
  });
}
export default createAdminAuthHandler();
