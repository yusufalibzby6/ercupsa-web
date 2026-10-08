import { createHash } from "node:crypto";
import { identifier } from "../lib/security.mjs";
import { readEvents } from "./events.mjs";

const origin = "https://ercupsa.com.tr";
const fallbackImage = `${origin}/og-image.jpg`;
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const compact = (value, limit) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
const styles = `*{box-sizing:border-box}body{margin:0;background:#f8f9fb;color:#242424;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}header,main,footer{max-width:900px;margin:auto;padding:24px}header a{color:#8b2323;font-weight:900;font-size:24px;text-decoration:none}.card{background:#fff;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden}.poster{display:block;width:100%;max-height:440px;object-fit:contain;background:#f4f4f5}.content{padding:28px}.eyebrow{color:#8b2323;font-weight:800;font-size:14px}h1{font-size:clamp(26px,5vw,40px);line-height:1.2;margin:12px 0 24px;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px}dt{font-size:13px;font-weight:800;color:#676767}dd{margin:4px 0 0;overflow-wrap:anywhere}.description{white-space:pre-wrap;overflow-wrap:anywhere}.action{display:inline-block;background:#8b2323;color:#fff;border-radius:14px;padding:14px 22px;font-weight:800;text-decoration:none;margin-top:12px}.secondary{display:inline-block;color:#8b2323;font-weight:700;margin:20px 0 0}.hint,footer{font-size:14px;color:#676767}@media(min-width:700px){.card{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr)}.card.no-poster{display:block}.poster{height:100%;max-height:none;object-fit:contain}.content{padding:36px}}`;
const styleHash = createHash("sha256").update(styles).digest("base64");

function publicImage(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["res.cloudinary.com", "ercupsa.com.tr"].includes(url.hostname)) return url.href;
  } catch {}
  return fallbackImage;
}

function eventDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const date = new Date(`${value}T12:00:00+03:00`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

function documentHtml({ title, description, image = fallbackImage, canonical, content, indexable = true }) {
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${indexable ? "" : '<meta name="robots" content="noindex,nofollow">'}
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:url" content="${escapeHtml(canonical)}">` : ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="ERCUPSA"><meta property="og:locale" content="tr_TR">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(image)}">
<style>${styles}</style></head><body><header><a href="/index.html">ERCUPSA</a></header>
<main>${content}</main><footer>Erciyes Üniversitesi Eczacılık Fakültesi Öğrenci Topluluğu</footer></body></html>`;
}

function htmlResponse(html, status, head = false, extraHeaders = {}) {
  return new Response(head ? null : html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8",
    // An unpublished or deleted event must stop returning its old public metadata.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${styleHash}'; img-src https://res.cloudinary.com https://ercupsa.com.tr; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    ...extraHeaders,
  } });
}

const notFound = () => documentHtml({ title: "Etkinlik bulunamadı | ERCUPSA",
  description: "Bu etkinlik bağlantısı şu anda kullanılamıyor.", indexable: false,
  content: '<article class="card no-poster"><div class="content"><h1>Etkinlik bulunamadı</h1><p>Bu etkinlik bağlantısı şu anda kullanılamıyor.</p><a class="action" href="/etkinlikler.html">Etkinlikleri keşfet</a></div></article>',
});

export function createEventShareHandler({ events = readEvents } = {}) {
  return async (req) => {
    const head = req.method === "HEAD";
    if (!["GET", "HEAD"].includes(req.method)) return htmlResponse(notFound(), 405, false, { Allow: "GET, HEAD" });
    let eventId;
    try {
      const url = new URL(req.url);
      // Netlify rewrites the public path to a function query parameter. Accept
      // the original path too, since local/proxy routing may preserve it.
      const path = /^\/etkinlik\/([^/]+)\/?$/.exec(url.pathname);
      eventId = identifier(path ? decodeURIComponent(path[1]) : url.searchParams.get("eventId"));
    } catch {
      return htmlResponse(notFound(), 404, head);
    }
    try {
      const event = (await events()).find((entry) => entry.id === eventId && entry.published !== false && entry.archived !== true);
      if (!event) return htmlResponse(notFound(), 404, head);
      const canonical = `${origin}/etkinlik/${encodeURIComponent(eventId)}`;
      const registrationPath = `/form.html?event=${encodeURIComponent(eventId)}#registrationSection`;
      const date = eventDate(event.date), time = /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time || "") ? event.time : "";
      const location = compact(event.location, 200), title = `${compact(event.title, 150)} | ERCUPSA`;
      const image = publicImage(event.poster), hasPoster = image !== fallbackImage;
      const facts = [date, time ? `${time} · Türkiye saati` : "", location].filter(Boolean).join(" · ");
      const description = compact([facts, compact(event.description, 220)].filter(Boolean).join(" — "), 500);
      // Registration availability is deliberately checked on the form page:
      // quotas and disabled/native/external forms can change after sharing.
      const content = `<article class="card${hasPoster ? "" : " no-poster"}">
${hasPoster ? `<img class="poster" src="${escapeHtml(image)}" alt="${escapeHtml(event.title)} etkinlik afişi" decoding="async">` : ""}
<div class="content"><span class="eyebrow">${escapeHtml(compact(event.category, 80) || "Etkinlik")}</span><h1>${escapeHtml(compact(event.title, 150))}</h1>
<dl><div><dt>Tarih</dt><dd>${escapeHtml(date || "Tarih bilgisi paylaşılmadı.")}</dd></div><div><dt>Saat</dt><dd>${escapeHtml(time ? `${time} · Türkiye saati` : "Saat bilgisi paylaşılmadı.")}</dd></div><div><dt>Konum</dt><dd>${escapeHtml(location || "Konum bilgisi paylaşılmadı.")}</dd></div></dl>
${event.description ? `<p class="description">${escapeHtml(String(event.description).slice(0, 5000))}</p>` : ""}
<a class="action" href="${registrationPath}">Etkinlik detayları ve kayıt formu</a><p class="hint">Kayıt formu paylaşıldıysa ve kayıtlar açıksa bu bağlantıdan ulaşabilirsin.</p>
<a class="secondary" href="/etkinlikler.html">Tüm etkinlikler</a></div></article>`;
      return htmlResponse(documentHtml({ title, description, image, canonical, content }), 200, head);
    } catch (error) {
      console.error("Event preview unavailable:", error.name);
      return htmlResponse(documentHtml({ title: "Etkinlik bilgileri | ERCUPSA",
        description: "Etkinlik bilgileri şu anda yüklenemiyor.", indexable: false,
        content: '<article class="card no-poster"><div class="content"><h1>Etkinlik bilgileri yüklenemedi</h1><p>Lütfen biraz sonra tekrar deneyin.</p><a class="action" href="/etkinlikler.html">Etkinlikleri keşfet</a></div></article>',
      }), 503, head);
    }
  };
}

export default createEventShareHandler();
