import { createHash, randomBytes } from "node:crypto";
import { fail } from "./security.mjs";

export function reserveRegistrationTicket(uuid, createdAt, eventTitle) {
  return { batchId: uuid(), code: `ERC-${randomBytes(12).toString("hex").toUpperCase()}`,
    eventTitle, reservedAt: createdAt, status: "pending" };
}

async function readReservedTicket(db, eventId, reservation) {
  const batches = await db(`ticket_batches?id=eq.${reservation.batchId}&select=id,event_id,event_title,codes`);
  if (!batches.length) return null;
  // Read after observing the committed batch. Parallel reads could straddle a
  // concurrent RPC commit and incorrectly see an absent batch with its ticket.
  const tickets = await db(`tickets?batch_id=eq.${reservation.batchId}&select=id,event_id,code_hash,claimed_at,revoked`);
  const expectedHash = createHash("sha256").update(reservation.code).digest("hex");
  if (batches.length !== 1 || batches[0].event_id !== eventId ||
    !Array.isArray(batches[0].codes) || batches[0].codes.length !== 1 ||
    batches[0].codes[0] !== reservation.code || tickets.length !== 1 ||
    tickets[0].event_id !== eventId || tickets[0].code_hash !== expectedHash)
    fail(503, "Kayıt bileti doğrulanamadı. Lütfen tekrar deneyin.");
  return tickets[0];
}

// The existing RPC atomically inserts a batch and its ticket. Its primary key
// makes the durable reservation idempotent even when the response is lost.
export async function ensureRegistrationTicket(db, eventId, reservation) {
  let ticket = await readReservedTicket(db, eventId, reservation);
  if (ticket) return ticket;
  try {
    await db("rpc/create_ticket_batch", { method: "POST", data: {
      p_id: reservation.batchId, p_event: eventId,
      p_title: reservation.eventTitle, p_codes: [reservation.code],
    } });
  } catch (error) {
    // Concurrent requests and a lost RPC response both converge on the same
    // verified record; an unrelated failure never creates a new reservation.
    ticket = await readReservedTicket(db, eventId, reservation);
    if (ticket) return ticket;
    throw error;
  }
  ticket = await readReservedTicket(db, eventId, reservation);
  if (!ticket) fail(503, "Kayıt bileti kaydedilemedi. Lütfen tekrar deneyin.");
  return ticket;
}

export async function savedRegistrationTicket(db, eventId, reservation) {
  const ticket = await readReservedTicket(db, eventId, reservation);
  if (!ticket) fail(503, "Kayıt bileti henüz hazır değil. Bilet ver düğmesiyle tekrar deneyin.");
  return ticket;
}

export async function revokeRegistrationTicket(db, eventId, reservation) {
  // Materialize before revoking, including a pending reservation. A delayed
  // issuer can then only encounter this same permanently revoked ticket.
  const ticket = await ensureRegistrationTicket(db, eventId, reservation);
  if (!ticket.revoked) await db(`tickets?id=eq.${ticket.id}`, {
    method: "PATCH", data: { revoked: true },
  });
  const confirmed = await savedRegistrationTicket(db, eventId, reservation);
  if (!confirmed.revoked) fail(503, "Kayıt bileti iptal edilemedi. Silme işlemini tekrar deneyin.");
}

export function registrationTicketResponse(reservation, ticket) {
  return { batchId: reservation.batchId, id: ticket.id, code: reservation.code,
    claimedAt: ticket.claimed_at || null, revoked: ticket.revoked === true };
}
