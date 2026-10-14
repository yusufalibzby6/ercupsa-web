import { createHash } from "node:crypto";
import { eventInput, fail, identifier } from "./security.mjs";

export const EVENTS_KEY = "events.json";
export const CONTENT_STORE = "ercupsa-content";
const OPERATIONS = new Set(["create", "update", "publish", "unpublish", "delete", "restore", "recover"]);
const dateStamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
export const isDeletedEvent = event => event?.deleted === true;

export function eventRevision(event) {
  if (typeof event.revision === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(event.revision)) return event.revision;
  return createHash("sha256").update(JSON.stringify({ ...eventInput(event), id: identifier(event.id),
    createdAt: dateStamp(event.createdAt), updatedAt: dateStamp(event.updatedAt) })).digest("hex");
}

export function projectEvent(event, admin = false) {
  const value = { ...eventInput(event), id: identifier(event.id),
    ...(dateStamp(event.createdAt) ? { createdAt: event.createdAt } : {}),
    ...(dateStamp(event.updatedAt) ? { updatedAt: event.updatedAt } : {}), revision: eventRevision(event) };
  if (admin && OPERATIONS.has(event.lastOperation?.type) && dateStamp(event.lastOperation.at))
    value.lastOperation = { type: event.lastOperation.type, at: event.lastOperation.at };
  return value;
}

// Keep active events and their recoverable tombstones in the same conditional
// write. A separate backup write could lose the archive during a concurrent save.
export function eventArray(value, fallback) {
  const events = value == null ? structuredClone(fallback) : value;
  if (!Array.isArray(events)) fail(503, "Etkinlik listesi doğrulanamadı.");
  const ids = new Set();
  try {
    for (const event of events) {
      const id = identifier(event?.id);
      if (ids.has(id)) throw Error("Duplicate event");
      ids.add(id);
      if (isDeletedEvent(event)) {
        if (event.event?.id !== id || !dateStamp(event.deletedAt) ||
            typeof event.revision !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(event.revision)) throw Error("Invalid archive");
        projectEvent(event.event);
      } else projectEvent(event);
    }
  } catch { fail(503, "Etkinlik listesi doğrulanamadı."); }
  return events;
}

export const activeEvents = (events, admin = false) => events.filter(event => !isDeletedEvent(event)).map(event => projectEvent(event, admin));
export function assertEventRevision(expected, actual) {
  if (typeof expected !== "string" || expected !== actual)
    fail(409, "Etkinlik başka bir işlemde değişmiş. Listeyi yenileyip tekrar deneyin.");
}
export function operationHistory(event, type, at) {
  const previous = Array.isArray(event?.operations) ? event.operations.filter(operation =>
    OPERATIONS.has(operation?.type) && dateStamp(operation.at)).slice(-19) : [];
  return [...previous.map(operation => ({ type: operation.type, at: operation.at })), { type, at }];
}

// Only the dedicated event snapshot is used. Participant names, answers,
// receipts, ticket codes and registration fingerprints are never inspected.
export function registrationRecovery(state, id) {
  if (!state?.event || state.event.id !== id || (state.eventId != null && state.eventId !== id)) return null;
  try {
    const event = { ...eventInput({ title: state.event.title, date: state.event.date,
      time: state.event.time || "", location: state.event.location || "", published: false }), id: identifier(id) };
    const revision = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    return { id, event, revision, source: "registrations" };
  } catch { return null; }
}
