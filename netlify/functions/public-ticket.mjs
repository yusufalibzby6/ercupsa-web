import { createHash } from "node:crypto";
import { getStore as getBlobStore } from "@netlify/blobs";
import { db } from "../lib/database.mjs";
import { guarded, response, body, fail } from "../lib/security.mjs";
import { readEvents as readStoredEvents } from "./events.mjs";
import { readRegistrationTicketRestrictions, registrationTicketIsBlocked } from "../lib/registration-ticket-owners.mjs";
import { TICKET_DESIGN_WIDTH, TICKET_DESIGN_HEIGHT, TICKET_DESIGN_MAX_BYTES,
  validateTicketDesign } from "../lib/ticket-design.mjs";

const missing = () => fail(404, "Bilet bulunamadı. Bağlantıyı kontrol edin.");
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const string = (value, maximum) => typeof value === "string" ? value.slice(0, maximum) : "";

function publicDesign(design) {
  if (design == null) return null;
  // Retain only a validated raster image. No arbitrary stored properties, remote
  // URLs, SVG markup or administration metadata enter the guest response.
  try {
    if (typeof design !== "object" || Array.isArray(design) ||
        design.width !== TICKET_DESIGN_WIDTH || design.height !== TICKET_DESIGN_HEIGHT ||
        !["image/png", "image/jpeg"].includes(design.mime) ||
        typeof design.dataUrl !== "string" ||
        design.dataUrl.length > Math.ceil(TICKET_DESIGN_MAX_BYTES * 4 / 3) + 32 ||
        !design.dataUrl.startsWith(`data:${design.mime};base64,`) ||
        !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(design.dataUrl)) throw Error();
    const encoded = design.dataUrl.slice(design.dataUrl.indexOf(",") + 1);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) throw Error();
    const format = validateTicketDesign(bytes, design.mime);
    return { ...format, dataUrl: design.dataUrl,
      ...(typeof design.updatedAt === "string" && design.updatedAt.length <= 100 &&
        Number.isFinite(Date.parse(design.updatedAt)) ? { updatedAt: design.updatedAt } : {}) };
  } catch {
    fail(503, "Bilet tasarımı açılamadı. Lütfen organizatörle iletişime geçin.");
  }
}

export function createPublicTicketHandler({ read = db, readEvents = readStoredEvents,
  getStore = getBlobStore, registrationStore } = {}) {
  const handle = guarded(async req => {
    if (req.method !== "POST") fail(405, "Desteklenmeyen işlem.");
    const input = await body(req);
    if (Object.keys(input).some(key => key !== "code")) fail(400, "Geçersiz bilet isteği.");
    // Match the codes accepted by account claims and the door scanner. This is
    // a lookup of a previously issued ticket; it never issues or claims one.
    if (typeof input.code !== "string" || input.code.length > 40) missing();
    const code = input.code.toUpperCase().replace(/\s/g, "");
    if (!/^ERC-[A-F0-9]{24}$/.test(code)) missing();
    const hash = createHash("sha256").update(code).digest("hex");
    const tickets = await read(`tickets?code_hash=eq.${hash}&select=id,batch_id,event_id,code_hash,revoked&limit=2`);
    if (!Array.isArray(tickets)) fail(503, "Bilet doğrulanamadı. Lütfen tekrar deneyin.");
    if (!tickets.length) missing();
    const ticket = tickets[0];
    if (tickets.length !== 1 || !validId(ticket?.id) || !validId(ticket.batch_id) ||
        !validId(ticket.event_id) || ticket.code_hash !== hash || typeof ticket.revoked !== "boolean")
      fail(503, "Bilet doğrulanamadı. Lütfen tekrar deneyin.");
    if (ticket.revoked) fail(410, "Bu bilet iptal edilmiş. Lütfen organizatörle iletişime geçin.");
    const batches = await read(`ticket_batches?id=eq.${ticket.batch_id}&select=id,event_id,event_title,codes&limit=2`);
    if (!Array.isArray(batches)) fail(503, "Bilet doğrulanamadı. Lütfen tekrar deneyin.");
    const batch = batches[0];
    if (batches.length !== 1 || batch?.id !== ticket.batch_id || batch.event_id !== ticket.event_id ||
        !Array.isArray(batch.codes) || !batch.codes.includes(code)) missing();
    const restrictions = await readRegistrationTicketRestrictions(ticket.event_id, { store: registrationStore });
    if (registrationTicketIsBlocked(ticket, restrictions))
      fail(410, "Bu kayıt için bilet kullanılamıyor. Lütfen organizatörle iletişime geçin.");
    const events = await readEvents();
    if (!Array.isArray(events)) fail(503, "Etkinlik bilgileri alınamadı. Lütfen tekrar deneyin.");
    const current = events.find(event => event?.id === ticket.event_id);
    // Issued batches remain printable after an event is removed. Keep this
    // behavior for guest tickets, without returning an archived private event.
    const event = { id: ticket.event_id, title: string(current?.title, 150) ||
      string(batch.event_title, 150) || "ERCUPSA etkinliği", date: string(current?.date, 10),
      time: string(current?.time, 5), location: string(current?.location, 200) };
    const design = publicDesign(await getStore("ercupsa-ticket-designs").get(ticket.event_id,
      { type: "json", consistency: "strong" }));
    return response({ ticket: { code, eventId: ticket.event_id, eventTitle: event.title }, event, design });
  });
  return async req => {
    const result = await handle(req);
    // The code is a bearer capability. Neither successes nor error pages may
    // be retained by a shared CDN or a browser cache.
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Referrer-Policy", "no-referrer");
    result.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return result;
  };
}

export default createPublicTicketHandler();
