import { createHmac, timingSafeEqual } from "node:crypto";
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
function signature(s) {
  return createHmac("sha256", process.env.ADMIN_PASSWORD || "")
    .update(s)
    .digest("base64url");
}
export function admin(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const token = (req.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("ercupsa_admin="))
    ?.slice(14);
  if (!token) return false;
  const [expires, sign] = token.split(".");
  const expected = signature(expires || "");
  return (
    Number(expires) > Date.now() &&
    sign?.length === expected.length &&
    timingSafeEqual(Buffer.from(sign), Buffer.from(expected))
  );
}
export function requireAdmin(req) {
  if (!admin(req)) fail(401, "Yönetici girişi gerekli.");
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
  const expires = String(Date.now() + 8 * 60 * 60 * 1000);
  return `ercupsa_admin=${expires}.${signature(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
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
