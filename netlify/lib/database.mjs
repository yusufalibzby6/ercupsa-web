import { fail } from "./security.mjs";
export function config() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    fail(
      503,
      "Bu bölüm henüz kullanıma açılmadı. Lütfen daha sonra tekrar deneyin.",
    );
  return { url, key };
}
export async function db(path, { method = "GET", data, headers = {} } = {}) {
  const { url, key } = config();
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok)
    fail(
      r.status === 409 ? 409 : 503,
      r.status === 409
        ? "Bu kayıt zaten mevcut."
        : "Veri kaydedilemedi. Lütfen tekrar deneyin.",
    );
  return r.status === 204 ? null : r.json();
}
export async function user(req) {
  const token = req.headers.get("authorization");
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(token || ""))
    fail(401, "E-posta ile giriş yapmalısın.");
  const { url, key } = config();
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: token },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) fail(401, "Oturum süresi doldu. Tekrar giriş yap.");
  const u = await r.json();
  if (!u.email_confirmed_at) fail(401, "E-posta doğrulaması gerekli.");
  return u;
}
