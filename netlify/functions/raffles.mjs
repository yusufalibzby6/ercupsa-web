import { getStore } from '@netlify/blobs';
import { guarded, requireAdmin, response, body, identifier, fail } from '../lib/security.mjs';
import { db } from '../lib/database.mjs';
import { readEvents } from './events.mjs';
import { paged, participantsFor, drawInput, weightedWinners, saveDraw, deleteDraw } from '../lib/raffles.mjs';

export function createHandler({ read = db, events = readEvents, store = () => getStore({ name: 'ercupsa-raffles', consistency: 'strong' }) } = {}) {
  async function pool(eventId) {
    const allEvents = await events();
    const event = allEvents.find(e => e.id === eventId);
    if (!event) fail(404, 'Etkinlik bulunamadı.');
    // attendance is written by claim_ticket when a QR ticket is added to an account.
    const selected = await paged(`attendance?event_id=eq.${encodeURIComponent(eventId)}&select=user_id,event_id,created_at&order=user_id.asc,event_id.asc`, read);
    const ids = [...new Set(selected.map(a => identifier(a.user_id)))];
    let attendance = [], profiles = [];
    for (let i = 0; i < ids.length; i += 100) {
      const filter = ids.slice(i, i + 100).join(',');
      const [a, p] = await Promise.all([
        paged(`attendance?user_id=in.(${filter})&select=user_id,event_id,created_at&order=user_id.asc,event_id.asc`, read),
        paged(`profiles?id=in.(${filter})&select=id,name&order=id.asc`, read),
      ]);
      attendance.push(...a); profiles.push(...p);
    }
    return { event, participants: participantsFor(event, allEvents, attendance, profiles) };
  }
  return guarded(async req => {
    requireAdmin(req);
    const url = new URL(req.url), storage = store();
    if (req.method === 'GET') {
      const eventId = identifier(url.searchParams.get('eventId'));
      const result = await pool(eventId);
      const saved = await storage.get(`events/${eventId}.json`, { type: 'json', consistency: 'strong' });
      return response({ ...result, draws: (saved?.draws || []).filter(d => !d.deleted) });
    }
    if (req.method === 'POST') {
      const input = drawInput(await body(req));
      const draw = await saveDraw(storage, input, async () => {
        const { event, participants } = await pool(input.eventId);
        if (input.excluded.some(id => !participants.some(p => p.id === id))) fail(409, 'Katılımcı listesi değişti. Listeyi yenileyin.');
        const included = participants.filter(p => !input.excluded.includes(p.id));
        return { id: input.id, hash: input.hash, eventId: input.eventId, eventTitle: event.title, createdAt: new Date().toISOString(), excluded: input.excluded, participants: included, winners: weightedWinners(included, input.count) };
      });
      return response({ draw });
    }
    if (req.method === 'DELETE') {
      const input = await body(req);
      await deleteDraw(storage, identifier(input.eventId), identifier(input.id));
      return response({ ok: true });
    }
    fail(405, 'Desteklenmeyen işlem.');
  });
}
export default createHandler();
