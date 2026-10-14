import { createHash } from "node:crypto";
import { eventInput, fail, identifier } from "./security.mjs";

export const EVENTS_KEY = "events.json";
export const CONTENT_STORE = "ercupsa-content";
const OPERATIONS = new Set(["create", "update", "publish", "unpublish", "delete", "restore", "recover", "purge"]);
const dateStamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
export const isDeletedEvent = event => event?.deleted === true;
export const isPurgedEvent = event => isDeletedEvent(event) && event.purged === true;
const operationActor = actor => actor && typeof actor.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(actor.id) &&
  typeof actor.username === "string" && /^[a-z0-9][a-z0-9._-]{2,49}$/.test(actor.username)
  ? { id: actor.id, username: actor.username } : undefined;
export const eventOperation = (type, at, actor) => ({ type, at, ...(operationActor(actor) ? { actor: operationActor(actor) } : {}) });

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
    value.lastOperation = eventOperation(event.lastOperation.type, event.lastOperation.at, event.lastOperation.actor);
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
        if (!dateStamp(event.deletedAt) ||
            typeof event.revision !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(event.revision)) throw Error("Invalid archive");
        if (isPurgedEvent(event)) {
          if (!dateStamp(event.purgedAt) || event.event != null) throw Error("Invalid purge marker");
        } else {
          if (event.event?.id !== id) throw Error("Invalid archive");
          projectEvent(event.event);
        }
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
export function operationHistory(event, type, at, actor) {
  const previous = Array.isArray(event?.operations) ? event.operations.filter(operation =>
    OPERATIONS.has(operation?.type) && dateStamp(operation.at)).slice(-19) : [];
  return [...previous.map(operation => eventOperation(operation.type, operation.at, operation.actor)), eventOperation(type, at, actor)];
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
