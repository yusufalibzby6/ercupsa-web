import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export function text(value, max, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string") fail(400, "Geçersiz metin alanı.");
  const result = value.trim();
  if (result.length > max || (required && !result))
    fail(400, `Alan boş olamaz ve ${max} karakteri aşamaz.`);
  return result;
}
export function safeUrl(value, image = false) {
  const s = text(value, 2048);
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    fail(400, "Geçersiz bağlantı.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (image && u.hostname !== "res.cloudinary.com")
  )
    fail(
      400,
      "Bağlantı HTTPS olmalı; görseller Cloudinary üzerinde bulunmalı.",
    );
  return u.href;
}
export function identifier(value) {
  const s = text(value, 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) fail(400, "Geçersiz kayıt kimliği.");
  return s;
}
export async function body(req) {
  if (!req.headers.get("content-type")?.includes("application/json"))
    fail(415, "JSON gerekli.");
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 100000) fail(413, "İstek çok büyük.");
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw Error();
    return v;
  } catch {
    fail(400, "Geçersiz JSON.");
  }
}
export const ADMIN_PERMISSIONS = Object.freeze([
  "events.view", "events.manage", "events.publish",
  "registrations.view", "registrations.manage", "registrations.receipts", "registrations.photos", "registrations.export",
  "payments.view", "payments.manage", "statistics.view", "audit.view",
  "yearbooks.view", "yearbooks.manage", "yearbooks.publish",
  "tickets.view", "tickets.manage", "raffles.view", "raffles.manage",
  "attendance.view", "attendance.manage", "accounts.view", "accounts.manage", "instagram.view", "instagram.manage",
]);
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
export function ownerUsername() {
  const value = (process.env.ADMIN_USERNAME || "basadmin").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(value) || value === "sayman")
    fail(503, "Baş yönetici hesabı henüz yapılandırılmadı.");
  return value;
}
function signature(value) {
  return createHmac("sha256", process.env.ADMIN_PASSWORD || "")
    .update("ercupsa:admin-session:v2:" + value).digest("base64url");
}
export function ownerSession() {
  return { id: "owner", username: ownerUsername(), name: "Baş yönetici", role: "owner", permissions: [...ADMIN_PERMISSIONS] };
}
export function signedAdminCookie(req, principal, now = new Date()) {
  if (!process.env.ADMIN_PASSWORD) fail(503, "Yönetici girişi henüz yapılandırılmadı.");
  const issued = now.getTime(), expires = String(issued + ADMIN_SESSION_MS);
  const payload = Buffer.from(JSON.stringify({ v: 2, id: principal.id, username: principal.username,
    role: principal.role, ...(principal.version ? { version: principal.version } : {}),
    issued, sessionId: randomUUID() })).toString("base64url");
  const value = expires + ".v2." + payload;
  return `ercupsa_admin=${value}.${signature(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function decodeAdminCookie(req, now = new Date()) {
  if (!process.env.ADMIN_PASSWORD) return null;
  const token = (req.headers.get("cookie") || "").split(";").map(s => s.trim())
    .find(s => s.startsWith("ercupsa_admin="))?.slice(14);
  if (!token || token.length > 2000) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[1] !== "v2" || !/^\d{13}$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{1,1600}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) return null;
  const expected = signature(parts.slice(0, 3).join("."));
  if (!timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8")); } catch { return null; }
  if (!payload || payload.v !== 2 || !["owner", "admin", "treasurer"].includes(payload.role) ||
      typeof payload.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.id) ||
      typeof payload.username !== "string" || !/^[a-z0-9][a-z0-9._-]{2,49}$/.test(payload.username) ||
      typeof payload.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.sessionId) ||
      !Number.isSafeInteger(payload.issued) || Number(parts[0]) !== payload.issued + ADMIN_SESSION_MS ||
      Number(parts[0]) <= now.getTime() || payload.issued > now.getTime() + 60000) return null;
  if (payload.role === "owner") {
    if (payload.id !== "owner" || payload.username !== ownerUsername() || payload.version != null) return null;
  } else if (typeof payload.version !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.version)) return null;
  return { ...payload, expires: Number(parts[0]) };
}
export function admin(req) {
  return decodeAdminCookie(req)?.role === "owner";
}
export function requireAdmin(req) {
  const token = decodeAdminCookie(req);
  if (!token) fail(401, "Yönetici girişi gerekli.");
  if (token.role !== "owner") fail(403, "Bu işlem yalnızca baş yöneticiye açıktır.");
  return ownerSession();
}
export async function getAdminSession(req, options = {}) {
  return (await import("./admin-auth.mjs")).getAdminSession(req, options);
}
export const hasPermission = (session, permission) => session?.role === "owner" || session?.permissions?.includes(permission) === true;
export async function requirePermission(req, permission, options = {}) {
  const session = await getAdminSession(req, options);
  if (!session) fail(401, "Yönetici girişi gerekli.");
  if (session.role !== "owner" && !session.permissions.includes(permission))
    fail(403, "Bu işlem için yetkiniz yok.");
  return session;
}
export async function requireOwner(req, options = {}) {
  const session = await getAdminSession(req, options);
  if (!session) fail(401, "Yönetici girişi gerekli.");
  if (session.role !== "owner") fail(403, "Bu işlem yalnızca baş yöneticiye açıktır.");
  return session;
}
export function adminLogoutCookie(req) {
  return `ercupsa_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    fail(403, "İstek kaynağı geçersiz.");
}
export function adminLogin(req) {
  const supplied = req.headers.get("x-admin-password") || "",
    expected = process.env.ADMIN_PASSWORD || "";
  if (
    !expected ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    fail(401, "Giriş bilgileri geçersiz.");
  return signedAdminCookie(req, ownerSession());
}
export function response(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export function guarded(handler) {
  return async (req) => {
    try {
      if (req.method !== "GET") sameOrigin(req);
      return await handler(req);
    } catch (e) {
      if (!e.status) console.error("Request failed:", e.name);
      return response(
        {
          error: e.status
            ? e.message
            : "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
        },
        e.status || 503,
      );
    }
  };
}
export function eventInput(e) {
  if (!e || typeof e !== "object") fail(400, "Etkinlik gerekli.");
  const date = text(e.date, 10, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date + "T12:00:00Z")) ||
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
  )
    fail(400, "Geçersiz tarih.");
  const time = text(e.time, 5);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    fail(400, "Geçersiz saat.");
  if (e.published != null && typeof e.published !== "boolean")
    fail(400, "Geçersiz yayın durumu.");
  if (e.images != null && (!Array.isArray(e.images) || e.images.length > 100))
    fail(400, "En fazla 100 fotoğraf eklenebilir.");
  return {
    title: text(e.title, 150, true),
    category: text(e.category, 80) || "Etkinlik",
    date,
    time,
    location: text(e.location, 200),
    description: text(e.description, 5000),
    registrationUrl: safeUrl(e.registrationUrl),
    poster: safeUrl(e.poster, true),
    images: (e.images || []).map((p) => {
      if (!p || typeof p !== "object" || !text(p.url, 2048, true))
        fail(400, "Geçersiz fotoğraf.");
      return {
        url: safeUrl(p.url, true),
        publicId: text(p.publicId, 250),
        width: Number.isInteger(p.width) ? p.width : 0,
        height: Number.isInteger(p.height) ? p.height : 0,
      };
    }),
    published: e.published !== false,
  };
}
