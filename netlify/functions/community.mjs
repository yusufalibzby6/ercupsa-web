import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import {
  guarded,
  response,
  body,
  text,
  identifier,
  fail,
  requireAdmin,
} from "../lib/security.mjs";
import { db, user } from "../lib/database.mjs";
import { readEvents } from "./events.mjs";
import { operationsStore, readCheckins } from "../lib/checkins.mjs";
const classes = ["Hazırlık", "1", "2", "3", "4", "5", "Mezun"];
export const badge = (n) =>
  n >= 5 ? "Altın" : n >= 4 ? "Gümüş" : n >= 3 ? "Bronz" : null;
async function rate(req, scope, max = 5, seconds = 3600) {
  const ip = req.headers.get("x-nf-client-connection-ip") || "local";
  const key = createHmac(
    "sha256",
    process.env.ADMIN_PASSWORD ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "local",
  )
    .update(scope + ip)
    .digest("hex");
  if (
    !(await db("rpc/check_rate", {
      method: "POST",
      data: { p_key: key, p_max: max, p_seconds: seconds },
    }))
  )
    fail(429, "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.");
}
export function createCommunityHandler({ read = db, events = readEvents, store = operationsStore } = {}) {
return guarded(async (req) => {
  const db = read;
  const url = new URL(req.url),
    action = url.searchParams.get("action") || "public";
  if (req.method === "GET" && action === "config")
    return response({
      url: process.env.SUPABASE_URL || "",
      key: process.env.SUPABASE_ANON_KEY || "",
    });
  if (req.method === "GET" && action === "public") {
    const [experiences, board] = await Promise.all([
      db(
        "submissions?kind=eq.experience&status=eq.approved&select=id,title,content,created_at&order=created_at.desc&limit=100",
      ),
      db("rpc/badge_board", { method: "POST", data: {} }),
    ]);
    return response({
      members: [],
      experiences,
      board: board.map((p) => ({ ...p, badge: badge(Number(p.total)) })),
    });
  }
  if (action === "submit" && req.method === "POST") {
    const b = await body(req);
    if (!["suggestion", "experience"].includes(b.kind))
      fail(400, "Geçersiz gönderi.");
    if (b.website) fail(400, "Gönderi kabul edilmedi.");
    const record = {
      kind: b.kind,
      title: text(b.title, 150, true),
      content: text(b.content, 3000, true),
    };
    await rate(req, "submit");
    await db("submissions", { method: "POST", data: record });
    return response({ ok: true }, 201);
  }
  if (action === "me") {
    const u = await user(req);
    if (req.method === "GET") {
      const [p, a] = await Promise.all([
        db(`profiles?id=eq.${u.id}&select=name,public_name`),
        db(
          `attendance?user_id=eq.${u.id}&select=event_id,event_title,created_at&order=created_at.desc`,
        ),
      ]);
      return response({
        profile: p[0] || null,
        attendance: a,
        total: a.length,
        badge: badge(a.length),
      });
    }
    if (req.method === "POST") {
      const b = await body(req);
      if (typeof b.public_name !== "boolean")
        fail(400, "Görünürlük tercihi gerekli.");
      await db("profiles?on_conflict=id", {
        method: "POST",
        data: {
          id: u.id,
          name: text(b.name, 120, true),
          public_name: b.public_name,
        },
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
      });
      return response({ ok: true });
    }
  }
  if (action === "claim" && req.method === "POST") {
    const u = await user(req),
      b = await body(req);
    const code = text(b.code, 40, true).toUpperCase().replace(/\s/g, "");
    await rate(req, "claim:" + u.id, 20, 3600);
    if (!/^ERC-[A-F0-9]{24}$/.test(code)) fail(400, "Bilet kodunu kontrol et.");
    const result = await db("rpc/claim_ticket", {
      method: "POST",
      data: {
        p_user: u.id,
        p_hash: createHash("sha256").update(code).digest("hex"),
      },
    });
    if (result.error) fail(409, result.error);
    return response(result);
  }
  requireAdmin(req);
  if (action === "admin" && req.method === "GET") {
    const [members, submissions, batches] = await Promise.all([
      db("members?order=created_at.desc"),
      db("submissions?order=created_at.desc&limit=500"),
      db(
        "ticket_batches?select=id,event_id,event_title,created_at&order=created_at.desc&limit=100",
      ),
    ]);
    return response({ members, submissions, batches });
  }
  if (action === "member" && req.method === "POST") {
    const b = await body(req);
    if (!classes.includes(b.class)) fail(400, "Sınıf seçmelisin.");
    const record = { name: text(b.name, 120, true), class: b.class };
    const result = await db(
      b.id ? `members?id=eq.${identifier(b.id)}` : "members",
      { method: b.id ? "PATCH" : "POST", data: record },
    );
    return response({ ok: true, members: result });
  }
  if (action === "member" && req.method === "DELETE") {
    await db(`members?id=eq.${identifier(url.searchParams.get("id"))}`, {
      method: "DELETE",
    });
    return response({ ok: true });
  }
  if (action === "moderate" && req.method === "POST") {
    const b = await body(req);
    if (!["approved", "rejected", "pending"].includes(b.status))
      fail(400, "Geçersiz durum.");
    await db(`submissions?id=eq.${identifier(b.id)}`, {
      method: "PATCH",
      data: { status: b.status },
    });
    return response({ ok: true });
  }
  if (action === "batch" && req.method === "POST") {
    const b = await body(req);
    if (!Number.isInteger(b.count) || b.count < 1 || b.count > 200)
      fail(400, "1–200 arasında bilet sayısı gir.");
    const event = (await events()).find(
      (e) => e.id === identifier(b.event_id),
    );
    if (!event) fail(404, "Etkinlik bulunamadı.");
    const codes = Array.from(
        { length: b.count },
        () => `ERC-${randomBytes(12).toString("hex").toUpperCase()}`,
      ),
      id = randomUUID();
    await db("rpc/create_ticket_batch", {
      method: "POST",
      data: {
        p_id: id,
        p_event: event.id,
        p_title: event.title,
        p_codes: codes,
      },
    });
    return response({ id, codes, event_title: event.title }, 201);
  }
  if (action === "batch" && req.method === "GET") {
    const id = identifier(url.searchParams.get("id"));
    const [batch, tickets] = await Promise.all([
      db(`ticket_batches?id=eq.${id}`),
      db(`tickets?batch_id=eq.${id}&select=id,code_hash,claimed_at,revoked`),
    ]);
    if (!batch[0]) fail(404, "Bilet grubu bulunamadı.");
    let entries = [], checkinsAvailable = false;
    try {
      entries = await readCheckins(batch[0].event_id, store());
      if (!Array.isArray(entries) || entries.some((entry) => !entry ||
          typeof entry.ticketId !== "string" || typeof entry.enteredAt !== "string" ||
          !Number.isFinite(Date.parse(entry.enteredAt)))) throw new Error("Invalid check-in data");
      checkinsAvailable = true;
    } catch {
      // A gate storage outage must not turn a claimed ticket into an entered one,
      // or report an unknown entry status as a confirmed absence.
      entries = [];
    }
    const entered = new Map(entries.map((entry) => [entry.ticketId, entry.enteredAt]));
    return response({
      ...batch[0],
      tickets: tickets.map((ticket) => ({ ...ticket, entered_at: entered.get(ticket.id) || null })),
      checkins_available: checkinsAvailable,
    });
  }
  if (action === "revoke" && req.method === "POST") {
    const b = await body(req);
    await db(`tickets?id=eq.${identifier(b.id)}&claimed_at=is.null`, {
      method: "PATCH",
      data: { revoked: true },
    });
    return response({ ok: true });
  }
  fail(405, "Desteklenmeyen işlem.");
});
}
export default createCommunityHandler();
