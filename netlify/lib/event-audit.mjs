import { createHash } from 'node:crypto';
import { fail, identifier } from './security.mjs';

const SAFE_VALUES = new Set(['capacity', 'maxRegistrations', 'waitlistCapacity', 'waitlistEnabled', 'showRemainingCapacity', 'enabled', 'paymentEnabled', 'status', 'reviewStatus', 'trackingComplete']);
const validAt = value => typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
const values = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) if (SAFE_VALUES.has(key) && (item === null || typeof item === 'boolean' || Number.isSafeInteger(item) || typeof item === 'string' && /^[A-Za-z_ -]{1,40}$/.test(item))) result[key] = item;
  return Object.keys(result).length ? result : undefined;
};

// A small, explicitly projected event. Never copy request bodies, participant
// names, payment documents, phone numbers, answers or ticket secrets into logs.
export function auditOperation({ id, type, at, actor, eventId, before, after, relatedId } = {}) {
  if (typeof type !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(type) || !validAt(at)) fail(503, 'İşlem geçmişi doğrulanamadı.');
  const operation = { id: identifier(id), type, at, eventId: identifier(eventId) };
  if (actor && typeof actor.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(actor.id) && typeof actor.username === 'string' && /^[a-z0-9][a-z0-9._-]{2,49}$/.test(actor.username)) operation.actor = { id: actor.id, username: actor.username };
  if (relatedId != null) operation.relatedId = identifier(relatedId);
  for (const [key, value] of [['before', values(before)], ['after', values(after)]]) if (value) operation[key] = value;
  return operation;
}

export function appendAudit(state, event) {
  const operation = auditOperation(event), history = state.audit ?? [];
  if (!Array.isArray(history)) fail(503, 'İşlem geçmişi doğrulanamadı.');
  if (history.some(item => item.id === operation.id)) return state;
  if (history.length >= 10000) fail(503, 'İşlem geçmişi arşivlenmeden yeni işlem kaydedilemiyor.');
  state.audit = [...history, operation];
  return state;
}

export function projectAuditOperation(operation, eventId, origin = 'event', index = 0) {
  if (!operation || typeof operation.type !== 'string' || !validAt(operation.at)) return null;
  try {
    const id = operation.id || createHash('sha256').update(JSON.stringify([eventId, origin, index, operation.type, operation.at, operation.actor?.id])).digest('hex');
    return auditOperation({ ...operation, id, eventId });
  } catch { return null; }
}
