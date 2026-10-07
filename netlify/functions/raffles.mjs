import { getStore } from '@netlify/blobs';
import { guarded, requireAdmin, response, body, identifier, fail, HttpError } from '../lib/security.mjs';
import { db } from '../lib/database.mjs';
import { readEvents } from './events.mjs';
import { readCheckins } from '../lib/checkins.mjs';
import { paged, participantsFor, poolVersion, drawChances, drawInput, weightedWinners, savedDraw, drawHistory, saveDraw, deleteDraw, updatePrize, RaffleError, raffleFail } from '../lib/raffles.mjs';

export function createHandler({ read = db, events = readEvents, checkins = readCheckins, store = () => getStore({ name: 'ercupsa-raffles', consistency: 'strong' }) } = {}) {
  async function pool(eventId, { checkedInOnly = false, checkinBonus = false } = {}) {
    const now = Date.now(), cutoff = encodeURIComponent(new Date(now).toISOString());
    const allEvents = await events();
    const event = allEvents.find(e => e.id === eventId);
    if (!event) fail(404, 'Etkinlik bulunamadı.');
    // attendance is written by claim_ticket when a QR ticket is added to an
    // account. A cutoff and keyset pages avoid admitting later claims partway
    // through a read or skipping unrelated people after an earlier deletion.
    const selected = await paged(`attendance?event_id=eq.${encodeURIComponent(eventId)}&created_at=lte.${cutoff}&select=user_id,event_id,ticket_id,created_at&order=user_id.asc,event_id.asc`, read, { cursor: ['user_id', 'event_id'] });
    const ids = [...new Set(selected.map(a => identifier(a.user_id)))];
    let attendance = [], profiles = [];
    for (let i = 0; i < ids.length; i += 100) {
      const filter = ids.slice(i, i + 100).join(',');
      const [a, p] = await Promise.all([
        paged(`attendance?user_id=in.(${filter})&created_at=lte.${cutoff}&select=user_id,event_id,ticket_id,created_at&order=user_id.asc,event_id.asc`, read, { cursor: ['user_id', 'event_id'] }),
        paged(`profiles?id=in.(${filter})&select=id,name&order=id.asc`, read, { cursor: ['id'] }),
      ]);
      attendance.push(...a); profiles.push(...p);
    }
    const entryMap = new Map();
    const selectedDate = `${event.date}T${event.time || '00:00'}`;
    const needed = allEvents.filter(item => checkedInOnly && item.id === eventId || checkinBonus &&
      `${item.date}T${item.time || '00:00'}` < selectedDate && Number.isFinite(Date.parse(`${item.date}T${item.time || '00:00'}:00+03:00`)) &&
      Date.parse(`${item.date}T${item.time || '00:00'}:00+03:00`) <= now);
    // Default mode does not depend on the entry store. Bound concurrent reads
    // when an administrator explicitly chooses verified entry attendance.
    for (let i = 0; i < needed.length; i += 10) {
      await Promise.all(needed.slice(i, i + 10).map(async item => {
        const rows = await checkins(item.id);
        if (!Array.isArray(rows)) fail(503, 'Giriş kayıtları doğrulanamadı.');
        entryMap.set(item.id, rows);
      }));
    }
    const modes = { checkedInOnly, checkinBonus };
    const participants = participantsFor(event, allEvents, attendance, profiles, now, { ...modes, checkins: entryMap });
    return { event, participants, ...modes, poolVersion: poolVersion(eventId, participants, modes) };
  }
  return guarded(async req => {
    requireAdmin(req);
    try {
      const url = new URL(req.url), storage = store();
      if (req.method === 'GET') {
        const eventId = identifier(url.searchParams.get('eventId'));
        if (url.searchParams.get('action') === 'result') {
          return response({ draw: await savedDraw(storage, eventId, identifier(url.searchParams.get('requestId'))) });
        }
        if (url.searchParams.get('action') === 'history') {
          return response({ draws: await drawHistory(storage, eventId) });
        }
        const modes = {};
        for (const key of ['checkedInOnly', 'checkinBonus']) {
          const value = url.searchParams.get(key);
          if (value !== null && !['true', 'false'].includes(value)) fail(400, 'Geçersiz giriş seçimi.');
          modes[key] = value === 'true';
        }
        const result = await pool(eventId, modes);
        return response({ ...result, draws: await drawHistory(storage, eventId) });
      }
      if (req.method === 'POST') {
        let payload;
        try {
          payload = await body(req);
        } catch (error) {
          // These failures happen before a draw can be written. A generic 413
          // must not strand clients in the uncertain-result retry state.
          if (error instanceof HttpError && [400, 413, 415].includes(error.status)) {
            raffleFail(error.status, 'RAFFLE_INVALID_SELECTION', error.message);
          }
          throw error;
        }
        if (url.searchParams.get('action') === 'prize') {
          const draw = await updatePrize(storage, identifier(payload.eventId), identifier(payload.id), identifier(payload.winnerId), payload.delivered);
          return response({ draw });
        }
        const input = drawInput(payload);
        const draw = await saveDraw(storage, input, async () => {
          if (!input.poolVersion) raffleFail(400, 'RAFFLE_POOL_REQUIRED', 'Çekilişten önce katılımcı listesini yükleyin.');
          const checkedInOnly = input.checkedInOnly ?? false, checkinBonus = input.checkinBonus ?? false;
          const { event, participants, poolVersion: actualVersion } = await pool(input.eventId, { checkedInOnly, checkinBonus });
          if (input.poolVersion !== actualVersion) raffleFail(409, 'RAFFLE_POOL_CHANGED', 'Katılımcı listesi veya çekiliş hakları değişti. Listeyi yenileyip yeniden başlatın.');
          if (input.excluded.some(id => !participants.some(p => p.id === id))) raffleFail(409, 'RAFFLE_INVALID_SELECTION', 'Katılımcı seçimi geçersiz. Listeyi yenileyin.');
          const loyaltyBonus = input.loyaltyBonus ?? true;
          const included = drawChances(participants.filter(p => !input.excluded.includes(p.id)), loyaltyBonus);
          return { id: input.id, hash: input.hash, eventId: input.eventId, eventTitle: event.title, poolVersion: actualVersion, loyaltyBonus, checkedInOnly, checkinBonus, createdAt: new Date().toISOString(), excluded: input.excluded, participants: included, winners: weightedWinners(included, input.count) };
        });
        return response({ draw });
      }
      if (req.method === 'DELETE') {
        const input = await body(req);
        await deleteDraw(storage, identifier(input.eventId), identifier(input.id));
        return response({ ok: true });
      }
      fail(405, 'Desteklenmeyen işlem.');
    } catch (error) {
      if (error instanceof RaffleError) return response({ error: error.message, code: error.code }, error.status);
      throw error;
    }
  });
}
export default createHandler();
