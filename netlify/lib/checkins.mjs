import { getStore } from '@netlify/blobs';
import { identifier } from './security.mjs';
import { JSON_READ, mutateJson } from './blob-state.mjs';

export const operationsStore = () => getStore({ name: 'ercupsa-operations', consistency: 'strong' });
export const checkinKey = eventId => `checkins/events/${identifier(eventId)}.json`;
export async function readCheckins(eventId, store = operationsStore()) {
  return (await store.get(checkinKey(eventId), JSON_READ))?.entries || [];
}
export async function enterTicket(store, eventId, entry) {
  return mutateJson(store, checkinKey(eventId), { entries: [] }, state => {
    const existing = state.entries.find(item => item.ticketId === entry.ticketId);
    if (existing) return { write: false, result: { status: 'already', entry: existing } };
    state.entries.push(entry);
    return { result: { status: 'entered', entry } };
  });
}
